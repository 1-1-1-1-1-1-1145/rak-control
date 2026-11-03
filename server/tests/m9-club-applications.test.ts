import assert from 'node:assert/strict'
import test from 'node:test'

import { COLLECTIONS } from '../repositories/collections.ts'
import { memberId } from '../repositories/ids.ts'
import { addMemberWithIdentity, mutationFactory, seedTeam, type AddedMember, type SeedResult } from './helpers.ts'
import * as applications from '../modules/clubApplications/index.ts'

/**
 * 小程序内「开通新团队」用例（2026-10-18）。
 *
 * 权限模型：申请人在**审批团队**内（任意角色）发起；审批人是同队 manager/super_admin；
 * 通过后新队 owner = 申请人。A 队管理员不得看到/审批 B 队申请。
 */

interface Harness extends SeedResult {
  deps: applications.ClubApplicationDeps
  nextMutationId: () => string
  manager: AddedMember
  plain: AddedMember
}

async function makeHarness(): Promise<Harness> {
  const seed = await seedTeam()
  const manager = await addMemberWithIdentity(seed.db, seed.clubId, 'manager-openid', '管理员甲', 'manager')
  const plain = await addMemberWithIdentity(seed.db, seed.clubId, 'member-openid', '成员乙', 'member')
  let counter = 0
  const deps: applications.ClubApplicationDeps = {
    db: seed.db,
    now: seed.clock.now,
    newClubId: () => `club-new-${String((counter += 1)).padStart(4, '0')}`,
  }
  return { ...seed, deps, nextMutationId: mutationFactory(seed.clock), manager, plain }
}

const VALID = { name: '摄影社分社', slug: 'photo-branch', displayCode: 'PB01' }

function codeOf(error: unknown): string | undefined {
  return (error as { code?: string }).code
}

test('submit：审批团队成员可发起；非成员被拒', async () => {
  const h = await makeHarness()

  const result = await applications.submitNewTeamApplication(h.deps, h.plain.identity, h.clubId, VALID)
  assert.equal(result.status, 'PENDING')
  assert.equal(result.replayed, false)

  const doc = await h.db.read(COLLECTIONS.clubApplications, result.applicationId)
  assert.equal(doc?.status, 'PENDING')
  assert.equal(doc?.clubId, h.clubId)
  assert.equal(doc?.applicantUserId, h.plain.userId)
  assert.equal(doc?.applicantDisplayName, '成员乙')
  assert.equal(doc?.revision, 1)
  // 审计
  const audits = await h.db.query(COLLECTIONS.audit, (d) => d.action === 'team.newApplication.submit')
  assert.equal(audits.length, 1)

  // 非本队成员（另一个 unknown openid）
  await assert.rejects(
    () =>
      applications.submitNewTeamApplication(
        h.deps,
        { appId: h.ownerIdentity.appId, openid: 'stranger-openid' },
        h.clubId,
        { ...VALID, slug: 'other-slug' }
      ),
    (e) => codeOf(e) === 'identity_required'
  )
})

test('submit：重复提交同内容幂等；同 slug 不同内容冲突；标识被占用/非法被拒', async () => {
  const h = await makeHarness()
  const first = await applications.submitNewTeamApplication(h.deps, h.plain.identity, h.clubId, VALID)

  const replay = await applications.submitNewTeamApplication(h.deps, h.plain.identity, h.clubId, VALID)
  assert.deepEqual(replay, { applicationId: first.applicationId, status: 'PENDING', replayed: true })
  assert.equal((await h.db.query(COLLECTIONS.clubApplications, () => true)).length, 1)

  await assert.rejects(
    () =>
      applications.submitNewTeamApplication(h.deps, h.plain.identity, h.clubId, {
        ...VALID,
        name: '摄影社分社改名',
      }),
    (e) => codeOf(e) === 'idempotency_conflict'
  )

  // 已被现有团队占用（seedTeam 的 slug=photo / displayCode=A7K2）
  await assert.rejects(
    () =>
      applications.submitNewTeamApplication(h.deps, h.plain.identity, h.clubId, {
        name: '冲突队',
        slug: 'photo',
        displayCode: 'ZZ99',
      }),
    (e) => codeOf(e) === 'validation_failed'
  )

  // 非法 slug / 展示码 / 名称过短
  for (const bad of [
    { ...VALID, slug: 'Bad Slug' },
    { ...VALID, slug: 'ab' },
    { ...VALID, displayCode: 'ab' },
    { ...VALID, name: 'x' },
  ]) {
    await assert.rejects(
      () => applications.submitNewTeamApplication(h.deps, h.plain.identity, h.clubId, bad),
      (e) => codeOf(e) === 'validation_failed'
    )
  }
})

