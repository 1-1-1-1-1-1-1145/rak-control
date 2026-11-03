import assert from 'node:assert/strict'
import test from 'node:test'

import { COLLECTIONS } from '../repositories/collections.ts'
import { bootstrap } from '../modules/auth/index.ts'
import { enter, listMine } from '../modules/teams/index.ts'
import { addMemberWithIdentity, seedTeam, APP_ID, ENV, type SeedResult } from './helpers.ts'

function deps(seed: SeedResult) {
  return { db: seed.db, now: seed.clock.now }
}

async function seedClub(seed: SeedResult, clubId: string, name: string, code: string, createdAt: number) {
  await seed.db.tx(async (tx) => {
    await tx.set(COLLECTIONS.clubs, {
      _id: clubId,
      name,
      slug: clubId,
      displayCode: code,
      ownerMemberId: 'x',
      status: 'ACTIVE',
      settings: { memberDirectoryVisible: true },
      revision: 1,
      mutationSeq: 0,
      createdAt,
      updatedAt: createdAt,
    })
    await tx.set(COLLECTIONS.members, {
      _id: `m-${clubId}`,
      clubId,
      userId: seed.ownerUserId,
      displayName: '王同学',
      duty: null,
      role: 'member',
      status: 'ACTIVE',
      createdAt,
      joinedAt: createdAt,
      revision: 1,
      mutationSeq: 0,
    })
  })
}

test('team.listMine：只返回本人成员关联，按 createdAt/id 稳定分页', async () => {
  const seed = await seedTeam()
  const base = seed.clock.now()
  await seedClub(seed, 'clubX', '机器人社', 'B9M4', base + 2)
  await seedClub(seed, 'clubY', '另一社', 'C3R5', base + 1)

  const page1 = await listMine(deps(seed), seed.ownerIdentity, { pageSize: 2 })
  assert.equal(page1.hasMore, true)
  assert.ok(page1.nextCursor)
  assert.deepEqual(
    page1.items.map((i) => i.clubId),
    ['clubX', 'clubY']
  )

  const page2 = await listMine(deps(seed), seed.ownerIdentity, {
    pageSize: 2,
    cursor: page1.nextCursor as string,
  })
  assert.equal(page2.hasMore, false)
  assert.deepEqual(
    page2.items.map((i) => i.clubId),
    [seed.clubId]
  )
})

test('team.enter：ACTIVE 成员返回本队 TeamSession', async () => {
  const seed = await seedTeam()
  const session = await enter(deps(seed), seed.ownerIdentity, seed.clubId)
  assert.equal(session.club.id, seed.clubId)
  assert.equal(session.member.role, 'super_admin')
  assert.equal(session.member.status, 'ACTIVE')
  assert.ok(session.permissions.includes('member.setRole'))
})

test('team.enter：非成员 / 停用 / 维护分别拒绝', async () => {
  const seed = await seedTeam()

  const stranger = { appId: APP_ID, openid: 'stranger', env: ENV }
  await bootstrap(seed.authDeps, stranger)
  await assert.rejects(
    () => enter(deps(seed), stranger, seed.clubId),
    (e: unknown) => (e as { code?: string }).code === 'membership_required'
  )

  await addMemberWithIdentity(seed.db, seed.clubId, 'disabled-openid', '停用者', 'member', 'DISABLED')
  const disabledIdentity = { appId: APP_ID, openid: 'disabled-openid', env: ENV }
  await assert.rejects(
    () => enter(deps(seed), disabledIdentity, seed.clubId),
    (e: unknown) => (e as { code?: string }).code === 'membership_disabled'
  )

  await seed.db.tx(async (tx) => {
    const club = await tx.get(COLLECTIONS.clubs, seed.clubId)
    if (!club) throw new Error('夹具：club 缺失')
    await tx.set(COLLECTIONS.clubs, { ...club, status: 'MAINTENANCE' })
  })
  await assert.rejects(
    () => enter(deps(seed), seed.ownerIdentity, seed.clubId),
    (e: unknown) => (e as { code?: string }).code === 'team_maintenance'
  )
})

test('team.listMine：BLOCKED 账户不得读取团队列表', async () => {
  const seed = await seedTeam()
  await seed.db.tx(async (tx) => {
    const user = await tx.get(COLLECTIONS.users, seed.ownerUserId)
    if (!user) throw new Error('夹具：用户缺失')
    await tx.set(COLLECTIONS.users, { ...user, securityState: 'BLOCKED' })
  })
  await assert.rejects(
    () => listMine(deps(seed), seed.ownerIdentity),
    (e: unknown) => (e as { code?: string }).code === 'account_blocked'
  )
})
