import { AppError } from '../../contracts/errors.ts'
import type { Database, Doc } from '../../repositories/store.ts'
import { COLLECTIONS } from '../../repositories/collections.ts'
import { identityId, sha256Hex } from '../../repositories/ids.ts'
import type {
  AdminClubSearchPage,
  ClubDissolutionPage,
  ClubDissolutionView,
  DissolutionStatus,
  DissolveClubResult,
} from '../../contracts/dtos.ts'
import { writeAudit } from '../../shared/audit.ts'
import { decodeCursor, encodeCursor } from '../../shared/cursor.ts'
import { normalizeSingleLine } from '../../shared/text.ts'
import { bumpMutationSeq, resolveTenant, toTenantContext } from '../context.ts'
import { runIdempotent } from '../command.ts'

/**
 * 团队解散（2026-10-18 用户裁决）。
 *
 * - **常规**：本队 manager / super_admin 可直接解散（`club.dissolve`，TEAM）；
 * - **协助**：管理员无法执行/无法及时完成时，可提交申请（`club.dissolution.request`），
 *   由**任一 super_admin**（可跨队）批准并执行，或驳回；
 * - **超管直接**：super_admin 可解散**任意团队**（含自己不在的队，`club.dissolveAny`，GLOBAL）。
 *
 * 落地方式：`club.status='DISSOLVED'` + `dissolvedAt`；**成员关系与业务数据保留**（历史可审计），
 * 但 `resolveTenant` 会拒绝进入、`team.listMine` 不再返回该队。
 * 这样解散是 O(1) 事务写，不会因成员多而超事务操作上限。
 */

export interface DissolutionDeps {
  db: Database
  now: () => number
}

function dissolutionDocId(clubId: string): string {
  return sha256Hex(JSON.stringify(['rak-dissolve-v1', clubId]))
}

function iso(value: unknown): string | null {
  return typeof value === 'number' ? new Date(value).toISOString() : null
}

function toView(doc: Doc, clubName: string): ClubDissolutionView {
  return {
    clubId: doc.clubId as string,
    clubName,
    requestedByMemberId: doc.requestedByMemberId as string,
    requestedByDisplayName: (doc.requestedByDisplayName as string) ?? '',
    reason: (doc.reason as string) ?? '',
    status: doc.status as DissolutionStatus,
    decidedByMemberId: (doc.decidedByMemberId as string | null) ?? null,
    decidedAt: iso(doc.decidedAt),
    rejectReason: (doc.rejectReason as string | null) ?? null,
    revision: (doc.revision as number) ?? 1,
    createdAt: iso(doc.createdAt) as string,
    updatedAt: iso(doc.updatedAt) as string,
  }
}

/** 调用者必须是**任一团队**的 ACTIVE super_admin（用于跨队动作）；事务内会再次复核。 */
async function requireAnySuperAdmin(
  db: Database,
  trusted: { appId: string; openid: string }
): Promise<{ userId: string; actorMemberId: string }> {
  const identity = await db.read(COLLECTIONS.identities, identityId(trusted.appId, trusted.openid))
  if (!identity || typeof identity.userId !== 'string') throw new AppError('identity_required')
  const userId = identity.userId
  const user = await db.read(COLLECTIONS.users, userId)
  if (!user) throw new AppError('identity_required')
  if (user.securityState === 'BLOCKED') throw new AppError('account_blocked')
  const memberships = await db.query(
    COLLECTIONS.members,
    (doc) => doc.userId === userId && doc.role === 'super_admin' && doc.status === 'ACTIVE'
  )
  for (const membership of memberships) {
    const club = await db.read(COLLECTIONS.clubs, membership.clubId as string)
    if (club?.status === 'ACTIVE') return { userId, actorMemberId: membership._id }
  }
  throw new AppError('permission_denied', '仅超级管理员可执行此操作')
}

async function assertActorStillSuperAdmin(
  tx: Parameters<typeof bumpMutationSeq>[0],
  actorMemberId: string
): Promise<void> {
  const actor = await tx.get(COLLECTIONS.members, actorMemberId)
  if (!actor || actor.status !== 'ACTIVE' || actor.role !== 'super_admin') {
    throw new AppError('permission_denied', '超级管理员身份已失效')
  }
  const actorClub = await tx.get(COLLECTIONS.clubs, actor.clubId as string)
  if (!actorClub || actorClub.status !== 'ACTIVE') {
    throw new AppError('permission_denied', '超级管理员身份已失效')
  }
}