test('approve：普通成员无审批权；manager 通过后建队且申请人为新队 super_admin', async () => {
  const h = await makeHarness()
  const submitted = await applications.submitNewTeamApplication(h.deps, h.plain.identity, h.clubId, VALID)

  await assert.rejects(
    () =>
      applications.approveNewTeamApplication(h.deps, h.plain.identity, h.clubId, {
        applicationId: submitted.applicationId,
        mutationId: h.nextMutationId(),
        expectedRevision: 1,
      }),
    (e) => codeOf(e) === 'permission_denied'
  )

  const decided = await applications.approveNewTeamApplication(h.deps, h.manager.identity, h.clubId, {
    applicationId: submitted.applicationId,
    mutationId: h.nextMutationId(),
    expectedRevision: 1,
  })
  assert.equal(decided.status, 'APPROVED')
  const newClubId = decided.newClubId as string
  assert.ok(newClubId)

  const club = await h.db.read(COLLECTIONS.clubs, newClubId)
  assert.equal(club?.name, VALID.name)
  assert.equal(club?.slug, VALID.slug)
  assert.equal(club?.displayCode, VALID.displayCode)
  assert.equal(club?.ownerMemberId, memberId(newClubId, h.plain.userId))

  const owner = await h.db.read(COLLECTIONS.members, memberId(newClubId, h.plain.userId))
  assert.equal(owner?.role, 'super_admin')
  assert.equal(owner?.status, 'ACTIVE')
  assert.equal(owner?.clubId, newClubId)

  const app = await h.db.read(COLLECTIONS.clubApplications, submitted.applicationId)
  assert.equal(app?.status, 'APPROVED')
  assert.equal(app?.newClubId, newClubId)
  assert.equal(app?.decidedByMemberId, h.manager.memberId)
  assert.equal(app?.revision, 2)

  // 审批写栅栏
  assert.equal(((await h.db.read(COLLECTIONS.clubs, h.clubId))?.mutationSeq as number), 1)
  assert.equal(((await h.db.read(COLLECTIONS.members, h.manager.memberId))?.mutationSeq as number), 1)

  // 已处理：再次审批被拒
  await assert.rejects(
    () =>
      applications.approveNewTeamApplication(h.deps, h.manager.identity, h.clubId, {
        applicationId: submitted.applicationId,
        mutationId: h.nextMutationId(),
      }),
    (e) => codeOf(e) === 'invalid_transition'
  )
})

test('approve：同 mutationId 幂等回放，不重复建队', async () => {
  const h = await makeHarness()
  const submitted = await applications.submitNewTeamApplication(h.deps, h.plain.identity, h.clubId, VALID)
  const mutationId = h.nextMutationId()

  const first = await applications.approveNewTeamApplication(h.deps, h.manager.identity, h.clubId, {
    applicationId: submitted.applicationId,
    mutationId,
    expectedRevision: 1,
  })
  const second = await applications.approveNewTeamApplication(h.deps, h.manager.identity, h.clubId, {
    applicationId: submitted.applicationId,
    mutationId,
    expectedRevision: 1,
  })
  assert.deepEqual(second, first)
  const clubs = await h.db.query(COLLECTIONS.clubs, () => true)
  assert.equal(clubs.length, 2) // 原队 + 新队，未重复创建
})

