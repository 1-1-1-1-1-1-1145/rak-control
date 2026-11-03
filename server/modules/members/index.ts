import { AppError } from '../../contracts/errors.ts'
import type { Database, Doc, Tx } from '../../repositories/store.ts'
import { COLLECTIONS } from '../../repositories/collections.ts'
import { identityId } from '../../repositories/ids.ts'
import type { ClubRole } from '../../contracts/dtos.ts'
import { requireCanManageTarget } from '../../shared/authorization.ts'
import { writeAudit } from '../../shared/audit.ts'
import { decodeCursor, encodeCursor } from '../../shared/cursor.ts'
import { resolveTenant, toTenantContext } from '../context.ts'
import { runIdempotent } from '../command.ts'

/**
 * 成员资料与任免（多团队 DESIGN §6.2、§M3）。
 *
 * - setRole 仅 owner；不能处置 owner，不能授 super_admin。
 * - setStatus manager 仅 member、owner 可 manager/member；不能处置 owner；LEFT 不得借 setStatus 复活。
 * - 关键写同事务触碰 actor member.mutationSeq、club.mutationSeq 与目标 user.securityMutationSeq。
 */

export interface MembersDeps {
  db: Database
  now: () => number
}

export interface MemberView {
  memberId: string
  displayName: string
  duty: string | null
  role: ClubRole
  status: 'ACTIVE' | 'LEFT' | 'DISABLED'
  joinedAt: string | null
  revision: number
}

function toView(member: Doc): MemberView {
  return {
    memberId: member._id,
    displayName: (member.displayName as string) ?? '',
    duty: (member.duty as string | null) ?? null,
    role: member.role as ClubRole,
    status: member.status as MemberView['status'],
    joinedAt: member.joinedAt ? new Date(member.joinedAt as number).toISOString() : null,
    revision: (member.revision as number) ?? 0,
  }
}

async function applyMemberPatch(tx: Tx, member: Doc, patch: Record<string, unknown>, now: number): Promise<Doc> {
  const next: Doc = {
    ...member,
    ...patch,
    revision: ((member.revision as number) ?? 0) + 1,
    mutationSeq: ((member.mutationSeq as number) ?? 0) + 1,
    updatedAt: now,
  }
  await tx.set(COLLECTIONS.members, next)
  return next
}

async function bumpClubFence(tx: Tx, club: Doc, now: number): Promise<void> {
  await tx.set(COLLECTIONS.clubs, {
    ...club,
    mutationSeq: ((club.mutationSeq as number) ?? 0) + 1,
    updatedAt: now,
  })
}

async function bumpActorFence(tx: Tx, actorMember: Doc, now: number): Promise<void> {
  await tx.set(COLLECTIONS.members, {
    ...actorMember,
    mutationSeq: ((actorMember.mutationSeq as number) ?? 0) + 1,
    updatedAt: now,
  })
}

async function bumpUserSecurity(tx: Tx, userId: string, now: number): Promise<void> {
  const user = await tx.get(COLLECTIONS.users, userId)
  if (!user) return
  await tx.set(COLLECTIONS.users, {
    ...user,
    securityMutationSeq: ((user.securityMutationSeq as number) ?? 0) + 1,
    updatedAt: now,
  })
}

