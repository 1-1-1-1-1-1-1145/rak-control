import type {
  Announcement,
  ClubBrief,
  ClubInfo,
  ClubMember,
  ClubRole,
  LoginOutcome,
  MeView,
  MemberPerformance,
  Paged,
  QualityGrade,
  RoiInput,
  RoiItem,
  RoiOverview,
  RoiPeriod,
  Task,
  TaskSubmissionAttachment,
  TaskQuery,
  UserInfo,
} from '../types/domain'
import { validateTaskAttachments } from '../utils/task-attachment-policy.js'

const STORAGE_KEY = 'rak-control:demo:v1'
const STATE_VERSION = 1

export interface DemoStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export class MemoryDemoStorage implements DemoStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

export class DemoAdapterError extends Error {
  readonly status: number
  readonly code: string

  constructor(
    status: number,
    code: string,
    message: string
  ) {
    super(message)
    this.name = 'DemoAdapterError'
    this.status = status
    this.code = code
  }
}

export interface DemoState {
  version: number
  club: ClubInfo
  members: ClubMember[]
  currentUserId: string | null
  tasks: Task[]
  announcements: Announcement[]
  roiItems: RoiItem[]
  sequence: number
}

export interface DemoPublishTaskInput {
  title: string
  description: string
  category: string
  repo?: string | null
  acceptanceCriteria?: string | null
}

export interface DemoTaskQuery extends TaskQuery {}

export interface DemoRoiQuery {
  status?: string
  category?: string
  keyword?: string
  page?: number
  size?: number
}

