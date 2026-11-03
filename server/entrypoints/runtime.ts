import type { ApiRuntime } from '../modules/api-handlers.ts'
import type { FilesRuntime } from '../modules/files/index.ts'
import type { Database } from '../repositories/store.ts'
import type { StorageAdapter } from '../storage/adapter.ts'
import { SdkDatabase } from '../repositories/sdk-database.ts'
import { SdkStorageAdapter } from '../storage/sdk-adapter.ts'
import { loadCloudSdk, type CloudSdk } from '../shared/cloud-sdk.ts'
import type { TrustedIdentity } from '../shared/identity.ts'

/**
 * 生产运行时装配（多团队 DESIGN §4.2/§6.3、PLAN §M8）。
 *
 * 组成：CloudBase SDK（**先 `cloud.init({ env: 配置环境 })`** 再绑定数据库/存储）+ 平台可信
 * `getWXContext` + 服务端配置。云端实测：未调用 `init` 时 SDK 的 `database()` 会抛
 * `Cloud API isn't enabled, please call init first`（M8 冒烟发现并修正）。
 * - `expected`（AppID/环境）**只来自服务端环境变量**，绝不自报、绝不用被校验方自身取值，
 *   否则 `app_mismatch`/`environment_mismatch` 形同虚设；
 * - 身份只在 handler 内从平台上下文取得（`event` 自报一律无效）；
 * - **fail-closed**：SDK 未安装或必填配置缺失 → 返回 null → 入口空处理器表（not_implemented），
 *   不伪造已可用的运行时。
 *
 * 配置（函数环境变量，不进源码/日志）：见 `docs/MANUAL-OPERATIONS.md`（H-7 后新增）。
 */

export interface RuntimeConfig {
  /** 预期 AppID（`RAK_APP_ID`）。 */
  appId: string
  /** 预期环境 ID（`RAK_CLOUD_ENV`）。 */
  env: string
  /** 申请入口 token 签名密钥（`RAK_JOIN_SECRET`，仅服务端受控配置）。 */
  joinSecret: string
  /** `cloud://<env>.<bucket>`（`RAK_STORAGE_FILEID_ROOT`）；缺失时存储适配 fail-closed。 */
  storageFileIdRoot: string | null
}

