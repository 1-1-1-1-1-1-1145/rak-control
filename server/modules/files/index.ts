import { createHash } from 'node:crypto'
import { AppError } from '../../contracts/errors.ts'
import { actionsFor } from '../../contracts/actions.ts'
import type { ParsedRequest } from '../../contracts/request-v2.ts'
import type { HandlerMap } from '../../entrypoints/dispatch.ts'
import type { Database, Doc, Tx } from '../../repositories/store.ts'
import { COLLECTIONS } from '../../repositories/collections.ts'
import { identityId, randomId, sha256Hex } from '../../repositories/ids.ts'
import { writeAudit } from '../../shared/audit.ts'
import { assertTrustedIdentity, type TrustedIdentity } from '../../shared/identity.ts'
import { resolveTenant } from '../context.ts'
import { getIdempotentReplay, runIdempotent } from '../command.ts'
import type { StorageAdapter } from '../../storage/adapter.ts'

/**
 * 私有附件模块：`function-chunks-v1` 服务端（多团队 DESIGN §11、PLAN §M5）。
 *
 * 裁决依据（2026-10-17 M0 探针实测，见 docs/verification/cloudbase-capabilities-2026-10-17.md §3.1）：
 * - 首选「云函数签发 exact-key 受限 PUT + `copyFile overwrite:false` 冻结」的关键能力**不成立**
 *   （SDK 无凭证签发 API、无 `copyFile`，同路径上传直接覆盖）→ 裁决走 **受控分块**；
 * - 私有临时 URL 的**实际 TTL 不可控**（`maxAge` 未被实际执行）→ 下载改为**云函数代理**（受控），
 *   **不伪造 expiresAt**；因此本模块不下发任何 fileID/URL 给客户端。
 *
 * 不变量：
 * - 每件 1B..10MiB；单件固定 3 槽预占（batch），**只递增 batch revision，不动 task 业务 revision**；
 * - session 绑定 club/task/uploaderMember/revision/round，派生记录 clubId 必须一致，不可重绑；
 * - 分片不可变：`index` 定长 256KiB，末片必须精确等于剩余长度；同 index 同内容幂等、异内容冲突；
 * - **副作用先登记**：先登记 chunk 记录，再上传对象，最后回写状态；事务内不塞网络/存储副作用；
 * - 交付前有界读回 + 逐片 hash 复核 + 组装总长校验；`scanState=NOT_CONFIGURED` **如实标注未做病毒扫描**；
 * - 期限：`uploadExpiresAt = init + 30 分钟`、`confirmedUntil = confirm + 24 小时`。
 *
 * 未实现（明确 not_implemented，不静默、不伪造）：
 * - `file.downloadUrls` / `file.previewDraft`：受控（函数代理）下载的**响应体量/流式能力尚未实测**，
 *   在取得证据前不下发任何下载地址；
 * - worker（file-verification/storage-cleanup/reconcile）与存储 SDK 绑定在 M8。
 */

export const TRANSPORT = 'function-chunks-v1' as const
export const MAX_ATTACHMENTS = 3
export const MIN_OBJECT_BYTES = 1
export const MAX_OBJECT_BYTES = 10 * 1024 * 1024
export const CHUNK_BYTES = 256 * 1024
export const UPLOAD_TTL_MS = 30 * 60 * 1000
export const CONFIRMED_TTL_MS = 24 * 60 * 60 * 1000

export type UploadSessionState = 'DRAFT' | 'UPLOADING' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED'
export type ChunkState = 'PENDING' | 'STORED' | 'GC_PENDING'
export type IntegrityState = 'PENDING' | 'VERIFIED'
export type LifecycleState = 'DRAFT' | 'ATTACHED' | 'GC_PENDING'

export interface FilesDeps {
  db: Database
  now: () => number
  storage: StorageAdapter
}

export interface FilesRuntime {
  db: Database
  now: () => number
  expected: { appId: string; env: string }
  identity: () => TrustedIdentity | null
  storage: StorageAdapter
}