export interface DemoAnnouncementInput {
  title: string
  body: string
  pinned: boolean
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function isoDate(offsetDays = 0): string {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  return date.toISOString()
}

function dateOnly(offsetDays = 0): string {
  return isoDate(offsetDays).slice(0, 10)
}

function newMember(
  userId: string,
  role: ClubRole,
  displayName: string,
  duty: string | null,
  joinedDaysAgo: number
): ClubMember {
  const joinedAt = isoDate(-joinedDaysAgo)
  return {
    id: `member-${userId}`,
    clubId: 'demo-club',
    userId,
    clubRole: role,
    displayName,
    duty,
    status: 'ACTIVE',
    joinedAt,
    updatedAt: joinedAt,
  }
}

function newTask(
  id: string,
  values: Partial<Task> & Pick<Task, 'title' | 'description' | 'category' | 'status'>
): Task {
  const createdAt = values.createdAt || isoDate(-6)
  return {
    id,
    clubId: 'demo-club',
    title: values.title,
    description: values.description,
    category: values.category as Task['category'],
    repo: values.repo ?? null,
    acceptanceCriteria: values.acceptanceCriteria ?? null,
    status: values.status,
    assigneeId: values.assigneeId ?? null,
    assigneeName: values.assigneeName ?? null,
    claimedAt: values.claimedAt ?? null,
    submittedAt: values.submittedAt ?? null,
    submitNote: values.submitNote ?? null,
    approvedAt: values.approvedAt ?? null,
    qualityGrade: values.qualityGrade ?? null,
    qualityNote: values.qualityNote ?? null,
    rejectedAt: values.rejectedAt ?? null,
    rejectReason: values.rejectReason ?? null,
    createdBy: values.createdBy || 'demo-manager',
    createdByName: values.createdByName || '林老师',
    createdAt,
    updatedAt: values.updatedAt || createdAt,
  }
}

function newAnnouncement(
  id: string,
  values: Partial<Announcement> & Pick<Announcement, 'title' | 'body' | 'status'>
): Announcement {
  const createdAt = values.createdAt || isoDate(-3)
  return {
    id,
    clubId: 'demo-club',
    title: values.title,
    body: values.body,
    pinned: values.pinned ?? false,
    authorId: values.authorId || 'demo-manager',
    authorName: values.authorName || '林老师',
    status: values.status,
    publishedAt: values.publishedAt ?? null,
    createdAt,
    updatedAt: values.updatedAt || createdAt,
  }
}

function newRoiItem(
  id: string,
  values: Partial<RoiItem> & Pick<RoiItem, 'title' | 'category' | 'cost' | 'revenue'>
): RoiItem {
  const createdAt = values.createdAt || isoDate(-12)
  const cost = values.cost
  const revenue = values.revenue
  return {
    id,
    clubId: 'demo-club',
    title: values.title,
    category: values.category,
    cost,
    revenue,
    participants: values.participants ?? 0,
    periodStart: values.periodStart ?? dateOnly(-12),
    periodEnd: values.periodEnd ?? dateOnly(-10),
    status: values.status ?? 'DONE',
    notes: values.notes ?? null,
    roiRatio: cost === 0 ? null : (revenue - cost) / cost,
    createdBy: values.createdBy || 'demo-manager',
    createdAt,
    updatedAt: values.updatedAt || createdAt,
  }
}

export function createDemoSeed(): DemoState {
  const members = [
    newMember('demo-super', 'super_admin', '陈老师', '指导老师', 180),
    newMember('demo-manager', 'manager', '林老师', '社长', 120),
    newMember('demo-member', 'member', '周同学', '宣传部', 45),
    newMember('demo-member-2', 'member', '王同学', '技术部', 28),
  ]
  const memberName = (id: string) => members.find((m) => m.userId === id)?.displayName || null
  const now = isoDate()
  const earlier = isoDate(-4)

  return {
    version: STATE_VERSION,
    club: {
      id: 'demo-club',
      tenantId: 'demo-tenant',
      slug: 'rak-campus-demo',
      name: 'Rak 校园社团',
      logoUrl: null,
      description: '一起协作、记录成果与社团收支。',
      settingsJson: JSON.stringify({ memberDirectoryVisible: true }),
      createdAt: isoDate(-180),
      updatedAt: now,
    },
    members,
    currentUserId: 'demo-manager',
    tasks: [
      newTask('task-open-1', {
        title: '策划迎新招募活动',
        description: '完成招新活动方案、时间安排和现场分工。',
        category: 'ops',
        status: 'OPEN',
        acceptanceCriteria: '方案经社团负责人确认，包含预算和人员安排。',
      }),
      newTask('task-open-2', {
        title: '整理社团项目资料',
        description: '将本学期项目资料整理到共享目录并补齐索引。',
        category: 'content',
        status: 'OPEN',
      }),
      newTask('task-claimed', {
        title: '制作活动视觉初稿',
        description: '为秋季活动制作海报和社交媒体配图。',
        category: 'ai-image',
        status: 'CLAIMED',
        assigneeId: 'demo-member',
        assigneeName: memberName('demo-member'),
        claimedAt: earlier,
        createdAt: isoDate(-8),
      }),
      newTask('task-submitted', {
        title: '完成社团介绍短片',
        description: '剪辑一段 60 秒以内的社团介绍短片。',
        category: 'video-localize',
        status: 'SUBMITTED',
        assigneeId: 'demo-member-2',
        assigneeName: memberName('demo-member-2'),
        claimedAt: isoDate(-9),
        submittedAt: earlier,
        submitNote: '初版视频已放入共享目录，请验收字幕和片尾信息。',
        createdAt: isoDate(-10),
      }),
      newTask('task-approved', {
        title: '搭建活动报名页',
        description: '完成报名页面和移动端检查。',
        category: 'infra',
        status: 'APPROVED',
        assigneeId: 'demo-member',
        assigneeName: memberName('demo-member'),
        claimedAt: isoDate(-18),
        submittedAt: isoDate(-14),
        submitNote: '页面已发布并完成手机端检查。',
        approvedAt: isoDate(-13),
        qualityGrade: 'A',
        qualityNote: '交付完整，体验清晰。',
        createdAt: isoDate(-20),
      }),
      newTask('task-rejected', {
        title: '撰写活动复盘摘要',
        description: '整理活动数据、反馈和后续改进项。',
        category: 'content',
        status: 'REJECTED',
        assigneeId: 'demo-member-2',
        assigneeName: memberName('demo-member-2'),
        claimedAt: isoDate(-12),
        submittedAt: isoDate(-7),
        submitNote: '复盘摘要已提交。',
        rejectedAt: isoDate(-6),
        rejectReason: '请补充参与人数和活动成本数据。',
        createdAt: isoDate(-13),
      }),
    ],
    announcements: [
      newAnnouncement('announcement-pinned', {
        title: '本周社团例会安排',
        body: '本周五 18:30 在教学楼 302 开会，请各组提前准备本周进度。',
        status: 'PUBLISHED',
        pinned: true,
        publishedAt: now,
        createdAt: isoDate(-1),
      }),
      newAnnouncement('announcement-event', {
        title: '秋季招新活动报名开启',
        body: '招新活动报名已开启，请在周三前填写报名表。欢迎邀请感兴趣的同学参加。',
        status: 'PUBLISHED',
        publishedAt: earlier,
        createdAt: isoDate(-4),
      }),
      newAnnouncement('announcement-draft', {
        title: '社团开放日通知（草稿）',
        body: '开放日流程和地点待最终确认。',
        status: 'DRAFT',
        createdAt: isoDate(-2),
      }),
    ],
    roiItems: [
      newRoiItem('roi-workshop', {
        title: '校园创作工作坊',
        category: 'activity',
        cost: 680,
        revenue: 920,
        participants: 32,
        status: 'DONE',
        periodStart: dateOnly(-15),
        periodEnd: dateOnly(-14),
        createdAt: isoDate(-15),
        notes: '材料与场地支出；收入含报名和赞助。',
      }),
      newRoiItem('roi-website', {
        title: '社团作品集网站',
        category: 'project',
        cost: 420,
        revenue: 0,
        participants: 5,
        status: 'ACTIVE',
        periodStart: dateOnly(-2),
        periodEnd: null,
        createdAt: isoDate(-2),
        notes: '当前以建设投入为主。',
      }),
      newRoiItem('roi-spring', {
        title: '春季校园市集',
        category: 'activity',
        cost: 350,
        revenue: 760,
        participants: 48,
        status: 'DONE',
        periodStart: dateOnly(-95),
        periodEnd: dateOnly(-94),
        createdAt: isoDate(-95),
      }),
    ],
    sequence: 0,
  }
}

function isDemoState(value: unknown): value is DemoState {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<DemoState>
  return candidate.version === STATE_VERSION
    && !!candidate.club
    && Array.isArray(candidate.members)
    && Array.isArray(candidate.tasks)
    && Array.isArray(candidate.announcements)
    && Array.isArray(candidate.roiItems)
}

function paged<T>(items: T[], page = 0, size = 20): Paged<T> {
  const safePage = Math.max(0, Math.floor(page))
  const safeSize = Math.max(1, Math.min(100, Math.floor(size)))
  const start = safePage * safeSize
  return {
    items: items.slice(start, start + safeSize),
    page: safePage,
    size: safeSize,
    total: items.length,
  }
}

function dateInPeriod(value: string, period: RoiPeriod, now: Date): boolean {
  if (period === 'all') return true
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return false
  if (period === 'year') return date.getFullYear() === now.getFullYear()
  if (period === 'quarter') {
    return date.getFullYear() === now.getFullYear()
      && Math.floor(date.getMonth() / 3) === Math.floor(now.getMonth() / 3)
  }
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
}

function monthKey(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return '未知'
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export class DemoAdapter {
  private state: DemoState
  private readonly storage: DemoStorage

  constructor(storage: DemoStorage = new MemoryDemoStorage()) {
    this.storage = storage
    const raw = storage.getItem(STORAGE_KEY)
    let restored: unknown = null
    if (raw) {
      try {
        restored = JSON.parse(raw)
      } catch {
        restored = null
      }
    }
    if (isDemoState(restored)) this.state = restored
    else {
      this.state = createDemoSeed()
      this.persist()
    }
  }

  get snapshot(): DemoState {
    return clone(this.state)
  }

  get currentRole(): ClubRole | null {
    return this.currentMember()?.clubRole ?? null
  }

  reset(): DemoState {
    this.state = createDemoSeed()
    this.persist()
    return this.snapshot
  }

  login(): LoginOutcome {
    if (!this.currentMember()) this.state.currentUserId = 'demo-manager'
    this.persist()
    const identity = this.identity()
    return { bound: true, user: identity.user, club: identity.club }
  }

  logout(): void {
    this.state.currentUserId = null
    this.persist()
  }

  setCurrentRole(role: ClubRole): MeView {
    const member = this.state.members.find((item) => item.clubRole === role && item.status === 'ACTIVE')
    if (!member) throw this.error(404, 'member_not_found', `没有可用的 ${role} 演示成员`)
    this.state.currentUserId = member.userId
    this.persist()
    return this.me()
  }

  me(): MeView {
    const identity = this.identity()
    return {
      user: identity.user,
      club: identity.club,
      permissions: this.permissionsFor(identity.club.clubRole),
    }
  }

  fetchClub(): ClubInfo {
    this.requireMember()
    return clone(this.state.club)
  }

  updateClub(input: {
    name?: string
    description?: string
    logoUrl?: string
    settings?: Record<string, unknown>
  }): ClubInfo {
    this.requireManager()
    if (input.name !== undefined) this.state.club.name = input.name.trim()
    if (input.description !== undefined) this.state.club.description = input.description
    if (input.logoUrl !== undefined) this.state.club.logoUrl = input.logoUrl
    if (input.settings !== undefined) {
      this.state.club.settingsJson = JSON.stringify(input.settings)
    }
    this.state.club.updatedAt = new Date().toISOString()
    this.persist()
    return this.fetchClub()
  }

  fetchTasks(query: DemoTaskQuery = {}): Paged<Task> {
    this.requireMember()
    const statuses = query.status
      ? query.status.split(',').map((status) => status.trim()).filter(Boolean)
      : []
    const keyword = query.keyword?.trim().toLocaleLowerCase() || ''
    const filtered = this.state.tasks
      .filter((task) => !statuses.length || statuses.includes(task.status))
      .filter((task) => !query.category || task.category === query.category)
      .filter((task) => !query.assigneeId || task.assigneeId === query.assigneeId)
      .filter((task) => !keyword || `${task.title}\n${task.description}`.toLocaleLowerCase().includes(keyword))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return paged(filtered, query.page, query.size)
  }

  fetchTask(id: string): Task {
    this.requireMember()
    return clone(this.findTask(id))
  }

  publishTask(input: DemoPublishTaskInput): Task {
    this.requireManager()
    const title = input.title.trim()
    if (!title || title.length > 40) throw this.error(400, 'invalid_request', '任务标题必填且不超过 40 字')
    if (!input.description.trim()) throw this.error(400, 'invalid_request', '任务描述不能为空')
    const now = new Date().toISOString()
    const task = newTask(this.nextId('task'), {
      title,
      description: input.description.trim(),
      category: input.category as Task['category'],
      repo: input.repo || null,
      acceptanceCriteria: input.acceptanceCriteria || null,
      status: 'OPEN',
      createdBy: this.requireMember().userId,
      createdByName: this.requireMember().displayName,
      createdAt: now,
      updatedAt: now,
    })
    this.state.tasks.unshift(task)
    this.persist()
    return clone(task)
  }

  updateTask(id: string, input: DemoPublishTaskInput): Task {
    this.requireManager()
    const task = this.findTask(id)
    if (task.status !== 'OPEN') throw this.error(409, 'task_invalid_transition', '只有待认领任务可以编辑')
    const title = input.title.trim()
    if (!title || title.length > 40) throw this.error(400, 'invalid_request', '任务标题必填且不超过 40 字')
    task.title = title
    task.description = input.description.trim()
    task.category = input.category as Task['category']
    task.repo = input.repo || null
    task.acceptanceCriteria = input.acceptanceCriteria || null
    task.updatedAt = new Date().toISOString()
    this.persist()
    return clone(task)
  }

  claimTask(id: string): Task {
    const member = this.requireMember()
    const task = this.findTask(id)
    if (task.status !== 'OPEN') throw this.error(409, 'task_not_claimable', '任务已被认领或当前不可认领')
    task.status = 'CLAIMED'
    task.assigneeId = member.userId
    task.assigneeName = member.displayName
    task.claimedAt = new Date().toISOString()
    task.updatedAt = task.claimedAt
    this.persist()
    return clone(task)
  }

  submitTask(id: string, note: string, attachments: TaskSubmissionAttachment[] = []): Task {
    const member = this.requireMember()
    const task = this.findTask(id)
    if (task.assigneeId !== member.userId || !['CLAIMED', 'REJECTED'].includes(task.status)) {
      throw this.error(409, 'task_invalid_transition', '只能提交本人进行中或已驳回的任务')
    }
    if (!note.trim()) throw this.error(400, 'invalid_request', '请填写交付说明')
    const attachmentError = validateTaskAttachments(attachments)
    if (attachmentError) throw this.error(400, 'invalid_task_attachments', attachmentError)
    task.status = 'SUBMITTED'
    task.submitNote = note.trim()
    task.submissionAttachments = clone(attachments)
    task.submittedAt = new Date().toISOString()
    task.updatedAt = task.submittedAt
    this.persist()
    return clone(task)
  }

  approveTask(id: string, grade: QualityGrade, note = ''): Task {
    this.requireManager()
    const task = this.findTask(id)
    if (task.status !== 'SUBMITTED') throw this.error(409, 'task_invalid_transition', '只有待验收任务可以通过')
    task.status = 'APPROVED'
    task.qualityGrade = grade
    task.qualityNote = note.trim() || null
    task.approvedAt = new Date().toISOString()
    task.updatedAt = task.approvedAt
    this.persist()
    return clone(task)
  }

  rejectTask(id: string, reason: string): Task {
    this.requireManager()
    const task = this.findTask(id)
    if (task.status !== 'SUBMITTED') throw this.error(409, 'task_invalid_transition', '只有待验收任务可以驳回')
    if (!reason.trim()) throw this.error(400, 'invalid_request', '请填写驳回原因')
    task.status = 'REJECTED'
    task.rejectReason = reason.trim()
    task.rejectedAt = new Date().toISOString()
    task.updatedAt = task.rejectedAt
    this.persist()
    return clone(task)
  }

  archiveTask(id: string): Task {
    this.requireManager()
    const task = this.findTask(id)
    if (task.status !== 'APPROVED') throw this.error(409, 'task_invalid_transition', '只有已通过任务可以归档')
    task.status = 'DONE'
    task.updatedAt = new Date().toISOString()
    this.persist()
    return clone(task)
  }

  fetchMembers(): ClubMember[] {
    this.requireMember()
    return clone(this.state.members)
  }

  setMemberStatus(userId: string, status: string): ClubMember {
    this.requireManager()
    if (!['ACTIVE', 'LEFT', 'DISABLED'].includes(status)) {
      throw this.error(400, 'invalid_request', '成员状态无效')
    }
    const member = this.findMember(userId)
    if (member.clubRole === 'super_admin' && status !== 'ACTIVE') {
      throw this.error(409, 'invalid_request', '演示环境必须保留超级管理员')
    }
    member.status = status as ClubMember['status']
    member.updatedAt = new Date().toISOString()
    if (this.state.currentUserId === userId && member.status !== 'ACTIVE') {
      this.state.currentUserId = null
    }
    this.persist()
    return clone(member)
  }

  setMemberRole(userId: string, role: ClubRole): ClubMember {
    if (this.currentRole !== 'super_admin') {
      throw this.error(403, 'forbidden', '只有超级管理员可以调整成员角色')
    }
    if (role === 'super_admin') {
      throw this.error(400, 'invalid_request', '演示中不能将其他成员提升为超级管理员')
    }
    const member = this.findMember(userId)
    if (member.clubRole === 'super_admin') {
      throw this.error(409, 'invalid_request', '演示环境必须保留超级管理员')
    }
    member.clubRole = role
    member.updatedAt = new Date().toISOString()
    this.persist()
    return clone(member)
  }

  fetchAnnouncements(page = 0, size = 20): Paged<Announcement> {
    this.requireMember()
    const manager = this.isManager()
    const items = this.state.announcements
      .filter((item) => item.status !== 'ARCHIVED')
      .filter((item) => manager || item.status === 'PUBLISHED')
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt))
    return paged(items, page, size)
  }

