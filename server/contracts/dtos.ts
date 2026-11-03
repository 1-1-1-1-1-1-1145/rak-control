/**
 * 云-v2 DTO（多团队 DESIGN §5、§6）。
 *
 * 关键约束：
 * - 全局账户 DTO 不含任何团队角色/姓名/职务。
 * - 业务参与者一律用 memberId 引用，不把 memberId 硬塞旧 userId 字段。
 * - 对外不泄露他人全局 userId/openid/其他队关系。
 */

export type ClubRole = 'member' | 'manager' | 'super_admin'
export type MemberStatus = 'ACTIVE' | 'LEFT' | 'DISABLED'
export type ClubStatus = 'ACTIVE' | 'MAINTENANCE' | 'DISSOLVED'
export type AccountSecurityState = 'NORMAL' | 'BLOCKED'

/** 本人账户最小视图（GLOBAL）。accountKey 为不透明内部标识。 */
export interface AccountView {
  backend: 'cloud'
  env: string
  appId: string
  accountKey: string
  securityState: AccountSecurityState
  asOf: string
}

/** 本队会话（TEAM）。切队安装完整会话；权限仅帮助 UI 渲染，服务端每次重新鉴权。 */
export interface TeamSession {
  club: {
    id: string
    name: string
    displayCode: string
    status: 'ACTIVE'
  }
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

/** team.listMine 单行：仅最小队摘要，不含各队业务统计。 */
export interface TeamListItem {
  clubId: string
  name: string
  displayCode: string
  role: ClubRole
  status: MemberStatus
  canEnter: boolean
}

/** 入队申请入口解析结果（GLOBAL，team.resolveJoinTarget）。 */
export interface JoinTargetView {
  clubId: string
  name: string
  displayCode: string
  joinTargetToken: string
  expiresAt: string
}

/** 通用分页契约：cursor 绑定 scope/action/查询指纹，禁止填入旧 page 字段。 */
export interface Page<T> {
  items: T[]
  nextCursor: string | null
  hasMore: boolean
  asOf: string
}

/** 本人入队申请（GLOBAL、账户级；M7 的"仅待审"落点）。只含本人最小字段。 */
export interface JoinMineItem {
  joinRequestId: string
  clubId: string
  clubName: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  name: string
  reviewedAt: string | null
}

/**
 * 入队申请（TEAM、manager+；M7 审批）。
 * 只含**本队申请**的最小字段：不含他人 openid/appid/userId（全局身份不外泄）。
 */
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

export type JoinRequestPage = Page<JoinRequestView>

/** ===== 小程序内开通新团队（申请 → 本队管理员审批 → 建队，2026-10-18）===== */

export type NewTeamApplicationStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

/**
 * 开通申请视图（本队待审 / 本人申请共用）。
 *
 * 不暴露申请人全局 userId/openid：本队审批只需同队展示名与 memberId。
 * `approvalClubName` 仅用于本人跨队列表辨识审批团队。
 */
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
  /** 审批通过后创建的新团队 ID；未通过为 null。 */
  newClubId: string | null
}

export type NewTeamApplicationPage = Page<NewTeamApplicationView>

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

/** ===== 裁员（双人双角色审批，2026-10-18）===== */

export type DismissalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'

/**
 * 裁员申请视图（TEAM、manager+）。
 *
 * 审批规则（2026-10-18 第二次裁决）：
 * - **首位超管**（`clubs.ownerMemberId`）发起的申请：本人第一阶段确认即完成并执行；
 * - 其他人（manager / 非首位 super_admin）发起的申请：
 *   ① 申请人本人完成第一阶段；② 由**另一位** super_admin 完成最终审批；两阶段齐才执行。
 * - 禁止同一人完成全部审批（首位超管单节点除外）。
 * 不暴露目标/审批人的全局 userId/openid。
 */
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

export type MemberDismissalPage = Page<MemberDismissalView>

export interface ApproveDismissalResult {
  dismissalId: string
  status: DismissalStatus
  /** 本次审批是否已集齐两个节点并完成裁员。 */
  executed: boolean
  targetMemberId: string
}

/** ===== 团队解散（2026-10-18）===== */

export type DissolutionStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'

/** 协助解散申请（管理员无法执行时提交，由任一 super_admin 处理）。 */
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

export type ClubDissolutionPage = Page<ClubDissolutionView>

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
  status: ClubStatus
}

export interface AdminClubSearchPage {
  items: AdminClubSummary[]
  hasMore: boolean
}

/** ===== 公告（M6，DESIGN §M6、BASE-DESIGN §9.2）===== */
export type AnnouncementStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'

export interface AnnouncementView {
  announcementId: string
  clubId: string
  title: string
  body: string
  pinned: boolean
  status: AnnouncementStatus
  authorMemberId: string
  /** 同队作者的展示名（仅本队范围；不泄露全局 userId/openid）；成员缺失时为 null。 */
  authorDisplayName: string | null
  publishedAt: string | null
  revision: number
  createdAt: string
  updatedAt: string
}

/** 公告最小摘要（首页/dashboard），不含正文。 */
export interface AnnouncementSummary {
  announcementId: string
  title: string
  pinned: boolean
  publishedAt: string | null
  createdAt: string
}

/** ===== ROI（M6，BASE-DESIGN §10.1）===== */
export type RoiCategory = 'activity' | 'project' | 'other'
export type RoiStatus = 'PLANNING' | 'ACTIVE' | 'DONE' | 'CANCELLED'

export interface RoiItemView {
  roiId: string
  clubId: string
  title: string
  category: RoiCategory
  /** 人民币分，整数。 */
  costCents: number
  /** 人民币分，整数。 */
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

export interface RoiOverviewView {
  period: 'month' | 'quarter' | 'year' | 'all'
  /** 单位：人民币分（CNY_CENTS），整数。 */
  totalCost: number
  /** 单位：人民币分（CNY_CENTS），整数。 */
  totalRevenue: number
  /** 单位：人民币分（CNY_CENTS），整数。 */
  net: number
  roiRatio: number | null
  itemCount: number
  series: { label: string; cost: number; revenue: number }[]
  seriesWindow: 'last6'
  includesCancelled: true
  currencyUnit: 'CNY_CENTS'
  asOf: string
}

/** ===== 绩效（M6，BASE-DESIGN §10.2）===== */
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

/** ===== 社团设置与显式摘要（M6，BASE-DESIGN §10.3）===== */
export interface ClubView {
  clubId: string
  name: string
  slug: string
  displayCode: string
  status: ClubStatus
  /** 本队展示信息（白名单可写字段；不含 legacy tenantId）。 */
  description: string | null
  logoUrl: string | null
  settings: Record<string, unknown>
  revision: number
  createdAt: string
  updatedAt: string
}

export interface ClubDashboardView {
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

export interface ProfileSummaryView {
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
