import { createHash } from 'node:crypto'
import { AppError } from '../contracts/errors.ts'

/**
 * 可信微信身份（多团队 DESIGN §6.3、BASE-DESIGN §5.1）。
 *
 * 身份只在 handler 内从平台上下文取得；event 自报的 openid/userId/role 一律不可信。
 * identity 文档 ID 用 SHA-256(appId 与 openid 的规范编码)，不向成员目录暴露 openid。
 */
export interface TrustedIdentity {
  appId: string
  openid: string
  env: string
}

/** 规范编码后 hash，避免裸拼接产生歧义。 */
export function deriveIdentityId(appId: string, openid: string): string {
  return createHash('sha256')
    .update(JSON.stringify(['rak-identity-v1', appId, openid]))
    .digest('hex')
}

/** 确定性 memberId = hash(clubId, userId)（DESIGN §5.2）。 */
export function deriveMemberId(clubId: string, userId: string): string {
  return createHash('sha256')
    .update(JSON.stringify(['rak-member-v1', clubId, userId]))
    .digest('hex')
}

/** 校验可信身份与预期 AppID/环境一致；缺失或不符立即拒绝。 */
export function assertTrustedIdentity(
  identity: TrustedIdentity | null,
  expected: { appId: string; env: string }
): TrustedIdentity {
  if (!identity || !identity.openid || !identity.appId) {
    throw new AppError('identity_required')
  }
  if (identity.appId !== expected.appId) throw new AppError('app_mismatch')
  if (identity.env !== expected.env) throw new AppError('environment_mismatch')
  return identity
}
