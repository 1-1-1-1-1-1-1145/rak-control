import assert from 'node:assert/strict'
import test from 'node:test'

import { COLLECTIONS } from '../repositories/collections.ts'
import { identityId } from '../repositories/ids.ts'
import { bootstrap } from '../modules/auth/index.ts'
import { resolveJoinTarget, rotateJoinLink, submit, status } from '../modules/join/index.ts'
import { JOIN_TARGET_TTL_MS } from '../shared/join-token.ts'
import { APP_ID, ENV, labelIds, seedTeam, type SeedResult } from './helpers.ts'

const SECRET = 'test-join-secret'

function joinDeps(seed: SeedResult) {
  return { db: seed.db, now: seed.clock.now, joinSecret: SECRET }
}

async function applicant(seed: SeedResult, openid: string) {
  const identity = { appId: APP_ID, openid, env: ENV }
  await bootstrap(seed.authDeps, identity)
  return identity
}

test('rotate：首次返回明文，重放只回 masked，再次轮换递增版本并撤销旧入口', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)
  const deps = joinDeps(seed)

  const first = await rotateJoinLink(deps, seed.ownerIdentity, seed.clubId, { mutationId: ids('r1') })
  assert.equal(first.replayed, false)
  assert.ok(first.plaintextKey)
  assert.ok(first.maskedCode.includes('••'))

  const replay = await rotateJoinLink(deps, seed.ownerIdentity, seed.clubId, { mutationId: ids('r1') })
  assert.equal(replay.replayed, true)
  assert.equal(replay.plaintextKey, null)
  assert.equal(replay.entryId, first.entryId)

  const second = await rotateJoinLink(deps, seed.ownerIdentity, seed.clubId, { mutationId: ids('r2') })
  assert.notEqual(second.entryId, first.entryId)
  assert.equal(second.plaintextKey !== null, true)

  const state = await seed.db.read(COLLECTIONS.joinEntryStates, seed.clubId)
  assert.equal(state?.entryVersion, 2)
  const oldEntry = await seed.db.read(COLLECTIONS.joinEntries, first.entryId)
  assert.equal(typeof oldEntry?.revokedAt, 'number')
  await assert.rejects(
    () => resolveJoinTarget(deps, seed.ownerIdentity, first.plaintextKey as string),
    (e: unknown) => (e as { code?: string }).code === 'resource_not_found'
  )
})

test('resolveJoinTarget：有效 key 返回最小队信息与短效 token；无效 key 拒绝', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)
  const deps = joinDeps(seed)
  const rotate = await rotateJoinLink(deps, seed.ownerIdentity, seed.clubId, { mutationId: ids('r1') })
  const applicantIdentity = await applicant(seed, 'applicant-1')

  const view = await resolveJoinTarget(deps, applicantIdentity, rotate.plaintextKey as string)
  assert.equal(view.clubId, seed.clubId)
  assert.equal(view.name, '摄影社')
  assert.ok(view.joinTargetToken.length > 20)

  await assert.rejects(
    () => resolveJoinTarget(deps, applicantIdentity, 'definitely-not-a-key'),
    (e: unknown) => (e as { code?: string }).code === 'resource_not_found'
  )
})

test('join.submit：写入本队待审申请；同键重放稳定；轮换后旧 token 失效', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)
  const deps = joinDeps(seed)
  const rotate = await rotateJoinLink(deps, seed.ownerIdentity, seed.clubId, { mutationId: ids('r1') })
  const applicantIdentity = await applicant(seed, 'applicant-1')
  const view = await resolveJoinTarget(deps, applicantIdentity, rotate.plaintextKey as string)

  const input = {
    joinTargetToken: view.joinTargetToken,
    name: '小陈',
    wechat: 'chen',
    reason: '想加入',
    mutationId: ids('s1'),
  }
  const created = await submit(deps, applicantIdentity, input)
  assert.equal(created.status, 'PENDING')
  assert.equal(created.replayed, false)

  const replay = await submit(deps, applicantIdentity, input)
  assert.equal(replay.replayed, true)
  assert.equal(replay.joinRequestId, created.joinRequestId)

  const st = await status(joinDeps(seed), applicantIdentity, created.joinRequestId)
  assert.equal(st.status, 'PENDING')
  assert.equal(st.clubId, seed.clubId)

  await assert.rejects(
    () => status(joinDeps(seed), seed.ownerIdentity, created.joinRequestId),
    (e: unknown) => (e as { code?: string }).code === 'resource_not_found'
  )

  await rotateJoinLink(deps, seed.ownerIdentity, seed.clubId, { mutationId: ids('r2') })
  await assert.rejects(
    () => submit(deps, applicantIdentity, { ...input, mutationId: ids('s2') }),
    (e: unknown) => (e as { code?: string }).code === 'resource_not_found'
  )
})

