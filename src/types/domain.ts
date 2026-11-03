/**
 * 领域类型 —— 与 rak-auth docs/API.md §6/§7 契约一一对应（camelCase）。
 * 改字段必须先改 API.md（生态宪法 §2）。
 */

export type ClubRole = 'super_admin' | 'manager' | 'member'

export type ThemeMode = 'light' | 'dark'

/** ===== 认证（API.md §6） ===== */
export interface UserInfo {
  id: string
  displayName: string
  email: string | null
  status: 'ACTIVE' | 'DISABLED'
  duty?: string | null
}

export interface ClubBrief {
  id: string
  slug: string
  name: string
  clubRole: ClubRole
}

export interface LoginOutcome {
  bound: boolean
  accessToken?: string
  expiresIn?: number
  user?: UserInfo
  club?: ClubBrief
}

export interface MeView {
  user: UserInfo
  club: ClubBrief
  permissions: string[]
}

export type JoinStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED'

export interface JoinStatusView {
  status: JoinStatus
  reviewedAt: string | null
  clubName: string | null
}

/** ===== 社团（API.md §7.6） ===== */
export interface ClubInfo {
  id: string
  tenantId: string
  slug: string
  name: string
  logoUrl: string | null
  description: string | null
  settingsJson: string
  createdAt: string
  updatedAt: string
}

export interface ClubMember {
  id: string
  clubId: string
  userId: string
  clubRole: ClubRole
  displayName: string | null
  duty: string | null
  status: 'ACTIVE' | 'LEFT' | 'DISABLED'
  joinedAt: string
  updatedAt: string
  /** cloud：成员记录版本，供写操作带 expectedRevision（legacy 无此字段） */
  revision?: number
}

/** ===== 任务池（API.md §7.1/§7.2） ===== */
export type TaskStatus =
  | 'OPEN'
  | 'CLAIMED'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'DONE'

export type TaskCategory =
  | 'cross-dashboard'
  | 'content'
  | 'ai-image'
  | 'video-localize'
  | 'infra'
  | 'ops'

export type QualityGrade = 'A' | 'B' | 'C' | 'D'

/** 演示模式下保存在本机的交付附件；Rak API 当前没有附件字段。 */
export interface TaskSubmissionAttachment {
  id: string
  name: string
  size: number
  localPath: string
}

export interface Task {
  id: string
  clubId: string
  title: string
  description: string
  category: TaskCategory
  repo: string | null
  acceptanceCriteria: string | null
  status: TaskStatus
  assigneeId: string | null
  assigneeName: string | null
  claimedAt: string | null
  submittedAt: string | null
  submitNote: string | null
  submissionAttachments?: TaskSubmissionAttachment[]
  approvedAt: string | null
  qualityGrade: QualityGrade | null
  qualityNote: string | null
  rejectedAt: string | null
  rejectReason: string | null
  /** 最新一轮验收人展示名（云端详情提供；演示/legacy 可能为空）。 */
  reviewedByName?: string | null
  createdBy: string
  createdByName: string | null
  createdAt: string
  updatedAt: string
  /** 云端任务乐观并发版本；legacy 后端可能不提供。 */
  revision?: number
}

export interface TaskQuery {
  status?: string // 逗号分隔多值
  category?: string
  keyword?: string
  assigneeId?: string
  page?: number
  size?: number
}

export interface MemberPerformance {
  userId: string
  displayName: string | null
  duty: string | null
  role: ClubRole
  claimedCount: number
  approvedCount: number
  rejectedCount: number
  inProgressCount: number
  completionRate: number
  avgQualityScore: number | null
  compositeScore: number
}

/** ===== ROI（API.md §7.3） ===== */
export type RoiCategory = 'activity' | 'project' | 'other'
export type RoiStatus = 'PLANNING' | 'ACTIVE' | 'DONE' | 'CANCELLED'

export interface RoiItem {
  id: string
  clubId: string
  title: string
  category: RoiCategory
  cost: number
  revenue: number
  participants: number
  periodStart: string | null
  periodEnd: string | null
  status: RoiStatus
  notes: string | null
  roiRatio: number | null
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface RoiInput {
  title: string
  category: RoiCategory
  cost: number
  revenue: number
  participants?: number
  periodStart?: string | null
  periodEnd?: string | null
  status?: RoiStatus
  notes?: string | null
}

export type RoiPeriod = 'month' | 'quarter' | 'year' | 'all'

export interface RoiOverview {
  period: RoiPeriod
  totalCost: number
  totalRevenue: number
  net: number
  roiRatio: number | null
  itemCount: number
  series: { label: string; cost: number; revenue: number }[]
}

/** ===== 公告（API.md §7.4） ===== */
export interface Announcement {
  id: string
  clubId: string
  title: string
  body: string
  pinned: boolean
  authorId: string
  authorName: string | null
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
  publishedAt: string | null
  createdAt: string
  updatedAt: string
  /** cloud：公告记录版本，供写操作带 expectedRevision（legacy 无此字段） */
  revision?: number
}

/** ===== 邀请码（API.md §7.6） ===== */
export interface InviteCode {
  id: string
  clubId: string
  code: string
  createdBy: string
  maxUses: number
  usedCount: number
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string
}

/** ===== 入队申请（API.md §7.5） ===== */
export interface JoinRequest {
  id: string
  clubId: string
  applicantName: string
  applicantWechat: string
  reason: string
  appid: string
  openid: string
  userId: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  reviewedBy: string | null
  reviewedAt: string | null
  createdAt: string
}

/** ===== 分页（API.md §7 通用约定） ===== */
export interface Paged<T> {
  items: T[]
  page: number
  size: number
  total: number
}

export const TASK_CATEGORY_LABEL: Record<TaskCategory, string> = {
  'cross-dashboard': '跨境情报',
  content: '内容创作',
  'ai-image': 'AI 作图',
  'video-localize': '视频本地化',
  infra: '基础设施',
  ops: '运营品牌',
}

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  OPEN: '待认领',
  CLAIMED: '进行中',
  SUBMITTED: '待验收',
  APPROVED: '已通过',
  REJECTED: '已驳回',
  DONE: '已归档',
}

export const ROI_CATEGORY_LABEL: Record<RoiCategory, string> = {
  activity: '活动',
  project: '项目',
  other: '其他',
}

export const ROI_STATUS_LABEL: Record<RoiStatus, string> = {
  PLANNING: '规划中',
  ACTIVE: '进行中',
  DONE: '已完成',
  CANCELLED: '已取消',
}

/** API ProblemDetail（RFC7807 + code，契约 §2） */
export interface ProblemDetail {
  type?: string
  title?: string
  status: number
  detail?: string
  code?: string
}
