/** 云-v2 客户端 DTO（与 server/contracts/dtos.ts 投影一致）。 */

export type ClubRole = 'member' | 'manager' | 'super_admin'
export type MemberStatus = 'ACTIVE' | 'LEFT' | 'DISABLED'

export interface CloudAccount {
  accountKey: string
  securityState: 'NORMAL' | 'BLOCKED'
  setupRequired: boolean
}

export interface TeamListItemView {
  clubId: string
  name: string
  displayCode: string
  role: ClubRole
  status: MemberStatus
  canEnter: boolean
}

export interface TeamListPage {
  items: TeamListItemView[]
  nextCursor: string | null
  hasMore: boolean
  asOf: string
}

export interface TeamSessionView {
  club: { id: string; name: string; displayCode: string; status: 'ACTIVE' }
  member: {
    id: string
    displayName: string
    duty: string | null
    role: ClubRole
    status: 'ACTIVE'
    revision: number
  }
  permissions: string[]
  asOf: string
}

export interface JoinTargetResponse {
  clubId: string
  name: string
  displayCode: string
  joinTargetToken: string
  expiresAt: string
}

export interface RotateJoinLinkResponse {
  entryId: string
  maskedCode: string
  plaintextKey: string | null
  replayed: boolean
}

export interface JoinSubmitResponse {
  joinRequestId: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALREADY_MEMBER'
  replayed: boolean
}

export interface JoinStatusResponse {
  joinRequestId: string
  clubId: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  name: string
  reviewedAt: string | null
}

/** 本人入队申请（GLOBAL、账户级；M7）。 */
export interface JoinMineItem {
  joinRequestId: string
  clubId: string
  clubName: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  name: string
  reviewedAt: string | null
}

export interface JoinMinePage {
  items: JoinMineItem[]
  nextCursor: string | null
  hasMore: boolean
  asOf: string
}

/** 本队入队申请（TEAM、manager+；M7 审批）。不含他人 openid/appid/userId。 */
export interface JoinRequestView {
  joinRequestId: string
  clubId: string
  applicantName: string
  wechat: string
  reason: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  attemptNo: number
  createdAt: string
  reviewedAt: string | null
}

export interface JoinRequestPage {
  items: JoinRequestView[]
  nextCursor: string | null
  hasMore: boolean
  asOf: string
}

export interface JoinRequestResolveResponse {
  joinRequestId: string
  memberId: string
  created: boolean
}

export interface JoinRequestRejectResponse {
  joinRequestId: string
}

/** ===== 小程序内开通新团队（申请 → 本队管理员审批 → 建队）===== */

export type NewTeamApplicationStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

export interface NewTeamApplicationView {
  applicationId: string
  approvalClubId: string
  approvalClubName: string | null
  applicantMemberId: string
  applicantDisplayName: string
  name: string
  slug: string
  displayCode: string
  description: string | null
  status: NewTeamApplicationStatus
  revision: number
  createdAt: string
  decidedAt: string | null
  decidedByMemberId: string | null
  rejectReason: string | null
  newClubId: string | null
}

export interface NewTeamApplicationPage {
  items: NewTeamApplicationView[]
  nextCursor: string | null
  hasMore: boolean
  asOf: string
}

export interface SubmitNewTeamApplicationResult {
  applicationId: string
  status: NewTeamApplicationStatus
  replayed: boolean
}

export interface DecideNewTeamApplicationResult {
  applicationId: string
  status: NewTeamApplicationStatus
  newClubId: string | null
}

/** ===== 裁员（双人双角色审批）===== */

export type DismissalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'

export interface MemberDismissalView {
  dismissalId: string
  clubId: string
  targetMemberId: string
  targetDisplayName: string
  targetRole: ClubRole
  reason: string
  status: DismissalStatus
  requestedByMemberId: string
  requestedByDisplayName: string
  /** 申请人是否为该队首位超管：true 时只需本人第一阶段确认。 */
  requesterIsPrimaryOwner: boolean
  /** 当前待办阶段：FIRST（申请人本人）/ FINAL（另一位超管）/ DONE。 */
  currentStage: 'FIRST' | 'FINAL' | 'DONE'
  firstApprovedByMemberId: string | null
  firstApprovedAt: string | null
  finalApprovedByMemberId: string | null
  finalApprovedAt: string | null
  decidedAt: string | null
  rejectReason: string | null
  revision: number
  createdAt: string
  updatedAt: string
}

export interface MemberDismissalPage {
  items: MemberDismissalView[]
  nextCursor: string | null
  hasMore: boolean
  asOf: string
}

export interface ApproveDismissalResult {
  dismissalId: string
  status: DismissalStatus
  executed: boolean
  targetMemberId: string
}

/** ===== 团队解散 ===== */

export type DissolutionStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'

export interface ClubDissolutionView {
  clubId: string
  clubName: string
  requestedByMemberId: string
  requestedByDisplayName: string
  reason: string
  status: DissolutionStatus
  decidedByMemberId: string | null
  decidedAt: string | null
  rejectReason: string | null
  revision: number
  createdAt: string
  updatedAt: string
}

export interface ClubDissolutionPage {
  items: ClubDissolutionView[]
  nextCursor: string | null
  hasMore: boolean
  asOf: string
}

export interface DissolveClubResult {
  clubId: string
  status: 'DISSOLVED'
  affectedMemberCount: number
}

