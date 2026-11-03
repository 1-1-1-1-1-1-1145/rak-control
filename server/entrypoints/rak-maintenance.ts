import { AppError } from '../contracts/errors.ts'
import { isPlainObject } from '../shared/validation.ts'
import { randomClubId } from '../repositories/ids.ts'
import { initializePlatform, provisionTeam, type ProvisionInput } from '../modules/provisioning/index.ts'
import { loadMaintenanceRuntime, type MaintenanceRuntime } from './runtime.ts'

/**
 * rakMaintenance 入口（多团队 DESIGN §11.3、PLAN §M8）。
 *
 * 仅平台/管理受控来源调用；客户端 invoke 由**函数级安全规则**拒绝
 * （H-11：`rakMaintenance.invoke=false`）。受控动作按 `event.kind` 分发，
 * **不进入公共 action 注册表**（客户端也无法直达）：
 * - `platformInitialize` → 平台初始化（仅一次、幂等，写 `rak_system_config/main`）；
 * - `provisionTeam` → 每队受控开通（幂等；消费 owner 参考号；**须平台已初始化**）；
 * - 其他 / 缺 `kind` → `not_implemented`（fail-closed，不臆造处理）。
 *
 * **授权依据是平台强制**的"客户端不可 invoke"规则，**不是**事件自报字段：
 * 不得把 `event.source` / `type` / `clubId` 当作系统权限（来源校准 W1 仍 NOT_RUN）。
 * `appId` / `env` 一律与**服务端配置**比对，不一致即拒绝且无副作用。
 * worker 运行时**不持有**申请令牌密钥（最小权限）。
 */

export interface MaintenanceAck {
  ok: boolean
  function: 'rakMaintenance'
  handled: boolean
  /** 未实现 / 拒绝原因（不臆造处理）。 */
  reason?: 'not_implemented' | 'app_id_mismatch' | 'env_mismatch' | 'invalid_params' | 'rejected'
  /** 被拒时的稳定错误码（便于运维定位，不含内部细节）。 */
  errorCode?: string
  initialized?: boolean
  alreadyInitialized?: boolean
  clubId?: string
  replayed?: boolean
}

function asNonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/** 严格读取开通入参；缺失/非法返回 null（不臆造默认值）。 */
function readProvisionInput(
  payload: Record<string, unknown>,
  runtime: MaintenanceRuntime
): ProvisionInput | null {
  const provisioningKey = asNonEmpty(payload.provisioningKey)
  const clubName = asNonEmpty(payload.clubName)
  const slug = asNonEmpty(payload.slug)
  const displayCode = asNonEmpty(payload.displayCode)
  const ownerReferenceCode = asNonEmpty(payload.ownerReferenceCode)
  if (!provisioningKey || !clubName || !slug || !displayCode || !ownerReferenceCode) return null
  return {
    provisioningKey,
    appId: runtime.appId,
    env: runtime.env,
    clubName,
    slug,
    displayCode,
    ownerReferenceCode,
    ownerDisplayName: typeof payload.ownerDisplayName === 'string' ? payload.ownerDisplayName.trim() : '',
  }
}

function reject(error: unknown): MaintenanceAck {
  if (error instanceof AppError) {
    return { ok: false, function: 'rakMaintenance', handled: false, reason: 'rejected', errorCode: error.code }
  }
  throw error
}

/** 纯分发（供单测注入替身运行时）；运行时缺失即 fail-closed。 */
export async function handleMaintenance(
  event: unknown,
  runtime: MaintenanceRuntime | null
): Promise<MaintenanceAck> {
  if (!runtime) return { ok: true, function: 'rakMaintenance', handled: false, reason: 'not_implemented' }

  const payload = isPlainObject(event) ? event : null
  const kind = payload?.kind
  if (kind !== 'platformInitialize' && kind !== 'provisionTeam') {
    return { ok: true, function: 'rakMaintenance', handled: false, reason: 'not_implemented' }
  }

  // 只接受与**配置**一致的 AppID（不采信入参自报值；不一致即拒绝且无副作用）。
  if (typeof payload?.appId !== 'string' || payload.appId !== runtime.appId) {
    return { ok: false, function: 'rakMaintenance', handled: false, reason: 'app_id_mismatch' }
  }

  if (kind === 'provisionTeam') {
    if (typeof payload?.env !== 'string' || payload.env !== runtime.env) {
      return { ok: false, function: 'rakMaintenance', handled: false, reason: 'env_mismatch' }
    }
    const input = readProvisionInput(payload, runtime)
    if (!input) return { ok: false, function: 'rakMaintenance', handled: false, reason: 'invalid_params' }
    try {
      const result = await provisionTeam({ db: runtime.db, now: runtime.now, newClubId: randomClubId }, input)
      return {
        ok: true,
        function: 'rakMaintenance',
        handled: true,
        clubId: result.clubId,
        replayed: result.replayed,
      }
    } catch (error) {
      return reject(error)
    }
  }

  try {
    const result = await initializePlatform(
      { db: runtime.db, now: runtime.now, newClubId: randomClubId },
      runtime.appId
    )
    return {
      ok: true,
      function: 'rakMaintenance',
      handled: true,
      initialized: result.initialized,
      alreadyInitialized: result.alreadyInitialized,
    }
  } catch (error) {
    return reject(error)
  }
}

export async function main(event?: unknown): Promise<MaintenanceAck> {
  return handleMaintenance(event, loadMaintenanceRuntime())
}
