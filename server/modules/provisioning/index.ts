import { AppError } from '../../contracts/errors.ts'
import type { Database } from '../../repositories/store.ts'
import { COLLECTIONS } from '../../repositories/collections.ts'
import {
  hashReferenceCode,
  memberId,
  provisioningOperationId,
  sha256Hex,
} from '../../repositories/ids.ts'

/**
 * 平台初始化与每队受控开通（多团队 DESIGN §5.3、§6.2、§M3）。
 *
 * - 平台初始化只做一次；以后开通第 2/3 队不重置全平台。
 * - 开通幂等：op 键 hash(appId,env,provisioningId)；成功记录与建队/owner/审计/
 *   消费参考号/操作记录同事务；同键不同输入拒绝；重启先查记录，不建第二个队。
 * - 新 clubId 在事务外只生成一次，事务重试复用。
 * - 受控运维调用，不进入公共 action 注册表。
 */

export interface ProvisioningDeps {
  db: Database
  now: () => number
  newClubId: () => string
}

export interface ProvisionInput {
  provisioningKey: string
  appId: string
  env: string
  clubName: string
  slug: string
  displayCode: string
  ownerReferenceCode: string
  ownerDisplayName: string
}

export interface ProvisionResult {
  clubId: string
  ownerMemberId: string
  replayed: boolean
}

function canonical(input: Record<string, unknown>): string {
  const keys = Object.keys(input).sort()
  return JSON.stringify(keys.map((k) => [k, input[k]]))
}

export async function initializePlatform(
  deps: ProvisioningDeps,
  appId: string
): Promise<{ initialized: boolean; alreadyInitialized: boolean }> {
  const now = deps.now()
  return deps.db.tx(async (tx) => {
    const existing = await tx.get(COLLECTIONS.systemConfig, 'main')
    if (existing) return { initialized: true, alreadyInitialized: true }
    await tx.set(COLLECTIONS.systemConfig, {
      _id: 'main',
      appId,
      schemaVersion: 1,
      platformInitializedAt: now,
      maintenanceFlags: {},
    })
    return { initialized: true, alreadyInitialized: false }
  })
}

export async function provisionTeam(deps: ProvisioningDeps, input: ProvisionInput): Promise<ProvisionResult> {
  const now = deps.now()
  const opId = provisioningOperationId(input.appId, input.env, input.provisioningKey)
  const refHash = hashReferenceCode(input.ownerReferenceCode)
  const inputHash = sha256Hex(
    canonical({
      appId: input.appId,
      env: input.env,
      clubName: input.clubName,
      slug: input.slug,
      displayCode: input.displayCode,
      ownerDisplayName: input.ownerDisplayName,
      ownerReferenceHash: refHash,
    })
  )

  // 事务外按参考号 hash 定位 identity（事务内再做 doc 重读与全部校验）。
  const matches = await deps.db.query(COLLECTIONS.identities, (doc) => doc.ownerReferenceHash === refHash)
  if (matches.length !== 1) throw new AppError('resource_not_found', '参考号无效或未生成')
  const ownerIdentityId = matches[0]._id

  // 新 clubId 只生成一次，事务重试复用。
  const clubId = deps.newClubId()

  return deps.db.tx(async (tx) => {
    const existingOp = await tx.get(COLLECTIONS.provisioning, opId)
    if (existingOp) {
      if (existingOp.inputHash !== inputHash) throw new AppError('idempotency_conflict', '同一开通请求的内容不一致')
      return {
        clubId: existingOp.clubId as string,
        ownerMemberId: existingOp.ownerMemberId as string,
        replayed: true,
      }
    }

    const config = await tx.get(COLLECTIONS.systemConfig, 'main')
    if (!config) throw new AppError('setup_required', '平台尚未初始化')

    const identityDoc = await tx.get(COLLECTIONS.identities, ownerIdentityId)
    if (!identityDoc || identityDoc.ownerReferenceHash !== refHash) {
      throw new AppError('resource_not_found', '参考号无效')
    }
    if (typeof identityDoc.ownerReferenceUsedAt === 'number') {
      throw new AppError('resource_not_found', '参考号已被使用')
    }
    const expiresRaw = identityDoc.ownerReferenceExpiresAt
    if (typeof expiresRaw !== 'number' || expiresRaw <= now) {
      throw new AppError('resource_not_found', '参考号已过期')
    }

    const ownerUserId = identityDoc.userId as string
    const ownerUser = await tx.get(COLLECTIONS.users, ownerUserId)
    if (!ownerUser) throw new AppError('identity_required')
    if (ownerUser.securityState === 'BLOCKED') throw new AppError('account_blocked', '拟任 owner 账号已被封禁')

    const ownerMemberId = memberId(clubId, ownerUserId)

    await tx.set(COLLECTIONS.clubs, {
      _id: clubId,
      name: input.clubName,
      slug: input.slug,
      displayCode: input.displayCode,
      ownerMemberId,
      status: 'ACTIVE',
      settings: { memberDirectoryVisible: true },
      revision: 1,
      mutationSeq: 0,
      createdAt: now,
      updatedAt: now,
    })

    await tx.set(COLLECTIONS.members, {
      _id: ownerMemberId,
      clubId,
      userId: ownerUserId,
      displayName: input.ownerDisplayName,
      duty: null,
      role: 'super_admin',
      status: 'ACTIVE',
      createdAt: now,
      joinedAt: now,
      revision: 1,
      mutationSeq: 0,
    })

    // 消费参考号 + 目标账户安全栅栏
    await tx.set(COLLECTIONS.identities, { ...identityDoc, ownerReferenceUsedAt: now, updatedAt: now })
    await tx.set(COLLECTIONS.users, {
      ...ownerUser,
      securityMutationSeq: ((ownerUser.securityMutationSeq as number) ?? 0) + 1,
      updatedAt: now,
    })

    await tx.set(COLLECTIONS.provisioning, {
      _id: opId,
      appId: input.appId,
      env: input.env,
      inputHash,
      clubId,
      ownerMemberId,
      status: 'SUCCEEDED',
      createdAt: now,
    })

    await tx.set(COLLECTIONS.audit, {
      _id: sha256Hex(`${opId}|audit`),
      scope: 'GLOBAL',
      actorMemberId: null,
      action: 'provision.team',
      resourceType: 'club',
      resourceId: clubId,
      createdAt: now,
    })

    return { clubId, ownerMemberId, replayed: false }
  })
}
