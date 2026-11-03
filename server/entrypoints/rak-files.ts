import type { CloudResponse } from '../contracts/request-v2.ts'
import { dispatch, type HandlerMap } from './dispatch.ts'
import { loadFilesRuntime } from './runtime.ts'
import { createFileHandlers } from '../modules/files/index.ts'

/**
 * rakFiles 入口（多团队 DESIGN §11）。
 *
 * 运行时（数据库/存储 SDK 绑定 + 可信身份来源）在 `entrypoints/runtime.ts` 装配（M8）。
 * SDK 未安装或必填环境变量缺失时 `loadFilesRuntime()` 返回 null → 以空处理器表
 * fail-closed（所有 file.* 返回 not_implemented），**不伪造已可用**。
 * 真实字节与真机分片参数（U2/U4）仍在真机前保持 NOT_RUN。
 */

export async function main(event: unknown): Promise<CloudResponse> {
  const runtime = loadFilesRuntime()
  const handlers: HandlerMap = runtime ? createFileHandlers(runtime) : {}
  return dispatch('files', event, handlers)
}
