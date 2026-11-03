import assert from 'node:assert/strict'
import test from 'node:test'

import { MemoryDatabase } from '../repositories/store.ts'
import { COLLECTIONS } from '../repositories/collections.ts'
import { REFERENCE_TTL_MS, bootstrap, provisioningReference } from '../modules/auth/index.ts'
import { provisionTeam } from '../modules/provisioning/index.ts'
import { APP_ID, ENV, seedTeam, setupPlatform } from './helpers.ts'

test('受控开通创建 club + 唯一 owner，并消费参考号', async () => {
  const seed = await seedTeam()
  const club = await seed.db.read(COLLECTIONS.clubs, seed.clubId)
  assert.ok(club)
  assert.equal(club?.ownerMemberId, seed.ownerMemberId)
  assert.equal(club?.name, '摄影社')

  const owner = await seed.db.read(COLLECTIONS.members, seed.ownerMemberId)
  assert.equal(owner?.role, 'super_admin')
  assert.equal(owner?.status, 'ACTIVE')
  assert.equal(owner?.userId, seed.ownerUserId)

  const identities = await seed.db.query(COLLECTIONS.identities, (d) => d.openid === 'owner-openid')
  assert.equal(identities.length, 1)
  assert.equal(typeof identities[0].ownerReferenceUsedAt, 'number')
})

test('开通幂等：同键同输入恢复原 club，同键异输入拒绝', async () => {
  const setup = await setupPlatform()
  const input = {
    provisioningKey: 'k1',
    appId: APP_ID,
    env: ENV,
    clubName: '机器人社',
    slug: 'robot',
    displayCode: 'B9M4',
    ownerReferenceCode: setup.code,
    ownerDisplayName: '李同学',
  }
  const first = await provisionTeam(setup.provDeps, input)
  assert.equal(first.replayed, false)

  const replay = await provisionTeam(setup.provDeps, input)
  assert.equal(replay.replayed, true)
  assert.equal(replay.clubId, first.clubId)
  assert.equal(replay.ownerMemberId, first.ownerMemberId)

  await assert.rejects(
    () => provisionTeam(setup.provDeps, { ...input, clubName: '改名社' }),
    (e: unknown) => (e as { code?: string }).code === 'idempotency_conflict'
  )
  assert.equal((await setup.db.query(COLLECTIONS.clubs, () => true)).length, 1)
})

test('同一参考号被两个 provisioningKey 争用只成功一次', async () => {
  const setup = await setupPlatform()
  const base = {
    appId: APP_ID,
    env: ENV,
    clubName: '第二社',
    slug: 'second',
    displayCode: 'C3R5',
    ownerReferenceCode: setup.code,
    ownerDisplayName: '赵同学',
  }
  await provisionTeam(setup.provDeps, { ...base, provisioningKey: 'a' })
  await assert.rejects(
    () => provisionTeam(setup.provDeps, { ...base, provisioningKey: 'b' }),
    (e: unknown) => (e as { code?: string }).code === 'resource_not_found'
  )
  assert.equal((await setup.db.query(COLLECTIONS.clubs, () => true)).length, 1)
})

test('过期参考号不可开通', async () => {
  const setup = await setupPlatform()
  setup.clock.advance(REFERENCE_TTL_MS + 1)
  await assert.rejects(
    () =>
      provisionTeam(setup.provDeps, {
        provisioningKey: 'late',
        appId: APP_ID,
        env: ENV,
        clubName: '逾期社',
        slug: 'late',
        displayCode: 'D4S6',
        ownerReferenceCode: setup.code,
        ownerDisplayName: '钱同学',
      }),
    (e: unknown) => (e as { code?: string }).code === 'resource_not_found'
  )
})

test('平台未初始化时开通失败（setup_required）', async () => {
  const db = new MemoryDatabase()
  const now = () => 1_700_000_000_000
  const authDeps = { db, now }
  const identity = { appId: APP_ID, openid: 'nobody', env: ENV }
  await bootstrap(authDeps, identity)
  const ref = await provisioningReference(authDeps, identity)
  if (ref.state !== 'ISSUED') throw new Error('夹具失败')

  const provDeps = { db, now, newClubId: () => 'club999999' }
  await assert.rejects(
    () =>
      provisionTeam(provDeps, {
        provisioningKey: 'x',
        appId: APP_ID,
        env: ENV,
        clubName: '未初始化社',
        slug: 'uninit',
        displayCode: 'E5T7',
        ownerReferenceCode: ref.code,
        ownerDisplayName: '孙同学',
      }),
    (e: unknown) => (e as { code?: string }).code === 'setup_required'
  )
})
