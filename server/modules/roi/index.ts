import { AppError } from '../../contracts/errors.ts'
import type { Database, Doc, Tx } from '../../repositories/store.ts'
import { COLLECTIONS } from '../../repositories/collections.ts'
import { identityId, randomId } from '../../repositories/ids.ts'
import type { Page, RoiCategory, RoiItemView, RoiOverviewView, RoiStatus } from '../../contracts/dtos.ts'
import { requireManagerPlus } from '../../shared/authorization.ts'
import { writeAudit } from '../../shared/audit.ts'
import { decodeCursor, encodeCursor } from '../../shared/cursor.ts'
import { parseYuanToCents } from '../../shared/money.ts'
import { assertShDay, lastSixMonthKeys, periodRange, toShDay, type RoiPeriod } from '../../shared/shanghai-date.ts'
import { normalizeMultiLine, normalizeSingleLine } from '../../shared/text.ts'
import { resolveTenant, toTenantContext } from '../context.ts'
import { runIdempotent } from '../command.ts'

/**
 * ROI 的本队隔离、金额精度与统计口径（多团队 DESIGN §M6、BASE-DESIGN §10.1）。
 *
 * - 金额存人民币分的安全整数；输入为元十进制字符串。
 * - accountingDate 为上海业务日；周期边界左闭右开。
 * - 统计含 PLANNING/ACTIVE/DONE/CANCELLED 的未删除记录；软删不物理删除审计。
 */

export interface RoiDeps {
  db: Database
  now: () => number
}

export type { RoiCategory, RoiItemView, RoiOverviewView, RoiStatus }

const CATEGORIES: readonly RoiCategory[] = ['activity', 'project', 'other']
const STATUSES: readonly RoiStatus[] = ['PLANNING', 'ACTIVE', 'DONE', 'CANCELLED']

function iso(value: unknown): string | null {
  return typeof value === 'number' ? new Date(value).toISOString() : null
}

function ratioOf(costCents: number, revenueCents: number): number | null {
  if (costCents === 0) return null
  return (revenueCents - costCents) / costCents
}

function toView(doc: Doc): RoiItemView {
  const costCents = (doc.costCents as number) ?? 0
  const revenueCents = (doc.revenueCents as number) ?? 0
  return {
    roiId: doc._id,
    clubId: doc.clubId as string,
    title: doc.title as string,
    category: doc.category as RoiCategory,
    costCents,
    revenueCents,
    participants: (doc.participants as number) ?? 0,
    periodStart: (doc.periodStart as string | null) ?? null,
    periodEnd: (doc.periodEnd as string | null) ?? null,
    accountingDate: doc.accountingDate as string,
    status: doc.status as RoiStatus,
    notes: (doc.notes as string | null) ?? null,
    roiRatio: ratioOf(costCents, revenueCents),
    createdByMemberId: doc.createdByMemberId as string,
    createdAt: iso(doc.createdAt) as string,
    updatedAt: iso(doc.updatedAt) as string,
    revision: (doc.revision as number) ?? 0,
  }
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

function isDeleted(doc: Doc): boolean {
  return doc.deletedAt !== null && doc.deletedAt !== undefined
}

function requireCategory(value: unknown): RoiCategory {
  if (typeof value !== 'string' || !(CATEGORIES as readonly string[]).includes(value)) {
    throw new AppError('validation_failed', 'category 只能是 activity/project/other')
  }
  return value as RoiCategory
}

function requireStatus(value: unknown): RoiStatus {
  if (typeof value !== 'string' || !(STATUSES as readonly string[]).includes(value)) {
    throw new AppError('validation_failed', 'status 只能是 PLANNING/ACTIVE/DONE/CANCELLED')
  }
  return value as RoiStatus
}

function optionalShDay(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null
  return assertShDay(value, field)
}

function parseParticipants(value: unknown): number {
  if (value === undefined || value === null) return 0
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 999999) {
    throw new AppError('validation_failed', 'participants 必须是 0..999999 的整数')
  }
  return value
}