/** 平台级配置（**不含业务密钥**）：供 worker 等不签名/不校验申请令牌的入口使用。 */
export interface PlatformConfig {
  /** 预期 AppID（`RAK_APP_ID`）。 */
  appId: string
  /** 预期环境 ID（`RAK_CLOUD_ENV`）。 */
  env: string
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 读平台级配置（`RAK_APP_ID` + `RAK_CLOUD_ENV`）；任一缺失 → null（fail-closed）。 */
export function readPlatformConfig(env: Record<string, string | undefined> = process.env): PlatformConfig | null {
  const appId = trimmed(env.RAK_APP_ID)
  const envId = trimmed(env.RAK_CLOUD_ENV)
  if (!appId || !envId) return null
  return { appId, env: envId }
}

/** 读业务运行时配置（平台级 + 申请令牌密钥 + 存储 fileID 前缀）；任一必填缺失 → null（fail-closed）。 */
export function readRuntimeConfig(env: Record<string, string | undefined> = process.env): RuntimeConfig | null {
  const platform = readPlatformConfig(env)
  const joinSecret = trimmed(env.RAK_JOIN_SECRET)
  if (!platform || !joinSecret) return null
  const root = trimmed(env.RAK_STORAGE_FILEID_ROOT)
  return { ...platform, joinSecret, storageFileIdRoot: root ? root.replace(/\/+$/, '') : null }
}

/** 平台可信身份读取器：缺 OPENID/APPID 即 null（由 assertTrustedIdentity 守门）。 */
function identityReader(sdk: CloudSdk): () => TrustedIdentity | null {
  return () => {
    let ctx: { APPID?: string; OPENID?: string; ENV?: string }
    try {
      ctx = sdk.getWXContext()
    } catch {
      return null
    }
    const appId = trimmed(ctx?.APPID)
    const openid = trimmed(ctx?.OPENID)
    if (!appId || !openid) return null
    // ENV 缺失时留空 → 与 expected 不符 → environment_mismatch（fail-closed，不回落为 expected）。
    return { appId, openid, env: trimmed(ctx?.ENV) }
  }
}

export interface ApiRuntimeInput {
  sdk: CloudSdk
  config: RuntimeConfig
  now?: () => number
}

/** 纯工厂（供假 SDK 单测）。真实 SDK 由 `loadApiRuntime()` 提供。 */
export function createApiRuntime(input: ApiRuntimeInput): ApiRuntime {
  const { sdk, config } = input
  // 初始化默认配置（必须先于任何云 API 调用）；env 用**配置值**，不用自报值。
  sdk.init({ env: config.env })
  return {
    db: new SdkDatabase(sdk.database()),
    now: input.now ?? (() => Date.now()),
    expected: { appId: config.appId, env: config.env },
    identity: identityReader(sdk),
    joinSecret: config.joinSecret,
  }
}

export interface FilesRuntimeInput extends ApiRuntimeInput {
  storage?: StorageAdapter
}

/** 纯工厂（供假 SDK 单测）；`storage` 可注入替身，缺省用 SDK 适配。 */
export function createFilesRuntime(input: FilesRuntimeInput): FilesRuntime {
  const { sdk, config } = input
  sdk.init({ env: config.env })
  return {
    db: new SdkDatabase(sdk.database()),
    now: input.now ?? (() => Date.now()),
    expected: { appId: config.appId, env: config.env },
    identity: identityReader(sdk),
    storage: input.storage ?? new SdkStorageAdapter({ sdk, fileIdRoot: config.storageFileIdRoot }),
  }
}

/** rakApi 生产运行时；SDK 或配置缺失 → null（fail-closed）。 */
export function loadApiRuntime(): ApiRuntime | null {
  const sdk = loadCloudSdk()
  const config = readRuntimeConfig()
  if (!sdk || !config) return null
  return createApiRuntime({ sdk, config })
}

/** rakFiles 生产运行时；SDK 或配置缺失 → null（fail-closed）。 */
export function loadFilesRuntime(): FilesRuntime | null {
  const sdk = loadCloudSdk()
  const config = readRuntimeConfig()
  if (!sdk || !config) return null
  return createFilesRuntime({ sdk, config })
}

/**
 * worker（`rakMaintenance`）运行时：只需平台级配置 + 数据库绑定。
 *
 * **不持有**申请令牌密钥（最小权限）：worker 不签名/不校验申请入口令牌。
 * 客户端调用由函数级安全规则拒绝（`rakMaintenance.invoke=false`，H-11）；
 * 平台/管理侧通道即受控运维入口；**不允许**把 `event.source/type/clubId` 当系统权限
 * （来源校准 W1 仍 NOT_RUN）。
 */
export interface MaintenanceRuntime {
  db: Database
  now: () => number
  appId: string
  env: string
}

export interface MaintenanceRuntimeInput {
  sdk: CloudSdk
  config: PlatformConfig
  now?: () => number
}

/** 纯工厂（供假 SDK 单测）。 */
export function createMaintenanceRuntime(input: MaintenanceRuntimeInput): MaintenanceRuntime {
  const { sdk, config } = input
  sdk.init({ env: config.env })
  return {
    db: new SdkDatabase(sdk.database()),
    now: input.now ?? (() => Date.now()),
    appId: config.appId,
    env: config.env,
  }
}

/** rakMaintenance 生产运行时；SDK 或平台配置缺失 → null（fail-closed）。 */
export function loadMaintenanceRuntime(): MaintenanceRuntime | null {
  const sdk = loadCloudSdk()
  const config = readPlatformConfig()
  if (!sdk || !config) return null
  return createMaintenanceRuntime({ sdk, config })
}
