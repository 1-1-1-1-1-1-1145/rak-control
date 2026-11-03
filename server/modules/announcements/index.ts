import { AppError } from '../../contracts/errors.ts'
import type { Database, Doc, Tx } from '../../repositories/store.ts'
import { COLLECTIONS } from '../../repositories/collections.ts'
import { identityId, randomId } from '../../repositories/ids.ts'
import type { AnnouncementStatus, AnnouncementView, Page } from '../../contracts/dtos.ts'
import { requireManagerPlus } from '../../shared/authorization.ts'
import { writeAudit } from '../../shared/audit.ts'
import { decodeCursor, encodeCursor } from '../../shared/cursor.ts'
import { normalizeMultiLine, normalizeSingleLine } from '../../shared/text.ts'
import { resolveTenant, toTenantContext } from '../context.ts'
import { runIdempotent } from '../command.ts'

/**
 * 公告的本队隔离与状态机（多团队 DESIGN §M6、BASE-DESIGN §9.2）。
 *
 * - DRAFT→PUBLISHED→ARCHIVED；仅 DRAFT 可发布；已归档不可编辑/发布。
 * - 普通成员只读本队 PUBLISHED；manager/super 的管理列表可见草稿与归档。
 * - 排序 (pinned desc, createdAt desc, _id desc)，cursor 同时携带三值。
 */

export interface AnnouncementsDeps {
  db: Database
  now: () => number
}

export type { AnnouncementStatus, AnnouncementView }

const STATUSES: readonly AnnouncementStatus[] = ['DRAFT', 'PUBLISHED', 'ARCHIVED']

function iso(value: unknown): string | null {
  return typeof value === 'number' ? new Date(value).toISOString() : null
}

function toView(doc: Doc, authorDisplayName: string | null = null): AnnouncementView {
  return {
    announcementId: doc._id,
    clubId: doc.clubId as string,
    title: doc.title as string,
    body: doc.body as string,
    pinned: doc.pinned === true,
    status: doc.status as AnnouncementStatus,
    authorMemberId: doc.authorMemberId as string,
    authorDisplayName,
    publishedAt: iso(doc.publishedAt),
    revision: (doc.revision as number) ?? 0,
    createdAt: iso(doc.createdAt) as string,
    updatedAt: iso(doc.updatedAt) as string,
  }
}

/** 同队作者展示名（成员缺失返回 null，不回退其他队/全局姓名）。 */
async function memberNameWith(
  read: (collection: string, id: string) => Promise<Doc | null>,
  clubId: string,
  memberId: string | undefined
): Promise<string | null> {
  if (!memberId) return null
  const member = await read(COLLECTIONS.members, memberId)
  if (!member || member.clubId !== clubId) return null
  return (member.displayName as string) ?? null
}

async function memberName(db: Database, clubId: string, memberId: string | undefined): Promise<string | null> {
  return memberNameWith((collection, id) => db.read(collection, id), clubId, memberId)
}

function isManagerPlusRole(role: string): boolean {
  return role === 'manager' || role === 'super_admin'
}

async function bumpClubFence(tx: Tx, club: Doc, now: number): Promise<void> {
  await tx.set(COLLECTIONS.clubs, {
    ...club,
    mutationSeq: ((club.mutationSeq as number) ?? 0) + 1,
    updatedAt: now,
  })
}

function requireStatus(value: unknown): AnnouncementStatus {
  if (typeof value !== 'string' || !(STATUSES as readonly string[]).includes(value)) {
    throw new AppError('validation_failed', 'status 只能是 DRAFT/PUBLISHED/ARCHIVED')
  }
  return value as AnnouncementStatus
}

