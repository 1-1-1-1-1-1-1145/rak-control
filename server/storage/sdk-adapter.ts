import { AppError } from '../contracts/errors.ts'
import type { StorageAdapter, StorageDeletionResult, StorageObjectRef } from './adapter.ts'
import type { StorageCapabilities } from './capabilities.ts'
import type { CloudSdk } from '../shared/cloud-sdk.ts'
import { MAX_OBJECT_BYTES, TRANSPORT } from '../modules/files/index.ts'

/**
 * 存储适配：CloudBase SDK 绑定（多团队 DESIGN §11.1、PLAN §M5/§M8）。
 *
 * 传输协议已由 M0 裁决为 **`function-chunks-v1`**（首选 exact-key 受限 PUT 的关键能力
 * 在本 SDK 不成立：无凭证签发 API、无 `copyFile`）。故：
 * - `uploadObject`：**用 SDK 返回的 fileID**（不手拼、不用 listFiles）；
 * - `fileIdForPath`：按**配置的** `fileID` 前缀（`cloud://<env>.<bucket>`）确定性拼接
 *   —— U5 实测「同路径两次上传 fileID 完全一致」支持此构造，前缀取自环境配置（非猜测）；
 *   未配置前缀即拒绝（fail-closed），不伪造。
 * - **不提供**任何下载 URL：`getTempFileURL` 的 `maxAge` 实测未被实际执行（D1 FAIL），
 *   因此 `downloadTtlSeconds = null`，**不伪造 expiresAt**；下载仍走模块层 `not_implemented`。
 *
 * 未裁决/未配置时不得使用本类（`adapter.ts` 的 `loadStorageAdapter()` 仍 fail-closed）。
 */

function toBytes(content: unknown): Uint8Array {
  if (content instanceof Uint8Array) return new Uint8Array(content)
  if (content instanceof ArrayBuffer) return new Uint8Array(content)
  throw new AppError('storage_unavailable', '下载内容类型不可识别')
}

export interface SdkStorageOptions {
  sdk: CloudSdk
  /** `cloud://<env>.<bucket>`；为 null 时 `fileIdForPath` fail-closed。 */
  fileIdRoot: string | null
}

export class SdkStorageAdapter implements StorageAdapter {
  private readonly sdk: CloudSdk
  private readonly fileIdRoot: string | null

  constructor(options: SdkStorageOptions) {
    this.sdk = options.sdk
    this.fileIdRoot = options.fileIdRoot
  }

  capabilities(): StorageCapabilities {
    return {
      adjudicated: true,
      uploadTransport: TRANSPORT,
      maxObjectBytes: MAX_OBJECT_BYTES,
      // 下载签名实际期限不可控（D1 FAIL）→ 如实标 null，不伪造。
      downloadTtlSeconds: null,
    }
  }

  /** 上传协议已裁决；下载期限未达成不阻断上传路径（下载在模块层 not_implemented）。 */
  requireAdjudicated(): void {}

  async uploadObject(objectPath: string, bytes: Uint8Array): Promise<StorageObjectRef> {
    const res = await this.sdk.uploadFile({ cloudPath: objectPath, fileContent: bytes })
    const fileID = res?.fileID
    if (typeof fileID !== 'string' || fileID.length === 0) {
      // 副作用可能已发生但响应不可用：不静默成功；恢复路径为 `fileIdForPath`（受控运维）。
      throw new AppError('storage_unavailable', '上传响应缺少 fileID，需按预登记路径恢复')
    }
    return { fileID }
  }

  async downloadObject(fileID: string): Promise<Uint8Array> {
    const res = await this.sdk.downloadFile({ fileID })
    if (res?.fileContent === undefined || res?.fileContent === null) {
      throw new AppError('storage_unavailable', '下载响应缺少内容')
    }
    return toBytes(res.fileContent)
  }

  async deleteObjects(fileIDs: string[]): Promise<StorageDeletionResult[]> {
    if (fileIDs.length === 0) return []
    const res = await this.sdk.deleteFile({ fileList: fileIDs })
    const list = Array.isArray(res?.fileList) ? res.fileList : []
    // 保输入顺序逐项对账；响应缺失项按非 0 如实标注，不伪造成功。
    return fileIDs.map((fileID) => {
      const hit = list.find((item) => item.fileID === fileID)
      return { fileID, status: hit && typeof hit.status === 'number' ? hit.status : -1 }
    })
  }

  fileIdForPath(objectPath: string): string {
    if (!this.fileIdRoot) {
      throw new AppError('storage_unavailable', '未配置存储 fileID 前缀（RAK_STORAGE_FILEID_ROOT）')
    }
    return `${this.fileIdRoot}/${objectPath}`
  }
}
