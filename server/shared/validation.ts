import { AppError } from '../contracts/errors.ts'

/** 仅接受普通对象（拒绝数组、null、原型污染载体）。 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

export function isIntInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

/**
 * 客户端**不得**提供的归属/自报授权字段（多团队 DESIGN §6.1）。
 * 允许出现在 scope（clubId）中，但不允许出现在 data 内任意层级。
 */
export const FORBIDDEN_DATA_KEYS: readonly string[] = [
  'clubId',
  'teamId',
  'tenantId',
  'companyId',
  'userId',
  'openid',
  'openId',
  'actorRole',
  'actorId',
  'permissions',
]

/** 递归扫描 data，出现任一归属/自报授权字段即 fail-closed。 */
export function assertNoForbiddenKeys(value: unknown, path = 'data'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, `${path}[${index}]`))
    return
  }
  if (!isPlainObject(value)) return
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_DATA_KEYS.includes(key)) {
      throw new AppError('validation_failed', `${path}.${key} 不允许由客户端提供`)
    }
    if (typeof nested === 'object' && nested !== null) {
      assertNoForbiddenKeys(nested, `${path}.${key}`)
    }
  }
}

/** 校验 data 为普通对象（默认空对象），随后做归属字段扫描。 */
export function parseDataObject(raw: unknown): Record<string, unknown> {
  const data = raw === undefined ? {} : raw
  if (!isPlainObject(data)) throw new AppError('validation_failed', 'data 必须是对象')
  assertNoForbiddenKeys(data)
  return data
}
