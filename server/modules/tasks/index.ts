import { AppError } from '../../contracts/errors.ts'
import type { Database, Doc, Tx } from '../../repositories/store.ts'
import { COLLECTIONS } from '../../repositories/collections.ts'
import { identityId, commandId, randomId, sha256Hex } from '../../repositories/ids.ts'
import type { RequestScope } from '../../contracts/request-v2.ts'
import { requireManagerPlus } from '../../shared/authorization.ts'
import { writeAudit } from '../../shared/audit.ts'
import { classifyMissingCommand, mutationTimeMs, scopeCanonical } from '../../shared/command.ts'
import { decodeCursor, encodeCursor } from '../../shared/cursor.ts'
import { normalizeMultiLine, normalizeSingleLine } from '../../shared/text.ts'
import { resolveTenant, toTenantContext } from '../context.ts'
import { runIdempotent } from '../command.ts'
import { MAX_ATTACHMENTS } from '../files/index.ts'

/**
 * 本队任务状态机与交付轮次（多团队 DESIGN §9.1、§M4；BASE-DESIGN §9.1）。
 *
 * 六状态：OPEN→CLAIMED→SUBMITTED→APPROVED→DONE；SUBMITTED→REJECTED→SUBMITTED。
 * - 所有成员引用同队；服务端赋 author/member/time。
 * - 公共 Task DTO 不含他人交付说明/附件/私人备注。
 * - submit 创建独立 round/submission（历史不覆盖）；有 attachmentIds 时在提交事务内
 *   校验归属/完整性/期限与本批槽位，DRAFT→ATTACHED，未选槽位取消并封闭批次。
 */

export interface TasksDeps {
  db: Database
  now: () => number
}

interface BatchSlot {
  index: number
  sessionId: string | null
  state: 'EMPTY' | 'OCCUPIED'
}

export type TaskStatus = 'OPEN' | 'CLAIMED' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'DONE'
export type SubmissionStatus = 'SUBMITTED' | 'APPROVED' | 'REJECTED'

const GRADES: readonly string[] = ['A', 'B', 'C', 'D']
const ALLOWED_SCAN_STATES: readonly string[] = ['NOT_CONFIGURED', 'PASSED', 'UNSCANNABLE']
const TASK_CATEGORIES: readonly string[] = [
  'cross-dashboard',
  'content',
  'ai-image',
  'video-localize',
  'infra',
  'ops',
]
const GLOBAL_SUPER_ADMIN_ACTIONS = new Set(['club.dissolution.decide', 'club.dissolveAny'])

