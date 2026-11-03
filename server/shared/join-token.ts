import { createHmac, timingSafeEqual } from 'node:crypto'
import { AppError } from '../contracts/errors.ts'

/**
 * 申请入口短效 token（多团队 DESIGN §7.2）。
 *
 * 绑定 account/AppID/env/clubId/entryId/entryVersion/issuedAt/expiresAt/tokenVersion；
 * 签名密钥仅在服务端受控配置，不进源码/日志。默认 10 分钟有效。
 */

export const JOIN_TARGET_TTL_MS = 10 * 60 * 1000
export const JOIN_TOKEN_VERSION = 1

export interface JoinTargetPayload {
  accountKey: string
  appId: string
  env: string
  clubId: string
  entryId: string
  entryVersion: number
  tokenVersion: number
  issuedAt: number
  expiresAt: number
}

function b64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url')
}

export function signJoinTarget(payload: JoinTargetPayload, secret: string): string {
  const body = b64url(JSON.stringify(payload))
  const sig = createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyJoinTarget(
  token: string,
  secret: string,
  now: number,
  expected: { appId: string; env: string }
): JoinTargetPayload {
  const parts = token.split('.')
  if (parts.length !== 2) throw new AppError('resource_not_found', '无效的申请入口')
  const [body, sig] = parts
  const expectedSig = createHmac('sha256', secret).update(body).digest('base64url')
  const given = Buffer.from(sig)
  const want = Buffer.from(expectedSig)
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    throw new AppError('resource_not_found', '无效的申请入口')
  }

  let payload: JoinTargetPayload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as JoinTargetPayload
  } catch {
    throw new AppError('resource_not_found', '无效的申请入口')
  }
  if (payload.appId !== expected.appId || payload.env !== expected.env || payload.tokenVersion !== JOIN_TOKEN_VERSION) {
    throw new AppError('resource_not_found', '无效的申请入口')
  }
  if (now > payload.expiresAt) throw new AppError('command_expired', '申请入口已过期')
  return payload
}

/** 仅展示用的掩码（不含可分享明文）。 */
export function maskCode(value: string): string {
  if (value.length <= 8) return `${value.slice(0, 2)}••`
  return `${value.slice(0, 4)}••••${value.slice(-4)}`
}