  fetchAnnouncement(id: string): Announcement {
    this.requireMember()
    const item = this.state.announcements.find((announcement) => announcement.id === id)
    if (!item || (item.status !== 'PUBLISHED' && !this.isManager())) {
      throw this.error(404, 'not_found', '公告不存在')
    }
    return clone(item)
  }

  createAnnouncement(input: DemoAnnouncementInput): Announcement {
    this.requireManager()
    const title = input.title.trim()
    if (!title || title.length > 60 || !input.body.trim()) {
      throw this.error(400, 'invalid_request', '公告标题和正文必填，标题不超过 60 字')
    }
    const author = this.requireMember()
    const now = new Date().toISOString()
    const announcement = newAnnouncement(this.nextId('announcement'), {
      title,
      body: input.body,
      pinned: input.pinned,
      status: 'DRAFT',
      authorId: author.userId,
      authorName: author.displayName,
      createdAt: now,
      updatedAt: now,
    })
    this.state.announcements.unshift(announcement)
    this.persist()
    return clone(announcement)
  }

  updateAnnouncement(id: string, input: Partial<DemoAnnouncementInput>): Announcement {
    this.requireManager()
    const item = this.findAnnouncement(id)
    if (item.status === 'ARCHIVED') throw this.error(409, 'invalid_request', '已归档公告不能编辑')
    if (input.title !== undefined) {
      const title = input.title.trim()
      if (!title || title.length > 60) throw this.error(400, 'invalid_request', '公告标题必填且不超过 60 字')
      item.title = title
    }
    if (input.body !== undefined) {
      if (!input.body.trim()) throw this.error(400, 'invalid_request', '公告正文不能为空')
      item.body = input.body
    }
    if (input.pinned !== undefined) item.pinned = input.pinned
    item.updatedAt = new Date().toISOString()
    this.persist()
    return clone(item)
  }