/** 事务内执行解散：只置团队状态，保留成员与业务数据（历史可追溯）。 */
async function applyDissolution(tx: Parameters<typeof bumpMutationSeq>[0], club: Doc, now: number): Promise<void> {
  await tx.set(COLLECTIONS.clubs, {
    ...club,
    status: 'DISSOLVED',
    dissolvedAt: now,
    revision: ((club.revision as number) ?? 1) + 1,
    mutationSeq: ((club.mutationSeq as number) ?? 0) + 1,
    updatedAt: now,
  })
  // 待处理的协助申请一并标记为已处理（避免解散后仍有 PENDING）
  const pending = await tx.get(COLLECTIONS.clubDissolutions, dissolutionDocId(club._id))
  if (pending && pending.status === 'PENDING') {
    await tx.set(COLLECTIONS.clubDissolutions, {
      ...pending,
      status: 'APPROVED',
      decidedAt: now,
      revision: ((pending.revision as number) ?? 1) + 1,
      updatedAt: now,
    })
  }
}

async function countMembers(db: Database, clubId: string): Promise<number> {
  return (await db.query(COLLECTIONS.members, (doc) => doc.clubId === clubId)).length
}

/** 本队管理员直接解散（TEAM、manager+）。 */
export async function dissolveByManager(
  deps: DissolutionDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  input: { reason: string; mutationId: string }
): Promise<DissolveClubResult> {
  const now = deps.now()
  const reason = normalizeSingleLine(input.reason, { field: '解散原因', min: 2, max: 200 })
  const affectedMemberCount = await countMembers(deps.db, clubId)

  const run = await runIdempotent(
    deps.db,
    now,
    {
      scope: { kind: 'TEAM', clubId },
      actorIdentityId: identityId(trusted.appId, trusted.openid),
      action: 'club.dissolve',
      mutationId: input.mutationId,
      data: { reason },
    },
    async (tx) => {
      const tenant = await resolveTenant(tx, trusted, clubId)
      const ctx = toTenantContext(trusted, tenant)
      if (ctx.role !== 'manager' && ctx.role !== 'super_admin') throw new AppError('permission_denied')
      await applyDissolution(tx, tenant.club, now)
      await writeAudit(tx, {
        scope: `TEAM:${clubId}`,
        actorMemberId: tenant.member._id,
        action: 'club.dissolve',
        resourceType: 'club',
        resourceId: clubId,
        seed: input.mutationId,
        now,
        reason,
      })
      return { clubId, status: 'DISSOLVED' as const, affectedMemberCount }
    }
  )
  return run.result
}

/** 管理员提交「协助解散」申请（TEAM、manager+）。 */
export async function requestDissolution(
  deps: DissolutionDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  input: { reason: string; mutationId: string }
): Promise<ClubDissolutionView> {
  const now = deps.now()
  const reason = normalizeSingleLine(input.reason, { field: '申请原因', min: 2, max: 200 })

  return deps.db.tx(async (tx) => {
    const tenant = await resolveTenant(tx, trusted, clubId)
    const ctx = toTenantContext(trusted, tenant)
    if (ctx.role !== 'manager' && ctx.role !== 'super_admin') throw new AppError('permission_denied')

    const docId = dissolutionDocId(clubId)
    const existing = await tx.get(COLLECTIONS.clubDissolutions, docId)
    if (existing) {
      if (existing.status === 'PENDING') {
        if (existing.reason !== reason) throw new AppError('idempotency_conflict', '同一解散申请的内容不一致')
        return toView(existing, (tenant.club.name as string) ?? '')
      }
      if (existing.status === 'APPROVED') throw new AppError('invalid_transition', '该团队已解散')
    }

    const doc: Doc = {
      _id: docId,
      clubId,
      requestedByMemberId: tenant.member._id,
      requestedByDisplayName: (tenant.member.displayName as string) ?? '',
      reason,
      status: 'PENDING',
      decidedByMemberId: null,
      decidedAt: null,
      rejectReason: null,
      revision: existing ? ((existing.revision as number) ?? 1) + 1 : 1,
      createdAt: existing ? (existing.createdAt as number) : now,
      updatedAt: now,
    }
    await tx.set(COLLECTIONS.clubDissolutions, doc)
    await writeAudit(tx, {
      scope: `TEAM:${clubId}`,
      actorMemberId: tenant.member._id,
      action: 'club.dissolution.request',
      resourceType: 'club',
      resourceId: clubId,
      seed: input.mutationId,
      now,
      reason,
    })
    return toView(doc, (tenant.club.name as string) ?? '')
  })
}