export async function createRoiItem(
  deps: RoiDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  input: {
    title: string
    category: string
    cost: string
    revenue: string
    participants?: number
    periodStart?: string | null
    periodEnd?: string | null
    status?: string
    notes?: string | null
    mutationId: string
  }
): Promise<RoiItemView> {
  const now = deps.now()
  const title = normalizeSingleLine(input.title, { min: 1, max: 64, field: 'title' })
  const category = requireCategory(input.category)
  const costCents = parseYuanToCents(input.cost, 'cost')
  const revenueCents = parseYuanToCents(input.revenue, 'revenue')
  const participants = parseParticipants(input.participants)
  const periodStart = optionalShDay(input.periodStart, 'periodStart')
  const periodEnd = optionalShDay(input.periodEnd, 'periodEnd')
  if (periodStart && periodEnd && periodEnd < periodStart) {
    throw new AppError('validation_failed', 'periodEnd 不得早于 periodStart')
  }
  const status = input.status === undefined ? 'PLANNING' : requireStatus(input.status)
  const notes =
    input.notes === undefined || input.notes === null
      ? null
      : normalizeMultiLine(input.notes, { min: 0, max: 2000, field: 'notes' })
  const accountingDate = periodStart ?? toShDay(now)

  const run = await runIdempotent(
    deps.db,
    now,
    {
      scope: { kind: 'TEAM', clubId },
      actorIdentityId: identityId(trusted.appId, trusted.openid),
      action: 'roi.create',
      mutationId: input.mutationId,
      data: {
        title,
        category,
        costCents,
        revenueCents,
        participants,
        periodStart,
        periodEnd,
        status,
        notes,
      },
    },
    async (tx) => {
      const tenant = await resolveTenant(tx, trusted, clubId)
      requireManagerPlus(toTenantContext(trusted, tenant))
      const roiId = randomId('roi')
      const doc: Doc = {
        _id: roiId,
        clubId,
        title,
        category,
        costCents,
        revenueCents,
        participants,
        periodStart,
        periodEnd,
        accountingDate,
        status,
        notes,
        deletedAt: null,
        deletedByMemberId: null,
        createdByMemberId: tenant.member._id,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      }
      await tx.set(COLLECTIONS.roiItems, doc)
      await bumpClubFence(tx, tenant.club, now)
      await bumpActorFence(tx, tenant.member, now)
      await writeAudit(tx, {
        scope: `TEAM:${clubId}`,
        actorMemberId: tenant.member._id,
        action: 'roi.create',
        resourceType: 'roi',
        resourceId: roiId,
        seed: input.mutationId,
        now,
      })
      return toView(doc)
    }
  )
  return run.result
}