/** 对客户端暴露的 session 视图：**不含** fileID / 对象路径 / 任何 URL。 */
export interface UploadSessionView {
  sessionId: string
  clubId: string
  taskId: string
  targetRound: number
  name: string
  declaredSize: number
  chunkBytes: number
  totalChunks: number
  transport: typeof TRANSPORT
  state: UploadSessionState
  uploadExpiresAt: string
  receivedIndexes: number[]
  missingIndexes: number[]
}

/** 对客户端暴露的附件视图：同样**不含** fileID。 */
export interface AttachmentView {
  attachmentId: string
  clubId: string
  taskId: string
  name: string
  size: number
  sha256: string
  integrityState: IntegrityState
  scanState: 'NOT_CONFIGURED'
  lifecycleState: LifecycleState
  confirmedUntil: string | null
}

interface BatchSlot {
  index: number
  sessionId: string | null
  state: 'EMPTY' | 'OCCUPIED'
}

function iso(value: unknown): string | null {
  return typeof value === 'number' ? new Date(value).toISOString() : null
}

function actorIdentityId(trusted: { appId: string; openid: string }): string {
  return identityId(trusted.appId, trusted.openid)
}

/** 与任务模块固定的 batch 契约（M4 已按此读取）：hash(clubId,taskId,targetRound)。 */
function batchIdFor(clubId: string, taskId: string, targetRound: number): string {
  return sha256Hex(JSON.stringify(['rak-batch-v1', clubId, taskId, targetRound]))
}

function chunkDocId(clubId: string, sessionId: string, index: number): string {
  return sha256Hex(JSON.stringify(['rak-chunk-v1', clubId, sessionId, index]))
}

/** 服务端生成的唯一对象路径（DESIGN §11.1）：前缀只做组织，不代替授权。 */
function chunkObjectPath(clubId: string, sessionId: string, index: number): string {
  return `clubs/${clubId}/staging/${sessionId}/chunks/${String(index).padStart(4, '0')}`
}

function finalObjectPath(clubId: string, sessionId: string, attachmentId: string): string {
  return `clubs/${clubId}/final/${sessionId}/${attachmentId}/blob`
}

function chunkCount(declaredSize: number): number {
  return Math.max(1, Math.ceil(declaredSize / CHUNK_BYTES))
}

function emptySlots(): BatchSlot[] {
  return [0, 1, 2].map((index) => ({ index, sessionId: null, state: 'EMPTY' }))
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex')
}

/** 严格 base64 校验后解码（拒绝非法字符/长度）。 */
function decodeBase64(input: unknown): Uint8Array {
  if (typeof input !== 'string' || input.length === 0 || input.length % 4 !== 0) {
    throw new AppError('validation_failed', 'base64 非法')
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input)) throw new AppError('validation_failed', 'base64 含非法字符')
  const buf = Buffer.from(input, 'base64')
  return new Uint8Array(buf)
}

function validateName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim() : ''
  if (name.length === 0 || name.length > 120) throw new AppError('validation_failed', '文件名长度需在 1..120')
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new AppError('validation_failed', '文件名含控制字符')
  return name
}

function teamClubId(req: ParsedRequest): string {
  const scope = req.request.scope
  if (scope.kind !== 'TEAM') throw new AppError('scope_mismatch', '本动作需要 TEAM scope')
  return scope.clubId
}

/** 同一事务内解析并校验 session 归属（clubId 必须等于 scope.clubId）。 */
interface SessionContext {
  tenant: Awaited<ReturnType<typeof resolveTenant>>
  session: Doc
}

async function loadSession(tx: Tx, trusted: { appId: string; openid: string }, clubId: string, sessionId: string): Promise<SessionContext> {
  const tenant = await resolveTenant(tx, trusted, clubId)
  const session = await tx.get(COLLECTIONS.uploadSessions, sessionId)
  if (!session || session.clubId !== clubId) throw new AppError('resource_not_found')
  if (session.uploaderMemberId !== tenant.member._id) throw new AppError('permission_denied', '仅本会话上传者可操作')
  return { tenant, session }
}

function assertNotExpired(session: Doc, now: number): void {
  if (session.state === 'CANCELLED') throw new AppError('upload_cancelled')
  if (session.state === 'CONFIRMED') throw new AppError('invalid_transition', '会话已确认')
  const expiresAt = session.uploadExpiresAt as number
  if (typeof expiresAt === 'number' && now > expiresAt) throw new AppError('upload_expired')
}

