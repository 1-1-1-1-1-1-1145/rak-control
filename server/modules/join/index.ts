import { AppError } from '../../contracts/errors.ts'
import type { Database, Doc, Tx } from '../../repositories/store.ts'
import { COLLECTIONS } from '../../repositories/collections.ts'
import {
  hashJoinKey,
  identityId,
  joinRequestId,
  memberId,
  newJoinKey,
  sha256Hex,
} from '../../repositories/ids.ts'
import type { JoinMineItem, JoinRequestPage, JoinRequestView, JoinTargetView, Page } from '../../contracts/dtos.ts'
import { requireManagerPlus } from '../../shared/authorization.ts'
import { writeAudit } from '../../shared/audit.ts'
import { assertMutationFresh, IDEMPOTENCY_RETAIN_MS, RESULT_WINDOW_MS } from '../../shared/command.ts'
import { decodeCursor, encodeCursor } from '../../shared/cursor.ts'
import { JOIN_TARGET_TTL_MS, maskCode, signJoinTarget, verifyJoinTarget } from '../../shared/join-token.ts'
import { normalizeSingleLine } from '../../shared/text.ts'
import { runIdempotent } from '../command.ts'
import { resolveTenant, toTenantContext } from '../context.ts'

/**
 * 申请入口与入队申请（多团队 DESIGN §7.2、§6.2、§M3/M7）。
 *
 * - rotate（manager+）：轮换本队入口；与首次 join.submit 共写 join_entry_states 栅栏。
 * - resolveJoinTarget：joinKey(hash) → 最小队名 + 短效签名 token。
 * - join.submit：验签 → 事务写入本队待审申请（hash(clubId,userId)），同键恢复本人最小结果。
 * - join.list/approve/reject（manager+，TEAM）：本队申请的审批面；批准才建立 membership。
 */

export interface JoinDeps {
  db: Database
  now: () => number
  joinSecret: string
  newJoinKey?: () => string
}

export interface RotateResult {
  entryId: string
  maskedCode: string
  plaintextKey: string | null
  replayed: boolean
}

export async function rotateJoinLink(
  deps: JoinDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  input: { mutationId: string }
): Promise<RotateResult> {
  const now = deps.now()
  const genKey = deps.newJoinKey ?? newJoinKey
  const key = genKey()
  const keyHash = hashJoinKey(key)
  const entryId = sha256Hex(`entry|${clubId}|${keyHash}`)
  const commandDocId = sha256Hex(`cmd|TEAM:${clubId}|${trusted.openid}|team.joinLink.rotate|${input.mutationId}`)
  const inputHash = sha256Hex(JSON.stringify(['rotate', clubId]))
  assertMutationFresh(input.mutationId, now)

  return deps.db.tx(async (tx) => {
    const tenant = await resolveTenant(tx, trusted, clubId)
    requireManagerPlus(toTenantContext(trusted, tenant))

    const existing = await tx.get(COLLECTIONS.commands, commandDocId)
    if (existing) {
      if (existing.inputHash !== inputHash) throw new AppError('idempotency_conflict')
      const summary = JSON.parse(existing.resultSummary as string) as { entryId: string; maskedCode: string }
      // 明文只在生成当次返回；重放不返回明文
      return { ...summary, plaintextKey: null, replayed: true }
    }

    const state = await tx.get(COLLECTIONS.joinEntryStates, clubId)
    const entryVersion = state ? ((state.entryVersion as number) ?? 0) + 1 : 1
    if (state && typeof state.currentEntryId === 'string') {
      const old = await tx.get(COLLECTIONS.joinEntries, state.currentEntryId)
      if (old) await tx.set(COLLECTIONS.joinEntries, { ...old, revokedAt: now, updatedAt: now })
    }

    await tx.set(COLLECTIONS.joinEntries, {
      _id: entryId,
      clubId,
      keyHash,
      version: entryVersion,
      revokedAt: null,
      createdByMemberId: tenant.member._id,
      createdAt: now,
      updatedAt: now,
    })
    await tx.set(COLLECTIONS.joinEntryStates, {
      _id: clubId,
      clubId,
      currentEntryId: entryId,
      entryVersion,
      revision: state ? ((state.revision as number) ?? 0) + 1 : 1,
      mutationSeq: ((state?.mutationSeq as number) ?? 0) + 1,
      updatedAt: now,
    })
    // 本队栅栏
    await tx.set(COLLECTIONS.clubs, {
      ...tenant.club,
      mutationSeq: ((tenant.club.mutationSeq as number) ?? 0) + 1,
      updatedAt: now,
    })

    const maskedCode = maskCode(key)
    await writeAudit(tx, {
      scope: `TEAM:${clubId}`,
      actorMemberId: tenant.member._id,
      action: 'team.joinLink.rotate',
      resourceType: 'join_entry',
      resourceId: entryId,
      seed: input.mutationId,
      now,
    })
    await tx.set(COLLECTIONS.commands, {
      _id: commandDocId,
      scope: `TEAM:${clubId}`,
      actorIdentityId: identityId(trusted.appId, trusted.openid),
      actorRole: tenant.member.role as string,
      actorIsPrimaryOwner: tenant.club.ownerMemberId === tenant.member._id,
      action: 'team.joinLink.rotate',
      inputHash,
      status: 'SUCCEEDED',
      // 只缓存 mask，不含明文
      resultSummary: JSON.stringify({ entryId, maskedCode }),
      createdAt: now,
      completedAt: now,
      resultUntil: now + RESULT_WINDOW_MS,
      retainUntil: now + IDEMPOTENCY_RETAIN_MS,
    })
    return { entryId, maskedCode, plaintextKey: key, replayed: false }
  })
}

