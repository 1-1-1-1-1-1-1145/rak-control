/**
 * 动作注册表（多团队 DESIGN §6.2）。
 *
 * 每个 action 声明：部署函数（api/files）与允许的 scope 种类。
 * - 'GLOBAL'：账户级动作，不得带 clubId。
 * - 'TEAM'：必须提供 clubId（clubId 是选择器，**不授予**权限）。
 * - 'EITHER'：仅 command.status（scope 必须与原命令完全相同）。
 *
 * 未注册 action 一律拒绝（无默认泛 CRUD）。
 */

export type ScopeRequirement = 'GLOBAL' | 'TEAM' | 'EITHER'
export type FunctionName = 'api' | 'files'

export interface ActionSpec {
  fn: FunctionName
  scope: ScopeRequirement
}

export const ACTION_REGISTRY = {
  // ===== 身份（GLOBAL）=====
  'auth.bootstrap': { fn: 'api', scope: 'GLOBAL' },
  'auth.me': { fn: 'api', scope: 'GLOBAL' },
  'account.provisioningReference': { fn: 'api', scope: 'GLOBAL' },

  // ===== 团队（GLOBAL 列表 / TEAM 进入）=====
  'team.listMine': { fn: 'api', scope: 'GLOBAL' },
  'team.enter': { fn: 'api', scope: 'TEAM' },
  'team.resolveJoinTarget': { fn: 'api', scope: 'GLOBAL' },
  'team.joinLink.rotate': { fn: 'api', scope: 'TEAM' },

  // ===== 开通新团队（2026-10-18）：成员申请 → 本队管理员/超管审批 → 建队 =====
  // submit/list/approve/reject 用 TEAM scope：clubId = **审批团队**（发起人当前所在队），
  // 天然保证 A 队管理员看不到/不能审批 B 队的申请。
  'team.newApplication.submit': { fn: 'api', scope: 'TEAM' },
  'team.newApplication.list': { fn: 'api', scope: 'TEAM' },
  'team.newApplication.approve': { fn: 'api', scope: 'TEAM' },
  'team.newApplication.reject': { fn: 'api', scope: 'TEAM' },
  /** 本人申请（跨队、账户级只读）。 */
  'team.newApplication.mine': { fn: 'api', scope: 'GLOBAL' },

  // ===== 入会 / 邀请（GLOBAL）=====
  'join.mine': { fn: 'api', scope: 'GLOBAL' },
  'join.status': { fn: 'api', scope: 'GLOBAL' },
  'join.submit': { fn: 'api', scope: 'GLOBAL' },
  'invite.redeem': { fn: 'api', scope: 'GLOBAL' },

  // ===== 命令结果（与原命令同 scope）=====
  'command.status': { fn: 'api', scope: 'EITHER' },

  // ===== 成员 / 资料（TEAM）=====
  'member.updateMyProfile': { fn: 'api', scope: 'TEAM' },
  'member.updateProfile': { fn: 'api', scope: 'TEAM' },
  'member.list': { fn: 'api', scope: 'TEAM' },
  'member.setRole': { fn: 'api', scope: 'TEAM' },
  'member.setStatus': { fn: 'api', scope: 'TEAM' },

  // ===== 裁员（2026-10-18）：双人双角色审批 → LEFT =====
  'member.dismissal.request': { fn: 'api', scope: 'TEAM' },
  'member.dismissal.list': { fn: 'api', scope: 'TEAM' },
  'member.dismissal.approve': { fn: 'api', scope: 'TEAM' },
  'member.dismissal.reject': { fn: 'api', scope: 'TEAM' },

  // ===== 团队解散（2026-10-18）：本队直接 / 协助申请 / 超管跨队 =====
  'club.dissolve': { fn: 'api', scope: 'TEAM' },
  'club.dissolution.request': { fn: 'api', scope: 'TEAM' },
  'club.dissolution.list': { fn: 'api', scope: 'GLOBAL' },
  'club.dissolution.decide': { fn: 'api', scope: 'GLOBAL' },
  'club.dissolveAny': { fn: 'api', scope: 'GLOBAL' },
  'club.searchForAdmin': { fn: 'api', scope: 'GLOBAL' },

  // ===== 审核入会（TEAM）=====
  'join.list': { fn: 'api', scope: 'TEAM' },
  'join.approve': { fn: 'api', scope: 'TEAM' },
  'join.reject': { fn: 'api', scope: 'TEAM' },

  // ===== 邀请（TEAM）=====
  'invite.list': { fn: 'api', scope: 'TEAM' },
  'invite.create': { fn: 'api', scope: 'TEAM' },
  'invite.revoke': { fn: 'api', scope: 'TEAM' },
  'invite.qr': { fn: 'api', scope: 'TEAM' },

  // ===== 社团 / 摘要（TEAM）=====
  'club.get': { fn: 'api', scope: 'TEAM' },
  'club.update': { fn: 'api', scope: 'TEAM' },
  'club.dashboard': { fn: 'api', scope: 'TEAM' },
  'profile.summary': { fn: 'api', scope: 'TEAM' },

  // ===== 任务 / 交付（TEAM）=====
  'task.list': { fn: 'api', scope: 'TEAM' },
  'task.get': { fn: 'api', scope: 'TEAM' },
  'task.create': { fn: 'api', scope: 'TEAM' },
  'task.update': { fn: 'api', scope: 'TEAM' },
  'task.claim': { fn: 'api', scope: 'TEAM' },
  'task.submit': { fn: 'api', scope: 'TEAM' },
  'task.approve': { fn: 'api', scope: 'TEAM' },
  'task.reject': { fn: 'api', scope: 'TEAM' },
  'task.archive': { fn: 'api', scope: 'TEAM' },
  'submission.list': { fn: 'api', scope: 'TEAM' },
  'submission.get': { fn: 'api', scope: 'TEAM' },

  // ===== 公告（TEAM）=====
  'announcement.list': { fn: 'api', scope: 'TEAM' },
  'announcement.get': { fn: 'api', scope: 'TEAM' },
  'announcement.create': { fn: 'api', scope: 'TEAM' },
  'announcement.update': { fn: 'api', scope: 'TEAM' },
  'announcement.publish': { fn: 'api', scope: 'TEAM' },
  'announcement.archive': { fn: 'api', scope: 'TEAM' },

  // ===== ROI（TEAM）=====
  'roi.list': { fn: 'api', scope: 'TEAM' },
  'roi.get': { fn: 'api', scope: 'TEAM' },
  'roi.create': { fn: 'api', scope: 'TEAM' },
  'roi.update': { fn: 'api', scope: 'TEAM' },
  'roi.delete': { fn: 'api', scope: 'TEAM' },
  'roi.overview': { fn: 'api', scope: 'TEAM' },

  // ===== 绩效（TEAM）=====
  'performance.mine': { fn: 'api', scope: 'TEAM' },
  'performance.list': { fn: 'api', scope: 'TEAM' },

  // ===== 私有文件（files）=====
  'file.init': { fn: 'files', scope: 'TEAM' },
  'file.status': { fn: 'files', scope: 'TEAM' },
  'file.confirm': { fn: 'files', scope: 'TEAM' },
  'file.cancel': { fn: 'files', scope: 'TEAM' },
  'file.downloadUrls': { fn: 'files', scope: 'TEAM' },
  'file.previewDraft': { fn: 'files', scope: 'TEAM' },
  'file.putChunk': { fn: 'files', scope: 'TEAM' },
} as const satisfies Record<string, ActionSpec>

