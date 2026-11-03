import { createHash } from 'node:crypto'
import { AppError } from '../contracts/errors.ts'
import type { RequestScope } from '../contracts/request-v2.ts'

/**
 * 命令幂等与结果未知（多团队 DESIGN §10.2、BASE-DESIGN §8.4）。
 *
 * 命令键 = hash(canonical(scope), actorIdentityId, action, mutationId)。
 * TEAM A/B 的同 mutationId 是不同命名空间；inputHash 排除 requestId 等诊断字段。
 */

export const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000
export const RESULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
export const IDEMPOTENCY_RETAIN_MS = 30 * 24 * 60 * 60 * 1000
export const CLOCK_SKEW_FUTURE_MS = 5 * 60 * 1000

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function scopeCanonical(scope: RequestScope): string {
  return scope.kind === 'GLOBAL' ? 'GLOBAL' : `TEAM:${scope.clubId}`
}

/** 从 UUIDv7 提取内嵌时间（毫秒）；非法格式抛 validation_failed。 */
export function mutationTimeMs(mutationId: string): number {
  if (!UUID_V7.test(mutationId)) throw new AppError('validation_failed', 'mutationId 必须是 UUIDv7')
  return Number.parseInt(mutationId.replace(/-/g, '').slice(0, 12), 16)
}

/** 首次请求年龄门禁：未来偏差 ≤5 分钟，年龄 ≤24 小时。 */
export function assertMutationFresh(mutationId: string, serverNowMs: number): void {
  const time = mutationTimeMs(mutationId)
  if (time > serverNowMs + CLOCK_SKEW_FUTURE_MS) {
    throw new AppError('validation_failed', 'mutationId 时间超出允许的未来偏差')
  }
  if (serverNowMs - time > RETRY_WINDOW_MS) {
    throw new AppError('command_expired', '命令超出重试窗口')
  }
}

/** 稳定 JSON 规范（键排序），用于 inputHash；不依赖对象键插入顺序。 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`
}

export interface CommandFingerprintInput {
  apiVersion: number
  action: string
  scope: RequestScope
  data: unknown
  expectedRevision?: number
}

export function inputHash(input: CommandFingerprintInput): string {
  const canonical: Record<string, unknown> = {
    apiVersion: input.apiVersion,
    action: input.action,
    scope: input.scope,
    data: input.data,
  }
  if (input.expectedRevision !== undefined) canonical.expectedRevision = input.expectedRevision
  return createHash('sha256').update(canonicalJson(canonical)).digest('hex')
}

export function commandKey(
  scope: RequestScope,
  actorIdentityId: string,
  action: string,
  mutationId: string
): string {
  return createHash('sha256')
    .update(JSON.stringify(['rak-command-v1', scopeCanonical(scope), actorIdentityId, action, mutationId]))
    .digest('hex')
}

export type CommandStatus =
  | 'SUCCEEDED'
  | 'DETERMINISTIC_REJECTED'
  | 'ACCEPTED_JOB'
  | 'ABSENT_IN_WINDOW'
  | 'EXPIRED'

/** 查不到记录但仍在 24h 内 = ABSENT_IN_WINDOW（原请求可能尚在提交），不是确定失败。 */
export function classifyMissingCommand(commandTimeMs: number, serverNowMs: number): CommandStatus {
  if (serverNowMs - commandTimeMs > RESULT_WINDOW_MS) return 'EXPIRED'
  return 'ABSENT_IN_WINDOW'
}