function toSessionView(session: Doc, storedIndexes: number[]): UploadSessionView {
  const total = session.totalChunks as number
  const received = [...storedIndexes].sort((a, b) => a - b)
  const missing: number[] = []
  for (let i = 0; i < total; i += 1) if (!received.includes(i)) missing.push(i)
  return {
    sessionId: session._id,
    clubId: session.clubId as string,
    taskId: session.taskId as string,
    targetRound: session.targetRound as number,
    name: session.name as string,
    declaredSize: session.declaredSize as number,
    chunkBytes: session.chunkBytes as number,
    totalChunks: total,
    transport: TRANSPORT,
    state: session.state as UploadSessionState,
    uploadExpiresAt: iso(session.uploadExpiresAt) as string,
    receivedIndexes: received,
    missingIndexes: missing,
  }
}

export function toAttachmentView(attachment: Doc): AttachmentView {
  return {
    attachmentId: attachment._id,
    clubId: attachment.clubId as string,
    taskId: attachment.taskId as string,
    name: attachment.name as string,
    size: attachment.size as number,
    sha256: attachment.sha256 as string,
    integrityState: attachment.integrityState as IntegrityState,
    scanState: 'NOT_CONFIGURED',
    lifecycleState: attachment.lifecycleState as LifecycleState,
    confirmedUntil: iso(attachment.confirmedUntil),
  }
}

async function storedIndexesOf(deps: FilesDeps, clubId: string, sessionId: string): Promise<number[]> {
  return (await deps.db.query(COLLECTIONS.uploadChunks, (doc) => doc.clubId === clubId && doc.sessionId === sessionId && doc.state === 'STORED'))
    .map((doc) => doc.index as number)
}

