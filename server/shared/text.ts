import { AppError } from '../contracts/errors.ts'

/**
 * 文本规范化（BASE-DESIGN §7.3；M6）。
 *
 * - 单行字段：拒绝全部控制字符。
 * - 多行字段：先把 CRLF/CR 规范化为 LF，仅允许 LF，其余 NUL/控制字符拒绝。
 * - 先 trim 再校验；长度按 **Unicode 码点**计数（前后端一致）。
 */

export interface TextRule {
  min: number
  max: number
  field: string
}

const CONTROL_SINGLE = /[\u0000-\u001F\u007F]/u
// 允许 \n(000A)，拒绝其余控制字符
const CONTROL_MULTI = /[\u0000-\u0009\u000B-\u001F\u007F]/u

function codePointLength(value: string): number {
  return [...value].length
}

function assertLength(value: string, rule: TextRule): string {
  const length = codePointLength(value)
  if (length < rule.min || length > rule.max) {
    throw new AppError('validation_failed', `${rule.field} 长度须为 ${rule.min}..${rule.max} 字`)
  }
  return value
}

export function normalizeSingleLine(raw: unknown, rule: TextRule): string {
  if (typeof raw !== 'string') throw new AppError('validation_failed', `${rule.field} 必须是字符串`)
  const value = raw.trim()
  if (CONTROL_SINGLE.test(value)) {
    throw new AppError('validation_failed', `${rule.field} 不能包含控制字符`)
  }
  return assertLength(value, rule)
}

export function normalizeMultiLine(raw: unknown, rule: TextRule): string {
  if (typeof raw !== 'string') throw new AppError('validation_failed', `${rule.field} 必须是字符串`)
  const value = raw.replace(/\r\n|\r/g, '\n').trim()
  if (CONTROL_MULTI.test(value)) {
    throw new AppError('validation_failed', `${rule.field} 不能包含控制字符（换行除外）`)
  }
  return assertLength(value, rule)
}
