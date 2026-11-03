import { AppError } from '../../contracts/errors.ts'
import type { Database, Doc, Tx } from '../../repositories/store.ts'
import { COLLECTIONS } from '../../repositories/collections.ts'
import { identityId } from '../../repositories/ids.ts'
import type {
  AnnouncementSummary,
  ClubDashboardView,
  ClubStatus,
  ClubView,
  PerformanceView,
  ProfileSummaryView,
} from '../../contracts/dtos.ts'
import { requireManagerPlus } from '../../shared/authorization.ts'
import { writeAudit } from '../../shared/audit.ts'
import { normalizeMultiLine, normalizeSingleLine } from '../../shared/text.ts'
import { isPlainObject } from '../../shared/validation.ts'
import { resolveTenant, toTenantContext } from '../context.ts'
import { runIdempotent } from '../command.ts'
import { performanceOf, performanceIndexForTeam } from '../performance/index.ts'

/**
 * 社团设置与显式摘要（多团队 DESIGN §M6、BASE-DESIGN §10.3）。
 *
 * - club.update 白名单内容与设置键；未知字段拒绝；revision/mutationSeq 栅栏 + 审计。
 * - club.dashboard/profile.summary 显式计算，不伪造 `fetchTasks(size:1).total`。
 * - 名册关闭仍可返回授权在册总数，不泄露明细。
 */

export interface ClubDeps {
  db: Database
  now: () => number
}

export type { AnnouncementSummary, ClubDashboardView, ClubView, ProfileSummaryView }

const SETTINGS_KEYS: readonly string[] = ['memberDirectoryVisible']
const IN_PROGRESS: readonly string[] = ['CLAIMED', 'SUBMITTED', 'REJECTED']

function iso(value: unknown): string {
  return new Date(value as number).toISOString()
}

function toClubView(club: Doc): ClubView {
  return {
    clubId: club._id,
    name: club.name as string,
    slug: club.slug as string,
    displayCode: club.displayCode as string,
    status: club.status as ClubStatus,
    description: (club.description as string | null) ?? null,
    logoUrl: (club.logoUrl as string | null) ?? null,
    settings: (club.settings as Record<string, unknown>) ?? {},
    revision: (club.revision as number) ?? 0,
    createdAt: iso(club.createdAt),
    updatedAt: iso(club.updatedAt),
  }
}

async function bumpClubFence(tx: Tx, club: Doc, now: number): Promise<void> {
  await tx.set(COLLECTIONS.clubs, {
    ...club,
    mutationSeq: ((club.mutationSeq as number) ?? 0) + 1,
    updatedAt: now,
  })
}

function parseSettings(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) throw new AppError('validation_failed', 'settings 必须是对象')
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!SETTINGS_KEYS.includes(key)) throw new AppError('validation_failed', `settings 不允许键 ${key}`)
    if (key === 'memberDirectoryVisible' && typeof value !== 'boolean') {
      throw new AppError('validation_failed', 'memberDirectoryVisible 必须是布尔值')
    }
    out[key] = value
  }
  return out
}