/** 冲突/停用不得签发新会话：先解析本队授权并校验任务与负责人关系。 */
export async function fileInit(
  deps: FilesDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  input: { taskId: string; expectedTaskRevision: number; name: string; declaredSize: number; mutationId: string }
): Promise<UploadSessionView> {
  const now = deps.now()
  const name = validateName(input.name)
  const declaredSize = input.declaredSize
  if (!Number.isInteger(declaredSize) || declaredSize < MIN_OBJECT_BYTES || declaredSize > MAX_OBJECT_BYTES) {
    throw new AppError('validation_failed', `单件大小需在 ${MIN_OBJECT_BYTES}B..${MAX_OBJECT_BYTES}B`)
  }

  const run = await runIdempotent(
    deps.db,
    now,
    {
      scope: { kind: 'TEAM', clubId },
      actorIdentityId: actorIdentityId(trusted),
      action: 'file.init',
      mutationId: input.mutationId,
      data: { taskId: input.taskId, expectedTaskRevision: input.expectedTaskRevision, name, declaredSize },
    },
    async (tx) => {
      const tenant = await resolveTenant(tx, trusted, clubId)
      const task = await tx.get(COLLECTIONS.tasks, input.taskId)
      if (!task || task.clubId !== clubId) throw new AppError('resource_not_found')
      if ((task.revision as number) !== input.expectedTaskRevision) throw new AppError('revision_conflict')
      if (task.assigneeMemberId !== tenant.member._id) throw new AppError('permission_denied', '仅当前负责人可上传附件')
      if (task.status !== 'CLAIMED' && task.status !== 'REJECTED') {
        throw new AppError('invalid_transition', '当前任务状态不可上传附件')
      }

      const targetRound = ((task.currentRound as number) ?? 0) + 1
      const batchId = batchIdFor(clubId, input.taskId, targetRound)
      const existing = await tx.get(COLLECTIONS.uploadBatches, batchId)
      if (existing && existing.state === 'CLOSED') throw new AppError('invalid_transition', '本轮附件批次已封闭')
      const batch: Doc =
        existing ??
        ({
          _id: batchId,
          clubId,
          taskId: input.taskId,
          targetRound,
          ownerMemberId: tenant.member._id,
          slots: emptySlots(),
          state: 'OPEN',
          revision: 1,
          createdAt: now,
          updatedAt: now,
        } satisfies Doc)
      let slots = (batch.slots as BatchSlot[] | undefined) ?? emptySlots()
      // 回收过期/作废占位：否则放弃上传后本批会在 TTL 内无法继续添加
      for (const slot of [...slots]) {
        if (slot.state !== 'OCCUPIED' || typeof slot.sessionId !== 'string') continue
        const session = await tx.get(COLLECTIONS.uploadSessions, slot.sessionId)
        let release = false
        if (!session || session.state === 'CANCELLED' || session.state === 'EXPIRED') {
          release = true
        } else if (
          (session.state === 'DRAFT' || session.state === 'UPLOADING') &&
          typeof session.uploadExpiresAt === 'number' &&
          now > session.uploadExpiresAt
        ) {
          const totalChunks = (session.totalChunks as number) ?? 0
          for (let i = 0; i < totalChunks; i += 1) {
            const chunk = await tx.get(COLLECTIONS.uploadChunks, chunkDocId(clubId, slot.sessionId, i))
            if (chunk) await tx.set(COLLECTIONS.uploadChunks, { ...chunk, state: 'GC_PENDING', updatedAt: now })
          }
          await tx.set(COLLECTIONS.uploadSessions, {
            ...session,
            state: 'EXPIRED',
            fence: ((session.fence as number) ?? 0) + 1,
            updatedAt: now,
          })
          release = true
        } else if (session.state === 'CONFIRMED' && typeof session.attachmentId === 'string') {
          const attachment = await tx.get(COLLECTIONS.attachments, session.attachmentId)
          const expired =
            attachment !== null &&
            typeof attachment.confirmedUntil === 'number' &&
            now > attachment.confirmedUntil
          if (attachment && attachment.lifecycleState === 'DRAFT' && expired) {
            await tx.set(COLLECTIONS.attachments, { ...attachment, lifecycleState: 'GC_PENDING', updatedAt: now })
            await tx.set(COLLECTIONS.uploadSessions, {
              ...session,
              state: 'EXPIRED',
              fence: ((session.fence as number) ?? 0) + 1,
              updatedAt: now,
            })
            release = true
          }
        }
        if (release) {
          slots = slots.map((item) =>
            item.index === slot.index ? { ...item, sessionId: null, state: 'EMPTY' as const } : item
          )
        }
      }
      if (slots.filter((slot) => slot.state === 'OCCUPIED').length >= MAX_ATTACHMENTS) {
        throw new AppError('validation_failed', `附件最多 ${MAX_ATTACHMENTS} 个`)
      }
      const slotIndex = slots.findIndex((slot) => slot.state === 'EMPTY')
      if (slotIndex < 0) throw new AppError('validation_failed', `附件最多 ${MAX_ATTACHMENTS} 个`)

      const sessionId = randomId('ups')
      const nextSlots = slots.map((slot, i) => (i === slotIndex ? { ...slot, sessionId, state: 'OCCUPIED' as const } : slot))
      // 只递增 batch revision（首建为 1）；**不触碰 task 业务 revision**（第二件附件不使第一件失效）
      await tx.set(COLLECTIONS.uploadBatches, {
        ...batch,
        slots: nextSlots,
        revision: existing ? ((batch.revision as number) ?? 0) + 1 : 1,
        updatedAt: now,
      })

      const session: Doc = {
        _id: sessionId,
        clubId,
        taskId: input.taskId,
        uploaderMemberId: tenant.member._id,
        taskRevision: task.revision,
        targetRound,
        name,
        declaredSize,
        transport: TRANSPORT,
        state: 'DRAFT',
        fence: 0,
        chunkBytes: CHUNK_BYTES,
        totalChunks: chunkCount(declaredSize),
        uploadExpiresAt: now + UPLOAD_TTL_MS,
        confirmedUntil: null,
        attachmentId: null,
        createdAt: now,
        updatedAt: now,
      }
      await tx.set(COLLECTIONS.uploadSessions, session)
      await writeAudit(tx, {
        scope: `TEAM:${clubId}`,
        actorMemberId: tenant.member._id,
        action: 'file.init',
        resourceType: 'uploadSession',
        resourceId: sessionId,
        seed: input.mutationId,
        now,
      })
      return toSessionView(session, [])
    }
  )
  return run.result
}