  publishAnnouncement(id: string): Announcement {
    this.requireManager()
    const item = this.findAnnouncement(id)
    if (item.status === 'ARCHIVED') throw this.error(409, 'invalid_request', '已归档公告不能发布')
    item.status = 'PUBLISHED'
    item.publishedAt = new Date().toISOString()
    item.updatedAt = item.publishedAt
    this.persist()
    return clone(item)
  }

  archiveAnnouncement(id: string): Announcement {
    this.requireManager()
    const item = this.findAnnouncement(id)
    item.status = 'ARCHIVED'
    item.updatedAt = new Date().toISOString()
    this.persist()
    return clone(item)
  }

  fetchRoiItems(query: DemoRoiQuery = {}): Paged<RoiItem> {
    this.requireMember()
    const keyword = query.keyword?.trim().toLocaleLowerCase() || ''
    const items = this.state.roiItems
      .filter((item) => !query.status || item.status === query.status)
      .filter((item) => !query.category || item.category === query.category)
      .filter((item) => !keyword || `${item.title}\n${item.notes || ''}`.toLocaleLowerCase().includes(keyword))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return paged(items, query.page, query.size)
  }

  fetchRoiItem(id: string): RoiItem {
    this.requireMember()
    return clone(this.findRoiItem(id))
  }

