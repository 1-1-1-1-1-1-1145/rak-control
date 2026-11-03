import { AppError } from '../../contracts/errors.ts'
import type { Database, Doc, Tx } from '../../repositories/store.ts'
import { COLLECTIONS } from '../../repositories/collections.ts'
import { identityId, sha256Hex } from '../../repositories/ids.ts'
import type {
  ApproveDismissalResult,
  DismissalStatus,
  MemberDismissalPage,
  MemberDismissalView,
} from '../../contracts/dtos.ts'
import { writeAudit } from '../../shared/audit.ts'
import { decodeCursor, encodeCursor } from '../../shared/cursor.ts'
import { normalizeSingleLine } from '../../shared/text.ts'
import { bumpMutationSeq, resolveTenant, toTenantContext } from '../context.ts'
import { runIdempotent } from '../command.ts'

/**
 * 裁员（2026-10-18 用户第二次裁决）。
 *
 * 规则：
 * - **首位超管**（`clubs.ownerMemberId`）发起的申请：本人第一阶段确认即完成并执行；
 * - **其他人**（manager / 非首位 super_admin）发起的申请：
 *   ① 申请人本人完成第一阶段；② 由**另一位** super_admin 完成最终审批；两阶段齐才执行；
 * - **禁止同一人完成全部审批**（首位超管单节点除外）；
 * - 不能裁 owner、不能裁自己；目标必须仍是 ACTIVE/DISABLED；
 * - 落地：目标 `status=LEFT`（不可通过业务接口恢复，保留历史）。
 *
 * 自动流转：`currentStage` 由服务端计算（FIRST → FINAL → DONE），审批列表按 `currentStage`
 * 只对当前节点的负责人可用；审计记录审批人、时间、阶段与结果。
 */

export interface DismissalDeps {
  db: Database
  now: () => number
}

function dismissalDocId(clubId: string, targetMemberId: string): string {
  return sha256Hex(JSON.stringify(['rak-dismissal-v1', clubId, targetMemberId]))
}

function iso(value: unknown): string | null {
  return typeof value === 'number' ? new Date(value).toISOString() : null
}

function toView(doc: Doc): MemberDismissalView {
  const firstApprovedByMemberId = (doc.firstApprovedByMemberId as string | null) ?? null
  const finalApprovedByMemberId = (doc.finalApprovedByMemberId as string | null) ?? null
  const requesterIsPrimaryOwner = doc.requesterIsPrimaryOwner === true
  const currentStage: MemberDismissalView['currentStage'] =
    doc.status !== 'PENDING'
      ? 'DONE'
      : !firstApprovedByMemberId
        ? 'FIRST'
        : requesterIsPrimaryOwner || finalApprovedByMemberId
          ? 'DONE'
          : 'FINAL'
  return {
    dismissalId: doc._id,
    clubId: doc.clubId as string,
    targetMemberId: doc.targetMemberId as string,
    targetDisplayName: (doc.targetDisplayName as string) ?? '',
    targetRole: doc.targetRole as MemberDismissalView['targetRole'],
    reason: (doc.reason as string) ?? '',
    status: doc.status as DismissalStatus,
    requestedByMemberId: doc.requestedByMemberId as string,
    requestedByDisplayName: (doc.requestedByDisplayName as string) ?? '',
    requesterIsPrimaryOwner,
    currentStage,
    firstApprovedByMemberId,
    firstApprovedAt: iso(doc.firstApprovedAt),
    finalApprovedByMemberId,
    finalApprovedAt: iso(doc.finalApprovedAt),
    decidedAt: iso(doc.decidedAt),
    rejectReason: (doc.rejectReason as string | null) ?? null,
    revision: (doc.revision as number) ?? 1,
    createdAt: iso(doc.createdAt) as string,
    updatedAt: iso(doc.updatedAt) as string,
  }
}

async function bumpUserSecurity(tx: Tx, userId: string, now: number): Promise<void> {
  const user = await tx.get(COLLECTIONS.users, userId)
  if (user) await bumpMutationSeq(tx, COLLECTIONS.users, user, now)
}

