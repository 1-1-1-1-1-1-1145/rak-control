import { AppError } from '../../contracts/errors.ts'
import type { Database } from '../../repositories/store.ts'
import { COLLECTIONS } from '../../repositories/collections.ts'
import {
  hashInviteCode,
  hashSceneToken,
  identityId,
  memberId,
  newInviteCode,
  sha256Hex,
} from '../../repositories/ids.ts'
import { requireManagerPlus } from '../../shared/authorization.ts'
import { writeAudit } from '../../shared/audit.ts'
import { assertMutationFresh, IDEMPOTENCY_RETAIN_MS, RESULT_WINDOW_MS } from '../../shared/command.ts'
import { maskCode } from '../../shared/join-token.ts'
import { normalizeSingleLine } from '../../shared/text.ts'
import { resolveTenant, toTenantContext } from '../context.ts'
import { runIdempotent } from '../command.ts'

/**
 * 邀请码（多团队 DESIGN §6.2、§7.2、§M3）。
 *
 * - create（manager+）：12 位非歧义码；当次显示明文，通用命令只存 id/masked。
 * - redeem（GLOBAL）：{code|sceneToken} 互斥；原子扣额 + 建 member + 申请收敛；
 *   重复兑换不多扣；LEFT/DISABLED 不能借码复活；已 ACTIVE 返回 already_member。
 */

export interface InviteDeps {
  db: Database
  now: () => number
  newInviteCode?: () => string
}

