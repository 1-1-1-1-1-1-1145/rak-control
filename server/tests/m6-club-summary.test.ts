import assert from 'node:assert/strict'
import test from 'node:test'

import { clubDashboard, getClub, profileSummary, updateClub } from '../modules/club/index.ts'
import { listMembers } from '../modules/members/index.ts'
import { addMemberWithIdentity, labelIds, seedTeam, type SeedResult } from './helpers.ts'

function deps(seed: SeedResult) {
  return { db: seed.db, now: seed.clock.now }
}

test('club.get：成员可读本队，输出不含 tenantId', async () => {
  const seed = await seedTeam()
  const member = await addMemberWithIdentity(seed.db, seed.clubId, 'm1', '小张', 'member')

  const view = await getClub(deps(seed), member.identity, seed.clubId)
  assert.equal(view.clubId, seed.clubId)
  assert.equal(view.status, 'ACTIVE')
  assert.equal(Object.prototype.hasOwnProperty.call(view, 'tenantId'), false)
  assert.equal((view.settings as { memberDirectoryVisible?: boolean }).memberDirectoryVisible, true)
})

test('club.update：白名单与权限，未知设置键拒绝', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)
  const member = await addMemberWithIdentity(seed.db, seed.clubId, 'm1', '小张', 'member')

  await assert.rejects(
    () =>
      updateClub(deps(seed), member.identity, seed.clubId, {
        name: '改名',
        expectedRevision: 1,
        mutationId: ids('member'),
      }),
    (e: unknown) => (e as { code?: string }).code === 'permission_denied'
  )

  await assert.rejects(
    () =>
      updateClub(deps(seed), seed.ownerIdentity, seed.clubId, {
        settings: { unknownFlag: true },
        expectedRevision: 1,
        mutationId: ids('bad-setting'),
      }),
    (e: unknown) => (e as { code?: string }).code === 'validation_failed'
  )

  await assert.rejects(
    () =>
      updateClub(deps(seed), seed.ownerIdentity, seed.clubId, {
        logoUrl: 'ftp://example.com/logo.png',
        expectedRevision: 1,
        mutationId: ids('bad-logo'),
      }),
    (e: unknown) => (e as { code?: string }).code === 'validation_failed'
  )

  await assert.rejects(
    () =>
      updateClub(deps(seed), seed.ownerIdentity, seed.clubId, {
        name: '超出上限的名称'.repeat(20),
        expectedRevision: 1,
        mutationId: ids('bad-name'),
      }),
    (e: unknown) => (e as { code?: string }).code === 'validation_failed'
  )

  const updated = await updateClub(deps(seed), seed.ownerIdentity, seed.clubId, {
    name: '摄影社·新版',
    description: '我们是一群喜欢摄影的同学',
    logoUrl: 'https://example.com/logo.png',
    expectedRevision: 1,
    mutationId: ids('ok'),
  })
  assert.equal(updated.name, '摄影社·新版')
  assert.equal(updated.revision, 2)

  await assert.rejects(
    () =>
      updateClub(deps(seed), seed.ownerIdentity, seed.clubId, {
        name: '再次改名',
        expectedRevision: 1,
        mutationId: ids('stale'),
      }),
    (e: unknown) => (e as { code?: string }).code === 'revision_conflict'
  )
})

test('名册关闭仍可返回授权在册总数，不泄露明细', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)
  const member = await addMemberWithIdentity(seed.db, seed.clubId, 'm1', '小张', 'member')
  await addMemberWithIdentity(seed.db, seed.clubId, 'm2', '小李', 'member', 'DISABLED')

  await updateClub(deps(seed), seed.ownerIdentity, seed.clubId, {
    settings: { memberDirectoryVisible: false },
    expectedRevision: 1,
    mutationId: ids('close'),
  })

  await assert.rejects(
    () => listMembers(deps(seed), member.identity, seed.clubId, {}),
    (e: unknown) => (e as { code?: string }).code === 'permission_denied'
  )

  const dashboard = await clubDashboard(deps(seed), member.identity, seed.clubId)
  assert.equal(dashboard.activeMemberCount, 2) // owner + m1（DISABLED 不计）
  assert.equal(Object.prototype.hasOwnProperty.call(dashboard, 'members'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(dashboard, 'total'), false)
})

test('club.dashboard：显式摘要；普通成员无管理摘要', async () => {
  const seed = await seedTeam()
  const member = await addMemberWithIdentity(seed.db, seed.clubId, 'm1', '小张', 'member')

  const asMember = await clubDashboard(deps(seed), member.identity, seed.clubId)
  assert.equal(Object.prototype.hasOwnProperty.call(asMember, 'pendingReviewCount'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(asMember, 'topPerformers'), false)
  assert.equal(typeof asMember.openTaskCount, 'number')
  assert.equal(typeof asMember.myInProgressCount, 'number')
  assert.equal(typeof asMember.mySubmittedCount, 'number')
  assert.ok(Array.isArray(asMember.latestPublishedAnnouncements))
  assert.ok(asMember.asOf)

  const asOwner = await clubDashboard(deps(seed), seed.ownerIdentity, seed.clubId)
  assert.equal(asOwner.pendingReviewCount, 0)
  assert.ok(Array.isArray(asOwner.topPerformers))
})

test('profile.summary：只返回本人任务与绩效摘要', async () => {
  const seed = await seedTeam()
  const member = await addMemberWithIdentity(seed.db, seed.clubId, 'm1', '小张', 'member')

  const summary = await profileSummary(deps(seed), member.identity, seed.clubId)
  assert.equal(summary.memberId, member.memberId)
  assert.equal(summary.clubId, seed.clubId)
  assert.deepEqual(summary.taskCounts, { claimed: 0, approved: 0, rejected: 0, inProgress: 0 })
  assert.equal(summary.performance.memberId, member.memberId)
  assert.equal(summary.performance.compositeScore, 0)
  assert.ok(summary.asOf)
})