export async function listAnnouncements(
  deps: AnnouncementsDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  opts: { status?: string; cursor?: string; pageSize?: number } = {}
): Promise<Page<AnnouncementView>> {
  const now = deps.now()
  const tenant = await deps.db.tx(async (tx) => resolveTenant(tx, trusted, clubId))
  const isManagerPlus = isManagerPlusRole(tenant.member.role as string)

  const requested = opts.status === undefined ? null : requireStatus(opts.status)
  if (requested !== null && !isManagerPlus) {
    throw new AppError('permission_denied', '普通成员只能查看已发布公告')
  }
  const statusFilter = isManagerPlus ? requested : 'PUBLISHED'

  const pageSize = Math.min(Math.max(opts.pageSize ?? 20, 1), 50)
  const fingerprint = `announcement.list:${isManagerPlus ? 'admin' : 'public'}:${statusFilter ?? ''}`
  let after: { pinned: number; createdAt: number; id: string } | null = null
  if (opts.cursor) {
    const cursor = decodeCursor(opts.cursor, { action: 'announcement.list', clubId, fingerprint })
    after = { pinned: cursor.sort[0] as number, createdAt: cursor.sort[1] as number, id: cursor.sort[2] as string }
  }

  const entries = (
    await deps.db.query(COLLECTIONS.announcements, (doc) => {
      if (doc.clubId !== clubId) return false
      if (statusFilter !== null && doc.status !== statusFilter) return false
      return true
    })
  )
    .map((doc) => ({
      pinned: doc.pinned === true ? 1 : 0,
      createdAt: doc.createdAt as number,
      id: doc._id,
      doc,
    }))
    .sort((a, b) =>
      a.pinned !== b.pinned
        ? b.pinned - a.pinned
        : a.createdAt !== b.createdAt
          ? b.createdAt - a.createdAt
          : a.id < b.id
            ? 1
            : a.id > b.id
              ? -1
              : 0
    )
    .filter(
      (entry) =>
        after === null ||
        entry.pinned < after.pinned ||
        (entry.pinned === after.pinned &&
          (entry.createdAt < after.createdAt ||
            (entry.createdAt === after.createdAt && entry.id < after.id)))
    )

  const slice = entries.slice(0, pageSize + 1)
  const hasMore = slice.length > pageSize
  const pageEntries = slice.slice(0, pageSize)
  const items = await Promise.all(
    pageEntries.map(async (entry) =>
      toView(entry.doc, await memberName(deps.db, clubId, entry.doc.authorMemberId as string))
    )
  )
  const last = pageEntries[pageEntries.length - 1]
  const nextCursor =
    hasMore && last
      ? encodeCursor({
          v: 1,
          action: 'announcement.list',
          clubId,
          fingerprint,
          sort: [last.pinned, last.createdAt, last.id],
        })
      : null

  return { items, nextCursor, hasMore, asOf: new Date(now).toISOString() }
}

export async function getAnnouncement(
  deps: AnnouncementsDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  announcementId: string
): Promise<AnnouncementView> {
  const tenant = await deps.db.tx(async (tx) => resolveTenant(tx, trusted, clubId))
  const doc = await deps.db.read(COLLECTIONS.announcements, announcementId)
  if (!doc || doc.clubId !== clubId) throw new AppError('resource_not_found')
  if (!isManagerPlusRole(tenant.member.role as string) && doc.status !== 'PUBLISHED') {
    throw new AppError('resource_not_found')
  }
  return toView(doc, await memberName(deps.db, clubId, doc.authorMemberId as string))
}

export async function createAnnouncement(
  deps: AnnouncementsDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  input: { title: string; body: string; pinned?: boolean; mutationId: string }
): Promise<AnnouncementView> {
  const now = deps.now()
  const pinned = input.pinned ?? false
  if (typeof pinned !== 'boolean') throw new AppError('validation_failed', 'pinned 必须是布尔值')
  const title = normalizeSingleLine(input.title, { min: 1, max: 60, field: 'title' })
  const body = normalizeMultiLine(input.body, { min: 1, max: 10000, field: 'body' })

  const run = await runIdempotent(
    deps.db,
    now,
    {
      scope: { kind: 'TEAM', clubId },
      actorIdentityId: identityId(trusted.appId, trusted.openid),
      action: 'announcement.create',
      mutationId: input.mutationId,
      data: { title, body, pinned },
    },
    async (tx) => {
      const tenant = await resolveTenant(tx, trusted, clubId)
      requireManagerPlus(toTenantContext(trusted, tenant))
      const announcementId = randomId('ann')
      const doc: Doc = {
        _id: announcementId,
        clubId,
        authorMemberId: tenant.member._id,
        status: 'DRAFT',
        pinned,
        title,
        body,
        publishedAt: null,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      }
      await tx.set(COLLECTIONS.announcements, doc)
      await bumpClubFence(tx, tenant.club, now)
      await writeAudit(tx, {
        scope: `TEAM:${clubId}`,
        actorMemberId: tenant.member._id,
        action: 'announcement.create',
        resourceType: 'announcement',
        resourceId: announcementId,
        seed: input.mutationId,
        now,
      })
      return toView(doc, (tenant.member.displayName as string) ?? null)
    }
  )
  return run.result
}