export async function listMembers(
  deps: MembersDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  opts: { cursor?: string; pageSize?: number } = {}
): Promise<{ items: MemberView[]; nextCursor: string | null; hasMore: boolean; asOf: string }> {
  const now = deps.now()
  const tenant = await deps.db.tx(async (tx) => resolveTenant(tx, trusted, clubId))
  const ctx = toTenantContext(trusted, tenant)
  const isManagerPlus = ctx.role === 'manager' || ctx.role === 'super_admin'
  const directoryVisible = (tenant.club.settings as { memberDirectoryVisible?: boolean } | undefined)?.memberDirectoryVisible !== false
  if (!isManagerPlus && !directoryVisible) {
    throw new AppError('permission_denied', '本队未开放成员目录')
  }

  const pageSize = Math.min(Math.max(opts.pageSize ?? 20, 1), 50)
  const fingerprint = `member.list:${isManagerPlus ? 'admin' : 'public'}`
  let after: { createdAt: number; id: string } | null = null
  if (opts.cursor) {
    const cursor = decodeCursor(opts.cursor, { action: 'member.list', clubId, fingerprint })
    after = { createdAt: cursor.sort[0] as number, id: cursor.sort[1] as string }
  }

  const entries = (
    await deps.db.query(COLLECTIONS.members, (doc) => doc.clubId === clubId)
  )
    .map((member) => ({ createdAt: member.createdAt as number, id: member._id, member }))
    .sort((a, b) => (a.createdAt !== b.createdAt ? a.createdAt - b.createdAt : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .filter(
      (entry) =>
        after === null ||
        entry.createdAt > after.createdAt ||
        (entry.createdAt === after.createdAt && entry.id > after.id)
    )

  const slice = entries.slice(0, pageSize + 1)
  const hasMore = slice.length > pageSize
  const pageEntries = slice.slice(0, pageSize)
  const items = pageEntries.map((entry) => toView(entry.member))

  const last = pageEntries[pageEntries.length - 1]
  const nextCursor =
    hasMore && last
      ? encodeCursor({ v: 1, action: 'member.list', clubId, fingerprint, sort: [last.createdAt, last.id] })
      : null

  return { items, nextCursor, hasMore, asOf: new Date(now).toISOString() }
}

export async function setRole(
  deps: MembersDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  input: {
    targetMemberId: string
    targetRole: 'member' | 'manager' | 'super_admin'
    expectedRevision: number
    mutationId: string
  }
): Promise<MemberView> {
  const now = deps.now()
  const run = await runIdempotent(
    deps.db,
    now,
    {
      scope: { kind: 'TEAM', clubId },
      actorIdentityId: identityId(trusted.appId, trusted.openid),
      action: 'member.setRole',
      mutationId: input.mutationId,
      expectedRevision: input.expectedRevision,
      data: { targetMemberId: input.targetMemberId, targetRole: input.targetRole },
    },
    async (tx) => {
      const tenant = await resolveTenant(tx, trusted, clubId)
      // 仅**首位**超管（clubs.ownerMemberId）可任免；普通 super_admin 不可任免他人（2026-10-18）
      if (tenant.club.ownerMemberId !== tenant.member._id) {
        throw new AppError('permission_denied', '仅首位超级管理员可任免')
      }
      if (input.targetRole !== 'member' && input.targetRole !== 'manager' && input.targetRole !== 'super_admin') {
        throw new AppError('validation_failed', 'targetRole 只能是 member、manager 或 super_admin')
      }
      const target = await tx.get(COLLECTIONS.members, input.targetMemberId)
      if (!target || target.clubId !== clubId) throw new AppError('resource_not_found')
      if (tenant.club.ownerMemberId === target._id) throw new AppError('permission_denied', '不能通过业务接口修改 owner')
      if ((target.revision as number) !== input.expectedRevision) throw new AppError('revision_conflict')

      const updated = await applyMemberPatch(tx, target, { role: input.targetRole }, now)
      await bumpActorFence(tx, tenant.member, now)
      await bumpClubFence(tx, tenant.club, now)
      await bumpUserSecurity(tx, target.userId as string, now)
      await writeAudit(tx, {
        scope: `TEAM:${clubId}`,
        actorMemberId: tenant.member._id,
        action: 'member.setRole',
        resourceType: 'member',
        resourceId: target._id,
        seed: input.mutationId,
        now,
      })
      return toView(updated)
    }
  )
  return run.result
}

export async function setStatus(
  deps: MembersDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  input: { targetMemberId: string; targetStatus: 'ACTIVE' | 'DISABLED'; expectedRevision: number; mutationId: string }
): Promise<MemberView> {
  const now = deps.now()
  const run = await runIdempotent(
    deps.db,
    now,
    {
      scope: { kind: 'TEAM', clubId },
      actorIdentityId: identityId(trusted.appId, trusted.openid),
      action: 'member.setStatus',
      mutationId: input.mutationId,
      expectedRevision: input.expectedRevision,
      data: { targetMemberId: input.targetMemberId, targetStatus: input.targetStatus },
    },
    async (tx) => {
      const tenant = await resolveTenant(tx, trusted, clubId)
      const ctx = toTenantContext(trusted, tenant)
      const target = await tx.get(COLLECTIONS.members, input.targetMemberId)
      if (!target || target.clubId !== clubId) throw new AppError('resource_not_found')
      requireCanManageTarget(ctx, {
        role: target.role as ClubRole,
        isOwner: tenant.club.ownerMemberId === target._id,
      }, tenant.club.ownerMemberId === tenant.member._id)
      if (input.targetStatus !== 'ACTIVE' && input.targetStatus !== 'DISABLED') {
        throw new AppError('validation_failed', 'targetStatus 只能是 ACTIVE 或 DISABLED')
      }
      // LEFT 不得借 setStatus 隐式复活（首版仅受控运维）
      if (input.targetStatus === 'ACTIVE' && target.status === 'LEFT') {
        throw new AppError('invalid_transition', 'LEFT 成员不能通过业务接口恢复')
      }
      if ((target.revision as number) !== input.expectedRevision) throw new AppError('revision_conflict')

      const updated = await applyMemberPatch(tx, target, { status: input.targetStatus }, now)
      await bumpActorFence(tx, tenant.member, now)
      await bumpClubFence(tx, tenant.club, now)
      await bumpUserSecurity(tx, target.userId as string, now)
      await writeAudit(tx, {
        scope: `TEAM:${clubId}`,
        actorMemberId: tenant.member._id,
        action: 'member.setStatus',
        resourceType: 'member',
        resourceId: target._id,
        seed: input.mutationId,
        now,
      })
      return toView(updated)
    }
  )
  return run.result
}

export async function updateMyProfile(
  deps: MembersDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  input: { displayName: string; duty?: string | null; expectedRevision: number; mutationId: string }
): Promise<MemberView> {
  const now = deps.now()
  const run = await runIdempotent(
    deps.db,
    now,
    {
      scope: { kind: 'TEAM', clubId },
      actorIdentityId: identityId(trusted.appId, trusted.openid),
      action: 'member.updateMyProfile',
      mutationId: input.mutationId,
      expectedRevision: input.expectedRevision,
      data: input.duty === undefined ? { displayName: input.displayName } : { displayName: input.displayName, duty: input.duty },
    },
    async (tx) => {
      const tenant = await resolveTenant(tx, trusted, clubId)
      const member = tenant.member
      if ((member.revision as number) !== input.expectedRevision) throw new AppError('revision_conflict')
      // 职务只是本队展示性资料，不参与授权：任何成员都可改**自己的**职务。
      // （管理员改他人职务仍走 member.updateProfile 的既有权限矩阵。）
      const patch: Record<string, unknown> = { displayName: input.displayName }
      if (input.duty !== undefined) patch.duty = input.duty
      const updated = await applyMemberPatch(tx, member, patch, now)
      await bumpClubFence(tx, tenant.club, now)
      await writeAudit(tx, {
        scope: `TEAM:${clubId}`,
        actorMemberId: member._id,
        action: 'member.updateMyProfile',
        resourceType: 'member',
        resourceId: member._id,
        seed: input.mutationId,
        now,
      })
      return toView(updated)
    }
  )
  return run.result
}

export async function updateProfile(
  deps: MembersDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  input: { targetMemberId: string; displayName?: string; duty?: string | null; expectedRevision: number; mutationId: string }
): Promise<MemberView> {
  const now = deps.now()
  const data: Record<string, unknown> = { targetMemberId: input.targetMemberId }
  if (input.displayName !== undefined) data.displayName = input.displayName
  if (input.duty !== undefined) data.duty = input.duty
  const run = await runIdempotent(
    deps.db,
    now,
    {
      scope: { kind: 'TEAM', clubId },
      actorIdentityId: identityId(trusted.appId, trusted.openid),
      action: 'member.updateProfile',
      mutationId: input.mutationId,
      expectedRevision: input.expectedRevision,
      data,
    },
    async (tx) => {
      const tenant = await resolveTenant(tx, trusted, clubId)
      const ctx = toTenantContext(trusted, tenant)
      const target = await tx.get(COLLECTIONS.members, input.targetMemberId)
      if (!target || target.clubId !== clubId) throw new AppError('resource_not_found')
      requireCanManageTarget(ctx, {
        role: target.role as ClubRole,
        isOwner: tenant.club.ownerMemberId === target._id,
      }, tenant.club.ownerMemberId === tenant.member._id)
      if ((target.revision as number) !== input.expectedRevision) throw new AppError('revision_conflict')
      const patch: Record<string, unknown> = {}
      if (input.displayName !== undefined) patch.displayName = input.displayName
      if (input.duty !== undefined) patch.duty = input.duty
      const updated = await applyMemberPatch(tx, target, patch, now)
      await bumpActorFence(tx, tenant.member, now)
      await bumpClubFence(tx, tenant.club, now)
      await writeAudit(tx, {
        scope: `TEAM:${clubId}`,
        actorMemberId: tenant.member._id,
        action: 'member.updateProfile',
        resourceType: 'member',
        resourceId: target._id,
        seed: input.mutationId,
        now,
      })
      return toView(updated)
    }
  )
  return run.result
}