  createRoiItem(input: RoiInput): RoiItem {
    this.requireManager()
    this.validateRoi(input)
    const member = this.requireMember()
    const now = new Date().toISOString()
    const item = newRoiItem(this.nextId('roi'), {
      ...input,
      title: input.title.trim(),
      createdBy: member.userId,
      createdAt: now,
      updatedAt: now,
    })
    this.state.roiItems.unshift(item)
    this.persist()
    return clone(item)
  }

  updateRoiItem(id: string, input: RoiInput): RoiItem {
    this.requireManager()
    this.validateRoi(input)
    const item = this.findRoiItem(id)
    item.title = input.title.trim()
    item.category = input.category
    item.cost = input.cost
    item.revenue = input.revenue
    item.participants = input.participants ?? 0
    item.periodStart = input.periodStart ?? null
    item.periodEnd = input.periodEnd ?? null
    item.status = input.status ?? item.status
    item.notes = input.notes ?? null
    item.roiRatio = item.cost === 0 ? null : (item.revenue - item.cost) / item.cost
    item.updatedAt = new Date().toISOString()
    this.persist()
    return clone(item)
  }

  deleteRoiItem(id: string): void {
    this.requireManager()
    const index = this.state.roiItems.findIndex((item) => item.id === id)
    if (index < 0) throw this.error(404, 'not_found', 'ROI 项目不存在')
    this.state.roiItems.splice(index, 1)
    this.persist()
  }