export async function resolveJoinTarget(
  deps: JoinDeps,
  trusted: { appId: string; openid: string; env: string },
  joinKey: string
): Promise<JoinTargetView> {
  const now = deps.now()
  const keyHash = hashJoinKey(joinKey)

  const entries = await deps.db.query(COLLECTIONS.joinEntries, (doc) => doc.keyHash === keyHash)
  if (entries.length !== 1) throw new AppError('resource_not_found', '申请入口无效')
  const entry = entries[0]
  if (typeof entry.revokedAt === 'number') throw new AppError('resource_not_found', '申请入口已失效')

  const clubId = entry.clubId as string
  const state = await deps.db.read(COLLECTIONS.joinEntryStates, clubId)
  if (!state || state.currentEntryId !== entry._id || (state.entryVersion as number) !== (entry.version as number)) {
    throw new AppError('resource_not_found', '申请入口已轮换')
  }
  const club = await deps.db.read(COLLECTIONS.clubs, clubId)
  if (!club || club.status !== 'ACTIVE') throw new AppError('resource_not_found')

  const identity = await deps.db.read(COLLECTIONS.identities, identityId(trusted.appId, trusted.openid))
  if (!identity || typeof identity.userId !== 'string') throw new AppError('identity_required')
  const user = await deps.db.read(COLLECTIONS.users, identity.userId)
  if (!user) throw new AppError('identity_required')
  if (user.securityState === 'BLOCKED') throw new AppError('account_blocked')

  const expiresAt = now + JOIN_TARGET_TTL_MS
  const joinTargetToken = signJoinTarget(
    {
      accountKey: identity.userId,
      appId: trusted.appId,
      env: trusted.env,
      clubId,
      entryId: entry._id,
      entryVersion: entry.version as number,
      tokenVersion: 1,
      issuedAt: now,
      expiresAt,
    },
    deps.joinSecret
  )

  return {
    clubId,
    name: (club.name as string) ?? '',
    displayCode: (club.displayCode as string) ?? '',
    joinTargetToken,
    expiresAt: new Date(expiresAt).toISOString(),
  }
}

export interface SubmitResult {
  joinRequestId: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALREADY_MEMBER'
  replayed: boolean
}

