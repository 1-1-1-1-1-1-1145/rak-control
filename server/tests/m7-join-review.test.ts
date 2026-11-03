import assert from 'node:assert/strict'
import test from 'node:test'

import { MemoryDatabase } from '../repositories/store.ts'
import { COLLECTIONS } from '../repositories/collections.ts'
import { identityId, joinRequestId, memberId } from '../repositories/ids.ts'
import {
  approveJoinRequest,
  listJoinRequests,
  rejectJoinRequest,
  type JoinDeps,
} from '../modules/join/index.ts'
import { encodeCursor } from '../shared/cursor.ts'
import { APP_ID, addMemberWithIdentity, mutationFactory, seedTeam, type SeedResult } from './helpers.ts'

/** M7：本队入队申请审批（join.list/approve/reject）——替身层，非真实云鉴权。 */

function deps(seed: SeedResult): JoinDeps {
  return { db: seed.db, now: seed.clock.now, joinSecret: 'test-secret' }
}

/** 只有身份/账户、尚未入队的申请人（审批前的目标 user 必须存在）。 */
async function addApplicant(
  db: MemoryDatabase,
  openid: string,
  securityState: 'NORMAL' | 'BLOCKED' = 'NORMAL'
): Promise<string> {
  const userId = `user-${openid}`
  await db.tx(async (tx) => {
    await tx.set(COLLECTIONS.identities, {
      _id: identityId(APP_ID, openid),
      appId: APP_ID,
      openid,
      userId,
      createdAt: 1,
      updatedAt: 1,
    })
    await tx.set(COLLECTIONS.users, {
      _id: userId,
      securityState,
      securityMutationSeq: 0,
      createdAt: 1,
      updatedAt: 1,
    })
  })
  return userId
}

async function seedRequest(
  db: MemoryDatabase,
  clubId: string,
  userId: string,
  opts: { status?: 'PENDING' | 'APPROVED' | 'REJECTED'; createdAt?: number } = {}
) {
  const createdAt = opts.createdAt ?? 1
  const id = joinRequestId(clubId, userId)
  await db.tx(async (tx) => {
    await tx.set(COLLECTIONS.joinRequests, {
      _id: id,
      clubId,
      userId,
      name: '申请人',
      wechat: 'wxid-1',
      reason: '想加入',
      status: opts.status ?? 'PENDING',
      attemptNo: 1,
      resolution: null,
      reviewedByMemberId: null,
      revision: 1,
      createdAt,
      updatedAt: createdAt,
      reviewedAt: null,
    })
  })
  return id
}

test('join.approve：manager 批准 → 建号(role=member)、申请 APPROVED、审计与栅栏递增', async () => {
  const seed = await seedTeam()
  const mgr = await addMemberWithIdentity(seed.db, seed.clubId, 'mgr', '经理', 'manager')
  const userId = await addApplicant(seed.db, 'applicant')
  const reqId = await seedRequest(seed.db, seed.clubId, userId)
  const next = mutationFactory(seed.clock)

  const clubBefore = (await seed.db.read(COLLECTIONS.clubs, seed.clubId))?.mutationSeq as number
  const mgrBefore = (await seed.db.read(COLLECTIONS.members, mgr.memberId))?.mutationSeq as number

  const result = await approveJoinRequest(deps(seed), mgr.identity, seed.clubId, {
    joinRequestId: reqId,
    mutationId: next(),
  })
  assert.equal(result.created, true)
  assert.equal(result.memberId, memberId(seed.clubId, userId))

  const member = await seed.db.read(COLLECTIONS.members, result.memberId)
  assert.ok(member)
  assert.equal(member.role, 'member')
  assert.equal(member.status, 'ACTIVE')
  assert.equal(member.displayName, '申请人')
  assert.equal(member.duty, null)

  const req = await seed.db.read(COLLECTIONS.joinRequests, reqId)
  assert.equal(req?.status, 'APPROVED')
  assert.equal(req?.resolution, 'MANUAL')
  assert.equal(req?.reviewedByMemberId, mgr.memberId)

  const user = await seed.db.read(COLLECTIONS.users, userId)
  assert.equal(user?.securityMutationSeq, 1)
  assert.equal(((await seed.db.read(COLLECTIONS.clubs, seed.clubId))?.mutationSeq as number), clubBefore + 1)
  assert.equal(((await seed.db.read(COLLECTIONS.members, mgr.memberId))?.mutationSeq as number), mgrBefore + 1)

  const audits = await seed.db.query(COLLECTIONS.audit, (doc) => doc.action === 'join.approve')
  assert.equal(audits.length, 1)
  assert.equal(audits[0].scope, `TEAM:${seed.clubId}`)
  assert.equal(audits[0].resourceId, reqId)
})

