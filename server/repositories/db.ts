import { AppError } from '../contracts/errors.ts'
import { assertSameClub, type TenantContext } from '../shared/tenant-context.ts'

/**
 * 仓库契约（多团队 DESIGN §6.3）。
 *
 * - 所有业务仓库方法必须接收不可缺的 TenantContext；getById 也必须做同队比较。
 * - count/aggregate/search 与 list 同授权 filter；聚合 lookup 子管道同队。
 * - 禁止默认 clubId、可选 tenant 参数、公开 rawCollection 逃逸。
 * - 只有明确的**全局账户仓库**可无队（如 identities/users）。
 *
 * 具体 SDK 绑定在 M3 实现；本文件固定接口与不变量。
 */

export interface DocRecord {
  _id: string
  clubId?: string
  [key: string]: unknown
}

export interface TenantScopedRepository<T extends DocRecord> {
  getById(ctx: TenantContext, id: string): Promise<T | null>
  list(ctx: TenantContext, query: unknown): Promise<T[]>
  count(ctx: TenantContext, query: unknown): Promise<number>
}

/** 记录必须显式 clubId 且与请求 scope 相等；缺失/异队统一 resource_not_found。 */
export function assertRecordClub<T extends DocRecord>(ctx: TenantContext, record: T): T {
  if (!record.clubId) throw new AppError('resource_not_found')
  assertSameClub(ctx, record.clubId)
  return record
}

/** 全局账户仓库（无队归属）标记接口；不得用于任何团队业务集合。 */
export interface GlobalRepository<T extends DocRecord> {
  getById(id: string): Promise<T | null>
  put(record: T): Promise<void>
}
