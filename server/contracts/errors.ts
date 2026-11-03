/**
 * 云-v2 统一错误语义（多团队 DESIGN §6、BASE-DESIGN §8.1）。
 *
 * 本文件是错误码的**单一来源**；docs/api/cloud-v2.md 必须与本文件保持一致。
 * 只暴露稳定语义 code 与稳定用户文案，不回传堆栈/SQL/集合/SDK 凭证。
 */

export const ERROR_CODES = [
  // 身份 / 环境
  'identity_required',
  'app_mismatch',
  'environment_mismatch',
  'account_blocked',
  // 开通 / 入会
  'setup_required',
  'membership_required',
  'membership_disabled',
  'membership_left',
  'team_maintenance',
  // 授权 / 资源
  'permission_denied',
  'resource_not_found',
  'scope_mismatch',
  'cursor_scope_mismatch',
  // 校验 / 并发
  'validation_failed',
  'revision_conflict',
  'invalid_transition',
  'task_not_claimable',
  'attachment_not_ready',
  'attachment_forbidden',
  'upload_expired',
  'upload_cancelled',
  // 幂等 / 限流
  'idempotency_conflict',
  'command_expired',
  'rate_limited',
  // 能力 / 未知
  'storage_unavailable',
  'stats_unavailable',
  'result_unknown',
  'not_implemented',
  'internal_error',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

/** 可重试语义（客户端可短退避重试；非自动无限重试）。 */
const RETRYABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'rate_limited',
  'storage_unavailable',
  'stats_unavailable',
  'result_unknown',
  'internal_error',
])

/** 稳定用户文案（内部维护语义码与稳定文案，不把传输成功当业务成功）。 */
const DEFAULT_MESSAGE: Record<ErrorCode, string> = {
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
  cursor_scope_mismatch: '分页游标不属于当前范围',
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

export interface AppErrorShape {
  code: ErrorCode
  message: string
  retryable: boolean
  details?: Record<string, unknown>
}

/** 内部统一错误类型：入口捕获后映射为 CloudResponse 的 ok:false 分支。 */
export class AppError extends Error {
  readonly code: ErrorCode
  readonly retryable: boolean
  readonly details?: Record<string, unknown>

  constructor(code: ErrorCode, message?: string, details?: Record<string, unknown>) {
    super(message ?? DEFAULT_MESSAGE[code])
    this.name = 'AppError'
    this.code = code
    this.retryable = RETRYABLE.has(code)
    this.details = details
  }

  toShape(): AppErrorShape {
    const shape: AppErrorShape = {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    }
    if (this.details) shape.details = this.details
    return shape
  }
}

/** 构造统一失败响应体（scope 允许为 null 表示在解析 scope 前即失败）。 */
export function failureShape(code: ErrorCode, message?: string): AppErrorShape {
  return new AppError(code, message).toShape()
}
