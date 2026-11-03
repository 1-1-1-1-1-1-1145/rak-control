import type { CloudResponse } from '../contracts/request-v2.ts'
import { dispatch, type HandlerMap } from './dispatch.ts'
import { createApiHandlers } from '../modules/api-handlers.ts'
import { loadApiRuntime } from './runtime.ts'

/**
 * rakApi 入口（多团队 DESIGN §6.2）。
 *
 * M3–M6 已注册 身份/账户/团队/成员/任务/公告/ROI/绩效/社团 处理器。
 * 运行时（SDK + getWXContext）在 `entrypoints/runtime.ts` 装配（M8）；SDK 未安装或
 * 必填环境变量缺失时 `loadApiRuntime()` 返回 null → 空处理器表 fail-closed（not_implemented）。
 */

export async function main(event: unknown): Promise<CloudResponse> {
  const runtime = loadApiRuntime()
  const handlers: HandlerMap = runtime ? createApiHandlers(runtime) : {}
  return dispatch('api', event, handlers)
}