  fetchRoiOverview(period: RoiPeriod = 'month'): RoiOverview {
    this.requireMember()
    const now = new Date()
    const items = this.state.roiItems.filter((item) => dateInPeriod(item.periodStart || item.createdAt, period, now))
    const totalCost = items.reduce((sum, item) => sum + item.cost, 0)
    const totalRevenue = items.reduce((sum, item) => sum + item.revenue, 0)
    const buckets = new Map<string, { cost: number; revenue: number }>()
    for (const item of items) {
      const label = monthKey(item.periodStart || item.createdAt)
      const bucket = buckets.get(label) || { cost: 0, revenue: 0 }
      bucket.cost += item.cost
      bucket.revenue += item.revenue
      buckets.set(label, bucket)
    }
    const series = [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([label, values]) => ({ label, ...values }))
    return {
      period,
      totalCost,
      totalRevenue,
      net: totalRevenue - totalCost,
      roiRatio: totalCost === 0 ? null : (totalRevenue - totalCost) / totalCost,
      itemCount: items.length,
      series,
    }
  }

  fetchAllMemberPerformance(): MemberPerformance[] {
    this.requireManager()
    return this.state.members
      .filter((member) => member.status === 'ACTIVE')
      .map((member) => this.performanceFor(member))
      .sort((a, b) => b.compositeScore - a.compositeScore)
  }