/** 单个分片：先登记（PENDING）→ 事务外上传 → 回写 STORED；同 index 幂等。 */
export async function putChunk(
  deps: FilesDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  input: { sessionId: string; index: number; base64: string; chunkHashHint?: string }
): Promise<{ sessionId: string; index: number; size: number; sha256: string }> {
  const bytes = decodeBase64(input.base64)
  if (bytes.byteLength > CHUNK_BYTES) throw new AppError('validation_failed', `单片不得超过 ${CHUNK_BYTES}B`)
  const index = input.index
  if (!Number.isInteger(index) || index < 0) throw new AppError('validation_failed', 'index 必须为非负整数')
  const now = deps.now()

  // 阶段 1：事务内登记（登记先行；网络/存储副作用在事务外）
  const registered = await deps.db.tx(async (tx) => {
    const { session } = await loadSession(tx, trusted, clubId, input.sessionId)
    assertNotExpired(session, now)
    const total = session.totalChunks as number
    if (index >= total) throw new AppError('validation_failed', `index 超出范围（共 ${total} 片）`)
    const declaredSize = session.declaredSize as number
    const expectedSize = index === total - 1 ? declaredSize - index * CHUNK_BYTES : CHUNK_BYTES
    if (expectedSize <= 0 || bytes.byteLength !== expectedSize) {
      throw new AppError('validation_failed', `片长不符：index ${index} 应为 ${Math.max(0, expectedSize)}B`)
    }
    const sha256 = sha256Bytes(bytes)
    const chunkId = chunkDocId(clubId, input.sessionId, index)
    const existingChunk = await tx.get(COLLECTIONS.uploadChunks, chunkId)
    if (existingChunk) {
      if (existingChunk.sha256 !== sha256) throw new AppError('idempotency_conflict', '同一分片序号内容不一致')
      if (existingChunk.state === 'STORED' && typeof existingChunk.fileID === 'string') {
        return { chunkId, sha256, replayed: true }
      }
      if (existingChunk.state === 'GC_PENDING') throw new AppError('upload_cancelled')
      if (existingChunk.state !== 'PENDING') {
        throw new AppError('attachment_not_ready', '分片状态不可重试')
      }
      // 上一次上传可能在 SDK 返回后、回写 STORED 前失联。相同内容重试使用同一对象路径；
      // PENDING 不能当作成功回放，否则 confirm 会永远缺少对象。
      await tx.set(COLLECTIONS.uploadChunks, {
        ...existingChunk,
        attempt: ((existingChunk.attempt as number) ?? 1) + 1,
        updatedAt: now,
      })
      return { chunkId, sha256, replayed: false }
    }
    if (session.state === 'DRAFT') {
      await tx.set(COLLECTIONS.uploadSessions, { ...session, state: 'UPLOADING', updatedAt: now })
    }
    await tx.set(COLLECTIONS.uploadChunks, {
      _id: chunkId,
      clubId,
      sessionId: input.sessionId,
      index,
      sha256,
      size: bytes.byteLength,
      objectPath: chunkObjectPath(clubId, input.sessionId, index),
      fileID: null,
      state: 'PENDING',
      attempt: 1,
      createdAt: now,
      updatedAt: now,
    })
    return { chunkId, sha256, replayed: false }
  })

  if (registered.replayed) {
    return { sessionId: input.sessionId, index, size: bytes.byteLength, sha256: registered.sha256 }
  }

  // 阶段 2：事务外上传（服务端路径，唯一且不可重绑）
  const ref = await deps.storage.uploadObject(chunkObjectPath(clubId, input.sessionId, index), bytes)

  // 阶段 3：回写 STORED（若此时被取消 → 标记 GC_PENDING，不发布）
  const finalState = await deps.db.tx(async (tx) => {
    const chunk = await tx.get(COLLECTIONS.uploadChunks, registered.chunkId)
    if (!chunk) throw new AppError('resource_not_found')
    const session = await tx.get(COLLECTIONS.uploadSessions, input.sessionId)
    const cancelled = !session || session.state === 'CANCELLED'
    await tx.set(COLLECTIONS.uploadChunks, {
      ...chunk,
      fileID: ref.fileID,
      state: cancelled ? 'GC_PENDING' : 'STORED',
      updatedAt: now,
    })
    return cancelled ? 'GC_PENDING' : 'STORED'
  })
  if (finalState === 'GC_PENDING') throw new AppError('upload_cancelled')

  return { sessionId: input.sessionId, index, size: bytes.byteLength, sha256: registered.sha256 }
}

