/**
 * 前端云后端错误（M2）。语义与 server/contracts/errors.ts 保持一致。
 *
 * 云调用失败不得被当作成功或空数组；未知/非法错误码统一映射 internal_error。
 */

export const BACKEND_ERROR_CODES = [
  'identity_required',
  'app_mismatch',
  'environment_mismatch',
  'account_blocked',
  'setup_required',
  'membership_required',
  'membership_disabled',
  'membership_left',
  'team_maintenance',
  'permission_denied',
  'resource_not_found',
  'scope_mismatch',
  'cursor_scope_mismatch',
  'validation_failed',
  'revision_conflict',
  'invalid_transition',
  'task_not_claimable',
  'attachment_not_ready',
  'attachment_forbidden',
  'upload_expired',
  'upload_cancelled',
  'idempotency_conflict',
  'command_expired',
  'rate_limited',
  'storage_unavailable',
  'stats_unavailable',
  'result_unknown',
  'not_implemented',
  'internal_error',
]

const KNOWN = new Set(BACKEND_ERROR_CODES)

const RETRYABLE = new Set([
  'rate_limited',
  'storage_unavailable',
  'stats_unavailable',
  'result_unknown',
  'internal_error',
])

const MESSAGES = {
  identity_required: '缺少可信微信身份，请重试',
  app_mismatch: '小程序身份不匹配',
  environment_mismatch: '环境不匹配',
  account_blocked: '账号已被限制，请联系管理员',
  setup_required: '平台尚未初始化，请联系管理员',
  membership_required: '尚未加入该团队',
  membership_disabled: '你已被该团队停用',
  membership_left: '你已离开该团队',
  team_maintenance: '该团队正在维护',
  permission_denied: '没有权限执行此操作',
  resource_not_found: '资源不存在或无权访问',
  scope_mismatch: '请求范围不匹配',
  cursor_scope_mismatch: '分页数据已失效，请刷新',
  validation_failed: '请求内容不合法',
  revision_conflict: '数据已变化，请刷新后重试',
  invalid_transition: '当前状态不允许此操作',
  task_not_claimable: '任务已被他人认领',
  attachment_not_ready: '附件尚未就绪',
  attachment_forbidden: '无权访问该附件',
  upload_expired: '上传已过期',
  upload_cancelled: '上传已取消',
  idempotency_conflict: '同一命令的请求内容不一致',
  command_expired: '命令结果已过期',
  rate_limited: '操作过于频繁，请稍后重试',
  storage_unavailable: '文件服务暂不可用',
  stats_unavailable: '统计暂不可用',
  result_unknown: '结果确认中',
  not_implemented: '功能尚未上线',
  internal_error: '服务开小差了，请稍后重试',
}

export class BackendError extends Error {
  constructor(code, message, details) {
    const safeCode = KNOWN.has(code) ? code : 'internal_error'
    super(message || MESSAGES[safeCode] || '操作失败，请稍后重试')
    this.name = 'BackendError'
    this.code = safeCode
    this.retryable = RETRYABLE.has(safeCode)
    this.details = details
  }
}

export function isBackendError(value) {
  return value instanceof BackendError
}

/** 把任意值规范为 BackendError（未知码 → internal_error）。 */
export function toBackendError(value) {
  if (value instanceof BackendError) return value
  const shape = value && typeof value === 'object' ? value : null
  const code = shape && typeof shape.code === 'string' ? shape.code : 'internal_error'
  const message = shape && typeof shape.message === 'string' ? shape.message : undefined
  const details = shape && shape.details && typeof shape.details === 'object' ? shape.details : undefined
  return new BackendError(code, message, details)
}

export function backendUserMessage(code) {
  return MESSAGES[code] || '操作失败，请稍后重试'
}