/** 跨队协助申请列表（GLOBAL、任一 super_admin；默认 PENDING）。 */
export async function listDissolutionRequests(
  deps: DissolutionDeps,
  trusted: { appId: string; openid: string },
  opts: { status?: DissolutionStatus; cursor?: string; pageSize?: number } = {}
): Promise<ClubDissolutionPage> {
  const now = deps.now()
  await requireAnySuperAdmin(deps.db, trusted)

  const status: DissolutionStatus = opts.status ?? 'PENDING'
  const pageSize = Math.min(Math.max(opts.pageSize ?? 20, 1), 50)
  const fingerprint = `club.dissolution.list:${status}`
  let after: { createdAt: number; id: string } | null = null
  if (opts.cursor) {
    const cursor = decodeCursor(opts.cursor, { action: 'club.dissolution.list', clubId: null, fingerprint })
    after = { createdAt: cursor.sort[0] as number, id: cursor.sort[1] as string }
  }

  const entries = (
    await deps.db.query(COLLECTIONS.clubDissolutions, (doc) => doc.status === status)
  )
    .map((doc) => ({ createdAt: (doc.createdAt as number) ?? 0, id: doc._id, doc }))
    .sort((a, b) => (a.createdAt !== b.createdAt ? b.createdAt - a.createdAt : a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .filter(
      (entry) =>
        after === null ||
        entry.createdAt < after.createdAt ||
        (entry.createdAt === after.createdAt && entry.id < after.id)
    )

  const slice = entries.slice(0, pageSize + 1)
  const hasMore = slice.length > pageSize
  const page = slice.slice(0, pageSize)
  const items: ClubDissolutionView[] = []
  for (const entry of page) {
    const club = await deps.db.read(COLLECTIONS.clubs, entry.doc.clubId as string)
    items.push(toView(entry.doc, (club?.name as string) ?? ''))
  }
  const last = page[page.length - 1]

  return {
    items,
    nextCursor:
      hasMore && last
        ? encodeCursor({
            v: 1,
            action: 'club.dissolution.list',
            clubId: null,
            fingerprint,
            sort: [last.createdAt, last.id],
          })
        : null,
    hasMore,
    asOf: new Date(now).toISOString(),
  }
}

/** 超管处理协助解散申请（GLOBAL、任一 super_admin）。 */
export async function decideDissolution(
  deps: DissolutionDeps,
  trusted: { appId: string; openid: string },
  input: { clubId: string; approve: boolean; rejectReason?: string; mutationId: string; expectedRevision?: number }
): Promise<{ clubId: string; status: DissolutionStatus; affectedMemberCount: number }> {
  const now = deps.now()
  const actor = await requireAnySuperAdmin(deps.db, trusted)
  const rejectReason = input.approve
    ? ''
    : normalizeSingleLine(input.rejectReason, { field: '驳回理由', min: 1, max: 200 })
  const affectedMemberCount = input.approve ? await countMembers(deps.db, input.clubId) : 0

  const run = await runIdempotent(
    deps.db,
    now,
    {
      scope: { kind: 'GLOBAL' },
      actorIdentityId: identityId(trusted.appId, trusted.openid),
      action: 'club.dissolution.decide',
      mutationId: input.mutationId,
      expectedRevision: input.expectedRevision,
      data: input.approve ? { clubId: input.clubId } : { clubId: input.clubId, rejectReason },
    },
    async (tx) => {
      await assertActorStillSuperAdmin(tx, actor.actorMemberId)
      const doc = await tx.get(COLLECTIONS.clubDissolutions, dissolutionDocId(input.clubId))
      if (!doc || doc.clubId !== input.clubId) throw new AppError('resource_not_found')
      if (doc.status !== 'PENDING') throw new AppError('invalid_transition', '该申请已被处理')
      if (input.expectedRevision !== undefined && ((doc.revision as number) ?? 0) !== input.expectedRevision) {
        throw new AppError('revision_conflict')
      }

      const club = await tx.get(COLLECTIONS.clubs, input.clubId)
      if (!club) throw new AppError('resource_not_found')
      if (club.status === 'DISSOLVED') throw new AppError('invalid_transition', '该团队已解散')

      await tx.set(COLLECTIONS.clubDissolutions, {
        ...doc,
        status: input.approve ? 'APPROVED' : 'REJECTED',
        decidedByMemberId: actor.actorMemberId,
        decidedAt: now,
        rejectReason: input.approve ? null : rejectReason,
        revision: ((doc.revision as number) ?? 1) + 1,
        updatedAt: now,
      })

      if (input.approve) {
        await tx.set(COLLECTIONS.clubs, {
          ...club,
          status: 'DISSOLVED',
          dissolvedAt: now,
          revision: ((club.revision as number) ?? 1) + 1,
          mutationSeq: ((club.mutationSeq as number) ?? 0) + 1,
          updatedAt: now,
        })
      }

      await writeAudit(tx, {
        scope: 'GLOBAL',
        actorMemberId: actor.actorMemberId,
        action: 'club.dissolution.decide',
        resourceType: 'club',
        resourceId: input.clubId,
        seed: input.mutationId,
        now,
        reason: input.approve ? doc.reason as string : rejectReason,
      })

      return {
        clubId: input.clubId,
        status: (input.approve ? 'APPROVED' : 'REJECTED') as DissolutionStatus,
        affectedMemberCount,
      }
    }
  )
  return run.result
}

/**
 * 超管按名称/编码/ID 搜索目标团队（GLOBAL、任一 super_admin）。
 *
 * 只返回最小目录字段（clubId/name/displayCode/status），不授予任何他队业务数据；
 * 已解散团队不返回（不可再次解散）。
 */
export async function searchClubsForAdmin(
  deps: DissolutionDeps,
  trusted: { appId: string; openid: string },
  opts: { keyword?: string } = {}
): Promise<AdminClubSearchPage> {
  await requireAnySuperAdmin(deps.db, trusted)
  const keyword = normalizeSingleLine(opts.keyword, { field: '团队名称', min: 1, max: 40 })
  const needle = keyword.toLowerCase()
  const limit = 20

  const ranked = (await deps.db.query(COLLECTIONS.clubs, (doc) => doc.status !== 'DISSOLVED'))
    .map((doc) => {
      const name = (doc.name as string) ?? ''
      const displayCode = (doc.displayCode as string) ?? ''
      const fields = [name.toLowerCase(), displayCode.toLowerCase(), doc._id.toLowerCase()]
      let rank = 0
      if (needle) {
        if (fields.some((value) => value === needle)) rank = 0
        else if (fields.some((value) => value.startsWith(needle))) rank = 1
        else if (fields.some((value) => value.includes(needle))) rank = 2
        else rank = Number.MAX_SAFE_INTEGER
      }
      return { doc, name, displayCode, rank }
    })
    .filter((entry) => entry.rank !== Number.MAX_SAFE_INTEGER)
    .sort((a, b) =>
      a.rank !== b.rank ? a.rank - b.rank : a.name.localeCompare(b.name, 'zh-Hans-CN')
    )

  return {
    items: ranked.slice(0, limit).map((entry) => ({
      clubId: entry.doc._id,
      name: entry.name,
      displayCode: entry.displayCode,
      status: entry.doc.status as AdminClubSearchPage['items'][number]['status'],
    })),
    hasMore: ranked.length > limit,
  }
}

/** 超管直接解散任意团队（GLOBAL、任一 super_admin；含跨队）。 */
export async function dissolveAnyClub(
  deps: DissolutionDeps,
  trusted: { appId: string; openid: string },
  input: { clubId: string; reason: string; mutationId: string }
): Promise<DissolveClubResult> {
  const now = deps.now()
  const reason = normalizeSingleLine(input.reason, { field: '解散原因', min: 2, max: 200 })
  const actor = await requireAnySuperAdmin(deps.db, trusted)
  const affectedMemberCount = await countMembers(deps.db, input.clubId)

  const run = await runIdempotent(
    deps.db,
    now,
    {
      scope: { kind: 'GLOBAL' },
      actorIdentityId: identityId(trusted.appId, trusted.openid),
      action: 'club.dissolveAny',
      mutationId: input.mutationId,
      data: { clubId: input.clubId, reason },
    },
    async (tx) => {
      await assertActorStillSuperAdmin(tx, actor.actorMemberId)
      const club = await tx.get(COLLECTIONS.clubs, input.clubId)
      if (!club) throw new AppError('resource_not_found')
      if (club.status === 'DISSOLVED') throw new AppError('invalid_transition', '该团队已解散')
      await applyDissolution(tx, club, now)
      await writeAudit(tx, {
        scope: 'GLOBAL',
        actorMemberId: actor.actorMemberId,
        action: 'club.dissolveAny',
        resourceType: 'club',
        resourceId: input.clubId,
        seed: input.mutationId,
        now,
        reason,
      })
      return { clubId: input.clubId, status: 'DISSOLVED' as const, affectedMemberCount }
    }
  )
  return run.result
}