/** 发起裁员申请（TEAM、manager+）。 */
export async function requestDismissal(
  deps: DismissalDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  input: { targetMemberId: string; reason: string; mutationId: string }
): Promise<MemberDismissalView> {
  const now = deps.now()
  const reason = normalizeSingleLine(input.reason, { field: '裁员理由', min: 2, max: 200 })

  return deps.db.tx(async (tx) => {
    const tenant = await resolveTenant(tx, trusted, clubId)
    const ctx = toTenantContext(trusted, tenant)
    if (ctx.role !== 'manager' && ctx.role !== 'super_admin') throw new AppError('permission_denied')

    const target = await tx.get(COLLECTIONS.members, input.targetMemberId)
    if (!target || target.clubId !== clubId) throw new AppError('resource_not_found')
    if (target._id === tenant.club.ownerMemberId) throw new AppError('permission_denied', '不能裁撤 owner')
    if (target._id === tenant.member._id) throw new AppError('validation_failed', '不能裁撤自己')
    if (target.status === 'LEFT') throw new AppError('invalid_transition', '该成员已离队')

    const dismissalId = dismissalDocId(clubId, input.targetMemberId)
    const existing = await tx.get(COLLECTIONS.memberDismissals, dismissalId)

    if (existing) {
      if (existing.status === 'APPROVED') throw new AppError('invalid_transition', '该裁员已完成')
      if (existing.status === 'PENDING') {
        if (existing.reason !== reason) throw new AppError('idempotency_conflict', '同一裁员申请的内容不一致')
        return toView(existing)
      }
    }

    const doc: Doc = {
      _id: dismissalId,
      clubId,
      targetMemberId: input.targetMemberId,
      targetUserId: target.userId as string,
      targetDisplayName: (target.displayName as string) ?? '',
      targetRole: target.role as string,
      reason,
      status: 'PENDING',
      requestedByMemberId: tenant.member._id,
      requestedByDisplayName: (tenant.member.displayName as string) ?? '',
      /** 首位超管发起的申请：本人第一阶段确认即完成；其余人需另一位超管终审。 */
      requesterIsPrimaryOwner: tenant.club.ownerMemberId === tenant.member._id,
      firstApprovedByMemberId: null,
      firstApprovedAt: null,
      finalApprovedByMemberId: null,
      finalApprovedAt: null,
      decidedAt: null,
      rejectReason: null,
      revision: existing ? ((existing.revision as number) ?? 1) + 1 : 1,
      createdAt: existing ? (existing.createdAt as number) : now,
      updatedAt: now,
    }
    await tx.set(COLLECTIONS.memberDismissals, doc)
    await writeAudit(tx, {
      scope: `TEAM:${clubId}`,
      actorMemberId: tenant.member._id,
      action: 'member.dismissal.request',
      resourceType: 'member',
      resourceId: input.targetMemberId,
      seed: input.mutationId,
      now,
    })
    return toView(doc)
  })
}

/**
 * 审批裁员（TEAM、manager 或 super_admin）。
 *
 * - manager 只能填 `manager` 节点；super_admin 只能填 `superAdmin` 节点；
 * - 两名审批人必须不同；发起人不能审批；
 * - 两节点齐 → 同事务把目标置 `LEFT` 并完成申请。
 */
