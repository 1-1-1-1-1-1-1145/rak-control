import assert from 'node:assert/strict'
import test from 'node:test'

import { COLLECTIONS } from '../repositories/collections.ts'
import { memberId } from '../repositories/ids.ts'
import {
  archiveTask,
  approveTask,
  claimTask,
  createTask,
  getTask,
  listSubmissions,
  rejectTask,
  submitTask,
} from '../modules/tasks/index.ts'
import { addMemberWithIdentity, labelIds, seedTeam, type SeedResult } from './helpers.ts'

function deps(seed: SeedResult) {
  return { db: seed.db, now: seed.clock.now }
}

async function newTask(seed: SeedResult, ids: (label: string) => string) {
  return createTask(deps(seed), seed.ownerIdentity, seed.clubId, {
    title: '海报设计',
    description: '完成一张活动海报',
    category: 'content',
    mutationId: ids('create'),
  })
}

test('任务全流程：OPEN→CLAIMED→SUBMITTED→APPROVED→DONE，轮次独立', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)
  const member = await addMemberWithIdentity(seed.db, seed.clubId, 'm1', '小张', 'member')

  const task = await newTask(seed, ids)
  assert.equal(task.status, 'OPEN')
  assert.equal(task.revision, 1)
  assert.equal(task.createdByMemberId, seed.ownerMemberId)

  const claimed = await claimTask(deps(seed), member.identity, seed.clubId, {
    taskId: task.taskId,
    expectedRevision: 1,
    mutationId: ids('claim'),
  })
  assert.equal(claimed.status, 'CLAIMED')
  assert.equal(claimed.assigneeMemberId, member.memberId)

  const claimedView = await getTask(deps(seed), member.identity, seed.clubId, task.taskId)
  assert.equal(claimedView.createdByName, '王同学')
  assert.equal(claimedView.assigneeName, '小张')

  const sub = await submitTask(deps(seed), member.identity, seed.clubId, {
    taskId: task.taskId,
    note: '已完成',
    attachmentIds: [],
    expectedRevision: 2,
    mutationId: ids('submit'),
  })
  assert.equal(sub.task.status, 'SUBMITTED')
  assert.equal(sub.task.currentRound, 1)
  assert.equal(sub.submission.round, 1)

  const reviewed = await approveTask(deps(seed), seed.ownerIdentity, seed.clubId, {
    taskId: task.taskId,
    submissionId: sub.submission.submissionId,
    grade: 'A',
    expectedRevision: 3,
    mutationId: ids('approve'),
  })
  assert.equal(reviewed.task.status, 'APPROVED')
  assert.equal(reviewed.submission.status, 'APPROVED')

  const approvedView = await getTask(deps(seed), member.identity, seed.clubId, task.taskId)
  assert.equal(approvedView.reviewedByName, '王同学')
  assert.equal(approvedView.reviewedAt, reviewed.submission.reviewedAt)

  const done = await archiveTask(deps(seed), seed.ownerIdentity, seed.clubId, {
    taskId: task.taskId,
    expectedRevision: 4,
    mutationId: ids('archive'),
  })
  assert.equal(done.status, 'DONE')

  const doneView = await getTask(deps(seed), member.identity, seed.clubId, task.taskId)
  assert.equal(doneView.reviewedByName, '王同学')
  assert.equal(doneView.reviewedAt, reviewed.submission.reviewedAt)
})

test('非法迁移：未认领直接交付、未交付直接验收均拒绝', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)
  const member = await addMemberWithIdentity(seed.db, seed.clubId, 'm1', '小张', 'member')
  const task = await newTask(seed, ids)

  await assert.rejects(
    () =>
      submitTask(deps(seed), member.identity, seed.clubId, {
        taskId: task.taskId,
        note: 'x',
        attachmentIds: [],
        expectedRevision: 1,
        mutationId: ids('s1'),
      }),
    (e: unknown) => (e as { code?: string }).code === 'invalid_transition'
  )

  await assert.rejects(
    () =>
      approveTask(deps(seed), seed.ownerIdentity, seed.clubId, {
        taskId: task.taskId,
        submissionId: 'nope',
        grade: 'A',
        expectedRevision: 1,
        mutationId: ids('a1'),
      }),
    (e: unknown) => (e as { code?: string }).code === 'invalid_transition'
  )
})

test('双人竞争认领：恰一成功，另一按 revision/claimable 拒绝', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)
  const a = await addMemberWithIdentity(seed.db, seed.clubId, 'a', 'A', 'member')
  const b = await addMemberWithIdentity(seed.db, seed.clubId, 'b', 'B', 'member')
  const task = await newTask(seed, ids)

  const first = await claimTask(deps(seed), a.identity, seed.clubId, {
    taskId: task.taskId,
    expectedRevision: 1,
    mutationId: ids('ca'),
  })
  assert.equal(first.status, 'CLAIMED')

  await assert.rejects(
    () =>
      claimTask(deps(seed), b.identity, seed.clubId, {
        taskId: task.taskId,
        expectedRevision: 1,
        mutationId: ids('cb'),
      }),
    (e: unknown) => (e as { code?: string }).code === 'revision_conflict'
  )
  await assert.rejects(
    () =>
      claimTask(deps(seed), b.identity, seed.clubId, {
        taskId: task.taskId,
        expectedRevision: 2,
        mutationId: ids('cb2'),
      }),
    (e: unknown) => (e as { code?: string }).code === 'task_not_claimable'
  )
})