export async function updateRoiItem(
  deps: RoiDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  input: {
    roiId: string
    title?: string
    category?: string
    cost?: string
    revenue?: string
    participants?: number
    periodStart?: string | null
    periodEnd?: string | null
    status?: string
    notes?: string | null
    expectedRevision: number
    mutationId: string
  }
): Promise<RoiItemView> {
  const now = deps.now()
  const title = input.title === undefined ? undefined : normalizeSingleLine(input.title, { min: 1, max: 64, field: 'title' })
  const category = input.category === undefined ? undefined : requireCategory(input.category)
  const costCents = input.cost === undefined ? undefined : parseYuanToCents(input.cost, 'cost')
  const revenueCents = input.revenue === undefined ? undefined : parseYuanToCents(input.revenue, 'revenue')
  const participants = input.participants === undefined ? undefined : parseParticipants(input.participants)
  const periodStart = input.periodStart === undefined ? undefined : optionalShDay(input.periodStart, 'periodStart')
  const periodEnd = input.periodEnd === undefined ? undefined : optionalShDay(input.periodEnd, 'periodEnd')
  const status = input.status === undefined ? undefined : requireStatus(input.status)
  const notes =
    input.notes === undefined
      ? undefined
      : input.notes === null
        ? null
        : normalizeMultiLine(input.notes, { min: 0, max: 2000, field: 'notes' })

  const data: Record<string, unknown> = { roiId: input.roiId }
  if (title !== undefined) data.title = title
  if (category !== undefined) data.category = category
  if (costCents !== undefined) data.costCents = costCents
  if (revenueCents !== undefined) data.revenueCents = revenueCents
  if (participants !== undefined) data.participants = participants
  if (periodStart !== undefined) data.periodStart = periodStart
  if (periodEnd !== undefined) data.periodEnd = periodEnd
  if (status !== undefined) data.status = status
  if (notes !== undefined) data.notes = notes

  const run = await runIdempotent(
    deps.db,
    now,
    {
      scope: { kind: 'TEAM', clubId },
      actorIdentityId: identityId(trusted.appId, trusted.openid),
      action: 'roi.update',
      mutationId: input.mutationId,
      expectedRevision: input.expectedRevision,
      data,
    },
    async (tx) => {
      const tenant = await resolveTenant(tx, trusted, clubId)
      requireManagerPlus(toTenantContext(trusted, tenant))
      const doc = await tx.get(COLLECTIONS.roiItems, input.roiId)
      if (!doc || doc.clubId !== clubId || isDeleted(doc)) throw new AppError('resource_not_found')
      if ((doc.revision as number) !== input.expectedRevision) throw new AppError('revision_conflict')

      const nextPeriodStart = periodStart === undefined ? (doc.periodStart as string | null) : periodStart
      const nextPeriodEnd = periodEnd === undefined ? (doc.periodEnd as string | null) : periodEnd
      if (nextPeriodStart && nextPeriodEnd && nextPeriodEnd < nextPeriodStart) {
        throw new AppError('validation_failed', 'periodEnd 不得早于 periodStart')
      }
      // periodStart 为空时沿用原 accountingDate，不因编辑改月份。
      const nextAccounting = nextPeriodStart ?? (doc.accountingDate as string)

      const next: Doc = {
        ...doc,
        title: title ?? doc.title,
        category: category ?? doc.category,
        costCents: costCents ?? doc.costCents,
        revenueCents: revenueCents ?? doc.revenueCents,
        participants: participants ?? doc.participants,
        periodStart: nextPeriodStart,
        periodEnd: nextPeriodEnd,
        accountingDate: nextAccounting,
        status: status ?? doc.status,
        notes: notes === undefined ? doc.notes : notes,
        revision: (doc.revision as number) + 1,
        updatedAt: now,
      }
      await tx.set(COLLECTIONS.roiItems, next)
      await bumpClubFence(tx, tenant.club, now)
      await bumpActorFence(tx, tenant.member, now)
      await writeAudit(tx, {
        scope: `TEAM:${clubId}`,
        actorMemberId: tenant.member._id,
        action: 'roi.update',
        resourceType: 'roi',
        resourceId: doc._id,
        seed: input.mutationId,
        now,
      })
      return toView(next)
    }
  )
  return run.result
}

export async function deleteRoiItem(
  deps: RoiDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  input: { roiId: string; mutationId: string }
): Promise<RoiItemView> {
  const now = deps.now()
  const run = await runIdempotent(
    deps.db,
    now,
    {
      scope: { kind: 'TEAM', clubId },
      actorIdentityId: identityId(trusted.appId, trusted.openid),
      action: 'roi.delete',
      mutationId: input.mutationId,
      data: { roiId: input.roiId },
    },
    async (tx) => {
      const tenant = await resolveTenant(tx, trusted, clubId)
      requireManagerPlus(toTenantContext(trusted, tenant))
      const doc = await tx.get(COLLECTIONS.roiItems, input.roiId)
      if (!doc || doc.clubId !== clubId || isDeleted(doc)) throw new AppError('resource_not_found')
      const next: Doc = {
        ...doc,
        deletedAt: now,
        deletedByMemberId: tenant.member._id,
        revision: (doc.revision as number) + 1,
        updatedAt: now,
      }
      await tx.set(COLLECTIONS.roiItems, next)
      await bumpClubFence(tx, tenant.club, now)
      await bumpActorFence(tx, tenant.member, now)
      await writeAudit(tx, {
        scope: `TEAM:${clubId}`,
        actorMemberId: tenant.member._id,
        action: 'roi.delete',
        resourceType: 'roi',
        resourceId: doc._id,
        seed: input.mutationId,
        now,
      })
      return toView(next)
    }
  )
  return run.result
}

export async function getRoiItem(
  deps: RoiDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  roiId: string
): Promise<RoiItemView> {
  await deps.db.tx(async (tx) => resolveTenant(tx, trusted, clubId))
  const doc = await deps.db.read(COLLECTIONS.roiItems, roiId)
  if (!doc || doc.clubId !== clubId || isDeleted(doc)) throw new AppError('resource_not_found')
  return toView(doc)
}

