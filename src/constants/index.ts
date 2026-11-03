export const APP_NAME = 'Rak'

export const STORAGE_PREFIX = 'rak-control:v2:'

export const STORAGE_KEYS = {
  accessToken: `${STORAGE_PREFIX}access_token`,
  theme: `${STORAGE_PREFIX}theme`,
  /** 客户端最小命令指针（scope/action/mutationId，不含 payload） */
  pendingCommands: `${STORAGE_PREFIX}pending_commands`,
} as const

export const API_BASE = __RAK_API_BASE__
export const DEMO_MODE = __RAK_DEMO_MODE__

/** 后端模式：demo | cloud | http（多团队 DESIGN §4.3） */
export const BACKEND = __RAK_BACKEND__
/** cloud 模式的云环境 ID（仅 cloud 构建非空） */
export const CLOUD_ENV = __RAK_CLOUD_ENV__

/** 微信小程序认证面（API.md §6） */
export const WECHAT_UI_BASE = '/api/ui/wechat/miniprogram'

/** club 业务面（API.md §7）；clubBase() 需登录后取 clubId */
export const CLUB_API_BASE = '/api/v1/clubs'

export const ROUTES = {
  index: '/pages/index/index',
  login: '/pages/auth/login',
  joinStatus: '/pages/auth/join-status',
  taskPool: '/pages/task/pool',
  taskDetail: '/pages/task/detail',
  roiOverview: '/pages/roi/overview',
  roiList: '/pages/roi/list',
  roiDetail: '/pages/roi/detail',
  clubHome: '/pages/club/home',
  announcements: '/pages/club/announcement-list',
  announcementDetail: '/pages/club/announcement-detail',
  members: '/pages/club/members',
  profile: '/pages/me/profile',
  myTasks: '/pages/me/tasks',
  myPerformance: '/pages/me/performance',
  settings: '/pages/me/settings',
  /** 多团队：选队/入队/入队状态/本队资料/账户（M7） */
  teamSelect: '/pages/me/team-select',
  teamJoin: '/pages/me/team-join',
  teamJoinStatus: '/pages/me/team-join-status',
  teamProfile: '/pages/me/team-profile',
  /** 小程序内开通新团队（申请 → 本队管理员审批 → 建队） */
  newTeam: '/pages/me/new-team',
  newTeamApplications: '/pages/me/new-team-applications',
  account: '/pages/me/account',
  adminHome: '/subpackage-admin/pages/admin/home',
  adminTaskPublish: '/subpackage-admin/pages/admin/task-publish',
  adminReview: '/subpackage-admin/pages/admin/review',
  adminRoiEdit: '/subpackage-admin/pages/admin/roi-edit',
  adminAnnouncements: '/subpackage-admin/pages/admin/announcements',
  adminMembers: '/subpackage-admin/pages/admin/members',
  adminJoinRequests: '/subpackage-admin/pages/admin/join-requests',
  adminDismissals: '/subpackage-admin/pages/admin/dismissals',
  adminDissolutions: '/subpackage-admin/pages/admin/dissolutions',
  adminInvites: '/subpackage-admin/pages/admin/invites',
  adminClubSettings: '/subpackage-admin/pages/admin/club-settings',
  superRoles: '/subpackage-admin/pages/super/roles',
} as const

/** 任务发布表单的可选项（UI 常量，非契约） */
export const REPO_OPTIONS = [
  'rak-runtime',
  'rak-flowmind',
  'cross-dashboard',
  'Xra-space',
] as const
