import { AppError } from '../../contracts/errors.ts'
import type { Database } from '../../repositories/store.ts'
import { COLLECTIONS } from '../../repositories/collections.ts'
import { hashReferenceCode, identityId, newReferenceCode, randomUserId } from '../../repositories/ids.ts'
import type { TrustedIdentity } from '../../shared/identity.ts'

/**
 * 身份与账户（多团队 DESIGN §5.1/§5.3、§6.2）。
 *
 * - 可信身份只在 handler 内由 getWXContext 取得；event 自报字段不可信。
 * - bootstrap 事务 get-or-create 确定性 identity + 唯一 user；同 openid 并发首次只留一份映射。
 * - user 只有 NORMAL/BLOCKED；BLOCKED 仅本人最小状态。
 * - 参考号 30 分钟、未消费复用、已消费须显式 replaceConsumed 换发；仅 hash 落库。
 */

export const REFERENCE_TTL_MS = 30 * 60 * 1000

export interface AuthDeps {
  db: Database
  now: () => number
}

export interface AccountState {
  accountKey: string
  securityState: 'NORMAL' | 'BLOCKED'
  setupRequired: boolean
}

export type ReferenceOutcome =
  | { state: 'ISSUED'; code: string; expiresAt: number }
  | { state: 'REUSED'; expiresAt: number }
  | { state: 'REPLACED'; code: string; expiresAt: number }
  | { state: 'CONSUMED' }

export async function bootstrap(deps: AuthDeps, identity: TrustedIdentity): Promise<AccountState> {
  const now = deps.now()
  const id = identityId(identity.appId, identity.openid)

  return deps.db.tx(async (tx) => {
    let identityDoc = await tx.get(COLLECTIONS.identities, id)
    let userId: string
    if (!identityDoc) {
      userId = randomUserId()
      identityDoc = {
        _id: id,
        appId: identity.appId,
        openid: identity.openid,
        userId,
        createdAt: now,
        updatedAt: now,
      }
      await tx.set(COLLECTIONS.identities, identityDoc)
    } else {
      userId = identityDoc.userId as string
    }

    let user = await tx.get(COLLECTIONS.users, userId)
    if (!user) {
      user = {
        _id: userId,
        securityState: 'NORMAL',
        securityMutationSeq: 0,
        createdAt: now,
        updatedAt: now,
      }
      await tx.set(COLLECTIONS.users, user)
    }

    const config = await tx.get(COLLECTIONS.systemConfig, 'main')
    return {
      accountKey: userId,
      securityState: user.securityState === 'BLOCKED' ? 'BLOCKED' : 'NORMAL',
      setupRequired: !config,
    }
  })
}

/**
 * account.provisioningReference：仅本人参考号/有效期，不产生 membership。
 *
 * **平台初始化后仍可签发**：初始化只代表平台已就绪，不代表不能再开新队；
 * 若此处因 `systemConfig` 存在而拒绝，会导致"每开一队都要先删初始化文档"，且第 2 位 owner 无法取号。
 * 参考号**不授予任何权限**，只能由平台运维经受控开通（`provisionTeam`）消费一次。
 */
export async function provisioningReference(
  deps: AuthDeps,
  identity: TrustedIdentity,
  replaceConsumed = false
): Promise<ReferenceOutcome> {
  const now = deps.now()
  const id = identityId(identity.appId, identity.openid)

  return deps.db.tx(async (tx) => {
    const identityDoc = await tx.get(COLLECTIONS.identities, id)
    if (!identityDoc) throw new AppError('identity_required', '请先完成 auth.bootstrap')

    const user = await tx.get(COLLECTIONS.users, identityDoc.userId as string)
    if (user && user.securityState === 'BLOCKED') throw new AppError('account_blocked')

    const hash = identityDoc.ownerReferenceHash as string | undefined
    const expiresRaw = identityDoc.ownerReferenceExpiresAt
    const expiresAt = typeof expiresRaw === 'number' ? expiresRaw : undefined
    const usedAt = typeof identityDoc.ownerReferenceUsedAt === 'number' ? identityDoc.ownerReferenceUsedAt : undefined
    const active = Boolean(hash) && usedAt === undefined && expiresAt !== undefined && expiresAt > now

    if (usedAt !== undefined) {
      if (!replaceConsumed) return { state: 'CONSUMED' }
      const code = newReferenceCode()
      const next = now + REFERENCE_TTL_MS
      await tx.set(COLLECTIONS.identities, {
        ...identityDoc,
        ownerReferenceHash: hashReferenceCode(code),
        ownerReferenceExpiresAt: next,
        ownerReferenceUsedAt: null,
        updatedAt: now,
      })
      return { state: 'REPLACED', code, expiresAt: next }
    }

    if (active) return { state: 'REUSED', expiresAt: expiresAt as number }

    const code = newReferenceCode()
    const next = now + REFERENCE_TTL_MS
    await tx.set(COLLECTIONS.identities, {
      ...identityDoc,
      ownerReferenceHash: hashReferenceCode(code),
      ownerReferenceExpiresAt: next,
      ownerReferenceUsedAt: null,
      updatedAt: now,
    })
    return { state: 'ISSUED', code, expiresAt: next }
  })
}
