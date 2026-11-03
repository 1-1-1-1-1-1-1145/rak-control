import { AppError } from '../contracts/errors.ts'

/**
 * 私有文件存储能力声明（多团队 DESIGN §11.1/§11.2、PLAN §M5、§M0 出口）。
 *
 * 上传/下载传输协议必须由 M0 能力门禁在**真实 SDK/真机**上裁决（首选
 * exact-key 受限 PUT，或 function-chunks-v1）。本文件只**声明与查询**能力，
 * 不实现任何协议：裁决结论产生前快照为「未裁决」，任何要求真实字节传输的调用
 * 都必须据此拒绝 —— 不得用假定值（10MiB、300 秒等）冒充已裁决能力。
 *
 * 当前依据：`docs/verification/cloudbase-capabilities-2026-10-17.md` 记 M0 云能力
 * 门禁（E1–E3/U1–U5/D1/W1/C1/O1）与「上传/下载协议裁决」为 **BLOCKED（未验证）**。
 */

export type UploadTransport = 'exact-key-put' | 'function-chunks-v1'

export interface StorageCapabilities {
  /** 是否已由 M0 裁决。无云访问权限与真实微信身份前恒为 false。 */
  adjudicated: boolean
  /** 已裁决的上传协议；未裁决为 null（禁止推断协议）。 */
  uploadTransport: UploadTransport | null
  /** 单件最大字节；未裁决为 null（不得用假定值冒充能力）。 */
  maxObjectBytes: number | null
  /** 下载签名实际最大有效期（秒）；未裁决为 null（不伪造 expiresAt）。 */
  downloadTtlSeconds: number | null
}

/** 未裁决快照：能力均为未知，任何实现都不得按假定值工作。 */
export const UNADJUDICATED_CAPABILITIES: StorageCapabilities = {
  adjudicated: false,
  uploadTransport: null,
  maxObjectBytes: null,
  downloadTtlSeconds: null,
}

/**
 * 当前环境的能力快照。
 *
 * M0 未通过时恒为未裁决；裁决通过后由运维结论填充**实测**值（不在代码里写死数字）。
 */
export function resolveStorageCapabilities(): StorageCapabilities {
  return UNADJUDICATED_CAPABILITIES
}

/** 未裁决即拒绝：能力不完整时抛 storage_unavailable（fail-closed，不伪造能力）。 */
export function assertStorageAdjudicated(caps: StorageCapabilities = resolveStorageCapabilities()): void {
  if (
    !caps.adjudicated ||
    caps.uploadTransport === null ||
    caps.maxObjectBytes === null ||
    caps.downloadTtlSeconds === null
  ) {
    throw new AppError('storage_unavailable', '文件传输能力尚未裁决，附件功能不可用', {
      adjudicated: caps.adjudicated,
    })
  }
}
