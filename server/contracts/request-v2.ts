/**
 * 云-v2 请求/响应信封（多团队 DESIGN §6.1）。
 *
 * 所有入口统一先做信封校验：apiVersion、注册表、scope 种类、data 归属字段。
 * 任何一步失败即 fail-closed，返回 ok:false 且不进入业务处理。
 */

import { AppError, type AppErrorShape } from './errors.ts'
import { lookupAction, lookupDataSchema, type ActionSpec } from './actions.ts'
import { isIntInRange, isNonEmptyString, isPlainObject, parseDataObject } from '../shared/validation.ts'

export const API_VERSION = 2 as const

export type RequestScope = { kind: 'GLOBAL' } | { kind: 'TEAM'; clubId: string }

export interface CloudRequest<T = unknown> {
  apiVersion: 2
  action: string
  scope: RequestScope
  requestId: string
  mutationId?: string
  expectedRevision?: number
  data: T
}

export interface CloudSuccess<T = unknown> {
  ok: true
  requestId: string
  scope: RequestScope
  data: T
  serverTime: string
}

export interface CloudFailure {
  ok: false
  requestId: string
  scope: RequestScope | null
  error: AppErrorShape
  serverTime: string
}

export type CloudResponse<T = unknown> = CloudSuccess<T> | CloudFailure

export interface ParsedRequest<T = unknown> {
  request: CloudRequest<T>
  spec: ActionSpec
}

/** 每动作允许的 scope 种类是否与本次请求 scope 相符。 */
function scopeMatches(requirement: ActionSpec['scope'], kind: RequestScope['kind']): boolean {
  if (requirement === 'EITHER') return true
  return requirement === kind
}

function parseScope(raw: unknown): RequestScope {
  if (!isPlainObject(raw)) throw new AppError('scope_mismatch', 'scope 缺失或非法')
  if (raw.kind === 'GLOBAL') return { kind: 'GLOBAL' }
  if (raw.kind === 'TEAM') {
    if (!isNonEmptyString(raw.clubId)) throw new AppError('scope_mismatch', 'TEAM scope 缺少 clubId')
    return { kind: 'TEAM', clubId: raw.clubId }
  }
  throw new AppError('scope_mismatch', 'scope.kind 非法')
}

/** 校验 data 顶层字段（仅当该 action 声明了 schema）。 */
function assertActionData(action: string, data: Record<string, unknown>): void {
  const schema = lookupDataSchema(action)
  if (!schema) return
  for (const key of Object.keys(data)) {
    if (!schema.allowed.includes(key)) throw new AppError('validation_failed', `${action}: 不允许字段 ${key}`)
  }
  for (const key of schema.required ?? []) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) {
      throw new AppError('validation_failed', `${action}: 缺少字段 ${key}`)
    }
  }
  if (schema.mutex) {
    const present = schema.mutex.filter((key) => Object.prototype.hasOwnProperty.call(data, key))
    if (present.length > 1) {
      throw new AppError('validation_failed', `${action}: ${present.join('/')} 互斥，只能提供其一`)
    }
  }
}

/** 信封校验：成功返回可分发请求，失败抛 AppError。 */
export function validateEnvelope<T = unknown>(raw: unknown): ParsedRequest<T> {
  if (!isPlainObject(raw)) throw new AppError('validation_failed', '请求必须是 JSON 对象')
  if (raw.apiVersion !== API_VERSION) {
    throw new AppError('validation_failed', `apiVersion 必须为 ${API_VERSION}`)
  }
  if (!isNonEmptyString(raw.action)) throw new AppError('validation_failed', 'action 缺失')

  const spec = lookupAction(raw.action)
  if (!spec) throw new AppError('validation_failed', `未注册的 action: ${raw.action}`)

  if (!isNonEmptyString(raw.requestId)) throw new AppError('validation_failed', 'requestId 缺失')
  if (raw.mutationId !== undefined && !isNonEmptyString(raw.mutationId)) {
    throw new AppError('validation_failed', 'mutationId 必须是非空字符串')
  }
  if (raw.expectedRevision !== undefined && !isIntInRange(raw.expectedRevision, 0, Number.MAX_SAFE_INTEGER)) {
    throw new AppError('validation_failed', 'expectedRevision 必须是 >=0 的整数')
  }

  const scope = parseScope(raw.scope)
  if (!scopeMatches(spec.scope, scope.kind)) {
    throw new AppError('scope_mismatch', `action ${raw.action} 不允许 ${scope.kind} scope`)
  }

  const data = parseDataObject(raw.data) as T
  assertActionData(raw.action, data as Record<string, unknown>)

  const request: CloudRequest<T> = {
    apiVersion: API_VERSION,
    action: raw.action,
    scope,
    requestId: raw.requestId,
    data,
  }
  if (raw.mutationId !== undefined) request.mutationId = raw.mutationId
  if (raw.expectedRevision !== undefined) request.expectedRevision = raw.expectedRevision

  return { request, spec }
}
