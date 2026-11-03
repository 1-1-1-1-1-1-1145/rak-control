import { AppError } from '../contracts/errors.ts'

/**
 * 金额精度（BASE-DESIGN §10.1；M6）。
 *
 * 持久化金额为人民币**分**的安全整数；API 输入为十进制元字符串
 * （0..999999999.99、最多 2 位小数、无符号/无千分位/无科学计数）。
 * 禁止用浮点元累计。
 */

const YUAN = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/

export function parseYuanToCents(raw: unknown, field: string): number {
  if (typeof raw !== 'string') {
    throw new AppError('validation_failed', `${field} 必须是十进制元字符串`)
  }
  const value = raw.trim()
  if (!YUAN.test(value)) {
    throw new AppError('validation_failed', `${field} 必须是 0..999999999.99、最多 2 位小数的十进制元`)
  }
  const [intPart, decPart = ''] = value.split('.')
  const cents = Number(intPart) * 100 + Number(decPart.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents)) {
    throw new AppError('validation_failed', `${field} 超出安全整数范围`)
  }
  return cents
}

/** 仅供展示层/文档示例使用；业务 DTO 一律回分整数。 */
export function centsToYuanText(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const integer = Math.floor(abs / 100)
  const fraction = (abs % 100).toString().padStart(2, '0')
  return `${sign}${integer}.${fraction}`
}
