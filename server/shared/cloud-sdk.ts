/**
 * CloudBase SDK 端口（多团队 DESIGN §4.2、§11；M8 装配）。
 *
 * 本文件只**声明**云端 SDK 的最小能力面，并提供一个懒加载入口；**不实现**任何业务。
 * 生产运行时由 `entrypoints/runtime.ts` 装配；本地测试用**假 SDK** 驱动
 * （镜像同一 API 面），**不得**把假 SDK 结果称为真实云结果。
 *
 * 锁版依据（M0 实测）：`wx-server-sdk@4.0.2`；可用面为
 * `getWXContext / uploadFile / downloadFile / getTempFileURL / deleteFile /
 * runTransaction(run,retry)`；**无凭证签发 API、无 `copyFile`**。
 * 见 `docs/verification/cloudbase-capabilities-2026-10-17.md` §3.1。
 */

export const SDK_PACKAGE = 'wx-server-sdk'

/** `getWXContext()` 返回的平台上下文；管理侧调用可能为空（M0 实测）。 */
export interface SdkWxContext {
  APPID?: string
  OPENID?: string
  ENV?: string
  SOURCE?: string
  UNIONID?: string
}

/** 单文档引用：只做 get / set / remove（服务端事务仅 doc，禁用 where/add）。 */
export interface SdkDocumentRef {
  get(): Promise<{ data: unknown }>
  set(options: { data: Record<string, unknown> }): Promise<unknown>
  remove(): Promise<unknown>
}

/** 集合/查询句柄：`limit/skip/get` 用于分页全扫（不用默认首批冒充全队）。 */
export interface SdkQuery {
  limit(n: number): SdkQuery
  skip(n: number): SdkQuery
  get(): Promise<{ data: unknown[] }>
}

export interface SdkCollection extends SdkQuery {
  doc(id: string): SdkDocumentRef
}

export interface SdkTransaction {
  collection(name: string): SdkCollection
}

export interface SdkDatabase {
  collection(name: string): SdkCollection
  /**
   * 事务执行。SDK 的**返回外壳结构在本轮未实测确认**，故端口如实声明为 `unknown`：
   * 适配层用闭包捕获回调返回值，**不依赖**外壳结构（避免按猜测取值）。
   */
  runTransaction(fn: (tx: SdkTransaction) => Promise<unknown>, times?: number): Promise<unknown>
}

export interface SdkUploadResult {
  fileID: string
  statusCode?: number
}

export interface SdkDeleteItemResult {
  fileID: string
  status: number
}

export interface SdkDownloadResult {
  fileContent: Uint8Array | ArrayBuffer
  statusCode?: number
}

export interface CloudSdk {
  /**
   * 初始化默认配置（**必须先于其它云 API 调用**）。
   * 云端实测：未调用 `init` 时 `database()` 直接抛
   * `Cloud API isn't enabled, please call init first`（M8 冒烟发现并修正）。
   */
  init(options: { env: string }): void
  getWXContext(): SdkWxContext
  database(): SdkDatabase
  uploadFile(options: { cloudPath: string; fileContent: Uint8Array }): Promise<SdkUploadResult>
  downloadFile(options: { fileID: string }): Promise<SdkDownloadResult>
  deleteFile(options: { fileList: string[] }): Promise<{ fileList: SdkDeleteItemResult[] }>
}

/**
 * 懒加载真实 SDK。
 *
 * 未安装（本地）、加载失败、或缺少必需能力面（`init`/`getWXContext`）一律返回 null →
 * 入口 fail-closed（空处理器表 → not_implemented），**不伪造**已可用的运行时。
 */
export function loadCloudSdk(): CloudSdk | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod: unknown = require(SDK_PACKAGE)
    if (!mod) return null
    const api = mod as { init?: unknown; getWXContext?: unknown }
    if (typeof api.init !== 'function' || typeof api.getWXContext !== 'function') return null
    return mod as CloudSdk
  } catch {
    return null
  }
}