export type ActionName = keyof typeof ACTION_REGISTRY

export const ACTION_NAMES = Object.keys(ACTION_REGISTRY) as ActionName[]

export function lookupAction(action: string): ActionSpec | null {
  if (!Object.prototype.hasOwnProperty.call(ACTION_REGISTRY, action)) return null
  return (ACTION_REGISTRY as Record<string, ActionSpec>)[action]
}

/** 按部署函数筛出该函数负责的 action 名单（供入口分发与文档/校验使用）。 */
export function actionsFor(fn: FunctionName): ActionName[] {
  return ACTION_NAMES.filter((name) => ACTION_REGISTRY[name].fn === fn)
}

/**
 * 明确输入字段的 action schema（DESIGN §6.2 显式列出者）。
 *
 * 未在此声明的动作，仍受信封层的归属字段拒绝规则约束；其字段级校验在各模块
 * 实现（M3–M6）时补充。要点：`member.setRole` 只接受 `targetRole`、
 * `member.setStatus` 只接受 `targetStatus`，不接受含混的 `role`/`status`。
 */
export interface ActionDataSchema {
  /** data 顶层允许的键；出现其他键即拒绝。 */
  allowed: readonly string[]
  /** 必填键。 */
  required?: readonly string[]
  /** 互斥键：至多出现其一。 */
  mutex?: readonly string[]
}