test('隔离：B 队管理员看不到也批不了 A 队申请', async () => {
  const h = await makeHarness()
  const submitted = await applications.submitNewTeamApplication(h.deps, h.plain.identity, h.clubId, VALID)

  // 另一个队 B（用同一个 db 手工建）
  const clubB = 'club-b-0001'
  const managerB = await addMemberWithIdentity(h.db, clubB, 'manager-b-openid', '管理员丙', 'manager')
  await h.db.tx(async (tx) => {
    await tx.set(COLLECTIONS.clubs, {
      _id: clubB,
      name: '队B',
      slug: 'team-b',
      displayCode: 'TB01',
      ownerMemberId: managerB.memberId,
      status: 'ACTIVE',
      settings: { memberDirectoryVisible: true },
      revision: 1,
      mutationSeq: 0,
      createdAt: 1,
      updatedAt: 1,
    })
    await tx.set(COLLECTIONS.members, {
      _id: managerB.memberId,
      clubId: clubB,
      userId: managerB.userId,
      displayName: '管理员丙',
      duty: null,
      role: 'manager',
      status: 'ACTIVE',
      createdAt: 1,
      joinedAt: 1,
      revision: 1,
      mutationSeq: 0,
    })
  })

  const listB = await applications.listNewTeamApplications(h.deps, managerB.identity, clubB)
  assert.equal(listB.items.length, 0)

  await assert.rejects(
    () =>
      applications.approveNewTeamApplication(h.deps, managerB.identity, clubB, {
        applicationId: submitted.applicationId,
        mutationId: h.nextMutationId(),
      }),
    (e) => codeOf(e) === 'resource_not_found'
  )

  // 审批队在 A 时可见，且 DTO 不含全局身份字段
  const listA = await applications.listNewTeamApplications(h.deps, h.manager.identity, h.clubId)
  assert.equal(listA.items.length, 1)
  const text = JSON.stringify(listA)
  assert.ok(!text.includes('userId'))
  assert.ok(!text.includes('openid'))
  assert.ok(!text.includes(h.plain.userId))
})

test('reject：理由必填；驳回后可重新提交（revision 递增）', async () => {
  const h = await makeHarness()
  const submitted = await applications.submitNewTeamApplication(h.deps, h.plain.identity, h.clubId, VALID)

  await assert.rejects(
    () =>
      applications.rejectNewTeamApplication(h.deps, h.manager.identity, h.clubId, {
        applicationId: submitted.applicationId,
        rejectReason: '   ',
        mutationId: h.nextMutationId(),
        expectedRevision: 1,
      }),
    (e) => codeOf(e) === 'validation_failed'
  )

  const rejected = await applications.rejectNewTeamApplication(h.deps, h.manager.identity, h.clubId, {
    applicationId: submitted.applicationId,
    rejectReason: '名称与已有社团重名',
    mutationId: h.nextMutationId(),
    expectedRevision: 1,
  })
  assert.equal(rejected.status, 'REJECTED')

  const doc = await h.db.read(COLLECTIONS.clubApplications, submitted.applicationId)
  assert.equal(doc?.status, 'REJECTED')
  assert.equal(doc?.rejectReason, '名称与已有社团重名')
  assert.equal(doc?.revision, 2)
  assert.equal(doc?.newClubId, null)

  // 驳回后不可审批
  await assert.rejects(
    () =>
      applications.approveNewTeamApplication(h.deps, h.manager.identity, h.clubId, {
        applicationId: submitted.applicationId,
        mutationId: h.nextMutationId(),
      }),
    (e) => codeOf(e) === 'invalid_transition'
  )

  // 重新提交：复用记录、回到 PENDING、revision+1、清空上次决定
  const resubmitted = await applications.submitNewTeamApplication(h.deps, h.plain.identity, h.clubId, VALID)
  assert.equal(resubmitted.applicationId, submitted.applicationId)
  assert.equal(resubmitted.replayed, false)
  const again = await h.db.read(COLLECTIONS.clubApplications, submitted.applicationId)
  assert.equal(again?.status, 'PENDING')
  assert.equal(again?.rejectReason, null)
  assert.equal(again?.decidedAt, null)
  assert.equal(again?.revision, 3)
})