  fetchMemberPerformance(userId: string): MemberPerformance | null {
    this.requireMember()
    const member = this.findMember(userId)
    if (member.userId !== this.requireMember().userId && !this.isManager()) {
      throw this.error(403, 'forbidden', '只能查看自己的绩效')
    }
    return this.performanceFor(member)
  }

  private identity(): { user: UserInfo; club: ClubBrief } {
    const member = this.requireMember()
    const user: UserInfo = {
      id: member.userId,
      displayName: member.displayName || '演示成员',
      email: null,
      status: member.status === 'ACTIVE' ? 'ACTIVE' : 'DISABLED',
      duty: member.duty,
    }
    return {
      user,
      club: {
        id: this.state.club.id,
        slug: this.state.club.slug,
        name: this.state.club.name,
        clubRole: member.clubRole,
      },
    }
  }

  private permissionsFor(role: ClubRole): string[] {
    const base = ['club:read', 'profile:read', 'task:claim', 'task:submit', 'performance:self', 'roi:read', 'announcement:read']
    if (role === 'member') return base
    return [
      ...base,
      'task:publish',
      'task:review',
      'roi:write',
      'announcement:write',
      'member:read',
      'performance:all',
      'invite:write',
      'join:read',
      'join:write',
      ...(role === 'super_admin' ? ['club:admin', 'member:write'] : []),
    ]
  }