export async function submit(
  deps: JoinDeps,
  trusted: { appId: string; openid: string; env: string },
  input: { joinTargetToken: string; name: string; wechat: string; reason: string; mutationId: string }
): Promise<SubmitResult> {
  const now = deps.now()
  const payload = verifyJoinTarget(input.joinTargetToken, deps.joinSecret, now, {
    appId: trusted.appId,
    env: trusted.env,
  })
  const name = normalizeSingleLine(input.name, { field: '申请姓名', min: 1, max: 16 })
  const wechat = normalizeSingleLine(input.wechat, { field: '申请微信号', min: 1, max: 32 })
  const reason = normalizeSingleLine(input.reason, { field: '申请理由', min: 1, max: 80 })

  const identity = await deps.db.read(COLLECTIONS.identities, identityId(trusted.appId, trusted.openid))
  if (!identity || identity.userId !== payload.accountKey) {
    throw new AppError('identity_required', '申请入口与当前账号不一致')
  }
  const userId = payload.accountKey
  const clubId = payload.clubId
  const reqId = joinRequestId(clubId, userId)
  const commandDocId = sha256Hex(`cmd|GLOBAL|${userId}|join.submit|${input.mutationId}`)
  const inputHash = sha256Hex(JSON.stringify(['join.submit', clubId, name, wechat, reason]))
  assertMutationFresh(input.mutationId, now)

  return deps.db.tx(async (tx) => {
    const user = await tx.get(COLLECTIONS.users, userId)
    if (!user) throw new AppError('identity_required')
    if (user.securityState === 'BLOCKED') throw new AppError('account_blocked')
    const club = await tx.get(COLLECTIONS.clubs, clubId)
    if (!club || club.status !== 'ACTIVE') throw new AppError('resource_not_found', '目标团队当前不可加入')

    const existing = await tx.get(COLLECTIONS.commands, commandDocId)
    if (existing) {
      if (existing.inputHash !== inputHash) throw new AppError('idempotency_conflict')
      const summary = JSON.parse(existing.resultSummary as string) as { joinRequestId: string; status: SubmitResult['status'] }
      return { ...summary, replayed: true }
    }

    // 轮换栅栏：入口版本必须仍是当前版本
    const state = await tx.get(COLLECTIONS.joinEntryStates, clubId)
    if (!state || state.currentEntryId !== payload.entryId || (state.entryVersion as number) !== payload.entryVersion) {
      throw new AppError('resource_not_found', '申请入口已轮换')
    }

    const memberDoc = await tx.get(COLLECTIONS.members, sha256Hex(JSON.stringify(['rak-member-v1', clubId, userId])))
    if (memberDoc && memberDoc.status === 'ACTIVE') {
      const summary = { joinRequestId: reqId, status: 'ALREADY_MEMBER' as const }
      await tx.set(COLLECTIONS.commands, {
        _id: commandDocId,
        scope: 'GLOBAL',
        actorIdentityId: identityId(trusted.appId, trusted.openid),
        actorRole: null,
        actorIsPrimaryOwner: false,
        action: 'join.submit',
        inputHash,
        status: 'SUCCEEDED',
        resultSummary: JSON.stringify(summary),
        createdAt: now,
        completedAt: now,
        resultUntil: now + RESULT_WINDOW_MS,
        retainUntil: now + IDEMPOTENCY_RETAIN_MS,
      })
      return { ...summary, replayed: false }
    }

    const prior = await tx.get(COLLECTIONS.joinRequests, reqId)
    const attemptNo = prior ? ((prior.attemptNo as number) ?? 0) + 1 : 1
    await tx.set(COLLECTIONS.joinRequests, {
      _id: reqId,
      clubId,
      userId,
      name,
      wechat,
      reason,
      status: 'PENDING',
      attemptNo,
      resolution: null,
      reviewedByMemberId: null,
      reviewedAt: null,
      revision: prior ? ((prior.revision as number) ?? 0) + 1 : 1,
      createdAt: prior ? (prior.createdAt as number) : now,
      updatedAt: now,
    })

    // 申请写入与入口状态栅栏同事务
    await tx.set(COLLECTIONS.joinEntryStates, {
      ...state,
      revision: ((state.revision as number) ?? 0) + 1,
      mutationSeq: ((state.mutationSeq as number) ?? 0) + 1,
      updatedAt: now,
    })
    await tx.set(COLLECTIONS.clubs, {
      ...club,
      mutationSeq: ((club.mutationSeq as number) ?? 0) + 1,
      updatedAt: now,
    })

    await writeAudit(tx, {
      scope: 'GLOBAL',
      actorMemberId: null,
      action: 'join.submit',
      resourceType: 'join_request',
      resourceId: reqId,
      seed: input.mutationId,
      now,
    })

    const summary = { joinRequestId: reqId, status: 'PENDING' as const }
    await tx.set(COLLECTIONS.commands, {
      _id: commandDocId,
      scope: 'GLOBAL',
      actorIdentityId: identityId(trusted.appId, trusted.openid),
      actorRole: null,
      actorIsPrimaryOwner: false,
      action: 'join.submit',
      inputHash,
      status: 'SUCCEEDED',
      resultSummary: JSON.stringify(summary),
      createdAt: now,
      completedAt: now,
      resultUntil: now + RESULT_WINDOW_MS,
      retainUntil: now + IDEMPOTENCY_RETAIN_MS,
    })
    return { ...summary, replayed: false }
  })
}

export interface JoinStatusView {
  joinRequestId: string
  clubId: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  name: string
  reviewedAt: string | null
}