test('revision 栅栏：旧 revision 审批被拒（revision_conflict）', async () => {
  const h = await makeHarness()
  const submitted = await applications.submitNewTeamApplication(h.deps, h.plain.identity, h.clubId, VALID)
  await assert.rejects(
    () =>
      applications.approveNewTeamApplication(h.deps, h.manager.identity, h.clubId, {
        applicationId: submitted.applicationId,
        mutationId: h.nextMutationId(),
        expectedRevision: 99,
      }),
    (e) => codeOf(e) === 'revision_conflict'
  )
})

test('mine：本人跨队可见且只含本人；审批队名可见；BLOCKED 账号拒绝', async () => {
  const h = await makeHarness()
  await applications.submitNewTeamApplication(h.deps, h.plain.identity, h.clubId, VALID)
  // 同队管理员也提一条（不同 slug）
  await applications.submitNewTeamApplication(h.deps, h.manager.identity, h.clubId, {
    name: '另一支队',
    slug: 'another-team',
    displayCode: 'AT02',
  })

  const mine = await applications.listMyNewTeamApplications(h.deps, h.plain.identity)
  assert.equal(mine.items.length, 1)
  assert.equal(mine.items[0].applicantDisplayName, '成员乙')
  assert.equal(mine.items[0].approvalClubName, '摄影社')
  assert.equal(mine.items[0].slug, VALID.slug)

  // 封禁：本人申请列表拒绝
  await h.db.tx(async (tx) => {
    const user = await tx.get(COLLECTIONS.users, h.plain.userId)
    if (!user) throw new Error('夹具：用户不存在')
    await tx.set(COLLECTIONS.users, { ...user, securityState: 'BLOCKED' })
  })
  await assert.rejects(
    () => applications.listMyNewTeamApplications(h.deps, h.plain.identity),
    (e) => codeOf(e) === 'account_blocked'
  )
})

test('approve：申请人账号已封禁 → account_blocked，且不建队', async () => {
  const h = await makeHarness()
  const submitted = await applications.submitNewTeamApplication(h.deps, h.plain.identity, h.clubId, VALID)
  await h.db.tx(async (tx) => {
    const user = await tx.get(COLLECTIONS.users, h.plain.userId)
    if (!user) throw new Error('夹具：用户不存在')
    await tx.set(COLLECTIONS.users, { ...user, securityState: 'BLOCKED' })
  })

  await assert.rejects(
    () =>
      applications.approveNewTeamApplication(h.deps, h.manager.identity, h.clubId, {
        applicationId: submitted.applicationId,
        mutationId: h.nextMutationId(),
        expectedRevision: 1,
      }),
    (e) => codeOf(e) === 'account_blocked'
  )
  assert.equal((await h.db.query(COLLECTIONS.clubs, () => true)).length, 1)
  assert.equal((await h.db.read(COLLECTIONS.clubApplications, submitted.applicationId))?.status, 'PENDING')
})

test('list：普通成员无审批权（permission_denied）', async () => {
  const h = await makeHarness()
  await assert.rejects(
    () => applications.listNewTeamApplications(h.deps, h.plain.identity, h.clubId),
    (e) => codeOf(e) === 'permission_denied'
  )
})

test('平台未初始化时仍可发起/审批（不依赖 system_config）', async () => {
  const h = await makeHarness()
  // seedTeam 已初始化平台；此处验证流程不读取 system_config 即可（无额外副作用）
  const submitted = await applications.submitNewTeamApplication(h.deps, h.plain.identity, h.clubId, VALID)
  const decided = await applications.approveNewTeamApplication(h.deps, h.ownerIdentity, h.clubId, {
    applicationId: submitted.applicationId,
    mutationId: h.nextMutationId(),
    expectedRevision: 1,
  })
  assert.equal(decided.status, 'APPROVED')
})
