import assert from 'node:assert/strict'
import test from 'node:test'

import { COLLECTIONS } from '../repositories/collections.ts'
import { approveTask, claimTask, createTask, rejectTask, submitTask } from '../modules/tasks/index.ts'
import { MAX_SCAN, listPerformance, myPerformance } from '../modules/performance/index.ts'
import { addMemberWithIdentity, labelIds, seedTeam, type SeedResult } from './helpers.ts'

function deps(seed: SeedResult) {
  return { db: seed.db, now: seed.clock.now }
}

let taskSeq = 0

async function newTask(seed: SeedResult, ids: (label: string) => string) {
  taskSeq += 1
  return createTask(deps(seed), seed.ownerIdentity, seed.clubId, {
    title: '海报设计',
    description: '完成一张活动海报',
    category: 'content',
    mutationId: ids(`create-${taskSeq}`),
  })
}

test('绩效口径：通过/驳回去重/进行中/综合分', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)
  const m1 = await addMemberWithIdentity(seed.db, seed.clubId, 'm1', '小张', 'member')
  const m2 = await addMemberWithIdentity(seed.db, seed.clubId, 'm2', '小李', 'member')

  // T1：认领→交付→通过 A
  const t1 = await newTask(seed, ids)
  await claimTask(deps(seed), m1.identity, seed.clubId, {
    taskId: t1.taskId,
    expectedRevision: 1,
    mutationId: ids('c1'),
  })
  const s1 = await submitTask(deps(seed), m1.identity, seed.clubId, {
    taskId: t1.taskId,
    note: '完成',
    attachmentIds: [],
    expectedRevision: 2,
    mutationId: ids('s1'),
  })
  await approveTask(deps(seed), seed.ownerIdentity, seed.clubId, {
    taskId: t1.taskId,
    submissionId: s1.submission.submissionId,
    grade: 'A',
    expectedRevision: 3,
    mutationId: ids('a1'),
  })

  // T2：两轮均被驳回 → 同一 task 只计 1 次
  const t2 = await newTask(seed, ids)
  await claimTask(deps(seed), m1.identity, seed.clubId, {
    taskId: t2.taskId,
    expectedRevision: 1,
    mutationId: ids('c2'),
  })
  const r1 = await submitTask(deps(seed), m1.identity, seed.clubId, {
    taskId: t2.taskId,
    note: '第一版',
    attachmentIds: [],
    expectedRevision: 2,
    mutationId: ids('s2'),
  })
  await rejectTask(deps(seed), seed.ownerIdentity, seed.clubId, {
    taskId: t2.taskId,
    submissionId: r1.submission.submissionId,
    reason: '不合格',
    expectedRevision: 3,
    mutationId: ids('rj1'),
  })
  const r2 = await submitTask(deps(seed), m1.identity, seed.clubId, {
    taskId: t2.taskId,
    note: '第二版',
    attachmentIds: [],
    expectedRevision: 4,
    mutationId: ids('s3'),
  })
  await rejectTask(deps(seed), seed.ownerIdentity, seed.clubId, {
    taskId: t2.taskId,
    submissionId: r2.submission.submissionId,
    reason: '仍不合格',
    expectedRevision: 5,
    mutationId: ids('rj2'),
  })

  const m1View = await myPerformance(deps(seed), m1.identity, seed.clubId)
  assert.equal(m1View.claimedCount, 2)
  assert.equal(m1View.approvedCount, 1)
  assert.equal(m1View.rejectedCount, 1)
  assert.equal(m1View.inProgressCount, 1)
  assert.equal(m1View.completionRate, 0.5)
  assert.equal(m1View.avgQualityScore, 90)
  assert.equal(m1View.compositeScore, 45)

  const m2View = await myPerformance(deps(seed), m2.identity, seed.clubId)
  assert.equal(m2View.claimedCount, 0)
  assert.equal(m2View.approvedCount, 0)
  assert.equal(m2View.rejectedCount, 0)
  assert.equal(m2View.inProgressCount, 0)
  assert.equal(m2View.completionRate, 0)
  assert.equal(m2View.avgQualityScore, null)
  assert.equal(m2View.compositeScore, 0)

  // 全榜仅 manager+；同分按 memberId asc
  await assert.rejects(
    () => listPerformance(deps(seed), m1.identity, seed.clubId, {}),
    (e: unknown) => (e as { code?: string }).code === 'permission_denied'
  )

  const board = await listPerformance(deps(seed), seed.ownerIdentity, seed.clubId, { pageSize: 50 })
  assert.equal(board.items[0].memberId, m1.memberId)
  assert.equal(board.items[0].compositeScore, 45)
  const zeros = board.items.filter((item) => item.compositeScore === 0).map((item) => item.memberId)
  assert.deepEqual(zeros, [...zeros].sort())
  assert.ok(zeros.includes(m2.memberId))
})

test('绩效扫描超预算返回 stats_unavailable，不返回部分榜单', async () => {
  const seed = await seedTeam()
  const m1 = await addMemberWithIdentity(seed.db, seed.clubId, 'm1', '小张', 'member')

  await seed.db.tx(async (tx) => {
    for (let i = 0; i <= MAX_SCAN; i += 1) {
      await tx.set(COLLECTIONS.tasks, {
        _id: `task${i}`,
        clubId: seed.clubId,
        title: '批量',
        description: '',
        category: 'content',
        repo: null,
        acceptanceCriteria: null,
        status: 'OPEN',
        assigneeMemberId: null,
        claimedAt: null,
        submittedAt: null,
        currentRound: 0,
        lastSubmissionId: null,
        revision: 1,
        createdByMemberId: seed.ownerMemberId,
        createdAt: 1,
        updatedAt: 1,
      })
    }
  })

  await assert.rejects(
    () => myPerformance(deps(seed), m1.identity, seed.clubId),
    (e: unknown) => (e as { code?: string }).code === 'stats_unavailable'
  )
  await assert.rejects(
    () => listPerformance(deps(seed), seed.ownerIdentity, seed.clubId, {}),
    (e: unknown) => (e as { code?: string }).code === 'stats_unavailable'
  )
})