export async function listRoiItems(
  deps: RoiDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  opts: { status?: string; category?: string; keyword?: string; cursor?: string; pageSize?: number } = {}
): Promise<Page<RoiItemView>> {
  const now = deps.now()
  await deps.db.tx(async (tx) => resolveTenant(tx, trusted, clubId))

  const status = opts.status === undefined ? null : requireStatus(opts.status)
  const category = opts.category === undefined ? null : requireCategory(opts.category)
  const keyword = (opts.keyword ?? '').trim()
  if ([...keyword].length > 80) throw new AppError('validation_failed', 'keyword 最多 80 字')
  const needle = keyword.toLowerCase()

  const pageSize = Math.min(Math.max(opts.pageSize ?? 20, 1), 50)
  const fingerprint = JSON.stringify(['roi.list', status ?? '', category ?? '', needle])
  let after: { createdAt: number; id: string } | null = null
  if (opts.cursor) {
    const cursor = decodeCursor(opts.cursor, { action: 'roi.list', clubId, fingerprint })
    after = { createdAt: cursor.sort[0] as number, id: cursor.sort[1] as string }
  }

  const entries = (
    await deps.db.query(COLLECTIONS.roiItems, (doc) => {
      if (doc.clubId !== clubId || isDeleted(doc)) return false
      if (status !== null && doc.status !== status) return false
      if (category !== null && doc.category !== category) return false
      if (needle) {
        const hay = `${doc.title as string}\n${(doc.notes as string) ?? ''}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  )
    .map((doc) => ({ createdAt: doc.createdAt as number, id: doc._id, doc }))
    .sort((a, b) => (a.createdAt !== b.createdAt ? b.createdAt - a.createdAt : a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .filter(
      (entry) =>
        after === null ||
        entry.createdAt < after.createdAt ||
        (entry.createdAt === after.createdAt && entry.id < after.id)
    )

  const slice = entries.slice(0, pageSize + 1)
  const hasMore = slice.length > pageSize
  const pageEntries = slice.slice(0, pageSize)
  const items = pageEntries.map((entry) => toView(entry.doc))
  const last = pageEntries[pageEntries.length - 1]
  const nextCursor =
    hasMore && last
      ? encodeCursor({ v: 1, action: 'roi.list', clubId, fingerprint, sort: [last.createdAt, last.id] })
      : null

  return { items, nextCursor, hasMore, asOf: new Date(now).toISOString() }
}

export async function roiOverview(
  deps: RoiDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  period: RoiPeriod = 'month'
): Promise<RoiOverviewView> {
  const now = deps.now()
  await deps.db.tx(async (tx) => resolveTenant(tx, trusted, clubId))
  const range = periodRange(period, now)

  const selected = await deps.db.query(COLLECTIONS.roiItems, (doc) => {
    if (doc.clubId !== clubId || isDeleted(doc)) return false
    if (!range) return true
    const day = doc.accountingDate as string
    return day >= range.start && day < range.endExclusive
  })

  const totalCost = selected.reduce((sum, doc) => sum + ((doc.costCents as number) ?? 0), 0)
  const totalRevenue = selected.reduce((sum, doc) => sum + ((doc.revenueCents as number) ?? 0), 0)

  const buckets = new Map<string, { label: string; cost: number; revenue: number }>()
  for (const key of lastSixMonthKeys(now)) buckets.set(key, { label: key, cost: 0, revenue: 0 })
  for (const doc of selected) {
    const key = (doc.accountingDate as string).slice(0, 7)
    const bucket = buckets.get(key)
    if (!bucket) continue
    bucket.cost += (doc.costCents as number) ?? 0
    bucket.revenue += (doc.revenueCents as number) ?? 0
  }

  return {
    period,
    totalCost,
    totalRevenue,
    net: totalRevenue - totalCost,
    roiRatio: ratioOf(totalCost, totalRevenue),
    itemCount: selected.length,
    series: [...buckets.values()],
    seriesWindow: 'last6',
    includesCancelled: true,
    currencyUnit: 'CNY_CENTS',
    asOf: new Date(now).toISOString(),
  }
}
