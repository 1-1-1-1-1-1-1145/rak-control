import assert from 'node:assert/strict'
import test from 'node:test'

import { COLLECTIONS } from '../repositories/collections.ts'
import { memberId } from '../repositories/ids.ts'
import { addMemberWithIdentity, mutationFactory, seedTeam, type AddedMember, type SeedResult } from './helpers.ts'
import * as dismissals from '../modules/dismissals/index.ts'
import * as dissolutions from '../modules/dissolutions/index.ts'
import * as members from '../modules/members/index.ts'
import * as teams from '../modules/teams/index.ts'
import { commandStatus } from '../modules/tasks/index.ts'

/**
 * 管理员/超级管理员三项管理能力（2026-10-18）。
 *
 * 裁员：首位超管发起的申请由本人第一阶段确认即完成；
 *       其余人（manager / 非首位超管）由本人完成第一阶段，再由**另一位** super_admin 终审；
 *       禁止同一人完成全部审批（首位超管除外）。
 * 解散：本队 manager 可直接解散；管理员可提交协助申请，任一 super_admin 可批准/驳回；
 *       超管可跨队直接解散任意团队。
 * 超管任免：仅首位超管（club.ownerMemberId）可任命/罢免其他 super_admin；不可动 owner。
 */

interface Harness extends SeedResult {
  manager1: AddedMember
  manager2: AddedMember
  superA: AddedMember
  superB: AddedMember
  plain: AddedMember
  nextMutationId: () => string
}

async function makeHarness(): Promise<Harness> {
  const seed = await seedTeam()
  const manager1 = await addMemberWithIdentity(seed.db, seed.clubId, 'm1-openid', '管理员甲', 'manager')
  const manager2 = await addMemberWithIdentity(seed.db, seed.clubId, 'm2-openid', '管理员乙', 'manager')
  const superA = await addMemberWithIdentity(seed.db, seed.clubId, 'sa-openid', '超管甲', 'super_admin')
  const superB = await addMemberWithIdentity(seed.db, seed.clubId, 'sb-openid', '超管乙', 'super_admin')
  const plain = await addMemberWithIdentity(seed.db, seed.clubId, 'member-openid', '成员丙', 'member')
  return { ...seed, manager1, manager2, superA, superB, plain, nextMutationId: mutationFactory(seed.clock) }
}

/** 另建一个队并给指定微信 owner 身份（用于跨队超管场景）。 */
async function addClubWithOwner(
  db: Harness['db'],
  clubId: string,
  openid: string,
  name: string,
  slug: string,
  displayCode: string
): Promise<AddedMember> {
  const owner = await addMemberWithIdentity(db, clubId, openid, 'B队主', 'super_admin')
  await db.tx(async (tx) => {
    await tx.set(COLLECTIONS.clubs, {
      _id: clubId,
      name,
      slug,
      displayCode,
      ownerMemberId: owner.memberId,
      status: 'ACTIVE',
      settings: { memberDirectoryVisible: true },
      revision: 1,
      mutationSeq: 0,
      createdAt: 1,
      updatedAt: 1,
    })
  })
  return owner
}

const codeOf = (error: unknown) => (error as { code?: string }).code

// ===== 裁员 =====

test('裁员：首位超管发起 → 本人第一阶段确认即完成并执行', async () => {
  const h = await makeHarness()
  const deps = { db: h.db, now: h.clock.now }

  const requested = await dismissals.requestDismissal(deps, h.ownerIdentity, h.clubId, {
    targetMemberId: h.plain.memberId,
    reason: '首位超管直接审批',
    mutationId: h.nextMutationId(),
  })
  assert.equal(requested.status, 'PENDING')
  assert.equal(requested.requesterIsPrimaryOwner, true)
  assert.equal(requested.currentStage, 'FIRST')

  const result = await dismissals.approveDismissal(deps, h.ownerIdentity, h.clubId, {
    dismissalId: requested.dismissalId,
    mutationId: h.nextMutationId(),
    expectedRevision: 1,
  })
  assert.equal(result.status, 'APPROVED')
  assert.equal(result.executed, true)
  assert.equal((await h.db.read(COLLECTIONS.members, h.plain.memberId))?.status, 'LEFT')

  const doc = await h.db.read(COLLECTIONS.memberDismissals, requested.dismissalId)
  assert.equal(doc?.firstApprovedByMemberId, h.ownerMemberId)
  assert.equal(doc?.finalApprovedByMemberId, null)

  const audits = await h.db.query(COLLECTIONS.audit, (d) => d.action === 'member.dismissal.approve')
  assert.equal(audits.length, 1)
  assert.equal(audits[0].reason, 'stage1:primary-owner')
})

