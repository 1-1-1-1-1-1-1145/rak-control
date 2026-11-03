import { AppError } from '../contracts/errors.ts'
import {
  assertStorageAdjudicated,
  resolveStorageCapabilities,
  type StorageCapabilities,
} from './capabilities.ts'

/**
 * 存储适配层（多团队 DESIGN §11.1、PLAN §M5）。
 *
 * 传输协议已由 M0 裁决为 **`function-chunks-v1`**（首选 exact-key 受限 PUT 的关键能力
 * 在当前 SDK 不成立：无凭证签发 API、无 `copyFile`、同路径可直接覆盖）。
 *
 * 因此适配层只提供"云函数代传/代读/精确删除/按服务端路径推导规范 fileID"这四项
 * 能力，**不提供**任何客户端直传凭证；未裁决时全部拒绝（fail-closed）。
 * 真实实现（CloudBase SDK 绑定）在 M8 装配；本地测试用替身层，**不得**称其为真实云鉴权。
 */

export interface StorageObjectRef {
  /** SDK 返回的规范 fileID；由服务端路径决定，不手拼、不用 listFiles。 */
  fileID: string
}

export interface StorageDeletionResult {
  fileID: string
  /** 0 表示成功；非 0 为逐项失败（不静默）。 */
  status: number
}

export interface StorageAdapter {
  /** 当前能力快照（只读）。 */
  capabilities(): StorageCapabilities
  /** 要求传输协议已裁决；未裁决即拒绝（storage_unavailable）。 */
  requireAdjudicated(): void
  /** 上传字节到**服务端生成**的唯一对象路径。 */
  uploadObject(objectPath: string, bytes: Uint8Array): Promise<StorageObjectRef>
  /** 读回对象字节（用于分片校验与有界组装）。 */
  downloadObject(fileID: string): Promise<Uint8Array>
  /** 精确删除预登记对象；返回逐项结果。 */
  deleteObjects(fileIDs: string[]): Promise<StorageDeletionResult[]>
  /** 由服务端路径推导规范 fileID（不手拼 cloud://、不用 listFiles）。 */
  fileIdForPath(objectPath: string): string
}

/** 未裁决适配器：任何传输/删除/推导一律拒绝，绝不产生云端副作用。 */
class UnadjudicatedStorageAdapter implements StorageAdapter {
  capabilities(): StorageCapabilities {
    return resolveStorageCapabilities()
  }

  requireAdjudicated(): void {
    assertStorageAdjudicated(this.capabilities())
  }

  async uploadObject(): Promise<StorageObjectRef> {
    this.requireAdjudicated()
    throw new AppError('storage_unavailable')
  }

  async downloadObject(): Promise<Uint8Array> {
    this.requireAdjudicated()
    throw new AppError('storage_unavailable')
  }

  async deleteObjects(): Promise<StorageDeletionResult[]> {
    this.requireAdjudicated()
    throw new AppError('storage_unavailable')
  }

  fileIdForPath(): string {
    this.requireAdjudicated()
    throw new AppError('storage_unavailable')
  }
}

/** 载入存储适配器。M0 未裁决前恒返回 fail-closed 的未裁决适配器。 */
export function loadStorageAdapter(): StorageAdapter {
  return new UnadjudicatedStorageAdapter()
}