export const ACTION_DATA_SCHEMAS: Record<string, ActionDataSchema> = {
  'account.provisioningReference': { allowed: ['replaceConsumed'] },
  'team.enter': { allowed: ['switchAttemptId'] },
  'team.resolveJoinTarget': { allowed: ['joinKey'], required: ['joinKey'] },
  'team.joinLink.rotate': { allowed: [] },
  'team.newApplication.submit': {
    allowed: ['name', 'slug', 'displayCode', 'description'],
    required: ['name', 'slug', 'displayCode'],
  },
  'team.newApplication.mine': { allowed: ['cursor', 'pageSize'] },
  'team.newApplication.list': { allowed: ['status', 'cursor', 'pageSize'] },
  'team.newApplication.approve': { allowed: ['applicationId'], required: ['applicationId'] },
  'team.newApplication.reject': {
    allowed: ['applicationId', 'rejectReason'],
    required: ['applicationId', 'rejectReason'],
  },
  'join.mine': { allowed: ['cursor', 'pageSize'] },
  'join.status': { allowed: ['joinRequestId'], required: ['joinRequestId'] },
  'join.submit': {
    allowed: ['joinTargetToken', 'name', 'wechat', 'reason'],
    required: ['joinTargetToken', 'name', 'wechat', 'reason'],
  },
  'invite.redeem': {
    allowed: ['code', 'sceneToken', 'displayName'],
    required: ['displayName'],
    mutex: ['code', 'sceneToken'],
  },
  'command.status': { allowed: ['action', 'mutationId'], required: ['action', 'mutationId'] },
  'member.updateMyProfile': { allowed: ['displayName', 'duty'], required: ['displayName'] },
  'member.updateProfile': { allowed: ['targetMemberId', 'duty', 'displayName'], required: ['targetMemberId'] },
  'member.setRole': { allowed: ['targetMemberId', 'targetRole'], required: ['targetMemberId', 'targetRole'] },
  'member.setStatus': { allowed: ['targetMemberId', 'targetStatus'], required: ['targetMemberId', 'targetStatus'] },

  // ===== 裁员（2026-10-18）=====
  'member.dismissal.request': { allowed: ['targetMemberId', 'reason'], required: ['targetMemberId', 'reason'] },
  'member.dismissal.list': { allowed: ['status', 'cursor', 'pageSize'] },
  'member.dismissal.approve': { allowed: ['dismissalId'], required: ['dismissalId'] },
  'member.dismissal.reject': { allowed: ['dismissalId', 'rejectReason'], required: ['dismissalId', 'rejectReason'] },

  // ===== 团队解散（2026-10-18）=====
  'club.dissolve': { allowed: ['reason'], required: ['reason'] },
  'club.dissolution.request': { allowed: ['reason'], required: ['reason'] },
  'club.dissolution.list': { allowed: ['status', 'cursor', 'pageSize'] },
  'club.dissolution.decide': {
    allowed: ['targetClubId', 'approve', 'rejectReason'],
    required: ['targetClubId', 'approve'],
  },
  'club.dissolveAny': { allowed: ['targetClubId', 'reason'], required: ['targetClubId', 'reason'] },
  'club.searchForAdmin': { allowed: ['keyword'], required: ['keyword'] },
  'join.approve': { allowed: ['joinRequestId'], required: ['joinRequestId'] },
  'join.reject': { allowed: ['joinRequestId', 'rejectReason'], required: ['joinRequestId', 'rejectReason'] },
  'join.list': { allowed: ['status', 'cursor', 'pageSize'] },
  'invite.create': { allowed: ['maxUses', 'expiresInDays'] },
  'invite.revoke': { allowed: ['inviteId'], required: ['inviteId'] },
  'invite.qr': { allowed: ['inviteId'], required: ['inviteId'] },
  'file.init': {
    allowed: ['taskId', 'expectedTaskRevision', 'name', 'declaredSize'],
    required: ['taskId', 'expectedTaskRevision', 'name', 'declaredSize'],
  },
  'file.status': { allowed: ['sessionId'], required: ['sessionId'] },
  'file.confirm': { allowed: ['sessionId'], required: ['sessionId'] },
  'file.cancel': { allowed: ['sessionId'], required: ['sessionId'] },
  'file.downloadUrls': { allowed: ['attachmentIds'], required: ['attachmentIds'] },
  'file.previewDraft': { allowed: ['attachmentId'], required: ['attachmentId'] },
  'file.putChunk': {
    allowed: ['sessionId', 'index', 'base64', 'chunkHashHint'],
    required: ['sessionId', 'index', 'base64'],
  },

  // ===== 公告（M6，TEAM）=====
  'announcement.list': { allowed: ['status', 'cursor', 'pageSize'] },
  'announcement.get': { allowed: ['announcementId'], required: ['announcementId'] },
  'announcement.create': { allowed: ['title', 'body', 'pinned'], required: ['title', 'body'] },
  'announcement.update': {
    allowed: ['announcementId', 'title', 'body', 'pinned'],
    required: ['announcementId'],
  },
  'announcement.publish': { allowed: ['announcementId'], required: ['announcementId'] },
  'announcement.archive': { allowed: ['announcementId'], required: ['announcementId'] },

  // ===== ROI（M6，TEAM；金额为元十进制字符串）=====
  'roi.list': { allowed: ['status', 'category', 'keyword', 'cursor', 'pageSize'] },
  'roi.get': { allowed: ['roiId'], required: ['roiId'] },
  'roi.create': {
    allowed: ['title', 'category', 'cost', 'revenue', 'participants', 'periodStart', 'periodEnd', 'status', 'notes'],
    required: ['title', 'category', 'cost', 'revenue'],
  },
  'roi.update': {
    allowed: ['roiId', 'title', 'category', 'cost', 'revenue', 'participants', 'periodStart', 'periodEnd', 'status', 'notes'],
    required: ['roiId'],
  },
  'roi.delete': { allowed: ['roiId'], required: ['roiId'] },
  'roi.overview': { allowed: ['period'] },

  // ===== 绩效（M6，TEAM）=====
  'performance.mine': { allowed: [] },
  'performance.list': { allowed: ['cursor', 'pageSize'] },

  // ===== 社团与摘要（M6，TEAM）=====
  'club.get': { allowed: [] },
  'club.update': { allowed: ['name', 'description', 'logoUrl', 'settings'] },
  'club.dashboard': { allowed: [] },
  'profile.summary': { allowed: [] },
}

export function lookupDataSchema(action: string): ActionDataSchema | null {
  if (!Object.prototype.hasOwnProperty.call(ACTION_DATA_SCHEMAS, action)) return null
  return ACTION_DATA_SCHEMAS[action]
}
