import { AppError } from '../../contracts/errors.ts'
import type { Database, Doc } from '../../repositories/store.ts'
import { COLLECTIONS } from '../../repositories/collections.ts'
import type { Page, PerformanceView } from '../../contracts/dtos.ts'
import { requireManagerPlus } from '../../shared/authorization.ts'
import { decodeCursor, encodeCursor } from '../../shared/cursor.ts'
import { resolveTenant, toTenantContext } from '../context.ts'

/**
 * 绩效：本队隔离与既有定义（多团队 DESIGN §M6、BASE-DESIGN §10.2）。
 *
 * claimedCount=claimedAt 非空任务数；approvedCount=当前 APPROVED/DONE；
 * rejectedCount=曾有 REJECTED 交付的任务数（同一 task 多轮计 1）；
 * inProgressCount=CLAIMED/SUBMITTED/REJECTED；A/B/C/D=90/75/60/40；
 * 完成率=approved/claimed（无认领为 0）；质量均分仅已通过交付；综合分=round(完成率×均分,缺均分按 0)。
 *
 * 服务端有界扫描：命中记录数超 MAX_SCAN 返回 stats_unavailable，
 * **不返回部分榜单伪成功**，也不把 SDK 默认首批当全体。
 */

export interface PerformanceDeps {
  db: Database
  now: () => number
}

export const GRADE_SCORE: Readonly<Record<string, number>> = { A: 90, B: 75, C: 60, D: 40 }
export const MAX_SCAN = 20000

export type { PerformanceView }

const IN_PROGRESS: readonly string[] = ['CLAIMED', 'SUBMITTED', 'REJECTED']
const APPROVED_SET: readonly string[] = ['APPROVED', 'DONE']

interface PerformanceIndex {
  tasksByAssignee: Map<string, Doc[]>
  rejectedTasksByMember: Map<string, Set<string>>
  approvedScoresByMember: Map<string, number[]>
}

export function buildPerformanceIndex(tasks: Doc[], submissions: Doc[]): PerformanceIndex {
  const tasksByAssignee = new Map<string, Doc[]>()
  for (const task of tasks) {
    const assignee = task.assigneeMemberId as string | null
    if (!assignee) continue
    const list = tasksByAssignee.get(assignee) ?? []
    list.push(task)
    tasksByAssignee.set(assignee, list)
  }

  const rejectedTasksByMember = new Map<string, Set<string>>()
  const approvedScoresByMember = new Map<string, number[]>()
  for (const submission of submissions) {
    const member = submission.submittedByMemberId as string | undefined
    if (!member) continue
    if (submission.status === 'REJECTED') {
      const set = rejectedTasksByMember.get(member) ?? new Set<string>()
      set.add(submission.taskId as string)
      rejectedTasksByMember.set(member, set)
    } else if (submission.status === 'APPROVED') {
      const score = GRADE_SCORE[submission.reviewGrade as string]
      if (score === undefined) continue
      const list = approvedScoresByMember.get(member) ?? []
      list.push(score)
      approvedScoresByMember.set(member, list)
    }
  }

  return { tasksByAssignee, rejectedTasksByMember, approvedScoresByMember }
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function performanceOf(member: Doc, index: PerformanceIndex): PerformanceView {
  const memberId = member._id
  const tasks = index.tasksByAssignee.get(memberId) ?? []
  const claimedCount = tasks.filter((task) => task.claimedAt !== null && task.claimedAt !== undefined).length
  const approvedCount = tasks.filter((task) => APPROVED_SET.includes(task.status as string)).length
  const inProgressCount = tasks.filter((task) => IN_PROGRESS.includes(task.status as string)).length
  const rejectedCount = index.rejectedTasksByMember.get(memberId)?.size ?? 0

  const scores = index.approvedScoresByMember.get(memberId) ?? []
  const avgQualityScore =
    scores.length === 0 ? null : round(scores.reduce((sum, score) => sum + score, 0) / scores.length, 2)
  const rawRate = claimedCount === 0 ? 0 : approvedCount / claimedCount
  const compositeScore = Math.round(rawRate * (avgQualityScore ?? 0))

  return {
    memberId,
    displayName: (member.displayName as string) ?? '',
    duty: (member.duty as string | null) ?? null,
    role: member.role as PerformanceView['role'],
    claimedCount,
    approvedCount,
    rejectedCount,
    inProgressCount,
    completionRate: round(rawRate, 4),
    avgQualityScore,
    compositeScore,
  }
}

/** 读取本队全部 tasks/submissions 并做扫描预算门禁。 */
export async function readPerformanceRecords(
  db: Database,
  clubId: string
): Promise<{ tasks: Doc[]; submissions: Doc[] }> {
  const tasks = await db.query(COLLECTIONS.tasks, (doc) => doc.clubId === clubId)
  const submissions = await db.query(COLLECTIONS.taskSubmissions, (doc) => doc.clubId === clubId)
  if (tasks.length + submissions.length > MAX_SCAN) {
    throw new AppError('stats_unavailable', '统计规模超出当前预算，暂不可用')
  }
  return { tasks, submissions }
}

export async function performanceIndexForTeam(db: Database, clubId: string): Promise<PerformanceIndex> {
  const { tasks, submissions } = await readPerformanceRecords(db, clubId)
  return buildPerformanceIndex(tasks, submissions)
}

export async function myPerformance(
  deps: PerformanceDeps,
  trusted: { appId: string; openid: string },
  clubId: string
): Promise<PerformanceView> {
  const tenant = await deps.db.tx(async (tx) => resolveTenant(tx, trusted, clubId))
  const index = await performanceIndexForTeam(deps.db, clubId)
  return performanceOf(tenant.member, index)
}

export async function listPerformance(
  deps: PerformanceDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  opts: { cursor?: string; pageSize?: number } = {}
): Promise<Page<PerformanceView>> {
  const now = deps.now()
  const tenant = await deps.db.tx(async (tx) => resolveTenant(tx, trusted, clubId))
  requireManagerPlus(toTenantContext(trusted, tenant))

  const index = await performanceIndexForTeam(deps.db, clubId)
  const members = await deps.db.query(COLLECTIONS.members, (doc) => doc.clubId === clubId && doc.status === 'ACTIVE')

  const pageSize = Math.min(Math.max(opts.pageSize ?? 20, 1), 50)
  const fingerprint = 'performance.list:active'
  let after: { score: number; memberId: string } | null = null
  if (opts.cursor) {
    const cursor = decodeCursor(opts.cursor, { action: 'performance.list', clubId, fingerprint })
    after = { score: cursor.sort[0] as number, memberId: cursor.sort[1] as string }
  }

  const entries = members
    .map((member) => performanceOf(member, index))
    .sort((a, b) =>
      a.compositeScore !== b.compositeScore
        ? b.compositeScore - a.compositeScore
        : a.memberId < b.memberId
          ? -1
          : a.memberId > b.memberId
            ? 1
            : 0
    )
    .filter(
      (entry) =>
        after === null ||
        entry.compositeScore < after.score ||
        (entry.compositeScore === after.score && entry.memberId > after.memberId)
    )

  const slice = entries.slice(0, pageSize + 1)
  const hasMore = slice.length > pageSize
  const pageEntries = slice.slice(0, pageSize)
  const last = pageEntries[pageEntries.length - 1]
  const nextCursor =
    hasMore && last
      ? encodeCursor({
          v: 1,
          action: 'performance.list',
          clubId,
          fingerprint,
          sort: [last.compositeScore, last.memberId],
        })
      : null

  return { items: pageEntries, nextCursor, hasMore, asOf: new Date(now).toISOString() }
}
