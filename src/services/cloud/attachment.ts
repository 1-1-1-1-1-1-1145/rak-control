import Taro from '@tarojs/taro'
import { getCloudClient } from '../backend'
import { createMutationId } from '@/utils/mutation-id'
import {
  CHUNK_BYTES,
  MAX_ATTACHMENT_BYTES,
  uploadTaskAttachment,
  type AttachmentSummary,
  type AttachmentTransport,
  type ChunkSource,
  type UploadSession,
  type UploadedAttachment,
} from '@/utils/attachment-upload'

/**
 * 私有附件的云端适配（多团队 DESIGN §11、PLAN §M5）。
 *
 * transport 已由 M0 裁决为 `function-chunks-v1`：分片经 `rakFiles` 代传；
 * 服务端不向客户端下发 fileID/URL（受控下载与 `file.downloadUrls`/`previewDraft`
 * 在证据齐备前仍 `not_implemented`，客户端不得伪造下载地址）。
 */

function teamScope(clubId: string) {
  return { kind: 'TEAM' as const, clubId }
}

export function createCloudAttachmentTransport(clubId: string): AttachmentTransport {
  const call = getCloudClient()
  return {
    init: (input) =>
      call.call<UploadSession>('rakFiles', 'file.init', teamScope(clubId), { ...input }, { mutationId: createMutationId() }),
    putChunk: (input) =>
      call.call<{ index: number; size: number; sha256: string }>('rakFiles', 'file.putChunk', teamScope(clubId), { ...input }),
    status: (sessionId) => call.call<UploadSession>('rakFiles', 'file.status', teamScope(clubId), { sessionId }),
    confirm: (sessionId) =>
      call.call<AttachmentSummary>('rakFiles', 'file.confirm', teamScope(clubId), { sessionId }, { mutationId: createMutationId() }),
    cancel: async (sessionId) => {
      await call.call('rakFiles', 'file.cancel', teamScope(clubId), { sessionId }, { mutationId: createMutationId() })
    },
  }
}

/** 小程序文件系统读取（按偏移/长度取 base64 分片）。 */
export function createTaroChunkSource(filePath: string): ChunkSource {
  return {
    readBase64: (offset: number, length: number) =>
      new Promise<string>((resolve, reject) => {
        Taro.getFileSystemManager().readFile({
          filePath,
          position: offset,
          length,
          encoding: 'base64',
          success: (res) => resolve(String(res.data)),
          fail: (err) => reject(new Error(String((err && err.errMsg) || '读取文件失败'))),
        })
      }),
  }
}

/** 校验并上传本队任务附件；返回服务端发布的附件摘要（不含 fileID）。 */
export async function uploadTaskAttachmentFromPath(input: {
  clubId: string
  taskId: string
  expectedTaskRevision: number
  name: string
  size: number
  filePath: string
  onProgress?: (done: number, total: number) => void
}): Promise<UploadedAttachment> {
  if (input.size < 1 || input.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`附件大小需在 1B..${MAX_ATTACHMENT_BYTES}B`)
  }
  return uploadTaskAttachment({
    taskId: input.taskId,
    expectedTaskRevision: input.expectedTaskRevision,
    name: input.name,
    size: input.size,
    transport: createCloudAttachmentTransport(input.clubId),
    source: createTaroChunkSource(input.filePath),
    onProgress: input.onProgress,
  })
}

/** 上传进度查询（用于结果未知/重试）。 */
export function cloudAttachmentStatus(clubId: string, sessionId: string): Promise<UploadSession> {
  return getCloudClient().call<UploadSession>('rakFiles', 'file.status', teamScope(clubId), { sessionId })
}

/** 主动取消未确认的会话（释放批次槽位；服务端 fence++）。 */
export async function cloudAttachmentCancel(clubId: string, sessionId: string): Promise<void> {
  await getCloudClient().call(
    'rakFiles',
    'file.cancel',
    teamScope(clubId),
    { sessionId },
    { mutationId: createMutationId() }
  )
}

export { CHUNK_BYTES, MAX_ATTACHMENT_BYTES }