/**
 * 本人入队申请列表（GLOBAL、账户级；M7）。
 *
 * - 只返回**本人**申请的最小字段（含本队名，便于 UI 展示"仅待审"落点）。
 * - cursor 绑定 account（clubId=null），跨队分页不漏重；权限每次重新解析。
 */
export async function listMine(
  deps: JoinDeps,
  trusted: { appId: string; openid: string },
  opts: { cursor?: string; pageSize?: number } = {}
): Promise<Page<JoinMineItem>> {
  const now = deps.now()
  const identity = await deps.db.read(COLLECTIONS.identities, identityId(trusted.appId, trusted.openid))
  if (!identity || typeof identity.userId !== 'string') throw new AppError('identity_required')
  const userId = identity.userId
  const user = await deps.db.read(COLLECTIONS.users, userId)
  if (!user) throw new AppError('identity_required')
  if (user.securityState === 'BLOCKED') throw new AppError('account_blocked')

  const pageSize = Math.min(Math.max(opts.pageSize ?? 20, 1), 50)
  const fingerprint = 'join.mine:self'
  let after: { createdAt: number; id: string } | null = null
  if (opts.cursor) {
    const cursor = decodeCursor(opts.cursor, { action: 'join.mine', clubId: null, fingerprint })
    after = { createdAt: cursor.sort[0] as number, id: cursor.sort[1] as string }
  }

  const entries = (
    await deps.db.query(COLLECTIONS.joinRequests, (doc) => doc.userId === userId)
  )
    .map((doc) => ({ createdAt: doc.createdAt as number, id: doc._id, doc }))
    .sort((a, b) =>
      a.createdAt !== b.createdAt ? b.createdAt - a.createdAt : a.id < b.id ? 1 : a.id > b.id ? -1 : 0
    )
    .filter(
      (entry) =>
        after === null ||
        entry.createdAt < after.createdAt ||
        (entry.createdAt === after.createdAt && entry.id < after.id)
    )

  const slice = entries.slice(0, pageSize + 1)
  const hasMore = slice.length > pageSize
  const page = slice.slice(0, pageSize)
  const items: JoinMineItem[] = await Promise.all(
    page.map(async (entry) => {
      const club = await deps.db.read(COLLECTIONS.clubs, entry.doc.clubId as string)
      return {
        joinRequestId: entry.doc._id,
        clubId: entry.doc.clubId as string,
        clubName: club ? ((club.name as string) ?? null) : null,
        status: entry.doc.status as JoinMineItem['status'],
        name: (entry.doc.name as string) ?? '',
        reviewedAt: entry.doc.reviewedAt ? new Date(entry.doc.reviewedAt as number).toISOString() : null,
      }
    })
  )
  const last = page[page.length - 1]
  const nextCursor =
    hasMore && last
      ? encodeCursor({ v: 1, action: 'join.mine', clubId: null, fingerprint, sort: [last.createdAt, last.id] })
      : null

  return { items, nextCursor, hasMore, asOf: new Date(now).toISOString() }
}

export async function status(
  deps: JoinDeps,
  trusted: { appId: string; openid: string },
  joinRequestIdValue: string
): Promise<JoinStatusView> {
  const identity = await deps.db.read(COLLECTIONS.identities, identityId(trusted.appId, trusted.openid))
  if (!identity || typeof identity.userId !== 'string') throw new AppError('identity_required')
  const user = await deps.db.read(COLLECTIONS.users, identity.userId)
  if (!user) throw new AppError('identity_required')
  if (user.securityState === 'BLOCKED') throw new AppError('account_blocked')
  const doc = await deps.db.read(COLLECTIONS.joinRequests, joinRequestIdValue)
  if (!doc || doc.userId !== identity.userId) throw new AppError('resource_not_found')
  return {
    joinRequestId: doc._id,
    clubId: doc.clubId as string,
    status: doc.status as JoinStatusView['status'],
    name: (doc.name as string) ?? '',
    reviewedAt: doc.reviewedAt ? new Date(doc.reviewedAt as number).toISOString() : null,
  }
}

function toJoinRequestView(doc: Doc): JoinRequestView {
  return {
    joinRequestId: doc._id,
    clubId: doc.clubId as string,
    applicantName: (doc.name as string) ?? '',
    wechat: (doc.wechat as string) ?? '',
    reason: (doc.reason as string) ?? '',
    status: doc.status as JoinRequestView['status'],
    attemptNo: (doc.attemptNo as number) ?? 1,
    createdAt: new Date(doc.createdAt as number).toISOString(),
    reviewedAt: doc.reviewedAt ? new Date(doc.reviewedAt as number).toISOString() : null,
  }
}

