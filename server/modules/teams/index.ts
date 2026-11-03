import { AppError } from '../../contracts/errors.ts'
import type { Database, Tx } from '../../repositories/store.ts'
import { COLLECTIONS } from '../../repositories/collections.ts'
import { identityId } from '../../repositories/ids.ts'
import type { ClubRole, TeamListItem, TeamSession } from '../../contracts/dtos.ts'
import { decodeCursor, encodeCursor } from '../../shared/cursor.ts'
import { permissionsFor } from '../../shared/permissions.ts'
import { resolveTenant } from '../context.ts'

/**
 * 团队列表与进入（多团队 DESIGN §6.2、§7.1）。
 *
 * - team.listMine：仅本人成员关联，按本人 membership.createdAt/id 分页，投影最小队摘要。
 * - team.enter：实时授权，返回 TeamSession；**不写服务端 currentClub**；owner 权限不传播到别队。
 */

export interface TeamsDeps {
  db: Database
  now: () => number
}

export interface TeamListPage {
  items: TeamListItem[]
  nextCursor: string | null
  hasMore: boolean
  asOf: string
}

const DEFAULT_PAGE = 20
const MAX_PAGE = 50

function clampPage(size: number | undefined): number {
  if (!size || size <= 0) return DEFAULT_PAGE
  return Math.min(Math.floor(size), MAX_PAGE)
}

export async function listMine(
  deps: TeamsDeps,
  trusted: { appId: string; openid: string },
  opts: { cursor?: string; pageSize?: number } = {}
): Promise<TeamListPage> {
  const identity = await deps.db.read(COLLECTIONS.identities, identityId(trusted.appId, trusted.openid))
  if (!identity || typeof identity.userId !== 'string') throw new AppError('identity_required')
  const userId = identity.userId
  const user = await deps.db.read(COLLECTIONS.users, userId)
  if (!user) throw new AppError('identity_required')
  if (user.securityState === 'BLOCKED') throw new AppError('account_blocked')

  const pageSize = clampPage(opts.pageSize)
  const fingerprint = 'team.listMine'
  let after: { createdAt: number; id: string } | null = null
  if (opts.cursor) {
    const cursor = decodeCursor(opts.cursor, { action: 'team.listMine', clubId: null, fingerprint })
    after = { createdAt: cursor.sort[0] as number, id: cursor.sort[1] as string }
  }

  const entries = (
    await deps.db.query(COLLECTIONS.members, (doc) => doc.userId === userId)
  )
    .map((member) => ({ createdAt: member.createdAt as number, id: member._id, member }))
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

  const items: TeamListItem[] = (
    await Promise.all(
      pageEntries.map(async (entry) => {
        const club = await deps.db.read(COLLECTIONS.clubs, entry.member.clubId as string)
        // 已解散团队不再出现在选队列表（历史数据保留，仅平台运维可审计）
        if (!club || club.status === 'DISSOLVED') return null
        const status = entry.member.status as 'ACTIVE' | 'LEFT' | 'DISABLED'
        return {
          clubId: entry.member.clubId as string,
          name: (club.name as string) ?? '',
          displayCode: (club.displayCode as string) ?? '',
          role: entry.member.role as ClubRole,
          status,
          canEnter: status === 'ACTIVE' && club.status === 'ACTIVE',
        } satisfies TeamListItem
      })
    )
  ).filter((item): item is TeamListItem => item !== null)

  const last = pageEntries[pageEntries.length - 1]
  const nextCursor =
    hasMore && last
      ? encodeCursor({ v: 1, action: 'team.listMine', clubId: null, fingerprint, sort: [last.createdAt, last.id] })
      : null

  return { items, nextCursor, hasMore, asOf: new Date(deps.now()).toISOString() }
}

export async function enter(
  deps: TeamsDeps,
  trusted: { appId: string; openid: string },
  clubId: string
): Promise<TeamSession> {
  const now = deps.now()
  return deps.db.tx(async (tx: Tx) => {
    const tenant = await resolveTenant(tx, trusted, clubId)
    const club = tenant.club
    const member = tenant.member
    const role = member.role as ClubRole
    return {
      club: {
        id: club._id,
        name: club.name as string,
        displayCode: club.displayCode as string,
        status: 'ACTIVE',
      },
      member: {
        id: member._id,
        displayName: (member.displayName as string) ?? '',
        duty: (member.duty as string | null) ?? null,
        role,
        status: 'ACTIVE',
        revision: member.revision as number,
      },
      permissions: permissionsFor(role),
      asOf: new Date(now).toISOString(),
    }
  })
}