test('join.approve：普通成员无审批权（permission_denied）', async () => {
  const seed = await seedTeam()
  const plain = await addMemberWithIdentity(seed.db, seed.clubId, 'plain', '普通', 'member')
  const userId = await addApplicant(seed.db, 'applicant')
  const reqId = await seedRequest(seed.db, seed.clubId, userId)

  await assert.rejects(
    () =>
      approveJoinRequest(deps(seed), plain.identity, seed.clubId, {
        joinRequestId: reqId,
        mutationId: mutationFactory(seed.clock)(),
      }),
    (e: unknown) => (e as { code?: string }).code === 'permission_denied'
  )
  assert.ok(!(await seed.db.read(COLLECTIONS.members, memberId(seed.clubId, userId))))
})

test('join.reject：理由必填；成功不建号、只收敛申请', async () => {
  const seed = await seedTeam()
  const mgr = await addMemberWithIdentity(seed.db, seed.clubId, 'mgr', '经理', 'manager')
  const userId = await addApplicant(seed.db, 'applicant')
  const reqId = await seedRequest(seed.db, seed.clubId, userId)
  const next = mutationFactory(seed.clock)

  await assert.rejects(
    () =>
      rejectJoinRequest(deps(seed), mgr.identity, seed.clubId, {
        joinRequestId: reqId,
        rejectReason: '  ',
        mutationId: next(),
      }),
    (e: unknown) => (e as { code?: string }).code === 'validation_failed'
  )

  const result = await rejectJoinRequest(deps(seed), mgr.identity, seed.clubId, {
    joinRequestId: reqId,
    rejectReason: '资料不完整',
    mutationId: next(),
  })
  assert.equal(result.joinRequestId, reqId)
  const req = await seed.db.read(COLLECTIONS.joinRequests, reqId)
  assert.equal(req?.status, 'REJECTED')
  assert.equal(req?.resolution, '资料不完整')
  assert.ok(!(await seed.db.read(COLLECTIONS.members, memberId(seed.clubId, userId))))
  assert.equal((await seed.db.query(COLLECTIONS.audit, (doc) => doc.action === 'join.reject')).length, 1)
})

test('异队申请不可见/不可审批（统一 resource_not_found）', async () => {
  const seed = await seedTeam()
  const mgr = await addMemberWithIdentity(seed.db, seed.clubId, 'mgr', '经理', 'manager')
  const userId = await addApplicant(seed.db, 'applicant')
  const otherClubId = 'clubOther'
  await seed.db.tx(async (tx) => {
    await tx.set(COLLECTIONS.clubs, {
      _id: otherClubId,
      name: '别队',
      slug: 'other',
      displayCode: 'OTHER',
      ownerMemberId: 'x',
      status: 'ACTIVE',
      settings: { memberDirectoryVisible: true },
      revision: 1,
      mutationSeq: 0,
      createdAt: 1,
      updatedAt: 1,
    })
  })
  const otherReqId = await seedRequest(seed.db, otherClubId, userId, { createdAt: 5 })
  const ownReqId = await seedRequest(seed.db, seed.clubId, userId)

  const page = await listJoinRequests(deps(seed), mgr.identity, seed.clubId)
  assert.deepEqual(
    page.items.map((item) => item.joinRequestId),
    [ownReqId]
  )

  await assert.rejects(
    () =>
      approveJoinRequest(deps(seed), mgr.identity, seed.clubId, {
        joinRequestId: otherReqId,
        mutationId: mutationFactory(seed.clock)(),
      }),
    (e: unknown) => (e as { code?: string }).code === 'resource_not_found'
  )
})

test('join.approve：目标账号已封禁 → account_blocked（批准前校验目标 NORMAL）', async () => {
  const seed = await seedTeam()
  const mgr = await addMemberWithIdentity(seed.db, seed.clubId, 'mgr', '经理', 'manager')
  const userId = await addApplicant(seed.db, 'blocked-applicant', 'BLOCKED')
  const reqId = await seedRequest(seed.db, seed.clubId, userId)

  await assert.rejects(
    () =>
      approveJoinRequest(deps(seed), mgr.identity, seed.clubId, {
        joinRequestId: reqId,
        mutationId: mutationFactory(seed.clock)(),
      }),
    (e: unknown) => (e as { code?: string }).code === 'account_blocked'
  )
  assert.ok(!(await seed.db.read(COLLECTIONS.members, memberId(seed.clubId, userId))))
  assert.equal((await seed.db.read(COLLECTIONS.joinRequests, reqId))?.status, 'PENDING')
})

