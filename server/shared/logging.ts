/**
 * 结构化、脱敏日志（多团队 DESIGN §12、BASE-DESIGN §13.3）。
 *
 * 只记录 requestId/action/scope/脱敏 actor/资源 ID/稳定错误码/耗时/版本；
 * 绝不记录 event 全量、文件内容、签名 URL、临时凭证、邀请码、openid 或完整联系方式。
 */

export interface LogFields {
  requestId: string
  action: string
  scope: 'GLOBAL' | 'TEAM'
  clubId?: string
  actorKey?: string
  resourceId?: string
  code?: string
  durationMs?: number
  version?: string
}

const FORBIDDEN_LOG_KEYS = new Set([
  'url',
  'signedUrl',
  'tempUrl',
  'token',
  'authorization',
  'openid',
  'inviteCode',
  'sceneToken',
  'wechat',
  'secret',
])

/** 递归剔除敏感键，保证日志不泄露凭证/联系方式/openid。 */
export function redactForLog(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactForLog)
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_LOG_KEYS.has(key)) continue
      out[key] = redactForLog(nested)
    }
    return out
  }
  return value
}

export function logEvent(fields: LogFields): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(redactForLog(fields)))
}