test('裁员：普通管理员两级审批（本人第一阶段 + 另一位超管终审）', async () => {
  const h = await makeHarness()
  const deps = { db: h.db, now: h.clock.now }
  const requested = await dismissals.requestDismissal(deps, h.manager1.identity, h.clubId, {
    targetMemberId: h.plain.memberId,
    reason: '管理员发起，需超管终审',
    mutationId: h.nextMutationId(),
  })
  assert.equal(requested.requesterIsPrimaryOwner, false)
  assert.equal(requested.currentStage, 'FIRST')

  // 非申请人不能做第一阶段
  await assert.rejects(
    () =>
      dismissals.approveDismissal(deps, h.manager2.identity, h.clubId, {
        dismissalId: requested.dismissalId,
        mutationId: h.nextMutationId(),
        expectedRevision: 1,
      }),
    (e) => codeOf(e) === 'permission_denied'
  )

  const stage1 = await dismissals.approveDismissal(deps, h.manager1.identity, h.clubId, {
    dismissalId: requested.dismissalId,
    mutationId: h.nextMutationId(),
    expectedRevision: 1,
  })
  assert.equal(stage1.status, 'PENDING')
  assert.equal(stage1.executed, false)
  assert.equal((await h.db.read(COLLECTIONS.members, h.plain.memberId))?.status, 'ACTIVE')

  // manager 不能做终审
  await assert.rejects(
    () =>
      dismissals.approveDismissal(deps, h.manager2.identity, h.clubId, {
        dismissalId: requested.dismissalId,
        mutationId: h.nextMutationId(),
        expectedRevision: 2,
      }),
    (e) => codeOf(e) === 'permission_denied'
  )

  // 另一位超管（首位超管）终审 → 执行
  const stage2 = await dismissals.approveDismissal(deps, h.ownerIdentity, h.clubId, {
    dismissalId: requested.dismissalId,
    mutationId: h.nextMutationId(),
    expectedRevision: 2,
  })
  assert.equal(stage2.status, 'APPROVED')
  assert.equal(stage2.executed, true)
  assert.equal((await h.db.read(COLLECTIONS.members, h.plain.memberId))?.status, 'LEFT')

  const audits = await h.db.query(COLLECTIONS.audit, (d) => d.action === 'member.dismissal.approve')
  assert.deepEqual(audits.map((a) => a.reason).sort(), ['stage1:self', 'stage2:final'])
})

test('裁员：非首位超管两级审批，终审必须是另一位超管（禁止同一人完成全部）', async () => {
  const h = await makeHarness()
  const deps = { db: h.db, now: h.clock.now }
  const requested = await dismissals.requestDismissal(deps, h.superA.identity, h.clubId, {
    targetMemberId: h.plain.memberId,
    reason: '普通超管发起',
    mutationId: h.nextMutationId(),
  })
  assert.equal(requested.requesterIsPrimaryOwner, false)

  const stage1 = await dismissals.approveDismissal(deps, h.superA.identity, h.clubId, {
    dismissalId: requested.dismissalId,
    mutationId: h.nextMutationId(),
    expectedRevision: 1,
  })
  assert.equal(stage1.executed, false)

  // 申请人本人不能完成最终审批
  await assert.rejects(
    () =>
      dismissals.approveDismissal(deps, h.superA.identity, h.clubId, {
        dismissalId: requested.dismissalId,
        mutationId: h.nextMutationId(),
        expectedRevision: 2,
      }),
    (e) => codeOf(e) === 'permission_denied'
  )

  // 另一位超管终审 → 执行
  const stage2 = await dismissals.approveDismissal(deps, h.superB.identity, h.clubId, {
    dismissalId: requested.dismissalId,
    mutationId: h.nextMutationId(),
    expectedRevision: 2,
  })
  assert.equal(stage2.executed, true)
  assert.equal((await h.db.read(COLLECTIONS.members, h.plain.memberId))?.status, 'LEFT')
})

