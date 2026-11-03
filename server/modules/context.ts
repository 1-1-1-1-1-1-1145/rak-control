import { AppError } from '../contracts/errors.ts'
import type { Doc, Tx } from '../repositories/store.ts'
import { COLLECTIONS } from '../repositories/collections.ts'
import { identityId, memberId } from '../repositories/ids.ts'
import type { TrustedIdentity } from '../shared/identity.ts'
import { permissionsFor } from '../shared/permissions.ts'
import type { TenantContext } from '../shared/tenant-context.ts'

/**
 * 本队授权解析（多团队 DESIGN §6.3）。
 *
 * 在**同一事务内**重读 identity→user→member(clubId,userId)→club，校验平台安全状态、
 * 成员状态与本队维护状态；任何不满足即 fail-closed。禁止读快照后异步写。
 */

export interface ResolvedTenant {
  userId: string
  user: Doc
  member: Doc
  club: Doc
}

export async function resolveTenant(
  tx: Tx,
  trusted: { appId: string; openid: string },
  clubId: string
): Promise<ResolvedTenant> {
  if (!clubId) throw new AppError('scope_mismatch', 'TEAM scope 缺少 clubId')

  const identity = await tx.get(COLLECTIONS.identities, identityId(trusted.appId, trusted.openid))
  if (!identity || typeof identity.userId !== 'string') throw new AppError('identity_required')
  const userId = identity.userId

  const user = await tx.get(COLLECTIONS.users, userId)
  if (!user) throw new AppError('identity_required')
  if (user.securityState === 'BLOCKED') throw new AppError('account_blocked')

  const member = await tx.get(COLLECTIONS.members, memberId(clubId, userId))
  if (!member) throw new AppError('membership_required')

  const club = await tx.get(COLLECTIONS.clubs, clubId)
  if (!club) throw new AppError('resource_not_found')
  // 已解散团队对业务不可见（历史数据保留在库，仅平台运维可审计）
  if (club.status === 'DISSOLVED') throw new AppError('resource_not_found')
  if (club.status === 'MAINTENANCE') throw new AppError('team_maintenance')

  if (member.status === 'DISABLED') throw new AppError('membership_disabled')
  if (member.status === 'LEFT') throw new AppError('membership_left')
  if (member.status !== 'ACTIVE') throw new AppError('membership_required')

  return { userId, user, member, club }
}

export function toTenantContext(
  trusted: { appId: string; openid: string },
  tenant: ResolvedTenant
): TenantContext {
  const clubId = tenant.club._id
  return {
    clubId,
    actorMemberId: tenant.member._id,
    actorUserId: tenant.userId,
    role: tenant.member.role as TenantContext['role'],
    permissions: permissionsFor(tenant.member.role as TenantContext['role']),
    membershipRevision: tenant.member.revision as number,
  }
}

/** 授权写栅栏：递增指定文档的 mutationSeq（同一事务内）。 */
export async function bumpMutationSeq(tx: Tx, collection: string, doc: Doc, now: number): Promise<Doc> {
  const next: Doc = {
    ...doc,
    mutationSeq: ((doc.mutationSeq as number) ?? 0) + 1,
    updatedAt: now,
  }
  await tx.set(collection, next)
  return next
}
