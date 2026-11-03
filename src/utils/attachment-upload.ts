/**
 * 附件分片上传编排（多团队 DESIGN §11、PLAN §M5）。
 *
 * 协议已由 M0 裁决为 **function-chunks-v1**：客户端把文件切成固定 256KiB 片，
 * 经云函数（rakFiles）代传；服务端负责组装、校验与发布（见 server/modules/files）。
 *
 * 本模块**纯逻辑、不依赖 Taro、不直接调云**，便于单测注入替身；真实文件读取与
 * 云调用在 `src/services/cloud/attachment.ts`。
 *
 * 一致性：分片长度/总数与本地计划必须由服务端回显一致后才继续（防契约漂移/串队）；
 * 任一分片失败 → 尽力取消会话后**显式抛出**，绝不伪造成功。
 */

export const CHUNK_BYTES = 256 * 1024
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const MAX_CONCURRENCY = 2

export interface PlannedChunk {
  index: number
  offset: number
  length: number
}

/** 依据文件字节数规划分片：中间片固定 256KiB，末片为剩余长度。 */
export function planChunks(size: number): PlannedChunk[] {
  if (!Number.isInteger(size) || size < 1 || size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`附件大小需在 1B..${MAX_ATTACHMENT_BYTES}B`)
  }
  const chunks: PlannedChunk[] = []
  let offset = 0
  let index = 0
  while (offset < size) {
    const length = Math.min(CHUNK_BYTES, size - offset)
    chunks.push({ index, offset, length })
    offset += length
    index += 1
  }
  return chunks
}

/** 客户端可见的会话（服务端不向客户端下发 fileID/URL）。 */
export interface UploadSession {
  sessionId: string
  declaredSize: number
  chunkBytes: number
  totalChunks: number
  uploadExpiresAt: string
  missingIndexes?: number[]
}

export interface AttachmentSummary {
  attachmentId: string
  name: string
  size: number
  sha256: string
  integrityState: string
  scanState: string
  lifecycleState: string
}

/** 已发布附件 + 会话 id（移除/离开页面时需要取消会话释放槽位）。 */
export interface UploadedAttachment extends AttachmentSummary {
  sessionId: string
}

export interface AttachmentRowState {
  status: 'UPLOADING' | 'READY' | 'FAILED'
  attachmentId?: string
}

/**
 * 提交前的唯一附件集合出口：只收集 READY；存在 UPLOADING/FAILED 时返回阻断原因。
 * READY 缺 attachmentId 视为 FAILED（防御内部状态不一致）。
 */
export function collectAttachmentIds(rows: AttachmentRowState[]): {
  ids: string[]
  blocker: 'UPLOADING' | 'FAILED' | null
} {
  if (rows.some((row) => row.status === 'UPLOADING')) return { ids: [], blocker: 'UPLOADING' }
  if (rows.some((row) => row.status === 'FAILED')) return { ids: [], blocker: 'FAILED' }
  const ids: string[] = []
  for (const row of rows) {
    if (typeof row.attachmentId !== 'string' || row.attachmentId.length === 0) {
      return { ids: [], blocker: 'FAILED' }
    }
    ids.push(row.attachmentId)
  }
  return { ids, blocker: null }
}

export interface AttachmentTransport {
  init(input: {
    taskId: string
    expectedTaskRevision: number
    name: string
    declaredSize: number
  }): Promise<UploadSession>
  putChunk(input: { sessionId: string; index: number; base64: string }): Promise<{ index: number; size: number; sha256: string }>
  status(sessionId: string): Promise<UploadSession>
  confirm(sessionId: string): Promise<AttachmentSummary>
  cancel(sessionId: string): Promise<void>
}

export interface ChunkSource {
  /** 读取 [offset, offset+length) 的 base64 数据。 */
  readBase64(offset: number, length: number): Promise<string>
}

export interface UploadTaskAttachmentInput {
  taskId: string
  expectedTaskRevision: number
  name: string
  size: number
  transport: AttachmentTransport
  source: ChunkSource
  onProgress?: (done: number, total: number) => void
}

/** 有限并发执行（默认 2）。任一分片抛错即整体失败。 */
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      await worker(items[index])
    }
  })
  await Promise.all(runners)
}

/** 一次重试：分片写入按 (index, 内容) 幂等，重试同一片是安全的（不新占资源）。 */
async function withOneRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch {
    return fn()
  }
}

export async function uploadTaskAttachment(input: UploadTaskAttachmentInput): Promise<UploadedAttachment> {
  const planned = planChunks(input.size)
  const session = await input.transport.init({
    taskId: input.taskId,
    expectedTaskRevision: input.expectedTaskRevision,
    name: input.name,
    declaredSize: input.size,
  })

  // 服务端回显必须与本地计划一致，否则拒绝继续（不猜测、不降级）
  if (session.declaredSize !== input.size) throw new Error('服务端声明的附件大小与本地不一致')
  if (session.chunkBytes !== CHUNK_BYTES) throw new Error(`服务端分片长度与约定不一致：${session.chunkBytes}`)
  if (session.totalChunks !== planned.length) throw new Error('服务端分片数与本地计划不一致')

  let done = 0
  try {
    await runPool(planned, MAX_CONCURRENCY, async (chunk) => {
      const base64 = await input.source.readBase64(chunk.offset, chunk.length)
      await withOneRetry(() => input.transport.putChunk({ sessionId: session.sessionId, index: chunk.index, base64 }))
      done += 1
      input.onProgress?.(done, planned.length)
    })
  } catch (error) {
    await input.transport.cancel(session.sessionId).catch(() => undefined)
    throw error
  }

  // 确认前再对账一次：服务端仍报告缺片 → 不进入确认
  const status = await input.transport.status(session.sessionId)
  const missing = status.missingIndexes ?? []
  if (missing.length > 0) {
    await input.transport.cancel(session.sessionId).catch(() => undefined)
    throw new Error(`分片未全部就绪：缺 ${missing.join(',')}`)
  }
  const summary = await input.transport.confirm(session.sessionId)
  return { ...summary, sessionId: session.sessionId }
}
