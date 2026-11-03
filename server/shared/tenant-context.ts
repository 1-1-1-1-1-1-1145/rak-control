import { AppError } from '../contracts/errors.ts'
import type { ClubRole } from '../contracts/dtos.ts'

/**
 * 本队不可变请求上下文（多团队 DESIGN §9.1）。
 * 仓库所有业务方法必须接收 TenantContext；getById 也必须比对 clubId。
 */
export interface TenantContext {
  readonly clubId: string
  readonly actorMemberId: string
  readonly actorUserId: string
  readonly role: ClubRole
  readonly permissions: readonly string[]
  readonly membershipRevision: number
}

/** 资源归属必须与请求 scope 的 clubId 相等；异队/不存在统一按 resource_not_found。 */
export function assertSameClub(ctx: TenantContext, resourceClubId: string): void {
  if (ctx.clubId !== resourceClubId) throw new AppError('resource_not_found')
}

export function isManagerPlus(role: ClubRole): boolean {
  return role === 'manager' || role === 'super_admin'
}

export function isOwner(role: ClubRole): boolean {
  return role === 'super_admin'
}

export function requireActiveMember(ctx: TenantContext): void {
  if (!ctx.actorMemberId) throw new AppError('membership_required')
}
