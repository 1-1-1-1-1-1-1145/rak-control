import assert from 'node:assert/strict'
import test from 'node:test'

import { COLLECTIONS } from '../repositories/collections.ts'
import { identityId, joinRequestId } from '../repositories/ids.ts'
import { bootstrap } from '../modules/auth/index.ts'
import { createInvite, listInvites, redeem, revokeInvite } from '../modules/invites/index.ts'
import { APP_ID, ENV, addMemberWithIdentity, labelIds, seedTeam, type SeedResult } from './helpers.ts'

function inviteDeps(seed: SeedResult) {
  return { db: seed.db, now: seed.clock.now }
}

async function applicant(seed: SeedResult, openid: string) {
  const identity = { appId: APP_ID, openid, env: ENV }
  await bootstrap(seed.authDeps, identity)
  return identity
}

test('invite.create：12 位码当次显示明文，重放只回 masked；列表不含明文', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)
  const deps = inviteDeps(seed)

  const created = await createInvite(deps, seed.ownerIdentity, seed.clubId, { mutationId: ids('c1') })
  assert.equal(created.plaintextCode?.length, 12)
  assert.ok(/^[A-HJ-NP-Z2-9]{12}$/.test(created.plaintextCode as string))
  assert.ok(created.maskedCode.includes('••'))

  const replay = await createInvite(deps, seed.ownerIdentity, seed.clubId, { mutationId: ids('c1') })
  assert.equal(replay.replayed, true)
  assert.equal(replay.plaintextCode, null)
  assert.equal(replay.inviteId, created.inviteId)

  const list = await listInvites(deps, seed.ownerIdentity, seed.clubId)
  assert.equal(list.length, 1)
  assert.equal(list[0].maskedCode, created.maskedCode)
  assert.equal((list[0] as unknown as { code?: string }).code, undefined)
})

test('invite.redeem：原子扣额 + 建 member；同键重放不多扣；申请收敛为 APPROVED', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)
  const deps = inviteDeps(seed)
  const created = await createInvite(deps, seed.ownerIdentity, seed.clubId, {
    maxUses: 2,
    mutationId: ids('c1'),
  })
  const user = await applicant(seed, 'app1')

  const userId = ((await seed.db.read(COLLECTIONS.identities, identityId(APP_ID, 'app1')))?.userId as string) ?? ''
  await seed.db.tx(async (tx) => {
    await tx.set(COLLECTIONS.joinRequests, {
      _id: joinRequestId(seed.clubId, userId),
      clubId: seed.clubId,
      userId,
      name: '小陈',
      wechat: 'chen',
      reason: '想加入',
      status: 'PENDING',
      attemptNo: 1,
      resolution: null,
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
    })
  })

  const result = await redeem(deps, user, {
    code: created.plaintextCode as string,
    displayName: '小陈',
    mutationId: ids('d1'),
  })
  assert.equal(result.status, 'ACTIVE')
  assert.equal(result.clubId, seed.clubId)

  const converged = await seed.db.read(COLLECTIONS.joinRequests, joinRequestId(seed.clubId, userId))
  assert.equal(converged?.status, 'APPROVED')
  assert.equal(converged?.resolution, 'INVITE')

  const member = await seed.db.read(COLLECTIONS.members, result.memberId)
  assert.equal(member?.role, 'member')
  assert.equal(member?.displayName, '小陈')
  assert.equal((await seed.db.read(COLLECTIONS.invites, created.inviteId))?.usedCount, 1)

  const replay = await redeem(deps, user, {
    code: created.plaintextCode as string,
    displayName: '小陈',
    mutationId: ids('d1'),
  })
  assert.equal(replay.replayed, true)
  assert.equal((await seed.db.read(COLLECTIONS.invites, created.inviteId))?.usedCount, 1)

  const again = await redeem(deps, user, {
    code: created.plaintextCode as string,
    displayName: '小陈',
    mutationId: ids('d2'),
  })
  assert.equal(again.status, 'ALREADY_MEMBER')
  assert.equal((await seed.db.read(COLLECTIONS.invites, created.inviteId))?.usedCount, 1)
})