test('驳回重交保留轮次历史；旧审核不能作用新轮', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)
  const member = await addMemberWithIdentity(seed.db, seed.clubId, 'm1', '小张', 'member')
  const task = await newTask(seed, ids)
  await claimTask(deps(seed), member.identity, seed.clubId, {
    taskId: task.taskId,
    expectedRevision: 1,
    mutationId: ids('claim'),
  })
  const round1 = await submitTask(deps(seed), member.identity, seed.clubId, {
    taskId: task.taskId,
    note: '第一版',
    attachmentIds: [],
    expectedRevision: 2,
    mutationId: ids('sub1'),
  })
  const rejected = await rejectTask(deps(seed), seed.ownerIdentity, seed.clubId, {
    taskId: task.taskId,
    submissionId: round1.submission.submissionId,
    reason: '不合格',
    expectedRevision: 3,
    mutationId: ids('rej'),
  })
  assert.equal(rejected.task.status, 'REJECTED')

  const round2 = await submitTask(deps(seed), member.identity, seed.clubId, {
    taskId: task.taskId,
    note: '第二版',
    attachmentIds: [],
    expectedRevision: 4,
    mutationId: ids('sub2'),
  })
  assert.equal(round2.submission.round, 2)

  await assert.rejects(
    () =>
      approveTask(deps(seed), seed.ownerIdentity, seed.clubId, {
        taskId: task.taskId,
        submissionId: round1.submission.submissionId,
        grade: 'A',
        expectedRevision: 5,
        mutationId: ids('old-approve'),
      }),
    (e: unknown) => (e as { code?: string }).code === 'invalid_transition'
  )

  const history = await listSubmissions(deps(seed), seed.ownerIdentity, seed.clubId, task.taskId)
  assert.deepEqual(
    history.map((h) => h.round),
    [2, 1]
  )
  assert.equal(history.find((h) => h.round === 1)?.status, 'REJECTED')
})

test('权限：非负责人不能交付，member 不能验收；revision 冲突与跨队指针拒绝', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)
  const assignee = await addMemberWithIdentity(seed.db, seed.clubId, 'm1', '小张', 'member')
  const other = await addMemberWithIdentity(seed.db, seed.clubId, 'm2', '小李', 'member')
  const task = await newTask(seed, ids)

  await assert.rejects(
    () =>
      claimTask(deps(seed), assignee.identity, seed.clubId, {
        taskId: task.taskId,
        expectedRevision: 99,
        mutationId: ids('claim-stale'),
      }),
    (e: unknown) => (e as { code?: string }).code === 'revision_conflict'
  )

  await claimTask(deps(seed), assignee.identity, seed.clubId, {
    taskId: task.taskId,
    expectedRevision: 1,
    mutationId: ids('claim'),
  })

  await assert.rejects(
    () =>
      submitTask(deps(seed), other.identity, seed.clubId, {
        taskId: task.taskId,
        note: '越权',
        attachmentIds: [],
        expectedRevision: 2,
        mutationId: ids('submit-other'),
      }),
    (e: unknown) => (e as { code?: string }).code === 'permission_denied'
  )

  const sub = await submitTask(deps(seed), assignee.identity, seed.clubId, {
    taskId: task.taskId,
    note: '完成',
    attachmentIds: [],
    expectedRevision: 2,
    mutationId: ids('submit'),
  })

  await assert.rejects(
    () =>
      approveTask(deps(seed), assignee.identity, seed.clubId, {
        taskId: task.taskId,
        submissionId: sub.submission.submissionId,
        grade: 'A',
        expectedRevision: 3,
        mutationId: ids('approve-member'),
      }),
    (e: unknown) => (e as { code?: string }).code === 'permission_denied'
  )

  // 同人在另一队有资格，也不能用异队 scope 操作本队任务
  await seed.db.tx(async (tx) => {
    await tx.set(COLLECTIONS.clubs, {
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
    await tx.set(COLLECTIONS.members, {
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
  await assert.rejects(
    () => getTask(deps(seed), seed.ownerIdentity, 'clubB', task.taskId),
    (e: unknown) => (e as { code?: string }).code === 'resource_not_found'
  )
})

test('公共 Task DTO 不含他人交付说明；交付记录仅负责人/管理者可读', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)
  const owner = seed.ownerIdentity
  const assignee = await addMemberWithIdentity(seed.db, seed.clubId, 'm1', '小张', 'member')
  const other = await addMemberWithIdentity(seed.db, seed.clubId, 'm2', '小李', 'member')
  const task = await newTask(seed, ids)
  await claimTask(deps(seed), assignee.identity, seed.clubId, {
    taskId: task.taskId,
    expectedRevision: 1,
    mutationId: ids('claim'),
  })
  const sub = await submitTask(deps(seed), assignee.identity, seed.clubId, {
    taskId: task.taskId,
    note: '私有说明',
    attachmentIds: [],
    expectedRevision: 2,
    mutationId: ids('submit'),
  })

  const publicView = await getTask(deps(seed), other.identity, seed.clubId, task.taskId)
  assert.equal(Object.prototype.hasOwnProperty.call(publicView, 'note'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(publicView, 'attachmentIds'), false)

  const assigneeHistory = await listSubmissions(deps(seed), assignee.identity, seed.clubId, task.taskId)
  assert.equal(assigneeHistory.length, 1)
  const otherHistory = await listSubmissions(deps(seed), other.identity, seed.clubId, task.taskId)
  assert.equal(otherHistory.length, 0)

  const ownerHistory = await listSubmissions(deps(seed), owner, seed.clubId, task.taskId)
  assert.equal(ownerHistory.length, 1)
  assert.equal(ownerHistory[0].note, '私有说明')
  void sub
})
