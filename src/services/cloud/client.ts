import { BackendError, toBackendError } from '../../utils/backend-error.js'

/**
 * 云调用客户端（多团队 DESIGN §6.1、M2）。
 *
 * 纯工厂：不依赖 Taro，便于单测注入替身。职责：
 * - 构造统一的 apiVersion=2 信封（action/scope/requestId/mutationId/expectedRevision）。
 * - 校验响应：ok 布尔、requestId、**响应 scope 等于请求 scope**。
 * - ok:false → 抛 BackendError；绝不把失败当成功或空数组；绝不回退 demo。
 */

export const CLOUD_API_VERSION = 2 as const

export type RequestScope = { kind: 'GLOBAL' } | { kind: 'TEAM'; clubId: string }

export interface CloudEnvelope {
  apiVersion: 2
  action: string
  scope: RequestScope
  requestId: string
  mutationId?: string
  expectedRevision?: number
  data: Record<string, unknown>
}

export type CloudFunctionName = 'rakApi' | 'rakFiles'

export interface CloudTransport {
  callFunction(fn: CloudFunctionName, payload: CloudEnvelope): Promise<unknown>
}

export interface CloudCallOptions {
  mutationId?: string
  expectedRevision?: number
}

export interface CloudClient {
  call<T>(
    fn: CloudFunctionName,
    action: string,
    scope: RequestScope,
    data?: Record<string, unknown>,
    options?: CloudCallOptions
  ): Promise<T>
}

function sameScope(requested: RequestScope, response: unknown): boolean {
  if (!response || typeof response !== 'object') return false
  const got = response as Record<string, unknown>
  if (requested.kind === 'GLOBAL') return got.kind === 'GLOBAL' && got.clubId === undefined
  return got.kind === 'TEAM' && got.clubId === requested.clubId
}

export function createCloudClient(opts: {
  transport: CloudTransport
  requestIdFactory: () => string
}): CloudClient {
  const { transport, requestIdFactory } = opts

  return {
    async call<T>(
      fn: CloudFunctionName,
      action: string,
      scope: RequestScope,
      data: Record<string, unknown> = {},
      options: CloudCallOptions = {}
    ): Promise<T> {
      const envelope: CloudEnvelope = {
        apiVersion: CLOUD_API_VERSION,
        action,
        scope,
        requestId: requestIdFactory(),
        data,
      }
      if (options.mutationId) envelope.mutationId = options.mutationId
      if (options.expectedRevision !== undefined) envelope.expectedRevision = options.expectedRevision

      let raw: unknown
      try {
        raw = await transport.callFunction(fn, envelope)
      } catch {
        // 传输失败 ≠ 业务失败；不返回空数据，抛可重试错误。
        throw new BackendError('internal_error', '云函数调用失败，请检查网络后重试')
      }

      const res = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
      if (!res || typeof res.ok !== 'boolean') {
        throw new BackendError('internal_error', '云响应格式非法')
      }
      if (res.ok === false) {
        throw toBackendError(res.error)
      }

      if (typeof res.requestId !== 'string') {
        throw new BackendError('internal_error', '云响应缺少 requestId')
      }
      if (!sameScope(scope, res.scope)) {
        throw new BackendError('scope_mismatch', '云响应 scope 与请求不一致')
      }
      return res.data as T
    },
  }
}