async function bumpMemberFence(tx: Tx, member: Doc, now: number): Promise<void> {
  await tx.set(COLLECTIONS.members, {
    ...member,
    mutationSeq: ((member.mutationSeq as number) ?? 0) + 1,
    updatedAt: now,
  })
}

async function bumpClubFence(tx: Tx, club: Doc, now: number): Promise<void> {
  await tx.set(COLLECTIONS.clubs, {
    ...club,
    mutationSeq: ((club.mutationSeq as number) ?? 0) + 1,
    updatedAt: now,
  })
}

/** 目标账号安全栅栏（批准即授权，必须写目标 user，而非只验证操作者）。 */
async function bumpUserSecurity(tx: Tx, userId: string, now: number): Promise<void> {
  const user = await tx.get(COLLECTIONS.users, userId)
  if (!user) return
  await tx.set(COLLECTIONS.users, {
    ...user,
    securityMutationSeq: ((user.securityMutationSeq as number) ?? 0) + 1,
    updatedAt: now,
  })
}

/**
 * 本队入队申请列表（TEAM、manager+；M7）。
 * - 默认只列 PENDING；只返回本队申请最小字段（不含 openid/appid/userId）。
 * - cursor 绑定 clubId 与状态指纹，异 scope 游标拒绝。
 */
export async function listJoinRequests(
  deps: JoinDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  opts: { status?: JoinRequestView['status']; cursor?: string; pageSize?: number } = {}
): Promise<JoinRequestPage> {
  const now = deps.now()
  const tenant = await deps.db.tx(async (tx) => resolveTenant(tx, trusted, clubId))
  requireManagerPlus(toTenantContext(trusted, tenant))

  const status: JoinRequestView['status'] = opts.status ?? 'PENDING'
  const pageSize = Math.min(Math.max(opts.pageSize ?? 20, 1), 50)
  const fingerprint = `join.list:${status}`
  let after: { createdAt: number; id: string } | null = null
  if (opts.cursor) {
    const cursor = decodeCursor(opts.cursor, { action: 'join.list', clubId, fingerprint })
    after = { createdAt: cursor.sort[0] as number, id: cursor.sort[1] as string }
  }

  const entries = (
    await deps.db.query(COLLECTIONS.joinRequests, (doc) => doc.clubId === clubId && doc.status === status)
  )
    .map((doc) => ({ createdAt: doc.createdAt as number, id: doc._id, doc }))
    .sort((a, b) =>
      a.createdAt !== b.createdAt ? b.createdAt - a.createdAt : a.id < b.id ? 1 : a.id > b.id ? -1 : 0
    )
    .filter(
      (entry) =>
        after === null ||
        entry.createdAt < after.createdAt ||
        (entry.createdAt === after.createdAt && entry.id < after.id)
    )

  const slice = entries.slice(0, pageSize + 1)
  const hasMore = slice.length > pageSize
  const page = slice.slice(0, pageSize)
  const items = page.map((entry) => toJoinRequestView(entry.doc))
  const last = page[page.length - 1]
  const nextCursor =
    hasMore && last
      ? encodeCursor({ v: 1, action: 'join.list', clubId, fingerprint, sort: [last.createdAt, last.id] })
      : null

  return { items, nextCursor, hasMore, asOf: new Date(now).toISOString() }
}

export interface ApproveJoinResult {
  joinRequestId: string
  memberId: string
  created: boolean
}

/**
 * 批准入队（TEAM、manager+）。
 * - 批准即授权：先验目标 user 为 NORMAL（BLOCKED 拒绝），再建 membership（role=member）。
 * - 已在册 ACTIVE：只收敛申请，不覆盖既有 role/name/joinedAt。
 * - 栅栏：actor member、本队 club、目标 user.securityMutationSeq（actor 与目标同账号也只写一次）。
 */
