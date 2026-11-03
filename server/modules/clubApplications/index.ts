import { AppError } from '../../contracts/errors.ts'
import type { Database, Doc } from '../../repositories/store.ts'
import { COLLECTIONS } from '../../repositories/collections.ts'
import { identityId, memberId, sha256Hex } from '../../repositories/ids.ts'
import type {
  DecideNewTeamApplicationResult,
  NewTeamApplicationPage,
  NewTeamApplicationStatus,
  NewTeamApplicationView,
  SubmitNewTeamApplicationResult,
} from '../../contracts/dtos.ts'
import { writeAudit } from '../../shared/audit.ts'
import { requireManagerPlus } from '../../shared/authorization.ts'
import { decodeCursor, encodeCursor } from '../../shared/cursor.ts'
import { normalizeMultiLine, normalizeSingleLine } from '../../shared/text.ts'
import { resolveTenant, toTenantContext } from '../context.ts'
import { runIdempotent } from '../command.ts'

/**
 * 小程序内「开通新团队」：成员申请 → 本队管理员/超管审批 → 建队（2026-10-18）。
 *
 * 权限模型（用户裁决）：
 * - **发起人**必须是审批团队（`clubId` = 其当前所在队）的 ACTIVE 成员（任意角色）；
 * - **审批人**必须是同一队的 manager / super_admin；A 队管理员看不到也批不了 B 队申请
 *   （所有读写都以 TEAM scope 的 clubId 为准）；
 * - 审批通过后**新队 owner = 发起人**（role=super_admin）；
 * - 状态通知为**站内**：本人可在 `team.newApplication.mine` 看到自己的全部申请与驳回理由。
 *
 * 防重复/防冲突：
 * - 申请 ID = `hash(审批团队, 申请人, slug)`：同一人、同一队、同一 slug 只有一条记录；
 *   PENDING 重复提交且内容一致 → `replayed`；内容不同 → `idempotency_conflict`；
 *   已驳回可再次提交（复用记录、revision+1）；已通过不可再提交。
 * - 新队 slug / displayCode 必须全局空闲（提交时与审批时各查一次）。
 *   **已知限制**：并发极端情况下两个不同审批团队可能同时通过同一 slug 的申请；
 *   最终一致性由 `rak_clubs.slug` / `displayCode` 唯一索引兜底（需云侧创建，见 infra/indexes.json）。
 *
 * 幂等：审批/驳回走 `runIdempotent`（mutationId + 同事务写命令记录）。
 */

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/
const CODE_RE = /^[A-Z0-9]{4,8}$/

export interface ClubApplicationDeps {
  db: Database
  now: () => number
  /** 新 clubId 生成（事务外生成一次，重试复用）。 */
  newClubId: () => string
}

export interface SubmitNewTeamInput {
  name: string
  slug: string
  displayCode: string
  description?: string | null
}

function applicationDocId(approvalClubId: string, applicantUserId: string, slug: string): string {
  return sha256Hex(JSON.stringify(['rak-club-app-v1', approvalClubId, applicantUserId, slug]))
}

/** 新队标识校验（slug 小写短横线；displayCode 大写字母数字）。 */
function normalizeNewTeamInput(input: SubmitNewTeamInput): {
  name: string
  slug: string
  displayCode: string
  description: string | null
} {
  const name = normalizeSingleLine(input.name, { field: '团队名称', min: 2, max: 40 })
  const slug = normalizeSingleLine(input.slug, { field: '团队标识', min: 3, max: 32 }).toLowerCase()
  if (!SLUG_RE.test(slug)) {
    throw new AppError('validation_failed', '团队标识只能包含小写字母、数字与短横线（3..32 位，首尾非短横线）')
  }
  const displayCode = normalizeSingleLine(input.displayCode, { field: '团队展示码', min: 4, max: 8 }).toUpperCase()
  if (!CODE_RE.test(displayCode)) {
    throw new AppError('validation_failed', '团队展示码只能包含大写字母与数字（4..8 位）')
  }
  const description =
    input.description === undefined || input.description === null
      ? null
      : normalizeMultiLine(input.description, { field: '团队简介', min: 0, max: 200 })
  return { name, slug, displayCode, description: description === '' ? null : description }
}