export async function fileStatus(
  deps: FilesDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  sessionId: string
): Promise<UploadSessionView> {
  const stored = await deps.db.tx(async (tx) => {
    const { session } = await loadSession(tx, trusted, clubId, sessionId)
    return session
  })
  return toSessionView(stored, await storedIndexesOf(deps, clubId, sessionId))
}

/** 组装校验并发布（唯一 candidate → 校验 → 发布；无 overwrite:false 冻结能力）。 */
export async function fileConfirm(
  deps: FilesDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  input: { sessionId: string; mutationId: string }
): Promise<AttachmentView> {
  const now = deps.now()
  const commandInput = {
    scope: { kind: 'TEAM' as const, clubId },
    actorIdentityId: actorIdentityId(trusted),
    action: 'file.confirm',
    mutationId: input.mutationId,
    data: { sessionId: input.sessionId },
  }

  // 成功结果丢响应时，先返回既有命令结果，不重新读字节或上传最终对象。
  const replay = await getIdempotentReplay<AttachmentView>(deps.db, now, commandInput)
  if (replay) return replay

  // 同一命令重试必须命中同一最终对象路径，避免上传成功但事务提交失败后产生新孤儿对象。
  const attachmentId = sha256Hex(
    JSON.stringify(['rak-attachment-v1', clubId, input.sessionId, input.mutationId])
  )

  // 阶段 1：读取并校验会话与分片完备性（事务内只做 doc 读取）
  const prepared = await deps.db.tx(async (tx) => {
    const { session } = await loadSession(tx, trusted, clubId, input.sessionId)
    assertNotExpired(session, now)
    const total = session.totalChunks as number
    // 事务内只做 doc 读取：按确定性 chunk id 逐片取，不用集合级查询
    const missing: number[] = []
    const notReady: number[] = []
    for (let i = 0; i < total; i += 1) {
      const chunk = await tx.get(COLLECTIONS.uploadChunks, chunkDocId(clubId, input.sessionId, i))
      if (!chunk) missing.push(i)
      else if (chunk.state !== 'STORED') notReady.push(i)
    }
    if (missing.length > 0) throw new AppError('attachment_not_ready', `分片不齐：缺 ${missing.join(',')}`)
    if (notReady.length > 0) throw new AppError('attachment_not_ready', `分片未就绪：${notReady.join(',')}`)
    return { session, total }
  })

  // 阶段 2：事务外有界读回 + 逐片 hash 复核 + 组装
  const assembled = new Uint8Array(prepared.session.declaredSize as number)
  let offset = 0
  for (let i = 0; i < prepared.total; i += 1) {
    const chunk = (
      await deps.db.query(COLLECTIONS.uploadChunks, (doc) => doc.clubId === clubId && doc.sessionId === input.sessionId && doc.index === i)
    ).shift()
    if (!chunk || typeof chunk.fileID !== 'string') throw new AppError('attachment_not_ready', `分片 ${i} 缺失 fileID`)
    const bytes = await deps.storage.downloadObject(chunk.fileID)
    if (bytes.byteLength !== (chunk.size as number) || sha256Bytes(bytes) !== chunk.sha256) {
      throw new AppError('attachment_not_ready', `分片 ${i} 校验失败`)
    }
    if (offset + bytes.byteLength > assembled.byteLength) throw new AppError('attachment_not_ready', '组装超长')
    assembled.set(bytes, offset)
    offset += bytes.byteLength
  }
  if (offset !== prepared.session.declaredSize) throw new AppError('attachment_not_ready', '组装长度与声明不符')
  const sha256 = sha256Bytes(assembled)

  // 阶段 3：事务外发布最终对象（服务端唯一路径；发布前已完成校验）
  const ref = await deps.storage.uploadObject(finalObjectPath(clubId, input.sessionId, attachmentId), assembled)

  // 阶段 4：事务内落库（含命令幂等）
  const run = await runIdempotent(
    deps.db,
    now,
    commandInput,
    async (tx) => {
      const { tenant, session } = await loadSession(tx, trusted, clubId, input.sessionId)
      // 取消/过期竞态：确认时再查一次
      if (session.state === 'CANCELLED') throw new AppError('upload_cancelled')
      if (session.state === 'CONFIRMED') throw new AppError('invalid_transition', '会话已确认')
      const confirmedUntil = now + CONFIRMED_TTL_MS
      const attachment: Doc = {
        _id: attachmentId,
        clubId,
        taskId: session.taskId as string,
        sessionId: input.sessionId,
        submissionId: null,
        uploadedByMemberId: tenant.member._id,
        name: session.name as string,
        size: assembled.byteLength,
        sha256,
        fileID: ref.fileID,
        objectPath: finalObjectPath(clubId, input.sessionId, attachmentId),
        integrityState: 'VERIFIED' as IntegrityState,
        scanState: 'NOT_CONFIGURED',
        lifecycleState: 'DRAFT' as LifecycleState,
        confirmedUntil,
        createdAt: now,
        updatedAt: now,
      }
      await tx.set(COLLECTIONS.attachments, attachment)
      await tx.set(COLLECTIONS.uploadSessions, {
        ...session,
        state: 'CONFIRMED',
        attachmentId,
        confirmedUntil,
        updatedAt: now,
      })
      await writeAudit(tx, {
        scope: `TEAM:${clubId}`,
        actorMemberId: tenant.member._id,
        action: 'file.confirm',
        resourceType: 'attachment',
        resourceId: attachmentId,
        seed: input.mutationId,
        now,
      })
      return toAttachmentView(attachment)
    }
  )

  // 阶段 5：尽力清理 staging 分片（失败只记 GC_PENDING，不掩盖确认成功）
  const cleanup = (
    await deps.db.query(COLLECTIONS.uploadChunks, (doc) => doc.clubId === clubId && doc.sessionId === input.sessionId)
  )
    .map((doc) => doc.fileID)
    .filter((fileID): fileID is string => typeof fileID === 'string')
  await deps.storage.deleteObjects(cleanup).catch(() => [])

  return run.result
}

