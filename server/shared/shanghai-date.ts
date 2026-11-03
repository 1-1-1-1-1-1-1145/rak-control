import { AppError } from '../contracts/errors.ts'

/**
 * 上海业务日与统计周期（BASE-DESIGN §10.1；M6）。
 *
 * `accountingDate` 是上海业务日 `YYYY-MM-DD`；周期边界左闭右开。
 * 中国大陆无夏令时，故 UTC+8 固定偏移即等价上海本地日历。
 * `createdAt/updatedAt` 仍是 UTC 毫秒，不与业务日字符串混算。
 */

export const SH_OFFSET_MS = 8 * 60 * 60 * 1000

export type RoiPeriod = 'month' | 'quarter' | 'year' | 'all'

const PERIODS: readonly RoiPeriod[] = ['month', 'quarter', 'year', 'all']

function pad2(value: number): string {
  return value.toString().padStart(2, '0')
}

function shParts(ms: number): { year: number; month: number; day: number } {
  const shifted = new Date(ms + SH_OFFSET_MS)
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() }
}

export function toShDay(ms: number): string {
  const { year, month, day } = shParts(ms)
  return `${year}-${pad2(month)}-${pad2(day)}`
}

export function isRoiPeriod(value: unknown): value is RoiPeriod {
  return typeof value === 'string' && (PERIODS as readonly string[]).includes(value)
}

/** 左闭右开区间 `[start, endExclusive)`，均为上海业务日字符串；`all` 返回 null。 */
export function periodRange(
  period: RoiPeriod,
  nowMs: number
): { start: string; endExclusive: string } | null {
  if (!isRoiPeriod(period)) throw new AppError('validation_failed', 'period 非法')
  if (period === 'all') return null

  const { year, month } = shParts(nowMs)
  let startYear = year
  let startMonth = month
  let endYear = year
  let endMonth = month + 1

  if (period === 'quarter') {
    startMonth = Math.floor((month - 1) / 3) * 3 + 1
    endMonth = startMonth + 3
  } else if (period === 'year') {
    startMonth = 1
    endMonth = 13
  }
  if (endMonth > 12) {
    endYear += Math.floor((endMonth - 1) / 12)
    endMonth = ((endMonth - 1) % 12) + 1
  }
  return { start: `${startYear}-${pad2(startMonth)}-01`, endExclusive: `${endYear}-${pad2(endMonth)}-01` }
}

/** 相对当前月的最近 6 个自然月键（升序 `YYYY-MM`）。 */
export function lastSixMonthKeys(nowMs: number): string[] {
  const { year, month } = shParts(nowMs)
  const keys: string[] = []
  for (let offset = 5; offset >= 0; offset -= 1) {
    let y = year
    let m = month - offset
    while (m <= 0) {
      m += 12
      y -= 1
    }
    keys.push(`${y}-${pad2(m)}`)
  }
  return keys
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** 校验严格 `YYYY-MM-DD` 且为真实日历日；返回规范化字符串。 */
export function assertShDay(raw: unknown, field: string): string {
  if (typeof raw !== 'string' || !DAY.test(raw)) {
    throw new AppError('validation_failed', `${field} 必须是 YYYY-MM-DD`)
  }
  const [y, m, d] = raw.split('-').map((part) => Number(part))
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() + 1 !== m || date.getUTCDate() !== d) {
    throw new AppError('validation_failed', `${field} 不是真实日历日`)
  }
  return raw
}
