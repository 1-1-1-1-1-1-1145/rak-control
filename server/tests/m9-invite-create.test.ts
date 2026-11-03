import assert from 'node:assert/strict'
import test from 'node:test'

import { COLLECTIONS } from '../repositories/collections.ts'
import { mutationFactory, seedTeam } from './helpers.ts'
import * as invites from '../modules/invites/index.ts'

/**
 * 邀请码生成回归用例（2026-10-18）。
 *
 * 真实云端故障：`rak_invites.sceneTokenHash` 有 `unique + sparse` 索引，
 * 而 MongoDB 的 sparse **只排除字段缺失**，`null` 仍会被索引。旧实现写入
 * `sceneTokenHash: null` → 第一条成功后，第二条永远唯一冲突（E11000）→
 * 服务端未捕获 → `internal_error`（前端"服务开小差了"）。
 *
 * 本用例守住两点：
 * 1. 连续生成 N 条邀请码都成功（不依赖索引，语义上保证不会写入重复的可索引值）；
 * 2. 写入的邀请码文档**不得包含 `sceneTokenHash` 键**（未启用小程序码时）。
 */

test('连续生成两个邀请码：均成功，且不写 sceneTokenHash（避免 sparse-unique 的 null 冲突）', async () => {
  const seed = await seedTeam()
  const nextMutationId = mutationFactory(seed.clock)
  const deps = { db: seed.db, now: seed.clock.now }

  const first = await invites.createInvite(deps, seed.ownerIdentity, seed.clubId, {
    mutationId: nextMutationId(),
  })
  const second = await invites.createInvite(deps, seed.ownerIdentity, seed.clubId, {
    mutationId: nextMutationId(),
  })

  assert.notEqual(first.inviteId, second.inviteId)
  assert.equal(first.replayed, false)
  assert.equal(second.replayed, false)
  assert.ok(first.plaintextCode && second.plaintextCode)

  const docs = await seed.db.query(COLLECTIONS.invites, () => true)
  assert.equal(docs.length, 2)
  for (const doc of docs) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(doc, 'sceneTokenHash'),
      false,
      '未启用小程序码时不得写入 sceneTokenHash（含 null）'
    )
  }

  // 列表读取不因字段缺失而失败
  const list = await invites.listInvites(deps, seed.ownerIdentity, seed.clubId)
  assert.equal(list.length, 2)
})

test('同 mutationId 重放：不重复创建、不返回明文', async () => {
  const seed = await seedTeam()
  const mutationId = mutationFactory(seed.clock)()
  const deps = { db: seed.db, now: seed.clock.now }

  const first = await invites.createInvite(deps, seed.ownerIdentity, seed.clubId, { mutationId })
  const replay = await invites.createInvite(deps, seed.ownerIdentity, seed.clubId, { mutationId })

  assert.equal(replay.replayed, true)
  assert.equal(replay.inviteId, first.inviteId)
  assert.equal(replay.plaintextCode, null)
  assert.equal((await seed.db.query(COLLECTIONS.invites, () => true)).length, 1)
})
