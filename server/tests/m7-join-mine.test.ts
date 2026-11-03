import assert from 'node:assert/strict'
import test from 'node:test'

import { COLLECTIONS } from '../repositories/collections.ts'
import { joinRequestId } from '../repositories/ids.ts'
import { listMine, type JoinDeps } from '../modules/join/index.ts'
import { encodeCursor } from '../shared/cursor.ts'
import { addMemberWithIdentity, seedTeam, type SeedResult } from './helpers.ts'

function deps(seed: SeedResult): JoinDeps {
  return { db: seed.db, now: seed.clock.now, joinSecret: 'test-secret' }
}

async function seedJoinRequest(seed: SeedResult, openid: string, status: 'PENDING' | 'APPROVED' | 'REJECTED', createdAt: number) {
  const userId = `user-${openid}`
  await seed.db.tx(async (tx) => {
    await tx.set(COLLECTIONS.joinRequests, {
      _id: joinRequestId(seed.clubId, userId),
      clubId: seed.clubId,
      userId,
      name: '申请人',
      wechat: 'wxid',
      reason: '想加入',
      status,
      attemptNo: 1,
      resolution: null,
      revision: 1,
      createdAt,
      updatedAt: createdAt,
      reviewedAt: status === 'PENDING' ? null : createdAt,
    })
  })
}

test('join.mine 只返回本人申请，含本队最小字段', async () => {
  const seed = await seedTeam()
  const me = await addMemberWithIdentity(seed.db, seed.clubId, 'me', '我', 'member')
  await addMemberWithIdentity(seed.db, seed.clubId, 'other', '别人', 'member')

  await seedJoinRequest(seed, 'me', 'PENDING', 1)
  await seedJoinRequest(seed, 'other', 'PENDING', 2)

  const page = await listMine(deps(seed), me.identity, {})
  assert.equal(page.items.length, 1)
  assert.equal(page.items[0].clubId, seed.clubId)
  assert.equal(page.items[0].clubName, '摄影社')
  assert.equal(page.items[0].status, 'PENDING')
  assert.equal(page.items[0].name, '申请人')
  assert.equal(page.items[0].reviewedAt, null)
  assert.ok(page.asOf)
})

test('join.mine：稳定倒序分页不漏重；异 scope cursor 拒绝', async () => {
  const seed = await seedTeam()
  const me = await addMemberWithIdentity(seed.db, seed.clubId, 'me', '我', 'member')

  // 同一账号在本队只有一条申请（确定性主键），故用不同 clubId 铺两条以验证跨队分页
  const userId = 'user-me'
  await seed.db.tx(async (tx) => {
    for (const [clubId, createdAt] of [
      ['clubA', 1],
      ['clubB', 2],
    ] as const) {
      await tx.set(COLLECTIONS.joinRequests, {
        _id: joinRequestId(clubId, userId),
        clubId,
        userId,
        name: '我',
        wechat: 'wxid',
        reason: '想加入',
        status: 'PENDING',
        attemptNo: 1,
        resolution: null,
        revision: 1,
        createdAt,
        updatedAt: createdAt,
        reviewedAt: null,
      })
      await tx.set(COLLECTIONS.clubs, {
        _id: clubId,
        name: `队-${clubId}`,
        slug: clubId,
        displayCode: clubId.toUpperCase(),
        ownerMemberId: 'x',
        status: 'ACTIVE',
        settings: { memberDirectoryVisible: true },
        revision: 1,
        mutationSeq: 0,
        createdAt: 1,
        updatedAt: 1,
      })
    }
  })

  const first = await listMine(deps(seed), me.identity, { pageSize: 1 })
  assert.equal(first.items.length, 1)
  assert.equal(first.hasMore, true)
  assert.ok(first.nextCursor)

  const second = await listMine(deps(seed), me.identity, { pageSize: 1, cursor: first.nextCursor as string })
  assert.equal(second.items.length, 1)
  assert.equal(second.hasMore, false)
  assert.notEqual(second.items[0].joinRequestId, first.items[0].joinRequestId)

  await assert.rejects(
    () => listMine(deps(seed), me.identity, { cursor: encodeCursor({ v: 1, action: 'join.status', clubId: null, fingerprint: 'x', sort: [1, 'a'] }) }),
    (e: unknown) => (e as { code?: string }).code === 'cursor_scope_mismatch'
  )
  // TEAM cursor（带 clubId）不得用于账户级列表
  await assert.rejects(
    () =>
      listMine(deps(seed), me.identity, {
        cursor: encodeCursor({ v: 1, action: 'join.mine', clubId: seed.clubId, fingerprint: 'join.mine:self', sort: [1, 'a'] }),
      }),
    (e: unknown) => (e as { code?: string }).code === 'cursor_scope_mismatch'
  )
})

test('join.mine：未识别身份拒绝（不泄露任何申请）', async () => {
  const seed = await seedTeam()
  await assert.rejects(
    () => listMine(deps(seed), { appId: 'wxa', openid: 'never-seen' }, {}),
    (e: unknown) => (e as { code?: string }).code === 'identity_required'
  )
})
