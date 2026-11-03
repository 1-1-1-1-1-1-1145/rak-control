import { createHash, randomBytes, randomUUID } from 'node:crypto'

/**
 * 确定性 / 随机 ID 生成（多团队 DESIGN §5.2）。
 *
 * 确定性 ID 仅用于身份、成员、唯一申请、命令、开通操作等已说明用途；
 * 组合值通过有分隔的规范编码后 hash，避免裸拼接歧义。
 */

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

export function identityId(appId: string, openid: string): string {
  return sha256Hex(JSON.stringify(['rak-identity-v1', appId, openid]))
}

export function memberId(clubId: string, userId: string): string {
  return sha256Hex(JSON.stringify(['rak-member-v1', clubId, userId]))
}

export function joinRequestId(clubId: string, userId: string): string {
  return sha256Hex(JSON.stringify(['rak-join-v1', clubId, userId]))
}

export function commandId(
  scopeCanonical: string,
  actorIdentityId: string,
  action: string,
  mutationId: string
): string {
  return sha256Hex(JSON.stringify(['rak-command-v1', scopeCanonical, actorIdentityId, action, mutationId]))
}

export function provisioningOperationId(appId: string, env: string, provisioningKey: string): string {
  return sha256Hex(JSON.stringify(['rak-provision-v1', appId, env, provisioningKey]))
}

/** clubId 随机且不可变（DESIGN §5.2）。 */
export function randomClubId(): string {
  return `club${randomBytes(10).toString('hex')}`
}

export function randomUserId(): string {
  return randomUUID()
}

/** 随机业务 ID（task/submission 等），前缀便于辨认，不含敏感信息。 */
export function randomId(prefix: string): string {
  return `${prefix}${randomUUID().replace(/-/g, '')}`
}

/** 高熵一次性参考号（仅 hash 落库，明文只在生成当次返回本人）。 */
export function newReferenceCode(): string {
  return randomBytes(24).toString('base64url')
}

export function hashReferenceCode(code: string): string {
  return sha256Hex(JSON.stringify(['rak-ref-v1', code]))
}

/** 高熵申请入口 key（≥128bit，仅 hash 查找）。 */
export function newJoinKey(): string {
  return randomBytes(24).toString('base64url')
}

export function hashJoinKey(key: string): string {
  return sha256Hex(JSON.stringify(['rak-join-key-v1', key]))
}

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** 12 位非歧义大写字母数字邀请码。 */
export function newInviteCode(): string {
  const bytes = randomBytes(12)
  let out = ''
  for (let i = 0; i < 12; i += 1) out += INVITE_ALPHABET[bytes[i] % INVITE_ALPHABET.length]
  return out
}

export function hashInviteCode(code: string): string {
  return sha256Hex(JSON.stringify(['rak-invite-v1', code.trim().toUpperCase()]))
}

/** sceneToken（受控二维码）：目标 32 字符 URL 安全；能力不足时降级文本码。 */
export function newSceneToken(): string {
  return randomBytes(24).toString('base64url')
}

export function hashSceneToken(token: string): string {
  return sha256Hex(JSON.stringify(['rak-scene-v1', token]))
}