function parseLogoUrl(raw: unknown): string | null {
  const value = normalizeSingleLine(raw, { min: 0, max: 500, field: 'logoUrl' })
  if (value === '') return null
  if (!/^https?:\/\//.test(value)) throw new AppError('validation_failed', 'logoUrl 必须是 http(s) 链接')
  return value
}

export async function getClub(
  deps: ClubDeps,
  trusted: { appId: string; openid: string },
  clubId: string
): Promise<ClubView> {
  const tenant = await deps.db.tx(async (tx) => resolveTenant(tx, trusted, clubId))
  return toClubView(tenant.club)
}

export async function updateClub(
  deps: ClubDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  input: {
    name?: string
    description?: string | null
    logoUrl?: string | null
    settings?: Record<string, unknown>
    expectedRevision: number
    mutationId: string
  }
): Promise<ClubView> {
  const now = deps.now()
  const name = input.name === undefined ? undefined : normalizeSingleLine(input.name, { min: 1, max: 60, field: 'name' })
  const description =
    input.description === undefined
      ? undefined
      : input.description === null || input.description === ''
        ? null
        : normalizeMultiLine(input.description, { min: 0, max: 2000, field: 'description' })
  const logoUrl = input.logoUrl === undefined ? undefined : parseLogoUrl(input.logoUrl)
  const settings = input.settings === undefined ? undefined : parseSettings(input.settings)

  const data: Record<string, unknown> = {}
  if (name !== undefined) data.name = name
  if (description !== undefined) data.description = description
  if (logoUrl !== undefined) data.logoUrl = logoUrl
  if (settings !== undefined) data.settings = settings

  const run = await runIdempotent(
    deps.db,
    now,
    {
      scope: { kind: 'TEAM', clubId },
      actorIdentityId: identityId(trusted.appId, trusted.openid),
      action: 'club.update',
      mutationId: input.mutationId,
      expectedRevision: input.expectedRevision,
      data,
    },
    async (tx) => {
      const tenant = await resolveTenant(tx, trusted, clubId)
      requireManagerPlus(toTenantContext(trusted, tenant))
      if ((tenant.club.revision as number) !== input.expectedRevision) throw new AppError('revision_conflict')

      const next: Doc = {
        ...tenant.club,
        name: name ?? tenant.club.name,
        description: description === undefined ? tenant.club.description : description,
        logoUrl: logoUrl === undefined ? tenant.club.logoUrl : logoUrl,
        settings: settings === undefined ? tenant.club.settings : settings,
        revision: (tenant.club.revision as number) + 1,
        mutationSeq: ((tenant.club.mutationSeq as number) ?? 0) + 1,
        updatedAt: now,
      }
      await tx.set(COLLECTIONS.clubs, next)
      await writeAudit(tx, {
        scope: `TEAM:${clubId}`,
        actorMemberId: tenant.member._id,
        action: 'club.update',
        resourceType: 'club',
        resourceId: clubId,
        seed: input.mutationId,
        now,
      })
      return toClubView(next)
    }
  )
  return run.result
}

async function publishedSummaries(db: Database, clubId: string, limit: number): Promise<AnnouncementSummary[]> {
  return (await db.query(COLLECTIONS.announcements, (doc) => doc.clubId === clubId && doc.status === 'PUBLISHED'))
    .map((doc) => ({
      pinned: doc.pinned === true ? 1 : 0,
      createdAt: doc.createdAt as number,
      doc,
    }))
    .sort((a, b) =>
      a.pinned !== b.pinned
        ? b.pinned - a.pinned
        : a.createdAt !== b.createdAt
          ? b.createdAt - a.createdAt
          : a.doc._id < b.doc._id
            ? 1
            : -1
    )
    .slice(0, limit)
    .map((entry) => ({
      announcementId: entry.doc._id,
      title: entry.doc.title as string,
      pinned: entry.doc.pinned === true,
      publishedAt: entry.doc.publishedAt === null || entry.doc.publishedAt === undefined ? null : iso(entry.doc.publishedAt),
      createdAt: iso(entry.doc.createdAt),
    }))
}

export async function clubDashboard(
  deps: ClubDeps,
  trusted: { appId: string; openid: string },
  clubId: string
): Promise<ClubDashboardView> {
  const now = deps.now()
  const tenant = await deps.db.tx(async (tx) => resolveTenant(tx, trusted, clubId))
  const ctx = toTenantContext(trusted, tenant)
  const isManagerPlus = ctx.role === 'manager' || ctx.role === 'super_admin'

  const activeMemberCount = (
    await deps.db.query(COLLECTIONS.members, (doc) => doc.clubId === clubId && doc.status === 'ACTIVE')
  ).length

  const tasks = await deps.db.query(COLLECTIONS.tasks, (doc) => doc.clubId === clubId)
  const openTaskCount = tasks.filter((doc) => doc.status === 'OPEN').length
  const mine = tasks.filter((doc) => doc.assigneeMemberId === ctx.actorMemberId)
  const myInProgressCount = mine.filter((doc) => IN_PROGRESS.includes(doc.status as string)).length
  const mySubmittedCount = mine.filter((doc) => doc.status === 'SUBMITTED').length

  const view: ClubDashboardView = {
    clubId,
    activeMemberCount,
    openTaskCount,
    myInProgressCount,
    mySubmittedCount,
    latestPublishedAnnouncements: await publishedSummaries(deps.db, clubId, 3),
    asOf: new Date(now).toISOString(),
  }

  if (isManagerPlus) {
    view.pendingReviewCount = tasks.filter((doc) => doc.status === 'SUBMITTED').length
    const index = await performanceIndexForTeam(deps.db, clubId)
    const members = await deps.db.query(COLLECTIONS.members, (doc) => doc.clubId === clubId && doc.status === 'ACTIVE')
    view.topPerformers = members
      .map((member) => performanceOf(member, index))
      .sort((a, b) => (a.compositeScore !== b.compositeScore ? b.compositeScore - a.compositeScore : a.memberId < b.memberId ? -1 : 1))
      .slice(0, 5)
  }
  return view
}

export async function profileSummary(
  deps: ClubDeps,
  trusted: { appId: string; openid: string },
  clubId: string
): Promise<ProfileSummaryView> {
  const now = deps.now()
  const tenant = await deps.db.tx(async (tx) => resolveTenant(tx, trusted, clubId))
  const actorMemberId = tenant.member._id
  const index = await performanceIndexForTeam(deps.db, clubId)
  const performance = performanceOf(tenant.member, index)

  return {
    clubId,
    memberId: actorMemberId,
    taskCounts: {
      claimed: performance.claimedCount,
      approved: performance.approvedCount,
      rejected: performance.rejectedCount,
      inProgress: performance.inProgressCount,
    },
    performance,
    asOf: new Date(now).toISOString(),
  }
}