/** 取消：fence++、草稿转 GC_PENDING、释放批次槽位；已确认不可取消。 */
export async function fileCancel(
  deps: FilesDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  input: { sessionId: string; mutationId: string }
): Promise<{ sessionId: string; state: UploadSessionState; fence: number; releasedSlot: boolean }> {
  const now = deps.now()
  const run = await runIdempotent(
    deps.db,
    now,
    {
      scope: { kind: 'TEAM', clubId },
      actorIdentityId: actorIdentityId(trusted),
      action: 'file.cancel',
      mutationId: input.mutationId,
      data: { sessionId: input.sessionId },
    },
    async (tx) => {
      const { tenant, session } = await loadSession(tx, trusted, clubId, input.sessionId)
      const fence = ((session.fence as number) ?? 0) + 1
      if (session.state === 'CONFIRMED') {
        // 已确认但尚未被任何交付绑定：允许丢弃（释放批次槽位）
        const attachment =
          typeof session.attachmentId === 'string'
            ? await tx.get(COLLECTIONS.attachments, session.attachmentId)
            : null
        const discardable =
          attachment !== null && attachment.lifecycleState === 'DRAFT' && !attachment.submissionId
        if (!discardable) throw new AppError('invalid_transition', '已交付的附件不可取消')
      }
      const totalChunks = (session.totalChunks as number) ?? 0
      for (let i = 0; i < totalChunks; i += 1) {
        const chunk = await tx.get(COLLECTIONS.uploadChunks, chunkDocId(clubId, input.sessionId, i))
        if (chunk) await tx.set(COLLECTIONS.uploadChunks, { ...chunk, state: 'GC_PENDING', updatedAt: now })
      }
      if (typeof session.attachmentId === 'string') {
        const attachment = await tx.get(COLLECTIONS.attachments, session.attachmentId)
        if (attachment) await tx.set(COLLECTIONS.attachments, { ...attachment, lifecycleState: 'GC_PENDING', updatedAt: now })
      }
      // 释放批次槽位（本会话未提交，允许重新选择文件）
      const batchId = batchIdFor(clubId, session.taskId as string, session.targetRound as number)
      const batch = await tx.get(COLLECTIONS.uploadBatches, batchId)
      let releasedSlot = false
      if (batch && batch.state !== 'CLOSED') {
        const slots = ((batch.slots as BatchSlot[] | undefined) ?? emptySlots()).map((slot) =>
          slot.sessionId === input.sessionId ? { ...slot, sessionId: null, state: 'EMPTY' as const } : slot
        )
        await tx.set(COLLECTIONS.uploadBatches, {
          ...batch,
          slots,
          revision: ((batch.revision as number) ?? 0) + 1,
          updatedAt: now,
        })
        releasedSlot = true
      }
      await tx.set(COLLECTIONS.uploadSessions, {
        ...session,
        state: 'CANCELLED',
        fence,
        updatedAt: now,
      })
      await writeAudit(tx, {
        scope: `TEAM:${clubId}`,
        actorMemberId: tenant.member._id,
        action: 'file.cancel',
        resourceType: 'uploadSession',
        resourceId: input.sessionId,
        seed: input.mutationId,
        now,
      })
      return { sessionId: input.sessionId, state: 'CANCELLED' as UploadSessionState, fence, releasedSlot }
    }
  )
  const fileIDs = (
    await deps.db.query(COLLECTIONS.uploadChunks, (doc) => doc.clubId === clubId && doc.sessionId === input.sessionId)
  )
    .map((doc) => doc.fileID)
    .filter((fileID): fileID is string => typeof fileID === 'string')
  await deps.storage.deleteObjects(fileIDs).catch(() => [])
  return run.result
}