test('裁员：普通成员不能发起；不能裁 owner/自己；阶段身份校验', async () => {
  const h = await makeHarness()
  const deps = { db: h.db, now: h.clock.now }

  await assert.rejects(
    () =>
      dismissals.requestDismissal(deps, h.plain.identity, h.clubId, {
        targetMemberId: h.manager1.memberId,
        reason: '无权限测试',
        mutationId: h.nextMutationId(),
      }),
    (e) => codeOf(e) === 'permission_denied'
  )

  await assert.rejects(
    () =>
      dismissals.requestDismissal(deps, h.manager1.identity, h.clubId, {
        targetMemberId: h.ownerMemberId,
        reason: '不能裁 owner',
        mutationId: h.nextMutationId(),
      }),
    (e) => codeOf(e) === 'permission_denied'
  )

  await assert.rejects(
    () =>
      dismissals.requestDismissal(deps, h.manager1.identity, h.clubId, {
        targetMemberId: h.manager1.memberId,
        reason: '不能裁自己',
        mutationId: h.nextMutationId(),
      }),
    (e) => codeOf(e) === 'validation_failed'
  )

  const requested = await dismissals.requestDismissal(deps, h.manager1.identity, h.clubId, {
    targetMemberId: h.plain.memberId,
    reason: '阶段身份校验',
    mutationId: h.nextMutationId(),
  })

  // 第一阶段：非申请人被拒
  await assert.rejects(
    () =>
      dismissals.approveDismissal(deps, h.manager2.identity, h.clubId, {
        dismissalId: requested.dismissalId,
        mutationId: h.nextMutationId(),
        expectedRevision: 1,
      }),
    (e) => codeOf(e) === 'permission_denied'
  )

  // 申请人本人完成第一阶段
  const stage1 = await dismissals.approveDismissal(deps, h.manager1.identity, h.clubId, {
    dismissalId: requested.dismissalId,
    mutationId: h.nextMutationId(),
    expectedRevision: 1,
  })
  assert.equal(stage1.executed, false)

  // 申请人再次审批进入 FINAL：manager 不能终审 → 拒绝
  await assert.rejects(
    () =>
      dismissals.approveDismissal(deps, h.manager1.identity, h.clubId, {
        dismissalId: requested.dismissalId,
        mutationId: h.nextMutationId(),
        expectedRevision: 2,
      }),
    (e) => codeOf(e) === 'permission_denied'
  )
})

test('裁员：驳回理由必填；驳回后可重新发起', async () => {
  const h = await makeHarness()
  const deps = { db: h.db, now: h.clock.now }
  const requested = await dismissals.requestDismissal(deps, h.manager1.identity, h.clubId, {
    targetMemberId: h.plain.memberId,
    reason: '驳回流程测试',
    mutationId: h.nextMutationId(),
  })

  await assert.rejects(
    () =>
      dismissals.rejectDismissal(deps, h.manager2.identity, h.clubId, {
        dismissalId: requested.dismissalId,
        rejectReason: '   ',
        mutationId: h.nextMutationId(),
      }),
    (e) => codeOf(e) === 'validation_failed'
  )

  const rejectMutation = h.nextMutationId()
  const rejected = await dismissals.rejectDismissal(deps, h.manager2.identity, h.clubId, {
    dismissalId: requested.dismissalId,
    rejectReason: '证据不足',
    mutationId: rejectMutation,
    expectedRevision: 1,
  })
  assert.equal(rejected.status, 'REJECTED')
  const replay = await dismissals.rejectDismissal(deps, h.manager2.identity, h.clubId, {
    dismissalId: requested.dismissalId,
    rejectReason: '证据不足',
    mutationId: rejectMutation,
    expectedRevision: 1,
  })
  assert.deepEqual(replay, rejected)

  const again = await dismissals.requestDismissal(deps, h.manager1.identity, h.clubId, {
    targetMemberId: h.plain.memberId,
    reason: '补充证据后重新申请',
    mutationId: h.nextMutationId(),
  })
  assert.equal(again.status, 'PENDING')
  assert.equal(again.dismissalId, requested.dismissalId)
  assert.equal(again.revision, 3)
})

test('裁员：列表仅 manager+，且只含本队申请', async () => {
  const h = await makeHarness()
  const deps = { db: h.db, now: h.clock.now }
  await dismissals.requestDismissal(deps, h.manager1.identity, h.clubId, {
    targetMemberId: h.plain.memberId,
    reason: '列表权限测试',
    mutationId: h.nextMutationId(),
  })

  await assert.rejects(() => dismissals.listDismissals(deps, h.plain.identity, h.clubId), (e) => codeOf(e) === 'permission_denied')
  const page = await dismissals.listDismissals(deps, h.manager2.identity, h.clubId)
  assert.equal(page.items.length, 1)
  assert.equal(page.items[0].targetMemberId, h.plain.memberId)
  assert.ok(!JSON.stringify(page).includes('userId'))
})

