import { BackendError } from './backend-error.js'

/**
 * 后端选择与云动作可用性（多团队 DESIGN §M2）。
 *
 * - cloud/http 失败**不得**静默回退 demo。
 * - 云模式下调用尚未实现的动作 → not_implemented（绝不误走 HTTP/demo）。
 */

export type BackendKind = 'demo' | 'cloud' | 'http'

/**
 * M2 阶段云后端已实现的动作集合。业务动作在 M3–M6 逐个登记到此处，
 * 未登记动作一律 not_implemented（fail-closed）。
 */
export const CLOUD_IMPLEMENTED_ACTIONS: ReadonlySet<string> = new Set<string>([])

export function isCloudActionImplemented(action: string): boolean {
  return CLOUD_IMPLEMENTED_ACTIONS.has(action)
}

/** 云动作未实现即抛 not_implemented，防止误走其他适配器。 */
export function assertCloudActionImplemented(action: string): void {
  if (!isCloudActionImplemented(action)) {
    throw new BackendError('not_implemented', `云动作尚未实现: ${action}`)
  }
}

/** 目标模式非 demo 时，实际运行到 demo 适配器即视为错误（禁止静默降级）。 */
export function assertNoDemoFallback(target: BackendKind, actual: BackendKind): void {
  if (target !== 'demo' && actual === 'demo') {
    throw new BackendError('internal_error', '云/HTTP 模式不得回退到演示数据')
  }
}