export interface InviteView {
  inviteId: string
  maskedCode: string
  maxUses: number
  usedCount: number
  expiresAt: string | null
  revokedAt: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000

function clampUses(value: unknown): number {
  const n = typeof value === 'number' && Number.isInteger(value) ? value : 10
  if (n < 1 || n > 100) throw new AppError('validation_failed', 'maxUses 必须在 1..100')
  return n
}

function clampDays(value: unknown): number {
  const n = typeof value === 'number' && Number.isInteger(value) ? value : 30
  if (n < 1 || n > 30) throw new AppError('validation_failed', 'expiresInDays 必须在 1..30')
  return n
}

function toView(doc: { [k: string]: unknown }): InviteView {
  const expiresAt = doc.expiresAt as number | null
  const revokedAt = doc.revokedAt as number | null
  return {
    inviteId: doc._id as string,
    maskedCode: (doc.maskedCode as string) ?? '',
    maxUses: (doc.maxUses as number) ?? 0,
    usedCount: (doc.usedCount as number) ?? 0,
    expiresAt: typeof expiresAt === 'number' ? new Date(expiresAt).toISOString() : null,
    revokedAt: typeof revokedAt === 'number' ? new Date(revokedAt).toISOString() : null,
  }
}

export interface CreateInviteResult {
  inviteId: string
  maskedCode: string
  plaintextCode: string | null
  maxUses: number
  expiresAt: string
  replayed: boolean
}

export async function createInvite(
  deps: InviteDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  input: { maxUses?: number; expiresInDays?: number; mutationId: string }
): Promise<CreateInviteResult> {
  const now = deps.now()
  const maxUses = clampUses(input.maxUses)
  const days = clampDays(input.expiresInDays)
  const expiresAt = now + days * DAY_MS
  const genCode = deps.newInviteCode ?? newInviteCode
  const code = genCode()
  const codeHash = hashInviteCode(code)
  const inviteId = sha256Hex(`invite|${clubId}|${codeHash}`)
  const maskedCode = maskCode(code)
  const commandDocId = sha256Hex(`cmd|TEAM:${clubId}|${trusted.openid}|invite.create|${input.mutationId}`)
  const inputHash = sha256Hex(JSON.stringify(['invite.create', clubId, maxUses, days]))
  assertMutationFresh(input.mutationId, now)

  return deps.db.tx(async (tx) => {
    const tenant = await resolveTenant(tx, trusted, clubId)
    requireManagerPlus(toTenantContext(trusted, tenant))

    const existing = await tx.get(COLLECTIONS.commands, commandDocId)
    if (existing) {
      if (existing.inputHash !== inputHash) throw new AppError('idempotency_conflict')
      const summary = JSON.parse(existing.resultSummary as string) as { inviteId: string; maskedCode: string; maxUses: number; expiresAt: string }
      // 明文只在生成当次返回；重放不返回明文
      return { ...summary, plaintextCode: null, replayed: true }
    }

    await tx.set(COLLECTIONS.invites, {
      _id: inviteId,
      clubId,
      codeHash,
      maskedCode,
      // **不要写 `sceneTokenHash: null`**：该字段有 `unique + sparse` 索引，
      // 而 MongoDB 的 sparse 只排除"字段不存在"，`null` 仍是真实值会被索引 →
      // 第二条邀请码会与第一条的 null 唯一冲突（E11000），表现为 internal_error。
      // 小程序码未启用时**省略该字段**；启用后写入真实且唯一的 token hash。
      maxUses,
      usedCount: 0,
      expiresAt,
      revokedAt: null,
      createdByMemberId: tenant.member._id,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    })

    const summary = { inviteId, maskedCode, maxUses, expiresAt: new Date(expiresAt).toISOString() }
    await tx.set(COLLECTIONS.commands, {
      _id: commandDocId,
      scope: `TEAM:${clubId}`,
      actorIdentityId: identityId(trusted.appId, trusted.openid),
      actorRole: tenant.member.role as string,
      actorIsPrimaryOwner: tenant.club.ownerMemberId === tenant.member._id,
      action: 'invite.create',
      inputHash,
      status: 'SUCCEEDED',
      resultSummary: JSON.stringify(summary),
      createdAt: now,
      completedAt: now,
      resultUntil: now + RESULT_WINDOW_MS,
      retainUntil: now + IDEMPOTENCY_RETAIN_MS,
    })
    await writeAudit(tx, {
      scope: `TEAM:${clubId}`,
      actorMemberId: tenant.member._id,
      action: 'invite.create',
      resourceType: 'invite',
      resourceId: inviteId,
      seed: input.mutationId,
      now,
    })
    return { ...summary, plaintextCode: code, replayed: false }
  })
}

export async function listInvites(
  deps: InviteDeps,
  trusted: { appId: string; openid: string },
  clubId: string
): Promise<InviteView[]> {
  const tenant = await deps.db.tx(async (tx) => resolveTenant(tx, trusted, clubId))
  requireManagerPlus(toTenantContext(trusted, tenant))
  return (await deps.db.query(COLLECTIONS.invites, (doc) => doc.clubId === clubId))
    .map((doc) => toView(doc))
    .sort((a, b) => (a.inviteId < b.inviteId ? 1 : -1))
}

export async function revokeInvite(
  deps: InviteDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  input: { inviteId: string; mutationId: string }
): Promise<InviteView> {
  const now = deps.now()
  const run = await runIdempotent(
    deps.db,
    now,
    {
      scope: { kind: 'TEAM', clubId },
      actorIdentityId: identityId(trusted.appId, trusted.openid),
      action: 'invite.revoke',
      mutationId: input.mutationId,
      data: { inviteId: input.inviteId },
    },
    async (tx) => {
      const tenant = await resolveTenant(tx, trusted, clubId)
      requireManagerPlus(toTenantContext(trusted, tenant))
      const invite = await tx.get(COLLECTIONS.invites, input.inviteId)
      if (!invite || invite.clubId !== clubId) throw new AppError('resource_not_found')
      const next = { ...invite, revokedAt: now, updatedAt: now }
      await tx.set(COLLECTIONS.invites, next)
      await writeAudit(tx, {
        scope: `TEAM:${clubId}`,
        actorMemberId: tenant.member._id,
        action: 'invite.revoke',
        resourceType: 'invite',
        resourceId: invite._id,
        seed: input.mutationId,
        now,
      })
      return toView(next)
    }
  )
  return run.result
}

export interface RedeemResult {
  clubId: string
  memberId: string
  role: string
  status: 'ACTIVE' | 'ALREADY_MEMBER'
  replayed: boolean
}

export async function redeem(
  deps: InviteDeps,
  trusted: { appId: string; openid: string },
  input: { code?: string; sceneToken?: string; displayName: string; mutationId: string }
): Promise<RedeemResult> {
  const now = deps.now()
  const displayName = normalizeSingleLine(input.displayName, { field: '展示名', min: 1, max: 16 })
  const codeHash = input.code ? hashInviteCode(input.code) : null
  const sceneHash = input.sceneToken ? hashSceneToken(input.sceneToken) : null
  if (!codeHash && !sceneHash) throw new AppError('validation_failed', '需要 code 或 sceneToken')

  const matches = await deps.db.query(
    COLLECTIONS.invites,
    (doc) =>
      (codeHash !== null && doc.codeHash === codeHash) ||
      (sceneHash !== null && doc.sceneTokenHash === sceneHash)
  )
  if (matches.length !== 1) throw new AppError('resource_not_found', '邀请码无效')
  const inviteId = matches[0]._id
  const clubId = matches[0].clubId as string

  const run = await runIdempotent(
    deps.db,
    now,
    {
      scope: { kind: 'GLOBAL' },
      actorIdentityId: identityId(trusted.appId, trusted.openid),
      action: 'invite.redeem',
      mutationId: input.mutationId,
      data: { code: input.code, sceneToken: input.sceneToken, displayName },
    },
    async (tx) => {
      const invite = await tx.get(COLLECTIONS.invites, inviteId)
      if (!invite || invite.clubId !== clubId) throw new AppError('resource_not_found')
      const club = await tx.get(COLLECTIONS.clubs, clubId)
      if (!club || club.status !== 'ACTIVE') throw new AppError('resource_not_found', '目标团队当前不可加入')
      if (typeof invite.revokedAt === 'number') throw new AppError('validation_failed', '邀请码已作废')
      const expiresAt = invite.expiresAt as number | null
      if (typeof expiresAt === 'number' && now > expiresAt) throw new AppError('validation_failed', '邀请码已过期')

      const identity = await tx.get(COLLECTIONS.identities, identityId(trusted.appId, trusted.openid))
      if (!identity || typeof identity.userId !== 'string') throw new AppError('identity_required')
      const userId = identity.userId
      const user = await tx.get(COLLECTIONS.users, userId)
      if (user && user.securityState === 'BLOCKED') throw new AppError('account_blocked')

      const mId = memberId(clubId, userId)
      const existing = await tx.get(COLLECTIONS.members, mId)
      if (existing && existing.status === 'ACTIVE') {
        return { clubId, memberId: mId, role: existing.role as string, status: 'ALREADY_MEMBER' as const }
      }
      if (existing && existing.status === 'DISABLED') throw new AppError('membership_disabled', '已停用，无法兑换')
      if (existing && existing.status === 'LEFT') throw new AppError('membership_left', '已离队，无法兑换')

      const usedCount = (invite.usedCount as number) ?? 0
      const maxUses = (invite.maxUses as number) ?? 0
      if (usedCount >= maxUses) throw new AppError('validation_failed', '邀请码次数已用尽')

      await tx.set(COLLECTIONS.members, {
        _id: mId,
        clubId,
        userId,
        displayName,
        duty: null,
        role: 'member',
        status: 'ACTIVE',
        createdAt: now,
        joinedAt: now,
        revision: 1,
        mutationSeq: 0,
      })
      await tx.set(COLLECTIONS.invites, {
        ...invite,
        usedCount: usedCount + 1,
        revision: ((invite.revision as number) ?? 0) + 1,
        updatedAt: now,
      })

      // 收敛本队 PENDING 申请
      const reqId = sha256Hex(JSON.stringify(['rak-join-v1', clubId, userId]))
      const req = await tx.get(COLLECTIONS.joinRequests, reqId)
      if (req && req.status === 'PENDING') {
        await tx.set(COLLECTIONS.joinRequests, {
          ...req,
          status: 'APPROVED',
          resolution: 'INVITE',
          reviewedAt: now,
          revision: ((req.revision as number) ?? 0) + 1,
          updatedAt: now,
        })
      }

      await tx.set(COLLECTIONS.clubs, {
        ...club,
        mutationSeq: ((club.mutationSeq as number) ?? 0) + 1,
        updatedAt: now,
      })
      if (user) {
        await tx.set(COLLECTIONS.users, {
          ...user,
          securityMutationSeq: ((user.securityMutationSeq as number) ?? 0) + 1,
          updatedAt: now,
        })
      }

      await writeAudit(tx, {
        scope: 'GLOBAL',
        actorMemberId: null,
        action: 'invite.redeem',
        resourceType: 'invite',
        resourceId: inviteId,
        seed: input.mutationId,
        now,
      })
      return { clubId, memberId: mId, role: 'member', status: 'ACTIVE' as const }
    }
  )

  return { ...run.result, replayed: run.replayed }
}
