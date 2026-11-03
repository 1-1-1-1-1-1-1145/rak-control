import { AppError } from '../contracts/errors.ts'
import type { FunctionName } from '../contracts/actions.ts'
import { validateEnvelope, type CloudResponse, type ParsedRequest, type RequestScope } from '../contracts/request-v2.ts'
import { logEvent } from '../shared/logging.ts'

/**
 * 三入口共用分发（多团队 DESIGN §6.1、BASE-DESIGN §8.1）。
 *
 * 顺序：信封/注册表/scope 校验 → 归属函数校验 → 模块处理 → 统一响应。
 * fail-closed：任何未实现动作返回 not_implemented，不臆造业务成功。
 */

export type ModuleHandler = (request: ParsedRequest) => Promise<unknown>
export type HandlerMap = Partial<Record<string, ModuleHandler>>

export async function dispatch(
  fn: FunctionName,
  rawEvent: unknown,
  handlers: HandlerMap,
  now: () => number = Date.now
): Promise<CloudResponse> {
  const start = now()
  const serverTime = new Date(start).toISOString()
  let requestId = ''
  let scope: RequestScope | null = null
  let action = 'unknown'

  try {
    const parsed = validateEnvelope(rawEvent)
    requestId = parsed.request.requestId
    scope = parsed.request.scope
    action = parsed.request.action

    if (parsed.spec.fn !== fn) {
      throw new AppError('validation_failed', `action ${action} 不属于本函数`)
    }

    const handler = handlers[action]
    if (!handler) throw new AppError('not_implemented')

    const data = await handler(parsed)
    logEvent({
      requestId,
      action,
      scope: scope.kind,
      clubId: scope.kind === 'TEAM' ? scope.clubId : undefined,
      durationMs: now() - start,
    })
    return { ok: true, requestId, scope, data, serverTime }
  } catch (error) {
    const shape = error instanceof AppError ? error.toShape() : new AppError('internal_error').toShape()
    logEvent({
      requestId,
      action,
      scope: scope ? scope.kind : 'GLOBAL',
      clubId: scope && scope.kind === 'TEAM' ? scope.clubId : undefined,
      code: shape.code,
      durationMs: now() - start,
    })
    return { ok: false, requestId, scope, error: shape, serverTime }
  }
}