test('join.submit：过期 token 拒绝；已 ACTIVE 返回 ALREADY_MEMBER', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)
  const deps = joinDeps(seed)
  const rotate = await rotateJoinLink(deps, seed.ownerIdentity, seed.clubId, { mutationId: ids('r1') })

  const applicantIdentity = await applicant(seed, 'applicant-1')
  const view = await resolveJoinTarget(deps, applicantIdentity, rotate.plaintextKey as string)
  seed.clock.advance(JOIN_TARGET_TTL_MS + 1)
  await assert.rejects(
    () =>
      submit(deps, applicantIdentity, {
        joinTargetToken: view.joinTargetToken,
        name: '小陈',
        wechat: 'chen',
        reason: '想加入',
        mutationId: ids('e1'),
      }),
    (e: unknown) => (e as { code?: string }).code === 'command_expired'
  )

  seed.clock.set(1_700_000_000_000)
  const rotate2 = await rotateJoinLink(deps, seed.ownerIdentity, seed.clubId, { mutationId: ids('r2') })
  const ownerView = await resolveJoinTarget(deps, seed.ownerIdentity, rotate2.plaintextKey as string)
  const already = await submit(deps, seed.ownerIdentity, {
    joinTargetToken: ownerView.joinTargetToken,
    name: '王同学',
    wechat: 'wang',
    reason: '再来一次',
    mutationId: ids('a1'),
  })
  assert.equal(already.status, 'ALREADY_MEMBER')
})

test('join：BLOCKED 账户与已解散团队不能继续解析或提交申请', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)
  const deps = joinDeps(seed)
  const rotate = await rotateJoinLink(deps, seed.ownerIdentity, seed.clubId, { mutationId: ids('r1') })
  const applicantIdentity = await applicant(seed, 'blocked-join-applicant')
  const identity = await seed.db.read(COLLECTIONS.identities, identityId(APP_ID, 'blocked-join-applicant'))
  const userId = identity?.userId as string
  const target = await resolveJoinTarget(deps, applicantIdentity, rotate.plaintextKey as string)

  await seed.db.tx(async (tx) => {
    const user = await tx.get(COLLECTIONS.users, userId)
    if (!user) throw new Error('夹具：用户缺失')
    await tx.set(COLLECTIONS.users, { ...user, securityState: 'BLOCKED' })
  })
  await assert.rejects(
    () => resolveJoinTarget(deps, applicantIdentity, rotate.plaintextKey as string),
    (e: unknown) => (e as { code?: string }).code === 'account_blocked'
  )

  await seed.db.tx(async (tx) => {
    const user = await tx.get(COLLECTIONS.users, userId)
    const club = await tx.get(COLLECTIONS.clubs, seed.clubId)
    if (!user || !club) throw new Error('夹具：文档缺失')
    await tx.set(COLLECTIONS.users, { ...user, securityState: 'NORMAL' })
    await tx.set(COLLECTIONS.clubs, { ...club, status: 'DISSOLVED' })
  })
  await assert.rejects(
    () =>
      submit(deps, applicantIdentity, {
        joinTargetToken: target.joinTargetToken,
        name: '申请人',
        wechat: 'wechat',
        reason: '申请加入',
        mutationId: ids('dissolved-submit'),
      }),
    (e: unknown) => (e as { code?: string }).code === 'resource_not_found'
  )
})