export async function updateAnnouncement(
  deps: AnnouncementsDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  input: {
    announcementId: string
    title?: string
    body?: string
    pinned?: boolean
    expectedRevision: number
    mutationId: string
  }
): Promise<AnnouncementView> {
  const now = deps.now()
  const title = input.title === undefined ? undefined : normalizeSingleLine(input.title, { min: 1, max: 60, field: 'title' })
  const body = input.body === undefined ? undefined : normalizeMultiLine(input.body, { min: 1, max: 10000, field: 'body' })
  if (input.pinned !== undefined && typeof input.pinned !== 'boolean') {
    throw new AppError('validation_failed', 'pinned 必须是布尔值')
  }
  const data: Record<string, unknown> = { announcementId: input.announcementId }
  if (title !== undefined) data.title = title
  if (body !== undefined) data.body = body
  if (input.pinned !== undefined) data.pinned = input.pinned

  const run = await runIdempotent(
    deps.db,
    now,
    {
      scope: { kind: 'TEAM', clubId },
      actorIdentityId: identityId(trusted.appId, trusted.openid),
      action: 'announcement.update',
      mutationId: input.mutationId,
      expectedRevision: input.expectedRevision,
      data,
    },
    async (tx) => {
      const tenant = await resolveTenant(tx, trusted, clubId)
      requireManagerPlus(toTenantContext(trusted, tenant))
      const doc = await tx.get(COLLECTIONS.announcements, input.announcementId)
      if (!doc || doc.clubId !== clubId) throw new AppError('resource_not_found')
      if (doc.status === 'ARCHIVED') throw new AppError('invalid_transition', '已归档公告不能编辑')
      if ((doc.revision as number) !== input.expectedRevision) throw new AppError('revision_conflict')

      const next: Doc = {
        ...doc,
        title: title ?? doc.title,
        body: body ?? doc.body,
        pinned: input.pinned === undefined ? doc.pinned : input.pinned,
        revision: (doc.revision as number) + 1,
        updatedAt: now,
      }
      await tx.set(COLLECTIONS.announcements, next)
      await bumpClubFence(tx, tenant.club, now)
      await writeAudit(tx, {
        scope: `TEAM:${clubId}`,
        actorMemberId: tenant.member._id,
        action: 'announcement.update',
        resourceType: 'announcement',
        resourceId: doc._id,
        seed: input.mutationId,
        now,
      })
      return toView(
        next,
        await memberNameWith((collection, id) => tx.get(collection, id), clubId, next.authorMemberId as string)
      )
    }
  )
  return run.result
}

async function transition(
  deps: AnnouncementsDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  action: 'announcement.publish' | 'announcement.archive',
  input: { announcementId: string; expectedRevision: number; mutationId: string }
): Promise<AnnouncementView> {
  const now = deps.now()
  const run = await runIdempotent(
    deps.db,
    now,
    {
      scope: { kind: 'TEAM', clubId },
      actorIdentityId: identityId(trusted.appId, trusted.openid),
      action,
      mutationId: input.mutationId,
      expectedRevision: input.expectedRevision,
      data: { announcementId: input.announcementId },
    },
    async (tx) => {
      const tenant = await resolveTenant(tx, trusted, clubId)
      requireManagerPlus(toTenantContext(trusted, tenant))
      const doc = await tx.get(COLLECTIONS.announcements, input.announcementId)
      if (!doc || doc.clubId !== clubId) throw new AppError('resource_not_found')
      if ((doc.revision as number) !== input.expectedRevision) throw new AppError('revision_conflict')

      let next: Doc
      if (action === 'announcement.publish') {
        if (doc.status !== 'DRAFT') throw new AppError('invalid_transition', '仅草稿状态可发布')
        next = { ...doc, status: 'PUBLISHED', publishedAt: now, revision: (doc.revision as number) + 1, updatedAt: now }
      } else {
        if (doc.status === 'ARCHIVED') throw new AppError('invalid_transition', '公告已归档')
        next = { ...doc, status: 'ARCHIVED', revision: (doc.revision as number) + 1, updatedAt: now }
      }
      await tx.set(COLLECTIONS.announcements, next)
      await bumpClubFence(tx, tenant.club, now)
      await writeAudit(tx, {
        scope: `TEAM:${clubId}`,
        actorMemberId: tenant.member._id,
        action,
        resourceType: 'announcement',
        resourceId: doc._id,
        seed: input.mutationId,
        now,
      })
      return toView(
        next,
        await memberNameWith((collection, id) => tx.get(collection, id), clubId, next.authorMemberId as string)
      )
    }
  )
  return run.result
}

export function publishAnnouncement(
  deps: AnnouncementsDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  input: { announcementId: string; expectedRevision: number; mutationId: string }
): Promise<AnnouncementView> {
  return transition(deps, trusted, clubId, 'announcement.publish', input)
}

export function archiveAnnouncement(
  deps: AnnouncementsDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  input: { announcementId: string; expectedRevision: number; mutationId: string }
): Promise<AnnouncementView> {
  return transition(deps, trusted, clubId, 'announcement.archive', input)
}