export async function approveDismissal(
  deps: DismissalDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  input: { dismissalId: string; mutationId: string; expectedRevision?: number }
): Promise<ApproveDismissalResult> {
  const now = deps.now()

  const run = await runIdempotent(
    deps.db,
    now,
    {
      scope: { kind: 'TEAM', clubId },
      actorIdentityId: identityId(trusted.appId, trusted.openid),
      action: 'member.dismissal.approve',
      mutationId: input.mutationId,
      expectedRevision: input.expectedRevision,
      data: { dismissalId: input.dismissalId },
    },
    async (tx) => {
      const tenant = await resolveTenant(tx, trusted, clubId)
      const ctx = toTenantContext(trusted, tenant)
      if (ctx.role !== 'manager' && ctx.role !== 'super_admin') throw new AppError('permission_denied')

      const doc = await tx.get(COLLECTIONS.memberDismissals, input.dismissalId)
      if (!doc || doc.clubId !== clubId) throw new AppError('resource_not_found')
      if (doc.status !== 'PENDING') throw new AppError('invalid_transition', '该申请已被处理')
      if (input.expectedRevision !== undefined && ((doc.revision as number) ?? 0) !== input.expectedRevision) {
        throw new AppError('revision_conflict')
      }

      const actorId = tenant.member._id
      const requesterId = doc.requestedByMemberId as string
      const requesterIsPrimaryOwner =
        doc.requesterIsPrimaryOwner === true || tenant.club.ownerMemberId === requesterId
      const firstApprovedBy = (doc.firstApprovedByMemberId as string | null) ?? null
      const finalApprovedBy = (doc.finalApprovedByMemberId as string | null) ?? null

      let nextFirstBy = firstApprovedBy
      let nextFirstAt = (doc.firstApprovedAt as number | null) ?? null
      let nextFinalBy = finalApprovedBy
      let nextFinalAt = (doc.finalApprovedAt as number | null) ?? null
      let completed = false
      let phase: 'FIRST' | 'FINAL'

      if (!firstApprovedBy) {
        // 第一阶段：**只能由申请人本人**确认；首位超管在此阶段即完成全部审批。
        if (actorId !== requesterId) {
          throw new AppError('permission_denied', '第一阶段须由申请人本人确认')
        }
        nextFirstBy = actorId
        nextFirstAt = now
        phase = 'FIRST'
        completed = requesterIsPrimaryOwner
      } else if (!finalApprovedBy) {
        // 第二阶段：必须由**另一位** super_admin 终审；申请人本人不得担任。
        if (requesterIsPrimaryOwner) throw new AppError('invalid_transition', '首位超管的申请只需本人确认')
        if (ctx.role !== 'super_admin') throw new AppError('permission_denied', '最终审批须由超级管理员完成')
        if (actorId === requesterId) throw new AppError('permission_denied', '不能由申请人完成最终审批')
        nextFinalBy = actorId
        nextFinalAt = now
        phase = 'FINAL'
        completed = true
      } else {
        throw new AppError('invalid_transition', '该申请已完成审批')
      }

      const target = await tx.get(COLLECTIONS.members, doc.targetMemberId as string)
      if (!target || target.clubId !== clubId) throw new AppError('resource_not_found')
      if (target.status === 'LEFT') throw new AppError('invalid_transition', '该成员已离队')
      if (target._id === tenant.club.ownerMemberId) throw new AppError('permission_denied', '不能裁撤 owner')

      const nextRevision = ((doc.revision as number) ?? 1) + 1
      await tx.set(COLLECTIONS.memberDismissals, {
        ...doc,
        firstApprovedByMemberId: nextFirstBy,
        firstApprovedAt: nextFirstAt,
        finalApprovedByMemberId: nextFinalBy,
        finalApprovedAt: nextFinalAt,
        status: completed ? 'APPROVED' : 'PENDING',
        decidedAt: completed ? now : null,
        revision: nextRevision,
        updatedAt: now,
      })

      if (completed) {
        // 落地裁员：LEFT 不可通过业务接口恢复；同时触碰 user/club/actor 栅栏
        await tx.set(COLLECTIONS.members, {
          ...target,
          status: 'LEFT',
          revision: ((target.revision as number) ?? 1) + 1,
          mutationSeq: ((target.mutationSeq as number) ?? 0) + 1,
          updatedAt: now,
        })
        await bumpUserSecurity(tx, target.userId as string, now)
      }
      await bumpMutationSeq(tx, COLLECTIONS.clubs, tenant.club, now)
      await bumpMutationSeq(tx, COLLECTIONS.members, tenant.member, now)

      await writeAudit(tx, {
        scope: `TEAM:${clubId}`,
        actorMemberId: actorId,
        action: 'member.dismissal.approve',
        resourceType: 'member',
        resourceId: doc.targetMemberId as string,
        seed: input.mutationId,
        now,
        // 记录审批阶段与结果，便于追溯（身份/时间已由 actorMemberId/now 记录）
        reason: phase === 'FIRST' ? (completed ? 'stage1:primary-owner' : 'stage1:self') : 'stage2:final',
      })

      return {
        dismissalId: input.dismissalId,
        status: completed ? ('APPROVED' as DismissalStatus) : ('PENDING' as DismissalStatus),
        executed: completed,
        targetMemberId: doc.targetMemberId as string,
      }
    }
  )
  return run.result
}