// ===== 团队解散 =====

test('解散：本队 manager 可直接解散；解散后不可进入、列表不再返回', async () => {
  const h = await makeHarness()
  const deps = { db: h.db, now: h.clock.now }

  await assert.rejects(
    () =>
      dissolutions.dissolveByManager(deps, h.plain.identity, h.clubId, {
        reason: '普通成员无权限',
        mutationId: h.nextMutationId(),
      }),
    (e) => codeOf(e) === 'permission_denied'
  )

  const result = await dissolutions.dissolveByManager(deps, h.manager1.identity, h.clubId, {
    reason: '项目终止，团队解散',
    mutationId: h.nextMutationId(),
  })
  assert.equal(result.status, 'DISSOLVED')
  assert.equal((await h.db.read(COLLECTIONS.clubs, h.clubId))?.status, 'DISSOLVED')

  await assert.rejects(() => teams.enter(deps, h.manager2.identity, h.clubId), (e) => codeOf(e) === 'resource_not_found')
  const page = await teams.listMine(deps, h.manager2.identity)
  assert.equal(page.items.length, 0)
  await assert.rejects(
    () =>
      dissolutions.dissolveAnyClub(deps, h.ownerIdentity, {
        clubId: 'another-club',
        reason: '原超管团队已解散',
        mutationId: h.nextMutationId(),
      }),
    (e) => codeOf(e) === 'permission_denied'
  )

  const audits = await h.db.query(COLLECTIONS.audit, (d) => d.action === 'club.dissolve')
  assert.equal(audits.length, 1)
})

test('解散：管理员提交协助申请 → 任一超管可批准（跨队）并执行', async () => {
  const h = await makeHarness()
  const deps = { db: h.db, now: h.clock.now }
  const clubB = 'club-b-dissolve-0001'
  const ownerB = await addClubWithOwner(h.db, clubB, 'owner-b-openid', 'B队', 'team-b-dissolve', 'BD01')

  const request = await dissolutions.requestDissolution(deps, h.manager1.identity, h.clubId, {
    reason: '管理员权限受限，请超管协助解散',
    mutationId: h.nextMutationId(),
  })
  assert.equal(request.status, 'PENDING')

  // 普通成员不能看待协助列表
  await assert.rejects(
    () => dissolutions.listDissolutionRequests(deps, h.plain.identity),
    (e) => codeOf(e) === 'permission_denied'
  )

  // 跨队超管（B 队 owner）可见并批准
  const list = await dissolutions.listDissolutionRequests(deps, ownerB.identity)
  assert.equal(list.items.length, 1)
  assert.equal(list.items[0].clubId, h.clubId)

  const decisionMutation = h.nextMutationId()
  const decided = await dissolutions.decideDissolution(deps, ownerB.identity, {
    clubId: h.clubId,
    approve: true,
    mutationId: decisionMutation,
    expectedRevision: request.revision,
  })
  assert.equal(decided.status, 'APPROVED')
  assert.equal((await h.db.read(COLLECTIONS.clubs, h.clubId))?.status, 'DISSOLVED')
  const status = await commandStatus(deps, ownerB.identity, { kind: 'GLOBAL' }, {
    action: 'club.dissolution.decide',
    mutationId: decisionMutation,
  })
  assert.equal(status.status, 'SUCCEEDED')
  assert.equal((status.resultSummary as { clubId?: string }).clubId, h.clubId)
})

test('解散：超管可跨队直接解散任意团队；非超管被拒', async () => {
  const h = await makeHarness()
  const deps = { db: h.db, now: h.clock.now }
  const clubB = 'club-b-dissolve-0002'
  const ownerB = await addClubWithOwner(h.db, clubB, 'owner-b-openid-2', 'B队2', 'team-b-dissolve-2', 'BD02')

  await assert.rejects(
    () =>
      dissolutions.dissolveAnyClub(deps, h.manager1.identity, {
        clubId: h.clubId,
        reason: '非超管尝试',
        mutationId: h.nextMutationId(),
      }),
    (e) => codeOf(e) === 'permission_denied'
  )

  const result = await dissolutions.dissolveAnyClub(deps, ownerB.identity, {
    clubId: h.clubId,
    reason: '平台级解散',
    mutationId: h.nextMutationId(),
  })
  assert.equal(result.status, 'DISSOLVED')
  assert.equal((await h.db.read(COLLECTIONS.clubs, h.clubId))?.status, 'DISSOLVED')
  assert.equal((await h.db.read(COLLECTIONS.clubs, clubB))?.status, 'ACTIVE')
})