test('join.approve：同 mutationId 幂等回放；已处理申请再次操作被拒', async () => {
  const seed = await seedTeam()
  const mgr = await addMemberWithIdentity(seed.db, seed.clubId, 'mgr', '经理', 'manager')
  const userId = await addApplicant(seed.db, 'applicant')
  const reqId = await seedRequest(seed.db, seed.clubId, userId)
  const next = mutationFactory(seed.clock)
  const mutationId = next()

  const first = await approveJoinRequest(deps(seed), mgr.identity, seed.clubId, { joinRequestId: reqId, mutationId })
  const replay = await approveJoinRequest(deps(seed), mgr.identity, seed.clubId, { joinRequestId: reqId, mutationId })
  assert.deepEqual(replay, first)
  assert.equal((await seed.db.query(COLLECTIONS.members, (doc) => doc.userId === userId)).length, 1)

  await assert.rejects(
    () => approveJoinRequest(deps(seed), mgr.identity, seed.clubId, { joinRequestId: reqId, mutationId: next() }),
    (e: unknown) => (e as { code?: string }).code === 'invalid_transition'
  )
})

test('join.list：默认仅 PENDING、稳定倒序分页不漏重、异 scope 游标拒绝', async () => {
  const seed = await seedTeam()
  const mgr = await addMemberWithIdentity(seed.db, seed.clubId, 'mgr', '经理', 'manager')
  const a = await addApplicant(seed.db, 'a')
  const b = await addApplicant(seed.db, 'b')
  const c = await addApplicant(seed.db, 'c')
  await seedRequest(seed.db, seed.clubId, a, { createdAt: 1 })
  await seedRequest(seed.db, seed.clubId, b, { createdAt: 2 })
  await seedRequest(seed.db, seed.clubId, c, { status: 'APPROVED', createdAt: 3 })

  const first = await listJoinRequests(deps(seed), mgr.identity, seed.clubId, { pageSize: 1 })
  assert.equal(first.items.length, 1)
  assert.equal(first.items[0].applicantName, '申请人')
  assert.equal(first.items[0].attemptNo, 1)
  assert.equal(first.hasMore, true)
  assert.ok(first.nextCursor)

  const second = await listJoinRequests(deps(seed), mgr.identity, seed.clubId, {
    pageSize: 1,
    cursor: first.nextCursor as string,
  })
  assert.equal(second.items.length, 1)
  assert.equal(second.hasMore, false)
  assert.notEqual(second.items[0].joinRequestId, first.items[0].joinRequestId)

  const approved = await listJoinRequests(deps(seed), mgr.identity, seed.clubId, { status: 'APPROVED' })
  assert.equal(approved.items.length, 1)
  assert.equal(approved.items[0].status, 'APPROVED')

  await assert.rejects(
    () =>
      listJoinRequests(deps(seed), mgr.identity, seed.clubId, {
        cursor: encodeCursor({ v: 1, action: 'join.mine', clubId: null, fingerprint: 'join.list:PENDING', sort: [1, 'a'] }),
      }),
    (e: unknown) => (e as { code?: string }).code === 'cursor_scope_mismatch'
  )
})

test('join.list/approve 的 DTO 不含他人全局身份（openid/appid/userId）', async () => {
  const seed = await seedTeam()
  const mgr = await addMemberWithIdentity(seed.db, seed.clubId, 'mgr', '经理', 'manager')
  const userId = await addApplicant(seed.db, 'applicant')
  const reqId = await seedRequest(seed.db, seed.clubId, userId)

  const page = await listJoinRequests(deps(seed), mgr.identity, seed.clubId)
  const item = page.items[0] as unknown as Record<string, unknown>
  assert.equal(item.userId, undefined)
  assert.equal(item.openid, undefined)
  assert.equal(item.appid, undefined)
  assert.equal(item.joinRequestId, reqId)

  const result = (await approveJoinRequest(deps(seed), mgr.identity, seed.clubId, {
    joinRequestId: reqId,
    mutationId: mutationFactory(seed.clock)(),
  })) as unknown as Record<string, unknown>
  assert.equal(result.userId, undefined)
  assert.equal(result.created, true)
})