/** 受控下载：响应体量/流式能力尚未实测 → 明确拒绝（不伪造 expiresAt、不下发 URL）。 */
function downloadPending(): never {
  throw new AppError('not_implemented', '附件下载（云函数受控代理）尚未上线：函数响应体量/流式能力待实测')
}

export function createFileHandlers(runtime: FilesRuntime): HandlerMap {
  const deps: FilesDeps = { db: runtime.db, now: runtime.now, storage: runtime.storage }
  const requireIdentity = (): TrustedIdentity => assertTrustedIdentity(runtime.identity(), runtime.expected)

  // 先为注册表中**每个** files 动作装上明确的 fail-closed 处理器（无静默漏项）
  const handlers: HandlerMap = {}
  for (const action of actionsFor('files')) {
    handlers[action] = async () => downloadPending()
  }

  handlers['file.init'] = async (req) => {
    const identity = requireIdentity()
    const data = req.request.data as { taskId: string; expectedTaskRevision: number; name: string; declaredSize: number }
    return fileInit(deps, identity, teamClubId(req), {
      taskId: data.taskId,
      expectedTaskRevision: data.expectedTaskRevision,
      name: data.name,
      declaredSize: data.declaredSize,
      mutationId: req.request.mutationId as string,
    })
  }
  handlers['file.putChunk'] = async (req) => {
    const identity = requireIdentity()
    const data = req.request.data as { sessionId: string; index: number; base64: string; chunkHashHint?: string }
    return putChunk(deps, identity, teamClubId(req), {
      sessionId: data.sessionId,
      index: data.index,
      base64: data.base64,
      chunkHashHint: data.chunkHashHint,
    })
  }
  handlers['file.status'] = async (req) => {
    const identity = requireIdentity()
    const data = req.request.data as { sessionId: string }
    return fileStatus(deps, identity, teamClubId(req), data.sessionId)
  }
  handlers['file.confirm'] = async (req) => {
    const identity = requireIdentity()
    const data = req.request.data as { sessionId: string }
    return fileConfirm(deps, identity, teamClubId(req), {
      sessionId: data.sessionId,
      mutationId: req.request.mutationId as string,
    })
  }
  handlers['file.cancel'] = async (req) => {
    const identity = requireIdentity()
    const data = req.request.data as { sessionId: string }
    return fileCancel(deps, identity, teamClubId(req), {
      sessionId: data.sessionId,
      mutationId: req.request.mutationId as string,
    })
  }
  handlers['file.downloadUrls'] = async () => downloadPending()
  handlers['file.previewDraft'] = async () => downloadPending()

  return handlers
}