test('解散：超管可按名称/编码搜索目标团队；非超管被拒；已解散不返回', async () => {
  const h = await makeHarness()
  const deps = { db: h.db, now: h.clock.now }
  const clubB = 'club-b-search-0001'
  const ownerB = await addClubWithOwner(h.db, clubB, 'owner-b-search', '设计二队', 'team-b-search', 'DES2')

  const byName = await dissolutions.searchClubsForAdmin(deps, h.superA.identity, { keyword: '设计' })
  assert.equal(byName.items.length, 1)
  assert.equal(byName.items[0].clubId, clubB)
  assert.equal(byName.items[0].name, '设计二队')
  assert.equal(byName.items[0].displayCode, 'DES2')

  const byCode = await dissolutions.searchClubsForAdmin(deps, h.superA.identity, { keyword: 'des2' })
  assert.equal(byCode.items[0].clubId, clubB)

  await assert.rejects(
    () => dissolutions.searchClubsForAdmin(deps, h.superA.identity, { keyword: ' ' }),
    (e) => codeOf(e) === 'validation_failed'
  )

  await assert.rejects(
    () => dissolutions.searchClubsForAdmin(deps, h.manager1.identity, { keyword: '设计' }),
    (e) => codeOf(e) === 'permission_denied'
  )

  await dissolutions.dissolveAnyClub(deps, ownerB.identity, {
    clubId: clubB,
    reason: '搜索后解散',
    mutationId: h.nextMutationId(),
  })
  const after = await dissolutions.searchClubsForAdmin(deps, h.superA.identity, { keyword: '设计' })
  assert.equal(after.items.length, 0)
})

// ===== 超管任免 =====

test('超管任免：首位超管可任命/罢免其他超管；普通超管不能任免；不可动 owner', async () => {
  const h = await makeHarness()
  const deps = { db: h.db, now: h.clock.now }

  // manager 不能任免
  await assert.rejects(
    () =>
      members.setRole(deps, h.manager1.identity, h.clubId, {
        targetMemberId: h.manager2.memberId,
        targetRole: 'super_admin',
        expectedRevision: 1,
        mutationId: h.nextMutationId(),
      }),
    (e) => codeOf(e) === 'permission_denied'
  )

  // owner 任命 manager1 为 super_admin
  const promoted = await members.setRole(deps, h.ownerIdentity, h.clubId, {
    targetMemberId: h.manager1.memberId,
    targetRole: 'super_admin',
    expectedRevision: 1,
    mutationId: h.nextMutationId(),
  })
  assert.equal(promoted.role, 'super_admin')

  // 新超管仍不能任免他人（仅首位超管）
  await assert.rejects(
    () =>
      members.setRole(deps, h.manager1.identity, h.clubId, {
        targetMemberId: h.manager2.memberId,
        targetRole: 'manager',
        expectedRevision: 1,
        mutationId: h.nextMutationId(),
      }),
    (e) => codeOf(e) === 'permission_denied'
  )

  // owner 罢免该超管（降为 manager）
  const demoted = await members.setRole(deps, h.ownerIdentity, h.clubId, {
    targetMemberId: h.manager1.memberId,
    targetRole: 'manager',
    expectedRevision: 2,
    mutationId: h.nextMutationId(),
  })
  assert.equal(demoted.role, 'manager')

  // 不可动 owner
  await assert.rejects(
    () =>
      members.setRole(deps, h.ownerIdentity, h.clubId, {
        targetMemberId: h.ownerMemberId,
        targetRole: 'manager',
        expectedRevision: 1,
        mutationId: h.nextMutationId(),
      }),
    (e) => codeOf(e) === 'permission_denied'
  )

  // 审计留痕
  const audits = await h.db.query(COLLECTIONS.audit, (d) => d.action === 'member.setRole')
  assert.equal(audits.length, 2)
})

test('超管任免：目标成员必须在本队', async () => {
  const h = await makeHarness()
  const deps = { db: h.db, now: h.clock.now }
  await assert.rejects(
    () =>
      members.setRole(deps, h.ownerIdentity, h.clubId, {
        targetMemberId: memberId('other-club', 'someone'),
        targetRole: 'super_admin',
        expectedRevision: 1,
        mutationId: h.nextMutationId(),
      }),
    (e) => codeOf(e) === 'resource_not_found'
  )
})