/** 超管跨队选择目标团队的最小目录项（仅名称/编码/状态，不含业务数据）。 */
export interface AdminClubSummary {
  clubId: string
  name: string
  displayCode: string
  status: 'ACTIVE' | 'MAINTENANCE' | 'DISSOLVED'
}

export interface AdminClubSearchPage {
  items: AdminClubSummary[]
  hasMore: boolean
}

export interface MemberView {
  memberId: string
  displayName: string
  duty: string | null
  role: ClubRole
  status: MemberStatus
  joinedAt: string | null
  revision: number
}

export interface MemberPage {
  items: MemberView[]
  nextCursor: string | null
  hasMore: boolean
  asOf: string
}

export interface InviteView {
  inviteId: string
  maskedCode: string
  maxUses: number
  usedCount: number
  expiresAt: string | null
  revokedAt: string | null
}

export interface CreateInviteResponse {
  inviteId: string
  maskedCode: string
  plaintextCode: string | null
  maxUses: number
  expiresAt: string
  replayed: boolean
}

export interface RedeemResponse {
  clubId: string
  memberId: string
  role: string
  status: 'ACTIVE' | 'ALREADY_MEMBER'
  replayed: boolean
}

/** ===== 任务 / 交付（M4）===== */

export type TaskStatus = 'OPEN' | 'CLAIMED' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'DONE'
export type SubmissionStatus = 'SUBMITTED' | 'APPROVED' | 'REJECTED'

export interface TaskView {
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
  createdByName: string | null
  assigneeName: string | null
  reviewedByName: string | null
  reviewedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface TaskPage {
  items: TaskView[]
  nextCursor: string | null
  hasMore: boolean
  asOf: string
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

export type CommandQueryStatus =
  | 'SUCCEEDED'
  | 'DETERMINISTIC_REJECTED'
  | 'ACCEPTED_JOB'
  | 'ABSENT_IN_WINDOW'
  | 'EXPIRED'

export interface CommandStatusResponse {
  status: CommandQueryStatus
  resultSummary: unknown
}

/** ===== 公告（M6）===== */

export type AnnouncementStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'

export interface AnnouncementView {
  announcementId: string
  clubId: string
  title: string
  body: string
  pinned: boolean
  status: AnnouncementStatus
  authorMemberId: string
  /** 同队作者展示名；成员缺失为 null。 */
  authorDisplayName: string | null
  publishedAt: string | null
  revision: number
  createdAt: string
  updatedAt: string
}

export interface AnnouncementPage {
  items: AnnouncementView[]
  nextCursor: string | null
  hasMore: boolean
  asOf: string
}

export interface AnnouncementSummary {
  announcementId: string
  title: string
  pinned: boolean
  publishedAt: string | null
  createdAt: string
}

/** ===== ROI（M6；金额为人民币分整数）===== */

export type RoiCategory = 'activity' | 'project' | 'other'
export type RoiStatus = 'PLANNING' | 'ACTIVE' | 'DONE' | 'CANCELLED'
export type RoiPeriod = 'month' | 'quarter' | 'year' | 'all'

export interface RoiItemView {
  roiId: string
  clubId: string
  title: string
  category: RoiCategory
  costCents: number
  revenueCents: number
  participants: number
  periodStart: string | null
  periodEnd: string | null
  accountingDate: string
  status: RoiStatus
  notes: string | null
  roiRatio: number | null
  createdByMemberId: string
  createdAt: string
  updatedAt: string
  revision: number
}

export interface RoiPage {
  items: RoiItemView[]
  nextCursor: string | null
  hasMore: boolean
  asOf: string
}

export interface RoiOverviewView {
  period: RoiPeriod
  /** 单位：人民币分（CNY_CENTS）。 */
  totalCost: number
  /** 单位：人民币分（CNY_CENTS）。 */
  totalRevenue: number
  /** 单位：人民币分（CNY_CENTS）。 */
  net: number
  roiRatio: number | null
  itemCount: number
  series: { label: string; cost: number; revenue: number }[]
  seriesWindow: 'last6'
  includesCancelled: true
  currencyUnit: 'CNY_CENTS'
  asOf: string
}

/** ===== 绩效（M6）===== */

export interface PerformanceView {
  memberId: string
  displayName: string
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

export interface PerformancePage {
  items: PerformanceView[]
  nextCursor: string | null
  hasMore: boolean
  asOf: string
}

/** ===== 社团设置与显式摘要（M6）===== */

export type ClubStatus = 'ACTIVE' | 'MAINTENANCE' | 'DISSOLVED'

export interface CloudClubView {
  clubId: string
  name: string
  slug: string
  displayCode: string
  status: ClubStatus
  description: string | null
  logoUrl: string | null
  settings: Record<string, unknown>
  revision: number
  createdAt: string
  updatedAt: string
}

export interface CloudClubDashboardView {
  clubId: string
  activeMemberCount: number
  openTaskCount: number
  myInProgressCount: number
  mySubmittedCount: number
  latestPublishedAnnouncements: AnnouncementSummary[]
  pendingReviewCount?: number
  topPerformers?: PerformanceView[]
  asOf: string
}

export interface CloudProfileSummaryView {
  clubId: string
  memberId: string
  taskCounts: {
    claimed: number
    approved: number
    rejected: number
    inProgress: number
  }
  performance: PerformanceView
  asOf: string
}