test('末次额度竞争：同一码两次兑换只成功一次', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)
  const deps = inviteDeps(seed)
  const created = await createInvite(deps, seed.ownerIdentity, seed.clubId, {
    maxUses: 1,
    mutationId: ids('c1'),
  })
  const userA = await applicant(seed, 'a')
  const userB = await applicant(seed, 'b')

  const first = await redeem(deps, userA, {
    code: created.plaintextCode as string,
    displayName: 'A',
    mutationId: ids('d1'),
  })
  assert.equal(first.status, 'ACTIVE')

  await assert.rejects(
    () => redeem(deps, userB, { code: created.plaintextCode as string, displayName: 'B', mutationId: ids('d2') }),
    (e: unknown) => (e as { code?: string }).code === 'validation_failed'
  )
  assert.equal((await seed.db.read(COLLECTIONS.invites, created.inviteId))?.usedCount, 1)
})

test('invite：撤销/过期不可兑换；DISABLED 不能借码复活', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)
  const deps = inviteDeps(seed)

  const revoked = await createInvite(deps, seed.ownerIdentity, seed.clubId, { mutationId: ids('c1') })
  await revokeInvite(deps, seed.ownerIdentity, seed.clubId, {
    inviteId: revoked.inviteId,
    mutationId: ids('v1'),
  })
  const user = await applicant(seed, 'app1')
  await assert.rejects(
    () => redeem(deps, user, { code: revoked.plaintextCode as string, displayName: '小陈', mutationId: ids('d1') }),
    (e: unknown) => (e as { code?: string }).code === 'validation_failed'
  )

  const expired = await createInvite(deps, seed.ownerIdentity, seed.clubId, {
    expiresInDays: 1,
    mutationId: ids('c2'),
  })
  seed.clock.advance(2 * 24 * 60 * 60 * 1000)
  await assert.rejects(
    () => redeem(deps, user, { code: expired.plaintextCode as string, displayName: '小陈', mutationId: ids('d2') }),
    (e: unknown) => (e as { code?: string }).code === 'validation_failed'
  )

  seed.clock.set(1_700_000_000_000)
  const fresh = await createInvite(deps, seed.ownerIdentity, seed.clubId, { mutationId: ids('c3') })
  const disabled = await addMemberWithIdentity(seed.db, seed.clubId, 'app1', '小陈', 'member', 'DISABLED')
  assert.ok(disabled)
  await assert.rejects(
    () => redeem(deps, user, { code: fresh.plaintextCode as string, displayName: '小陈', mutationId: ids('d3') }),
    (e: unknown) => (e as { code?: string }).code === 'membership_disabled'
  )
})

test('invite.redeem：BLOCKED 账户和已解散团队均不可兑换', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)
  const deps = inviteDeps(seed)
  const created = await createInvite(deps, seed.ownerIdentity, seed.clubId, { mutationId: ids('c1') })
  const user = await applicant(seed, 'blocked-applicant')
  const identity = await seed.db.read(COLLECTIONS.identities, identityId(APP_ID, 'blocked-applicant'))
  const userId = identity?.userId as string

  await seed.db.tx(async (tx) => {
    const account = await tx.get(COLLECTIONS.users, userId)
    if (!account) throw new Error('夹具：用户缺失')
    await tx.set(COLLECTIONS.users, { ...account, securityState: 'BLOCKED' })
  })
  await assert.rejects(
    () => redeem(deps, user, { code: created.plaintextCode as string, displayName: '申请人', mutationId: ids('d1') }),
    (e: unknown) => (e as { code?: string }).code === 'account_blocked'
  )

  await seed.db.tx(async (tx) => {
    const account = await tx.get(COLLECTIONS.users, userId)
    const club = await tx.get(COLLECTIONS.clubs, seed.clubId)
    if (!account || !club) throw new Error('夹具：文档缺失')
    await tx.set(COLLECTIONS.users, { ...account, securityState: 'NORMAL' })
    await tx.set(COLLECTIONS.clubs, { ...club, status: 'DISSOLVED' })
  })
  await assert.rejects(
    () => redeem(deps, user, { code: created.plaintextCode as string, displayName: '申请人', mutationId: ids('d2') }),
    (e: unknown) => (e as { code?: string }).code === 'resource_not_found'
  )
  assert.equal((await seed.db.read(COLLECTIONS.invites, created.inviteId))?.usedCount, 0)
})