export interface TaskPublicView {
  taskId: string
  clubId: string
  title: string
  description: string
  category: string
  repo: string | null
  acceptanceCriteria: string | null
  status: TaskStatus
  assigneeMemberId: string | null
  claimedAt: string | null
  submittedAt: string | null
  currentRound: number
  revision: number
  createdByMemberId: string
  /** 同队成员展示名；成员缺失为 null（详情页展示用）。 */
  createdByName: string | null
  assigneeName: string | null
  /** 最新一轮验收人展示名与验收时间（未验收为 null）。 */
  reviewedByName: string | null
  reviewedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface SubmissionView {
  submissionId: string
  clubId: string
  taskId: string
  round: number
  submittedByMemberId: string
  note: string
  attachmentIds: string[]
  status: SubmissionStatus
  reviewGrade: string | null
  reviewNote: string | null
  reviewedByMemberId: string | null
  reviewedAt: string | null
  createdAt: string
}

function iso(value: unknown): string | null {
  return typeof value === 'number' ? new Date(value).toISOString() : null
}

function toTaskView(task: Doc): TaskPublicView {
  return {
    taskId: task._id,
    clubId: task.clubId as string,
    title: (task.title as string) ?? '',
    description: (task.description as string) ?? '',
    category: (task.category as string) ?? '',
    repo: (task.repo as string | null) ?? null,
    acceptanceCriteria: (task.acceptanceCriteria as string | null) ?? null,
    status: task.status as TaskStatus,
    assigneeMemberId: (task.assigneeMemberId as string | null) ?? null,
    claimedAt: iso(task.claimedAt),
    submittedAt: iso(task.submittedAt),
    currentRound: (task.currentRound as number) ?? 0,
    revision: (task.revision as number) ?? 0,
    createdByMemberId: task.createdByMemberId as string,
    createdByName: null,
    assigneeName: null,
    reviewedByName: null,
    reviewedAt: null,
    createdAt: iso(task.createdAt) as string,
    updatedAt: iso(task.updatedAt) as string,
  }
}

/** 详情页补充同队成员展示名与最新验收人（不改变任务/交付的可见性规则）。 */
async function withTaskNames(db: Database, view: TaskPublicView, task: Doc): Promise<TaskPublicView> {
  const memberIds = new Set<string>([view.createdByMemberId])
  if (view.assigneeMemberId) memberIds.add(view.assigneeMemberId)
  const names = new Map<string, string>()
  for (const memberId of memberIds) {
    const member = await db.read(COLLECTIONS.members, memberId)
    if (member && typeof member.displayName === 'string') names.set(memberId, member.displayName)
  }

  let reviewedByName: string | null = null
  let reviewedAt: string | null = null
  if (typeof task.lastSubmissionId === 'string') {
    const submission = await db.read(COLLECTIONS.taskSubmissions, task.lastSubmissionId)
    if (submission) {
      reviewedAt = iso(submission.reviewedAt)
      if (typeof submission.reviewedByMemberId === 'string') {
        const reviewer = await db.read(COLLECTIONS.members, submission.reviewedByMemberId)
        reviewedByName = (reviewer?.displayName as string) ?? null
      }
    }
  }

  return {
    ...view,
    createdByName: names.get(view.createdByMemberId) ?? null,
    assigneeName: view.assigneeMemberId ? (names.get(view.assigneeMemberId) ?? null) : null,
    reviewedByName,
    reviewedAt,
  }
}

function toSubmissionView(sub: Doc): SubmissionView {
  return {
    submissionId: sub._id,
    clubId: sub.clubId as string,
    taskId: sub.taskId as string,
    round: sub.round as number,
    submittedByMemberId: sub.submittedByMemberId as string,
    note: (sub.note as string) ?? '',
    attachmentIds: (sub.attachmentIds as string[]) ?? [],
    status: sub.status as SubmissionStatus,
    reviewGrade: (sub.reviewGrade as string | null) ?? null,
    reviewNote: (sub.reviewNote as string | null) ?? null,
    reviewedByMemberId: (sub.reviewedByMemberId as string | null) ?? null,
    reviewedAt: iso(sub.reviewedAt),
    createdAt: iso(sub.createdAt) as string,
  }
}

async function bumpClubFence(tx: Tx, club: Doc, now: number): Promise<void> {
  await tx.set(COLLECTIONS.clubs, {
    ...club,
    mutationSeq: ((club.mutationSeq as number) ?? 0) + 1,
    updatedAt: now,
  })
}

function actorIdentityId(trusted: { appId: string; openid: string }): string {
  return identityId(trusted.appId, trusted.openid)
}

export async function createTask(
  deps: TasksDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  input: {
    title: string
    description: string
    category: string
    repo?: string | null
    acceptanceCriteria?: string | null
    mutationId: string
  }
): Promise<TaskPublicView> {
  const now = deps.now()
  const title = normalizeSingleLine(input.title, { min: 1, max: 40, field: '任务标题' })
  const description = normalizeMultiLine(input.description, { min: 1, max: 2000, field: '任务描述' })
  const category = normalizeSingleLine(input.category, { min: 1, max: 40, field: '任务分类' })
  if (!TASK_CATEGORIES.includes(category)) throw new AppError('validation_failed', '任务分类非法')
  const repo =
    input.repo === undefined || input.repo === null
      ? null
      : normalizeSingleLine(input.repo, { min: 1, max: 80, field: '关联仓库' })
  const acceptanceCriteria =
    input.acceptanceCriteria === undefined || input.acceptanceCriteria === null
      ? null
      : normalizeMultiLine(input.acceptanceCriteria, { min: 0, max: 2000, field: '验收标准' })
  const run = await runIdempotent(
    deps.db,
    now,
    {
      scope: { kind: 'TEAM', clubId },
      actorIdentityId: actorIdentityId(trusted),
      action: 'task.create',
      mutationId: input.mutationId,
      data: {
        title,
        description,
        category,
        repo,
        acceptanceCriteria,
      },
    },
    async (tx) => {
      const tenant = await resolveTenant(tx, trusted, clubId)
      requireManagerPlus(toTenantContext(trusted, tenant))
      const taskId = randomId('task')
      const task: Doc = {
        _id: taskId,
        clubId,
        title,
        description,
        category,
        repo,
        acceptanceCriteria,
        status: 'OPEN',
        assigneeMemberId: null,
        claimedAt: null,
        submittedAt: null,
        currentRound: 0,
        lastSubmissionId: null,
        revision: 1,
        createdByMemberId: tenant.member._id,
        createdAt: now,
        updatedAt: now,
      }
      await tx.set(COLLECTIONS.tasks, task)
      await bumpClubFence(tx, tenant.club, now)
      await writeAudit(tx, {
        scope: `TEAM:${clubId}`,
        actorMemberId: tenant.member._id,
        action: 'task.create',
        resourceType: 'task',
        resourceId: taskId,
        seed: input.mutationId,
        now,
      })
      return toTaskView(task)
    }
  )
  return run.result
}

export async function updateTask(
  deps: TasksDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  input: {
    taskId: string
    title?: string
    description?: string
    category?: string
    repo?: string | null
    acceptanceCriteria?: string | null
    expectedRevision: number
    mutationId: string
  }
): Promise<TaskPublicView> {
  const now = deps.now()
  const title =
    input.title === undefined ? undefined : normalizeSingleLine(input.title, { min: 1, max: 40, field: '任务标题' })
  const description =
    input.description === undefined
      ? undefined
      : normalizeMultiLine(input.description, { min: 1, max: 2000, field: '任务描述' })
  const category =
    input.category === undefined
      ? undefined
      : normalizeSingleLine(input.category, { min: 1, max: 40, field: '任务分类' })
  if (category !== undefined && !TASK_CATEGORIES.includes(category)) {
    throw new AppError('validation_failed', '任务分类非法')
  }
  const repo =
    input.repo === undefined
      ? undefined
      : input.repo === null
        ? null
        : normalizeSingleLine(input.repo, { min: 1, max: 80, field: '关联仓库' })
  const acceptanceCriteria =
    input.acceptanceCriteria === undefined
      ? undefined
      : input.acceptanceCriteria === null
        ? null
        : normalizeMultiLine(input.acceptanceCriteria, { min: 0, max: 2000, field: '验收标准' })

  const data: Record<string, unknown> = { taskId: input.taskId }
  if (title !== undefined) data.title = title
  if (description !== undefined) data.description = description
  if (category !== undefined) data.category = category
  if (repo !== undefined) data.repo = repo
  if (acceptanceCriteria !== undefined) data.acceptanceCriteria = acceptanceCriteria

  const run = await runIdempotent(
    deps.db,
    now,
    {
      scope: { kind: 'TEAM', clubId },
      actorIdentityId: actorIdentityId(trusted),
      action: 'task.update',
      mutationId: input.mutationId,
      expectedRevision: input.expectedRevision,
      data,
    },
    async (tx) => {
      const tenant = await resolveTenant(tx, trusted, clubId)
      requireManagerPlus(toTenantContext(trusted, tenant))
      const task = await tx.get(COLLECTIONS.tasks, input.taskId)
      if (!task || task.clubId !== clubId) throw new AppError('resource_not_found')
      if (task.status !== 'OPEN') throw new AppError('invalid_transition', '仅 OPEN 任务可编辑')
      if ((task.revision as number) !== input.expectedRevision) throw new AppError('revision_conflict')
      const patch: Record<string, unknown> = {
        title: title ?? task.title,
        description: description ?? task.description,
        category: category ?? task.category,
        repo: repo === undefined ? task.repo : repo,
        acceptanceCriteria: acceptanceCriteria === undefined ? task.acceptanceCriteria : acceptanceCriteria,
      }
      const next: Doc = { ...task, ...patch, revision: (task.revision as number) + 1, updatedAt: now }
      await tx.set(COLLECTIONS.tasks, next)
      await bumpClubFence(tx, tenant.club, now)
      return toTaskView(next)
    }
  )
  return run.result
}

export async function claimTask(
  deps: TasksDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  input: { taskId: string; expectedRevision: number; mutationId: string }
): Promise<TaskPublicView> {
  const now = deps.now()
  const run = await runIdempotent(
    deps.db,
    now,
    {
      scope: { kind: 'TEAM', clubId },
      actorIdentityId: actorIdentityId(trusted),
      action: 'task.claim',
      mutationId: input.mutationId,
      expectedRevision: input.expectedRevision,
      data: { taskId: input.taskId },
    },
    async (tx) => {
      const tenant = await resolveTenant(tx, trusted, clubId)
      const task = await tx.get(COLLECTIONS.tasks, input.taskId)
      if (!task || task.clubId !== clubId) throw new AppError('resource_not_found')
      if ((task.revision as number) !== input.expectedRevision) throw new AppError('revision_conflict')
      if (task.status !== 'OPEN' || task.assigneeMemberId !== null) {
        throw new AppError('task_not_claimable')
      }
      const next: Doc = {
        ...task,
        status: 'CLAIMED',
        assigneeMemberId: tenant.member._id,
        claimedAt: now,
        revision: (task.revision as number) + 1,
        updatedAt: now,
      }
      await tx.set(COLLECTIONS.tasks, next)
      await bumpClubFence(tx, tenant.club, now)
      await writeAudit(tx, {
        scope: `TEAM:${clubId}`,
        actorMemberId: tenant.member._id,
        action: 'task.claim',
        resourceType: 'task',
        resourceId: task._id,
        seed: input.mutationId,
        now,
      })
      return toTaskView(next)
    }
  )
  return run.result
}

export async function submitTask(
  deps: TasksDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  input: {
    taskId: string
    note: string
    attachmentIds: string[]
    targetRound?: number
    expectedRevision: number
    mutationId: string
  }
): Promise<{ task: TaskPublicView; submission: SubmissionView }> {
  const now = deps.now()
  const note = normalizeMultiLine(input.note, { min: 1, max: 1000, field: '交付说明' })
  const attachments = Array.isArray(input.attachmentIds) ? input.attachmentIds : []
  if (attachments.length > MAX_ATTACHMENTS) {
    throw new AppError('validation_failed', `附件最多 ${MAX_ATTACHMENTS} 个`)
  }
  if (attachments.some((id) => typeof id !== 'string' || id.length === 0)) {
    throw new AppError('validation_failed', '附件 id 非法')
  }
  if (new Set(attachments).size !== attachments.length) {
    throw new AppError('validation_failed', '附件重复')
  }

  const run = await runIdempotent(
    deps.db,
    now,
    {
      scope: { kind: 'TEAM', clubId },
      actorIdentityId: actorIdentityId(trusted),
      action: 'task.submit',
      mutationId: input.mutationId,
      expectedRevision: input.expectedRevision,
      data: { taskId: input.taskId, note, attachmentIds: attachments, targetRound: input.targetRound ?? null },
    },
    async (tx) => {
      const tenant = await resolveTenant(tx, trusted, clubId)
      const task = await tx.get(COLLECTIONS.tasks, input.taskId)
      if (!task || task.clubId !== clubId) throw new AppError('resource_not_found')
      if ((task.revision as number) !== input.expectedRevision) throw new AppError('revision_conflict')
      if (task.status !== 'CLAIMED' && task.status !== 'REJECTED') {
        throw new AppError('invalid_transition', '当前状态不可交付')
      }
      if (task.assigneeMemberId !== tenant.member._id) throw new AppError('permission_denied', '仅当前负责人可交付')

      const round = ((task.currentRound as number) ?? 0) + 1
      if (input.targetRound !== undefined && input.targetRound !== round) {
        throw new AppError('revision_conflict', 'targetRound 与当前任务轮次不符')
      }

      const submissionId = randomId('sub')
      // 固定 batch 契约（M5）：hash(clubId, taskId, targetRound)，与 file.init 同算法
      const batchId = sha256Hex(JSON.stringify(['rak-batch-v1', clubId, input.taskId, round]))
      const batch = await tx.get(COLLECTIONS.uploadBatches, batchId)
      const slots = (batch?.slots as BatchSlot[] | undefined) ?? []
      const slotSessionIds = new Set<string>()
      for (const slot of slots) {
        if (slot.state === 'OCCUPIED' && typeof slot.sessionId === 'string') slotSessionIds.add(slot.sessionId)
      }

      // 先完成全部附件校验：任一失败 → 整个事务回滚，不产生"绑了一半"
      const selectedSessions = new Set<string>()
      if (attachments.length > 0) {
        if (!batch || batch.state !== 'OPEN') {
          throw new AppError('attachment_forbidden', '本轮附件批次不存在或已封闭')
        }
        for (const attachmentId of attachments) {
          const attachment = await tx.get(COLLECTIONS.attachments, attachmentId)
          if (!attachment || attachment.clubId !== clubId || attachment.taskId !== input.taskId) {
            throw new AppError('attachment_forbidden', '附件不属于本任务')
          }
          if (attachment.uploadedByMemberId !== tenant.member._id) {
            throw new AppError('attachment_forbidden', '只能绑定本人上传的附件')
          }
          if (attachment.integrityState !== 'VERIFIED') {
            throw new AppError('attachment_not_ready', '附件尚未完成校验')
          }
          if (!ALLOWED_SCAN_STATES.includes(attachment.scanState as string)) {
            throw new AppError('attachment_not_ready', '附件安全状态不可交付')
          }
          if (attachment.lifecycleState !== 'DRAFT') {
            throw new AppError('attachment_forbidden', '附件已被其他交付绑定或待回收')
          }
          const confirmedUntil = attachment.confirmedUntil
          if (typeof confirmedUntil !== 'number' || now > confirmedUntil) {
            throw new AppError('upload_expired', '附件已过期，请重新上传')
          }
          const sessionId = attachment.sessionId as string
          const session = await tx.get(COLLECTIONS.uploadSessions, sessionId)
          if (!session || session.clubId !== clubId || session.taskId !== input.taskId) {
            throw new AppError('attachment_forbidden', '附件会话不属于本任务')
          }
          if (session.state !== 'CONFIRMED' || session.attachmentId !== attachmentId) {
            throw new AppError('attachment_not_ready', '附件会话尚未确认')
          }
          if ((session.targetRound as number) !== round || !slotSessionIds.has(sessionId)) {
            throw new AppError('attachment_forbidden', '附件不在本轮批次内')
          }
          selectedSessions.add(sessionId)
        }
      }

      // 绑定选中附件
      for (const attachmentId of attachments) {
        const attachment = (await tx.get(COLLECTIONS.attachments, attachmentId)) as Doc
        await tx.set(COLLECTIONS.attachments, {
          ...attachment,
          lifecycleState: 'ATTACHED',
          submissionId,
          updatedAt: now,
        })
      }

      // 未选中的槽位：终结会话 + 未交付附件转 GC_PENDING；随后封闭批次
      if (batch && batch.state !== 'CLOSED') {
        for (const slot of slots) {
          const sessionId = typeof slot.sessionId === 'string' ? slot.sessionId : null
          if (!sessionId || selectedSessions.has(sessionId)) continue
          const session = await tx.get(COLLECTIONS.uploadSessions, sessionId)
          if (!session) continue
          if (session.state !== 'CANCELLED') {
            await tx.set(COLLECTIONS.uploadSessions, {
              ...session,
              state: 'CANCELLED',
              fence: ((session.fence as number) ?? 0) + 1,
              updatedAt: now,
            })
          }
          if (typeof session.attachmentId === 'string') {
            const attachment = await tx.get(COLLECTIONS.attachments, session.attachmentId)
            if (attachment && attachment.lifecycleState === 'DRAFT') {
              await tx.set(COLLECTIONS.attachments, { ...attachment, lifecycleState: 'GC_PENDING', updatedAt: now })
            }
          }
        }
        await tx.set(COLLECTIONS.uploadBatches, {
          ...batch,
          state: 'CLOSED',
          revision: ((batch.revision as number) ?? 0) + 1,
          updatedAt: now,
        })
      }

      const submission: Doc = {
        _id: submissionId,
        clubId,
        taskId: input.taskId,
        round,
        submittedByMemberId: tenant.member._id,
        note,
        attachmentIds: attachments,
        taskRevisionAtSubmit: task.revision,
        status: 'SUBMITTED',
        reviewGrade: null,
        reviewNote: null,
        reviewedByMemberId: null,
        reviewedAt: null,
        createdAt: now,
        updatedAt: now,
      }
      await tx.set(COLLECTIONS.taskSubmissions, submission)

      const next: Doc = {
        ...task,
        status: 'SUBMITTED',
        submittedAt: now,
        currentRound: round,
        lastSubmissionId: submissionId,
        revision: (task.revision as number) + 1,
        updatedAt: now,
      }
      await tx.set(COLLECTIONS.tasks, next)
      await bumpClubFence(tx, tenant.club, now)
      await writeAudit(tx, {
        scope: `TEAM:${clubId}`,
        actorMemberId: tenant.member._id,
        action: 'task.submit',
        resourceType: 'submission',
        resourceId: submissionId,
        seed: input.mutationId,
        now,
      })
      return { task: toTaskView(next), submission: toSubmissionView(submission) }
    }
  )
  return run.result
}

async function reviewSubmission(
  deps: TasksDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  action: 'task.approve' | 'task.reject',
  input: { taskId: string; submissionId: string; grade?: string; note?: string; reason?: string; expectedRevision: number; mutationId: string }
): Promise<{ task: TaskPublicView; submission: SubmissionView }> {
  const now = deps.now()
  const grade =
    input.grade === undefined ? undefined : normalizeSingleLine(input.grade, { min: 1, max: 1, field: '验收等级' })
  const note =
    input.note === undefined ? undefined : normalizeMultiLine(input.note, { min: 0, max: 500, field: '验收备注' })
  const reason =
    input.reason === undefined
      ? undefined
      : normalizeSingleLine(input.reason, { min: 1, max: 500, field: '驳回原因' })
  const data: Record<string, unknown> = { taskId: input.taskId, submissionId: input.submissionId }
  if (grade !== undefined) data.grade = grade
  if (note !== undefined) data.note = note
  if (reason !== undefined) data.reason = reason

  const run = await runIdempotent(
    deps.db,
    now,
    {
      scope: { kind: 'TEAM', clubId },
      actorIdentityId: actorIdentityId(trusted),
      action,
      mutationId: input.mutationId,
      expectedRevision: input.expectedRevision,
      data,
    },
    async (tx) => {
      const tenant = await resolveTenant(tx, trusted, clubId)
      requireManagerPlus(toTenantContext(trusted, tenant))
      const task = await tx.get(COLLECTIONS.tasks, input.taskId)
      if (!task || task.clubId !== clubId) throw new AppError('resource_not_found')
      if ((task.revision as number) !== input.expectedRevision) throw new AppError('revision_conflict')
      if (task.status !== 'SUBMITTED') throw new AppError('invalid_transition', '当前任务不在待验收状态')
      if (task.lastSubmissionId !== input.submissionId) throw new AppError('invalid_transition', '只能验收当前待验收轮次')

      const submission = await tx.get(COLLECTIONS.taskSubmissions, input.submissionId)
      if (!submission || submission.clubId !== clubId || submission.taskId !== input.taskId) {
        throw new AppError('resource_not_found')
      }
      if (submission.status !== 'SUBMITTED') throw new AppError('invalid_transition', '该轮次已被处理')

      const approved = action === 'task.approve'
      if (approved && !GRADES.includes(grade as string)) {
        throw new AppError('validation_failed', 'grade 必须是 A/B/C/D')
      }
      if (!approved && !reason) {
        throw new AppError('validation_failed', '驳回原因必填')
      }

      const nextSub: Doc = {
        ...submission,
        status: approved ? 'APPROVED' : 'REJECTED',
        reviewGrade: approved ? grade : null,
        reviewNote: approved ? (note || null) : reason,
        reviewedByMemberId: tenant.member._id,
        reviewedAt: now,
        updatedAt: now,
      }
      await tx.set(COLLECTIONS.taskSubmissions, nextSub)

      const nextTask: Doc = {
        ...task,
        status: approved ? 'APPROVED' : 'REJECTED',
        revision: (task.revision as number) + 1,
        updatedAt: now,
      }
      await tx.set(COLLECTIONS.tasks, nextTask)
      await bumpClubFence(tx, tenant.club, now)
      await writeAudit(tx, {
        scope: `TEAM:${clubId}`,
        actorMemberId: tenant.member._id,
        action,
        resourceType: 'submission',
        resourceId: input.submissionId,
        seed: input.mutationId,
        now,
      })
      return { task: toTaskView(nextTask), submission: toSubmissionView(nextSub) }
    }
  )
  return run.result
}

export function approveTask(
  deps: TasksDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  input: { taskId: string; submissionId: string; grade: string; note?: string; expectedRevision: number; mutationId: string }
): Promise<{ task: TaskPublicView; submission: SubmissionView }> {
  return reviewSubmission(deps, trusted, clubId, 'task.approve', input)
}

export function rejectTask(
  deps: TasksDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  input: { taskId: string; submissionId: string; reason: string; expectedRevision: number; mutationId: string }
): Promise<{ task: TaskPublicView; submission: SubmissionView }> {
  return reviewSubmission(deps, trusted, clubId, 'task.reject', input)
}

export async function archiveTask(
  deps: TasksDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  input: { taskId: string; expectedRevision: number; mutationId: string }
): Promise<TaskPublicView> {
  const now = deps.now()
  const run = await runIdempotent(
    deps.db,
    now,
    {
      scope: { kind: 'TEAM', clubId },
      actorIdentityId: actorIdentityId(trusted),
      action: 'task.archive',
      mutationId: input.mutationId,
      expectedRevision: input.expectedRevision,
      data: { taskId: input.taskId },
    },
    async (tx) => {
      const tenant = await resolveTenant(tx, trusted, clubId)
      requireManagerPlus(toTenantContext(trusted, tenant))
      const task = await tx.get(COLLECTIONS.tasks, input.taskId)
      if (!task || task.clubId !== clubId) throw new AppError('resource_not_found')
      if ((task.revision as number) !== input.expectedRevision) throw new AppError('revision_conflict')
      if (task.status !== 'APPROVED') throw new AppError('invalid_transition', '仅 APPROVED 可归档')
      const next: Doc = { ...task, status: 'DONE', revision: (task.revision as number) + 1, updatedAt: now }
      await tx.set(COLLECTIONS.tasks, next)
      await bumpClubFence(tx, tenant.club, now)
      return toTaskView(next)
    }
  )
  return run.result
}

export async function listTasks(
  deps: TasksDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  opts: {
    status?: string[]
    category?: string
    keyword?: string
    assigneeMemberId?: string
    cursor?: string
    pageSize?: number
  } = {}
): Promise<{ items: TaskPublicView[]; nextCursor: string | null; hasMore: boolean; asOf: string }> {
  const now = deps.now()
  const tenant = await deps.db.tx(async (tx) => resolveTenant(tx, trusted, clubId))

  const pageSize = Math.min(Math.max(opts.pageSize ?? 20, 1), 50)
  const fingerprint = JSON.stringify([
    opts.status ?? [],
    opts.category ?? '',
    opts.keyword ?? '',
    opts.assigneeMemberId ?? '',
  ])
  let after: { createdAt: number; id: string } | null = null
  if (opts.cursor) {
    const cursor = decodeCursor(opts.cursor, { action: 'task.list', clubId, fingerprint })
    after = { createdAt: cursor.sort[0] as number, id: cursor.sort[1] as string }
  }

  const keyword = (opts.keyword ?? '').toLowerCase()
  const entries = (
    await deps.db.query(COLLECTIONS.tasks, (doc) => {
      if (doc.clubId !== clubId) return false
      if (opts.status && opts.status.length > 0 && !opts.status.includes(doc.status as string)) return false
      if (opts.category && doc.category !== opts.category) return false
      if (opts.assigneeMemberId && doc.assigneeMemberId !== opts.assigneeMemberId) return false
      if (keyword) {
        const hay = `${doc.title as string}\n${doc.description as string}`.toLowerCase()
        if (!hay.includes(keyword)) return false
      }
      return true
    })
  )
    .map((task) => ({ createdAt: task.createdAt as number, id: task._id, task }))
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
  const items = pageEntries.map((entry) => toTaskView(entry.task))
  const last = pageEntries[pageEntries.length - 1]
  const nextCursor =
    hasMore && last
      ? encodeCursor({ v: 1, action: 'task.list', clubId, fingerprint, sort: [last.createdAt, last.id] })
      : null

  void tenant
  return { items, nextCursor, hasMore, asOf: new Date(now).toISOString() }
}

export async function getTask(
  deps: TasksDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  taskId: string
): Promise<TaskPublicView> {
  const tenant = await deps.db.tx(async (tx) => resolveTenant(tx, trusted, clubId))
  void tenant
  const task = await deps.db.read(COLLECTIONS.tasks, taskId)
  if (!task || task.clubId !== clubId) throw new AppError('resource_not_found')
  return withTaskNames(deps.db, toTaskView(task), task)
}

function canReadSubmissions(ctx: ReturnType<typeof toTenantContext>, submission: Doc): boolean {
  if (ctx.role === 'manager' || ctx.role === 'super_admin') return true
  return submission.submittedByMemberId === ctx.actorMemberId
}

export async function getSubmission(
  deps: TasksDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  submissionId: string
): Promise<SubmissionView> {
  const tenant = await deps.db.tx(async (tx) => resolveTenant(tx, trusted, clubId))
  const ctx = toTenantContext(trusted, tenant)
  const submission = await deps.db.read(COLLECTIONS.taskSubmissions, submissionId)
  if (!submission || submission.clubId !== clubId) throw new AppError('resource_not_found')
  if (!canReadSubmissions(ctx, submission)) throw new AppError('permission_denied')
  return toSubmissionView(submission)
}

export async function listSubmissions(
  deps: TasksDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  taskId: string
): Promise<SubmissionView[]> {
  const tenant = await deps.db.tx(async (tx) => resolveTenant(tx, trusted, clubId))
  const ctx = toTenantContext(trusted, tenant)
  const task = await deps.db.read(COLLECTIONS.tasks, taskId)
  if (!task || task.clubId !== clubId) throw new AppError('resource_not_found')
  return (await deps.db.query(COLLECTIONS.taskSubmissions, (doc) => doc.clubId === clubId && doc.taskId === taskId))
    .filter((sub) => canReadSubmissions(ctx, sub))
    .map((sub) => toSubmissionView(sub))
    .sort((a, b) => b.round - a.round)
}

export type CommandQueryStatus =
  | 'SUCCEEDED'
  | 'DETERMINISTIC_REJECTED'
  | 'ACCEPTED_JOB'
  | 'ABSENT_IN_WINDOW'
  | 'EXPIRED'

async function hasActiveSuperAdmin(deps: TasksDeps, userId: string): Promise<boolean> {
  const memberships = await deps.db.query(
    COLLECTIONS.members,
    (doc) => doc.userId === userId && doc.role === 'super_admin' && doc.status === 'ACTIVE'
  )
  for (const membership of memberships) {
    const club = await deps.db.read(COLLECTIONS.clubs, membership.clubId as string)
    if (club?.status === 'ACTIVE') return true
  }
  return false
}

/** command.status：scope 必须与原命令一致；只查本人命令；查不到不等于失败。 */
export async function commandStatus(
  deps: TasksDeps,
  trusted: { appId: string; openid: string },
  scope: RequestScope,
  input: { action: string; mutationId: string }
): Promise<{ status: CommandQueryStatus; resultSummary: unknown }> {
  const now = deps.now()
  const actor = actorIdentityId(trusted)
  const scopeKey = scopeCanonical(scope)
  let currentRole: string | null = null
  let currentIsPrimaryOwner = false
  let currentUserId = ''

  if (scope.kind === 'TEAM') {
    await deps.db.tx(async (tx) => {
      const tenant = await resolveTenant(tx, trusted, scope.clubId)
      currentRole = tenant.member.role as string
      currentIsPrimaryOwner = tenant.club.ownerMemberId === tenant.member._id
    })
  } else {
    const identity = await deps.db.read(COLLECTIONS.identities, actor)
    if (!identity || typeof identity.userId !== 'string') throw new AppError('identity_required')
    const user = await deps.db.read(COLLECTIONS.users, identity.userId)
    if (!user) throw new AppError('identity_required')
    if (user.securityState === 'BLOCKED') throw new AppError('account_blocked')
    currentUserId = identity.userId
  }

  const id = commandId(scopeKey, actor, input.action, input.mutationId)
  const doc = await deps.db.read(COLLECTIONS.commands, id)
  if (!doc) {
    const time = mutationTimeMs(input.mutationId)
    return { status: classifyMissingCommand(time, now) as CommandQueryStatus, resultSummary: null }
  }
  const resultUntil = doc.resultUntil
  if (typeof resultUntil !== 'number' || now > resultUntil) {
    return { status: 'EXPIRED', resultSummary: null }
  }
  const storedRole = (doc.actorRole as string | null | undefined) ?? null
  const storedIsPrimaryOwner = doc.actorIsPrimaryOwner === true
  if (storedRole !== currentRole || storedIsPrimaryOwner !== currentIsPrimaryOwner) {
    throw new AppError('permission_denied', '命令结果不可在当前授权状态下读取')
  }
  if (
    scope.kind === 'GLOBAL' &&
    GLOBAL_SUPER_ADMIN_ACTIONS.has(input.action) &&
    !(await hasActiveSuperAdmin(deps, currentUserId))
  ) {
    throw new AppError('permission_denied', '超管权限已变化')
  }
  return { status: doc.status as CommandQueryStatus, resultSummary: JSON.parse(doc.resultSummary as string) }
}