/** 新队 slug/displayCode 必须全局空闲（已建团队 + 其他待审申请）。 */
async function assertNewTeamIdentityFree(
  db: Database,
  target: { slug: string; displayCode: string },
  excludeApplicationId: string | null
): Promise<void> {
  const clubClash = await db.query(
    COLLECTIONS.clubs,
    (doc) => doc.slug === target.slug || doc.displayCode === target.displayCode
  )
  if (clubClash.length > 0) {
    throw new AppError('validation_failed', '团队标识或展示码已被其他团队使用')
  }
  const pendingClash = await db.query(
    COLLECTIONS.clubApplications,
    (doc) =>
      doc._id !== excludeApplicationId &&
      doc.status === 'PENDING' &&
      (doc.slug === target.slug || doc.displayCode === target.displayCode)
  )
  if (pendingClash.length > 0) {
    throw new AppError('validation_failed', '团队标识或展示码已有一条待审批申请')
  }
}

function iso(value: unknown): string | null {
  return typeof value === 'number' ? new Date(value).toISOString() : null
}

function toView(doc: Doc, approvalClubName: string | null): NewTeamApplicationView {
  return {
    applicationId: doc._id,
    approvalClubId: doc.clubId as string,
    approvalClubName,
    applicantMemberId: doc.applicantMemberId as string,
    applicantDisplayName: doc.applicantDisplayName as string,
    name: doc.name as string,
    slug: doc.slug as string,
    displayCode: doc.displayCode as string,
    description: (doc.description as string | null) ?? null,
    status: doc.status as NewTeamApplicationStatus,
    revision: (doc.revision as number) ?? 1,
    createdAt: iso(doc.createdAt) as string,
    decidedAt: iso(doc.decidedAt),
    decidedByMemberId: (doc.decidedByMemberId as string | null) ?? null,
    rejectReason: (doc.rejectReason as string | null) ?? null,
    newClubId: (doc.newClubId as string | null) ?? null,
  }
}

function sameSubmission(
  existing: Doc,
  input: { name: string; slug: string; displayCode: string; description: string | null }
): boolean {
  return (
    existing.name === input.name &&
    existing.slug === input.slug &&
    existing.displayCode === input.displayCode &&
    ((existing.description as string | null) ?? null) === input.description
  )
}

/** 发起开通申请（TEAM：clubId = 审批团队）。 */
export async function submitNewTeamApplication(
  deps: ClubApplicationDeps,
  trusted: { appId: string; openid: string },
  approvalClubId: string,
  input: SubmitNewTeamInput
): Promise<SubmitNewTeamApplicationResult> {
  const now = deps.now()
  const normalized = normalizeNewTeamInput(input)
  const preTenant = await deps.db.tx(async (tx) => resolveTenant(tx, trusted, approvalClubId))
  const applicantUserId = preTenant.userId
  const applicationId = applicationDocId(approvalClubId, applicantUserId, normalized.slug)

  await assertNewTeamIdentityFree(deps.db, normalized, applicationId)

  return deps.db.tx(async (tx) => {
    const tenant = await resolveTenant(tx, trusted, approvalClubId)
    const existing = await tx.get(COLLECTIONS.clubApplications, applicationId)

    if (existing) {
      if (existing.status === 'APPROVED') {
        throw new AppError('invalid_transition', '该申请已通过，团队已创建')
      }
      if (existing.status === 'PENDING') {
        if (!sameSubmission(existing, normalized)) throw new AppError('idempotency_conflict')
        return { applicationId, status: 'PENDING' as const, replayed: true }
      }
      // REJECTED：允许复用记录重新提交（revision+1，清空上次决定）
      await tx.set(COLLECTIONS.clubApplications, {
        ...existing,
        name: normalized.name,
        slug: normalized.slug,
        displayCode: normalized.displayCode,
        description: normalized.description,
        applicantMemberId: tenant.member._id,
        applicantDisplayName: (tenant.member.displayName as string) ?? '',
        status: 'PENDING',
        rejectReason: null,
        decidedAt: null,
        decidedByMemberId: null,
        newClubId: null,
        revision: ((existing.revision as number) ?? 1) + 1,
        updatedAt: now,
      })
      await writeAudit(tx, {
        scope: `TEAM:${approvalClubId}`,
        actorMemberId: tenant.member._id,
        action: 'team.newApplication.submit',
        resourceType: 'clubApplication',
        resourceId: applicationId,
        seed: `${applicationId}|resubmit|${now}`,
        now,
      })
      return { applicationId, status: 'PENDING' as const, replayed: false }
    }

    await tx.set(COLLECTIONS.clubApplications, {
      _id: applicationId,
      clubId: approvalClubId,
      applicantUserId,
      applicantMemberId: tenant.member._id,
      applicantDisplayName: (tenant.member.displayName as string) ?? '',
      name: normalized.name,
      slug: normalized.slug,
      displayCode: normalized.displayCode,
      description: normalized.description,
      status: 'PENDING',
      revision: 1,
      createdAt: now,
      updatedAt: now,
      decidedAt: null,
      decidedByMemberId: null,
      rejectReason: null,
      newClubId: null,
    })
    await writeAudit(tx, {
      scope: `TEAM:${approvalClubId}`,
      actorMemberId: tenant.member._id,
      action: 'team.newApplication.submit',
      resourceType: 'clubApplication',
      resourceId: applicationId,
      seed: applicationId,
      now,
    })
    return { applicationId, status: 'PENDING' as const, replayed: false }
  })
}