export async function approveJoinRequest(
  deps: JoinDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  input: { joinRequestId: string; mutationId: string }
): Promise<ApproveJoinResult> {
  const now = deps.now()
  const run = await runIdempotent(
    deps.db,
    now,
    {
      scope: { kind: 'TEAM', clubId },
      actorIdentityId: identityId(trusted.appId, trusted.openid),
      action: 'join.approve',
      mutationId: input.mutationId,
      data: { joinRequestId: input.joinRequestId },
    },
    async (tx) => {
      const tenant = await resolveTenant(tx, trusted, clubId)
      requireManagerPlus(toTenantContext(trusted, tenant))

      const req = await tx.get(COLLECTIONS.joinRequests, input.joinRequestId)
      if (!req || req.clubId !== clubId) throw new AppError('resource_not_found')
      if (req.status !== 'PENDING') throw new AppError('invalid_transition', '该申请已被处理')

      const userId = req.userId as string
      const targetUser = await tx.get(COLLECTIONS.users, userId)
      if (!targetUser) throw new AppError('identity_required')
      if (targetUser.securityState === 'BLOCKED') throw new AppError('account_blocked', '申请人账号已封禁')

      const mId = memberId(clubId, userId)
      const existing = await tx.get(COLLECTIONS.members, mId)
      let created = false
      if (existing && existing.status === 'ACTIVE') {
        // 已是成员：不重复建号，也不改既有 role/displayName/joinedAt
      } else if (existing) {
        throw new AppError('invalid_transition', '该账号在本队的成员状态不允许入队')
      } else {
        await tx.set(COLLECTIONS.members, {
          _id: mId,
          clubId,
          userId,
          displayName: (req.name as string) ?? '',
          duty: null,
          role: 'member',
          status: 'ACTIVE',
          createdAt: now,
          joinedAt: now,
          revision: 1,
          mutationSeq: 0,
        })
        created = true
      }

      await tx.set(COLLECTIONS.joinRequests, {
        ...req,
        status: 'APPROVED',
        resolution: 'MANUAL',
        reviewedByMemberId: tenant.member._id,
        reviewedAt: now,
        revision: ((req.revision as number) ?? 0) + 1,
        updatedAt: now,
      })

      await bumpMemberFence(tx, tenant.member, now)
      await bumpClubFence(tx, tenant.club, now)
      await bumpUserSecurity(tx, userId, now)

      await writeAudit(tx, {
        scope: `TEAM:${clubId}`,
        actorMemberId: tenant.member._id,
        action: 'join.approve',
        resourceType: 'join_request',
        resourceId: req._id,
        seed: input.mutationId,
        now,
      })
      return { joinRequestId: req._id, memberId: mId, created }
    }
  )
  return run.result
}

export interface RejectJoinResult {
  joinRequestId: string
}

/**
 * 驳回入队（TEAM、manager+）。
 * - 理由必填；不建立 membership、不触碰目标 user（驳回不涉及授权授予）。
 * - 栅栏：actor member、本队 club。
 */
export async function rejectJoinRequest(
  deps: JoinDeps,
  trusted: { appId: string; openid: string },
  clubId: string,
  input: { joinRequestId: string; rejectReason: string; mutationId: string }
): Promise<RejectJoinResult> {
  const now = deps.now()
  const rejectReason = normalizeSingleLine(input.rejectReason, {
    field: '驳回原因',
    min: 1,
    max: 200,
  })
  const run = await runIdempotent(
    deps.db,
    now,
    {
      scope: { kind: 'TEAM', clubId },
      actorIdentityId: identityId(trusted.appId, trusted.openid),
      action: 'join.reject',
      mutationId: input.mutationId,
      data: { joinRequestId: input.joinRequestId, rejectReason },
    },
    async (tx) => {
      const tenant = await resolveTenant(tx, trusted, clubId)
      requireManagerPlus(toTenantContext(trusted, tenant))

      const req = await tx.get(COLLECTIONS.joinRequests, input.joinRequestId)
      if (!req || req.clubId !== clubId) throw new AppError('resource_not_found')
      if (req.status !== 'PENDING') throw new AppError('invalid_transition', '该申请已被处理')

      await tx.set(COLLECTIONS.joinRequests, {
        ...req,
        status: 'REJECTED',
        resolution: rejectReason,
        reviewedByMemberId: tenant.member._id,
        reviewedAt: now,
        revision: ((req.revision as number) ?? 0) + 1,
        updatedAt: now,
      })

      await bumpMemberFence(tx, tenant.member, now)
      await bumpClubFence(tx, tenant.club, now)

      await writeAudit(tx, {
        scope: `TEAM:${clubId}`,
        actorMemberId: tenant.member._id,
        action: 'join.reject',
        resourceType: 'join_request',
        resourceId: req._id,
        seed: input.mutationId,
        now,
      })
      return { joinRequestId: req._id }
    }
  )
  return run.result
}