  private performanceFor(member: ClubMember): MemberPerformance {
    const tasks = this.state.tasks.filter((task) => task.assigneeId === member.userId)
    const claimed = tasks.filter((task) => task.claimedAt !== null)
    const approved = tasks.filter((task) => ['APPROVED', 'DONE'].includes(task.status))
    const rated = approved.filter((task) => task.qualityGrade !== null)
    const scores: Record<QualityGrade, number> = { A: 90, B: 75, C: 60, D: 40 }
    const avgQualityScore = rated.length
      ? rated.reduce((sum, task) => sum + scores[task.qualityGrade as QualityGrade], 0) / rated.length
      : null
    const completionRate = claimed.length ? approved.length / claimed.length : 0
    return {
      userId: member.userId,
      displayName: member.displayName,
      duty: member.duty,
      role: member.clubRole,
      claimedCount: claimed.length,
      approvedCount: approved.length,
      rejectedCount: tasks.filter((task) => task.rejectedAt !== null).length,
      inProgressCount: tasks.filter((task) => ['CLAIMED', 'SUBMITTED', 'REJECTED'].includes(task.status)).length,
      completionRate,
      avgQualityScore,
      compositeScore: Math.round(completionRate * (avgQualityScore ?? 0)),
    }
  }

  private validateRoi(input: RoiInput): void {
    if (!input.title.trim()) throw this.error(400, 'invalid_request', '项目名称不能为空')
    if (!Number.isFinite(input.cost) || !Number.isFinite(input.revenue) || input.cost < 0 || input.revenue < 0) {
      throw this.error(400, 'roi_invalid_amount', '金额必须为非负数')
    }
    if ((input.participants ?? 0) < 0) throw this.error(400, 'invalid_request', '参与人数不能为负数')
  }

  private isManager(): boolean {
    return this.currentRole === 'manager' || this.currentRole === 'super_admin'
  }

  private requireManager(): ClubMember {
    const member = this.requireMember()
    if (member.clubRole !== 'manager' && member.clubRole !== 'super_admin') {
      throw this.error(403, 'forbidden', '当前演示角色没有管理权限')
    }
    return member
  }

  private requireMember(): ClubMember {
    const member = this.currentMember()
    if (!member) throw this.error(401, 'unauthorized', '请先进入本地演示模式')
    return member
  }

  private currentMember(): ClubMember | null {
    if (!this.state.currentUserId) return null
    return this.state.members.find((member) => member.userId === this.state.currentUserId && member.status === 'ACTIVE') || null
  }

  private findTask(id: string): Task {
    const task = this.state.tasks.find((item) => item.id === id)
    if (!task) throw this.error(404, 'not_found', '任务不存在')
    return task
  }

  private findMember(userId: string): ClubMember {
    const member = this.state.members.find((item) => item.userId === userId)
    if (!member) throw this.error(404, 'not_found', '成员不存在')
    return member
  }

  private findAnnouncement(id: string): Announcement {
    const announcement = this.state.announcements.find((item) => item.id === id)
    if (!announcement) throw this.error(404, 'not_found', '公告不存在')
    return announcement
  }

  private findRoiItem(id: string): RoiItem {
    const item = this.state.roiItems.find((roi) => roi.id === id)
    if (!item) throw this.error(404, 'not_found', 'ROI 项目不存在')
    return item
  }

  private nextId(prefix: string): string {
    this.state.sequence += 1
    return `${prefix}-demo-${this.state.sequence}`
  }

  private persist(): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state))
  }

  private error(status: number, code: string, message: string): DemoAdapterError {
    return new DemoAdapterError(status, code, message)
  }
}