/** 本队待审/历史列表（TEAM、manager+）。 */
export async function listNewTeamApplications(
  deps: ClubApplicationDeps,
  trusted: { appId: string; openid: string },
  approvalClubId: string,
  opts: { status?: NewTeamApplicationStatus; cursor?: string; pageSize?: number } = {}
): Promise<NewTeamApplicationPage> {
  const now = deps.now()
  const tenant = await deps.db.tx(async (tx) => resolveTenant(tx, trusted, approvalClubId))
  requireManagerPlus(toTenantContext(trusted, tenant))

  const status: NewTeamApplicationStatus = opts.status ?? 'PENDING'
  const pageSize = Math.min(Math.max(opts.pageSize ?? 20, 1), 50)
  const fingerprint = `team.newApplication.list:${status}`
  let after: { createdAt: number; id: string } | null = null
  if (opts.cursor) {
    const cursor = decodeCursor(opts.cursor, { action: 'team.newApplication.list', clubId: approvalClubId, fingerprint })
    after = { createdAt: cursor.sort[0] as number, id: cursor.sort[1] as string }
  }

  const entries = (
    await deps.db.query(
      COLLECTIONS.clubApplications,
      (doc) => doc.clubId === approvalClubId && doc.status === status
    )
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
  const clubName = (tenant.club.name as string) ?? null
  const last = page[page.length - 1]

  return {
    items: page.map((entry) => toView(entry.doc, clubName)),
    nextCursor:
      hasMore && last
        ? encodeCursor({
            v: 1,
            action: 'team.newApplication.list',
            clubId: approvalClubId,
            fingerprint,
            sort: [last.createdAt, last.id],
          })
        : null,
    hasMore,
    asOf: new Date(now).toISOString(),
  }
}

/** 本人全部开通申请（GLOBAL、跨队只读；用于状态与驳回理由反馈）。 */
export async function listMyNewTeamApplications(
  deps: ClubApplicationDeps,
  trusted: { appId: string; openid: string },
  opts: { cursor?: string; pageSize?: number } = {}
): Promise<NewTeamApplicationPage> {
  const now = deps.now()
  const identity = await deps.db.read(COLLECTIONS.identities, identityId(trusted.appId, trusted.openid))
  if (!identity || typeof identity.userId !== 'string') throw new AppError('identity_required')
  const userId = identity.userId
  const user = await deps.db.read(COLLECTIONS.users, userId)
  if (!user) throw new AppError('identity_required')
  if (user.securityState === 'BLOCKED') throw new AppError('account_blocked')

  const pageSize = Math.min(Math.max(opts.pageSize ?? 20, 1), 50)
  const fingerprint = 'team.newApplication.mine:all'
  let after: { createdAt: number; id: string } | null = null
  if (opts.cursor) {
    const cursor = decodeCursor(opts.cursor, { action: 'team.newApplication.mine', clubId: null, fingerprint })
    after = { createdAt: cursor.sort[0] as number, id: cursor.sort[1] as string }
  }

  const entries = (
    await deps.db.query(COLLECTIONS.clubApplications, (doc) => doc.applicantUserId === userId)
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
  const items: NewTeamApplicationView[] = []
  for (const entry of page) {
    const approvalClub = await deps.db.read(COLLECTIONS.clubs, entry.doc.clubId as string)
    items.push(toView(entry.doc, (approvalClub?.name as string) ?? null))
  }
  const last = page[page.length - 1]

  return {
    items,
    nextCursor:
      hasMore && last
        ? encodeCursor({
            v: 1,
            action: 'team.newApplication.mine',
            clubId: null,
            fingerprint,
            sort: [last.createdAt, last.id],
          })
        : null,
    hasMore,
    asOf: new Date(now).toISOString(),
  }
}

/** 审批通过：建新队 + 发起人成为 super_admin（TEAM、manager+）。 */
export async function approveNewTeamApplication(
  deps: ClubApplicationDeps,
  trusted: { appId: string; openid: string },
  approvalClubId: string,
  input: { applicationId: string; mutationId: string; expectedRevision?: number }
): Promise<DecideNewTeamApplicationResult> {
  const now = deps.now()

  // 事务外预检（尽早失败 + 生成一次性 clubId；事务内会重读并全部复核）。
  // 注意：**不能**在此拒绝非 PENDING —— 幂等重放时申请已是 APPROVED，
  // 必须让 `runIdempotent` 先命中命令记录并直接回放（否则重放会误报 invalid_transition）。
  const preview = await deps.db.read(COLLECTIONS.clubApplications, input.applicationId)
  if (!preview || preview.clubId !== approvalClubId) throw new AppError('resource_not_found')
  if (preview.status === 'PENDING') {
    // 仅首次审批时查重（已通过时新队已存在，重放不查）
    await assertNewTeamIdentityFree(
      deps.db,
      { slug: preview.slug as string, displayCode: preview.displayCode as string },
      preview._id
    )
  }

  // 新 clubId 只生成一次；事务重试复用。
  const newClubId = deps.newClubId()

  const run = await runIdempotent(
    deps.db,
    now,
    {
      scope: { kind: 'TEAM', clubId: approvalClubId },
      actorIdentityId: identityId(trusted.appId, trusted.openid),
      action: 'team.newApplication.approve',
      mutationId: input.mutationId,
      expectedRevision: input.expectedRevision,
      data: { applicationId: input.applicationId },
    },
    async (tx) => {
      const tenant = await resolveTenant(tx, trusted, approvalClubId)
      requireManagerPlus(toTenantContext(trusted, tenant))

      const application = await tx.get(COLLECTIONS.clubApplications, input.applicationId)
      if (!application || application.clubId !== approvalClubId) throw new AppError('resource_not_found')
      if (application.status !== 'PENDING') throw new AppError('invalid_transition', '该申请已被处理')
      if (
        input.expectedRevision !== undefined &&
        ((application.revision as number) ?? 0) !== input.expectedRevision
      ) {
        throw new AppError('revision_conflict')
      }

      const applicantUserId = application.applicantUserId as string
      const applicantUser = await tx.get(COLLECTIONS.users, applicantUserId)
      if (!applicantUser) throw new AppError('identity_required')
      if (applicantUser.securityState === 'BLOCKED') throw new AppError('account_blocked', '申请人账号已封禁')

      const ownerMemberId = memberId(newClubId, applicantUserId)
      const ownerMember = await tx.get(COLLECTIONS.members, ownerMemberId)
      if (ownerMember) throw new AppError('invalid_transition', '目标团队已存在同名成员')

      await tx.set(COLLECTIONS.clubs, {
        _id: newClubId,
        name: application.name as string,
        slug: application.slug as string,
        displayCode: application.displayCode as string,
        description: (application.description as string | null) ?? null,
        ownerMemberId,
        status: 'ACTIVE',
        settings: { memberDirectoryVisible: true },
        revision: 1,
        mutationSeq: 0,
        createdAt: now,
        updatedAt: now,
      })

      await tx.set(COLLECTIONS.members, {
        _id: ownerMemberId,
        clubId: newClubId,
        userId: applicantUserId,
        displayName: (application.applicantDisplayName as string) ?? '',
        duty: null,
        role: 'super_admin',
        status: 'ACTIVE',
        createdAt: now,
        joinedAt: now,
        revision: 1,
        mutationSeq: 0,
      })

      await tx.set(COLLECTIONS.clubApplications, {
        ...application,
        status: 'APPROVED',
        newClubId,
        decidedAt: now,
        decidedByMemberId: tenant.member._id,
        rejectReason: null,
        revision: ((application.revision as number) ?? 1) + 1,
        updatedAt: now,
      })

      // 审批是管理写：触碰审批队的 club 栅栏与审批人 member 栅栏
      await tx.set(COLLECTIONS.clubs, {
        ...tenant.club,
        mutationSeq: ((tenant.club.mutationSeq as number) ?? 0) + 1,
        updatedAt: now,
      })
      await tx.set(COLLECTIONS.members, {
        ...tenant.member,
        mutationSeq: ((tenant.member.mutationSeq as number) ?? 0) + 1,
        updatedAt: now,
      })

      await writeAudit(tx, {
        scope: `TEAM:${approvalClubId}`,
        actorMemberId: tenant.member._id,
        action: 'team.newApplication.approve',
        resourceType: 'club',
        resourceId: newClubId,
        seed: input.mutationId,
        now,
      })

      return { applicationId: input.applicationId, status: 'APPROVED' as const, newClubId }
    }
  )
  return run.result
}

/** 驳回申请（TEAM、manager+；理由必填）。 */
export async function rejectNewTeamApplication(
  deps: ClubApplicationDeps,
  trusted: { appId: string; openid: string },
  approvalClubId: string,
  input: { applicationId: string; rejectReason: string; mutationId: string; expectedRevision?: number }
): Promise<DecideNewTeamApplicationResult> {
  const now = deps.now()
  const reason = normalizeSingleLine(input.rejectReason, { field: '驳回理由', min: 1, max: 200 })

  const run = await runIdempotent(
    deps.db,
    now,
    {
      scope: { kind: 'TEAM', clubId: approvalClubId },
      actorIdentityId: identityId(trusted.appId, trusted.openid),
      action: 'team.newApplication.reject',
      mutationId: input.mutationId,
      expectedRevision: input.expectedRevision,
      data: { applicationId: input.applicationId, rejectReason: reason },
    },
    async (tx) => {
      const tenant = await resolveTenant(tx, trusted, approvalClubId)
      requireManagerPlus(toTenantContext(trusted, tenant))

      const application = await tx.get(COLLECTIONS.clubApplications, input.applicationId)
      if (!application || application.clubId !== approvalClubId) throw new AppError('resource_not_found')
      if (application.status !== 'PENDING') throw new AppError('invalid_transition', '该申请已被处理')
      if (
        input.expectedRevision !== undefined &&
        ((application.revision as number) ?? 0) !== input.expectedRevision
      ) {
        throw new AppError('revision_conflict')
      }

      await tx.set(COLLECTIONS.clubApplications, {
        ...application,
        status: 'REJECTED',
        rejectReason: reason,
        decidedAt: now,
        decidedByMemberId: tenant.member._id,
        newClubId: null,
        revision: ((application.revision as number) ?? 1) + 1,
        updatedAt: now,
      })

      await tx.set(COLLECTIONS.clubs, {
        ...tenant.club,
        mutationSeq: ((tenant.club.mutationSeq as number) ?? 0) + 1,
        updatedAt: now,
      })
      await tx.set(COLLECTIONS.members, {
        ...tenant.member,
        mutationSeq: ((tenant.member.mutationSeq as number) ?? 0) + 1,
        updatedAt: now,
      })

      await writeAudit(tx, {
        scope: `TEAM:${approvalClubId}`,
        actorMemberId: tenant.member._id,
        action: 'team.newApplication.reject',
        resourceType: 'clubApplication',
        resourceId: input.applicationId,
        seed: input.mutationId,
        now,
      })

      return { applicationId: input.applicationId, status: 'REJECTED' as const, newClubId: null }
    }
  )
  return run.result
}
