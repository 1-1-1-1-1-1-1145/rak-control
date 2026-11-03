import assert from 'node:assert/strict'
import test from 'node:test'

import { commandStatus } from '../modules/tasks/index.ts'
import { createTask } from '../modules/tasks/index.ts'
import { setRole } from '../modules/members/index.ts'
import { memberId } from '../repositories/ids.ts'
import { addMemberWithIdentity, labelIds, mutationFactory, seedTeam, uuidV7From } from './helpers.ts'

const DAY = 24 * 60 * 60 * 1000

test('command.status：已成功命令返回 SUCCEEDED 与最小结果', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)
  const deps = { db: seed.db, now: seed.clock.now }
  const mutationId = ids('create')

  const task = await createTask(deps, seed.ownerIdentity, seed.clubId, {
    title: 'T',
    description: 'D',
    category: 'content',
    mutationId,
  })

  const status = await commandStatus(deps, seed.ownerIdentity, { kind: 'TEAM', clubId: seed.clubId }, {
    action: 'task.create',
    mutationId,
  })
  assert.equal(status.status, 'SUCCEEDED')
  assert.equal((status.resultSummary as { taskId?: string }).taskId, task.taskId)
})

test('command.status：查不到为 ABSENT_IN_WINDOW；超 7 天为 EXPIRED', async () => {
  const seed = await seedTeam()
  const deps = { db: seed.db, now: seed.clock.now }

  const freshMissing = await commandStatus(deps, seed.ownerIdentity, { kind: 'TEAM', clubId: seed.clubId }, {
    action: 'task.create',
    mutationId: uuidV7From(seed.clock.now() - 60 * 1000, 7),
  })
  assert.equal(freshMissing.status, 'ABSENT_IN_WINDOW')

  const expired = await commandStatus(deps, seed.ownerIdentity, { kind: 'TEAM', clubId: seed.clubId }, {
    action: 'task.create',
    mutationId: uuidV7From(seed.clock.now() - 8 * DAY, 9),
  })
  assert.equal(expired.status, 'EXPIRED')
})

test('command.status：结果窗口过期后不再返回完整响应', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)
  const deps = { db: seed.db, now: seed.clock.now }
  const mutationId = ids('retained')

  await createTask(deps, seed.ownerIdentity, seed.clubId, {
    title: 'T',
    description: 'D',
    category: 'content',
    mutationId,
  })
  seed.clock.advance(8 * DAY)
  const status = await commandStatus(deps, seed.ownerIdentity, { kind: 'TEAM', clubId: seed.clubId }, {
    action: 'task.create',
    mutationId,
  })
  assert.equal(status.status, 'EXPIRED')
  assert.equal(status.resultSummary, null)
})

test('命令重放：成员被降权后不得继续读取旧管理结果', async () => {
  const seed = await seedTeam()
  const manager = await addMemberWithIdentity(seed.db, seed.clubId, 'manager-openid', '经理', 'manager')
  const nextMutationId = mutationFactory(seed.clock)
  const deps = { db: seed.db, now: seed.clock.now }
  const mutationId = nextMutationId()

  await createTask(deps, manager.identity, seed.clubId, {
    title: 'T',
    description: 'D',
    category: 'content',
    mutationId,
  })
  await setRole(deps, seed.ownerIdentity, seed.clubId, {
    targetMemberId: manager.memberId,
    targetRole: 'member',
    expectedRevision: 1,
    mutationId: nextMutationId(),
  })

  await assert.rejects(
    () =>
      createTask(deps, manager.identity, seed.clubId, {
        title: 'T',
        description: 'D',
        category: 'content',
        mutationId,
      }),
    (e: unknown) => (e as { code?: string }).code === 'permission_denied'
  )
  await assert.rejects(
    () =>
      commandStatus(deps, manager.identity, { kind: 'TEAM', clubId: seed.clubId }, {
        action: 'task.create',
        mutationId,
      }),
    (e: unknown) => (e as { code?: string }).code === 'permission_denied'
  )
})

test('command.status：同 mutationId 两队互不泄露', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)
  const deps = { db: seed.db, now: seed.clock.now }
  const mutationId = ids('create')

  await createTask(deps, seed.ownerIdentity, seed.clubId, {
    title: 'T',
    description: 'D',
    category: 'content',
    mutationId,
  })

  // 在 B 队（同人在此仅有成员资格）查询同键 → 无该队命令，ABSENT_IN_WINDOW，不返回 A 的结果
  await seed.db.tx(async (tx) => {
    await tx.set('rak_clubs', {
      _id: 'clubB',
      name: 'B队',
      slug: 'b',
      displayCode: 'B1',
      ownerMemberId: 'x',
      status: 'ACTIVE',
      settings: { memberDirectoryVisible: true },
      revision: 1,
      mutationSeq: 0,
      createdAt: 1,
      updatedAt: 1,
    })
    await tx.set('rak_members', {
      _id: memberId('clubB', seed.ownerUserId),
      clubId: 'clubB',
      userId: seed.ownerUserId,
      displayName: '王同学',
      duty: null,
      role: 'member',
      status: 'ACTIVE',
      createdAt: 1,
      joinedAt: 1,
      revision: 1,
      mutationSeq: 0,
    })
  })

  const inB = await commandStatus(deps, seed.ownerIdentity, { kind: 'TEAM', clubId: 'clubB' }, {
    action: 'task.create',
    mutationId,
  })
  assert.equal(inB.status, 'ABSENT_IN_WINDOW')
  assert.equal(inB.resultSummary, null)
})
