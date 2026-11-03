import { BACKEND, CLOUD_ENV } from '@/constants'
import { BackendError, isBackendError } from '@/utils/backend-error.js'
import { request as httpRequest, type RequestOptions } from '@/utils/request'
import { type BackendKind } from '@/utils/backend-mode'
import { commandTracker } from '@/store/command-tracker'
import { persistPendingCommands } from '@/store/command-tracker-persist'
import { createCloudClient, type CloudClient, type CloudCallOptions, type RequestScope } from './cloud/client'
import { createTaroCloudTransport, initCloud } from './cloud/transport'
import type { ServiceRequest } from './domain-entry'

/**
 * 后端适配选择（多团队 DESIGN §M2）。
 *
 * cloud 模式：callFunction(rakApi/rakFiles)，不需要 API_BASE / accessToken，不造 JWT；
 * 尚未实现的云动作抛 not_implemented，**不误走 HTTP**、不回退 demo。
 * demo / http 保留各自适配器。
 *
 * 带 `mutationId` 的写调用统一经**最小命令追踪器**：结果未知（传输失败/result_unknown）
 * 只保留原键指针，供回到本队后查询 `command.status`；**不新键重做**。
 */

export const BACKEND_KIND = BACKEND as BackendKind

function requestIdFactory(): string {
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** 结果未知（不代表业务失败）：传输失败 / 服务端未给出确定结论。 */
const UNKNOWN_OUTCOME_CODES = new Set(['result_unknown', 'internal_error'])

function isUnknownOutcome(error: unknown): boolean {
  return isBackendError(error) && UNKNOWN_OUTCOME_CODES.has(error.code)
}

/** 给带 mutationId 的写调用套上命令追踪（读写调用无 mutationId，不受影响）。 */
function withCommandTracking(client: CloudClient): CloudClient {
  return {
    call<T>(
      fn: Parameters<CloudClient['call']>[0],
      action: string,
      scope: RequestScope,
      data?: Record<string, unknown>,
      options?: CloudCallOptions
    ): Promise<T> {
      const mutationId = options?.mutationId
      if (!mutationId) return client.call<T>(fn, action, scope, data, options)

      commandTracker.begin(scope, action, mutationId, Date.now())
      return client.call<T>(fn, action, scope, data, options).then(
        (result) => {
          commandTracker.resolve(scope, action, mutationId)
          persistPendingCommands()
          return result
        },
        (error: unknown) => {
          if (isUnknownOutcome(error)) {
            commandTracker.markUnknown(scope, action, mutationId, Date.now())
          } else {
            // 确定性失败（校验/权限/冲突/未实现）：不保留指针
            commandTracker.resolve(scope, action, mutationId)
          }
          persistPendingCommands()
          throw error
        }
      )
    },
  }
}

let cloudClient: CloudClient | null = null

/** cloud 模式下的唯一云客户端；其它模式访问即报错。 */
export function getCloudClient(): CloudClient {
  if (BACKEND_KIND !== 'cloud') {
    throw new Error('当前不是 cloud 模式，不能使用云客户端')
  }
  if (!cloudClient) {
    cloudClient = withCommandTracking(
      createCloudClient({ transport: createTaroCloudTransport(), requestIdFactory })
    )
  }
  return cloudClient
}

/** cloud 模式必须先完成云初始化才能 bootstrap；其它模式为无操作。 */
export function ensureCloudReady(): Promise<void> {
  if (BACKEND_KIND !== 'cloud') return Promise.resolve()
  return initCloud(CLOUD_ENV)
}

function pendingCloud<T>(_options: RequestOptions): Promise<T> {
  return Promise.reject(new BackendError('not_implemented', '云动作尚未实现（M3+）'))
}

/**
 * 服务门面统一出口：cloud 模式下任何未迁移到云客户端的调用都抛 not_implemented，
 * 避免把 cloud 请求误发到 HTTP/演示地址。
 */
export const requestForBackend: ServiceRequest = (
  BACKEND_KIND === 'cloud' ? pendingCloud : httpRequest
) as ServiceRequest