/** 驳回裁员申请（TEAM、manager+；理由必填）。 */
export async function rejectDismissal(
  deps: DismissalDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  input: { dismissalId: string; rejectReason: string; mutationId: string; expectedRevision?: number }
): Promise<MemberDismissalView> {
  const now = deps.now()
  const reason = normalizeSingleLine(input.rejectReason, { field: '驳回理由', min: 1, max: 200 })

  const run = await runIdempotent(
    deps.db,
    now,
    {
      scope: { kind: 'TEAM', clubId },
      actorIdentityId: identityId(trusted.appId, trusted.openid),
      action: 'member.dismissal.reject',
      mutationId: input.mutationId,
      expectedRevision: input.expectedRevision,
      data: { dismissalId: input.dismissalId, rejectReason: reason },
    },
    async (tx) => {
      const tenant = await resolveTenant(tx, trusted, clubId)
      const ctx = toTenantContext(trusted, tenant)
      if (ctx.role !== 'manager' && ctx.role !== 'super_admin') throw new AppError('permission_denied')

      const doc = await tx.get(COLLECTIONS.memberDismissals, input.dismissalId)
      if (!doc || doc.clubId !== clubId) throw new AppError('resource_not_found')
      if (doc.status !== 'PENDING') throw new AppError('invalid_transition', '该申请已被处理')
      if (input.expectedRevision !== undefined && ((doc.revision as number) ?? 0) !== input.expectedRevision) {
        throw new AppError('revision_conflict')
      }

      const next: Doc = {
        ...doc,
        status: 'REJECTED',
        rejectReason: reason,
        decidedAt: now,
        revision: ((doc.revision as number) ?? 1) + 1,
        updatedAt: now,
      }
      await tx.set(COLLECTIONS.memberDismissals, next)
      await bumpMutationSeq(tx, COLLECTIONS.clubs, tenant.club, now)
      await bumpMutationSeq(tx, COLLECTIONS.members, tenant.member, now)
      await writeAudit(tx, {
        scope: `TEAM:${clubId}`,
        actorMemberId: tenant.member._id,
        action: 'member.dismissal.reject',
        resourceType: 'member',
        resourceId: doc.targetMemberId as string,
        seed: input.mutationId,
        now,
        reason,
      })
      return toView(next)
    }
  )
  return run.result
}

/** 本队裁员申请列表（TEAM、manager+；默认 PENDING）。 */
export async function listDismissals(
  deps: DismissalDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  opts: { status?: DismissalStatus; cursor?: string; pageSize?: number } = {}
): Promise<MemberDismissalPage> {
  const now = deps.now()
  const tenant = await deps.db.tx(async (tx) => resolveTenant(tx, trusted, clubId))
  const ctx = toTenantContext(trusted, tenant)
  if (ctx.role !== 'manager' && ctx.role !== 'super_admin') throw new AppError('permission_denied')

  const status: DismissalStatus = opts.status ?? 'PENDING'
  const pageSize = Math.min(Math.max(opts.pageSize ?? 20, 1), 50)
  const fingerprint = `member.dismissal.list:${status}`
  let after: { createdAt: number; id: string } | null = null
  if (opts.cursor) {
    const cursor = decodeCursor(opts.cursor, { action: 'member.dismissal.list', clubId, fingerprint })
    after = { createdAt: cursor.sort[0] as number, id: cursor.sort[1] as string }
  }

  const entries = (
    await deps.db.query(COLLECTIONS.memberDismissals, (doc) => doc.clubId === clubId && doc.status === status)
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
  const last = page[page.length - 1]

  return {
    items: page.map((entry) => toView(entry.doc)),
    nextCursor:
      hasMore && last
        ? encodeCursor({
            v: 1,
            action: 'member.dismissal.list',
            clubId,
            fingerprint,
            sort: [last.createdAt, last.id],
          })
        : null,
    hasMore,
    asOf: new Date(now).toISOString(),
  }
}
