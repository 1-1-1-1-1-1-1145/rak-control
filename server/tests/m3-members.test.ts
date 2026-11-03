import assert from 'node:assert/strict'
import test from 'node:test'

import { COLLECTIONS } from '../repositories/collections.ts'
import { listMembers, setRole, setStatus, updateMyProfile } from '../modules/members/index.ts'
import { addMemberWithIdentity, labelIds, readMutationSeq, seedTeam, type SeedResult } from './helpers.ts'

function deps(seed: SeedResult) {
  return { db: seed.db, now: seed.clock.now }
}

async function clubMutationSeq(seed: SeedResult): Promise<number> {
  return ((await seed.db.read(COLLECTIONS.clubs, seed.clubId))?.mutationSeq as number) ?? 0
}

async function userSecuritySeq(seed: SeedResult, userId: string): Promise<number> {
  return ((await seed.db.read(COLLECTIONS.users, userId))?.securityMutationSeq as number) ?? 0
}

test('owner setRole：member→manager，并触碰 actor/club/target-user 栅栏', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)
  const target = await addMemberWithIdentity(seed.db, seed.clubId, 'm1', '小张', 'member')
  const ownerSeqBefore = await readMutationSeq(seed.db, seed.ownerMemberId)
  const clubSeqBefore = await clubMutationSeq(seed)
  const userSeqBefore = await userSecuritySeq(seed, target.userId)

  const updated = await setRole(deps(seed), seed.ownerIdentity, seed.clubId, {
    targetMemberId: target.memberId,
    targetRole: 'manager',
    expectedRevision: 1,
    mutationId: ids('role-1'),
  })

  assert.equal(updated.role, 'manager')
  assert.equal(updated.revision, 2)
  assert.equal(await readMutationSeq(seed.db, seed.ownerMemberId), ownerSeqBefore + 1)
  assert.equal(await clubMutationSeq(seed), clubSeqBefore + 1)
  assert.equal(await userSecuritySeq(seed, target.userId), userSeqBefore + 1)
})

test('命令幂等：同键同 payload 重放；同键异 payload idempotency_conflict', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)
  const target = await addMemberWithIdentity(seed.db, seed.clubId, 'm1', '小张', 'member')

  const first = await setRole(deps(seed), seed.ownerIdentity, seed.clubId, {
    targetMemberId: target.memberId,
    targetRole: 'manager',
    expectedRevision: 1,
    mutationId: ids('same-key'),
  })
  const replay = await setRole(deps(seed), seed.ownerIdentity, seed.clubId, {
    targetMemberId: target.memberId,
    targetRole: 'manager',
    expectedRevision: 1,
    mutationId: ids('same-key'),
  })
  assert.deepEqual(replay, first)
  assert.equal((await seed.db.read(COLLECTIONS.members, target.memberId))?.revision, 2)

  await assert.rejects(
    () =>
      setRole(deps(seed), seed.ownerIdentity, seed.clubId, {
        targetMemberId: target.memberId,
        targetRole: 'member',
        expectedRevision: 2,
        mutationId: ids('same-key'),
      }),
    (e: unknown) => (e as { code?: string }).code === 'idempotency_conflict'
  )
})

test('任免矩阵：manager 不能 setRole，不能处置 owner，owner 可授 super_admin，revision 冲突', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)
  const manager = await addMemberWithIdentity(seed.db, seed.clubId, 'mgr', '经理', 'manager')
  const member = await addMemberWithIdentity(seed.db, seed.clubId, 'm1', '小张', 'member')

  await assert.rejects(
    () =>
      setRole(deps(seed), manager.identity, seed.clubId, {
        targetMemberId: member.memberId,
        targetRole: 'manager',
        expectedRevision: 1,
        mutationId: ids('x1'),
      }),
    (e: unknown) => (e as { code?: string }).code === 'permission_denied'
  )

  await assert.rejects(
    () =>
      setRole(deps(seed), seed.ownerIdentity, seed.clubId, {
        targetMemberId: seed.ownerMemberId,
        targetRole: 'member',
        expectedRevision: 1,
        mutationId: ids('x2'),
      }),
    (e: unknown) => (e as { code?: string }).code === 'permission_denied'
  )

  // owner（首位超管）可任命 super_admin（2026-10-18 新增）
  const promoted = await setRole(deps(seed), seed.ownerIdentity, seed.clubId, {
    targetMemberId: member.memberId,
    targetRole: 'super_admin',
    expectedRevision: 1,
    mutationId: ids('x3'),
  })
  assert.equal(promoted.role, 'super_admin')

  await assert.rejects(
    () =>
      setRole(deps(seed), seed.ownerIdentity, seed.clubId, {
        targetMemberId: member.memberId,
        targetRole: 'manager',
        expectedRevision: 99,
        mutationId: ids('x4'),
      }),
    (e: unknown) => (e as { code?: string }).code === 'revision_conflict'
  )
})

test('setStatus：manager 仅可管理 member；LEFT 不得借 setStatus 复活', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)
  const manager = await addMemberWithIdentity(seed.db, seed.clubId, 'mgr', '经理', 'manager')
  const otherManager = await addMemberWithIdentity(seed.db, seed.clubId, 'mgr2', '另一经理', 'manager')
  const member = await addMemberWithIdentity(seed.db, seed.clubId, 'm1', '小张', 'member')
  const leftMember = await addMemberWithIdentity(seed.db, seed.clubId, 'left1', '离队者', 'member', 'LEFT')

  await assert.rejects(
    () =>
      setStatus(deps(seed), manager.identity, seed.clubId, {
        targetMemberId: otherManager.memberId,
        targetStatus: 'DISABLED',
        expectedRevision: 1,
        mutationId: ids('s1'),
      }),
    (e: unknown) => (e as { code?: string }).code === 'permission_denied'
  )

  const disabled = await setStatus(deps(seed), manager.identity, seed.clubId, {
    targetMemberId: member.memberId,
    targetStatus: 'DISABLED',
    expectedRevision: 1,
    mutationId: ids('s2'),
  })
  assert.equal(disabled.status, 'DISABLED')

  await assert.rejects(
    () =>
      setStatus(deps(seed), manager.identity, seed.clubId, {
        targetMemberId: leftMember.memberId,
        targetStatus: 'ACTIVE',
        expectedRevision: 1,
        mutationId: ids('s3'),
      }),
    (e: unknown) => (e as { code?: string }).code === 'invalid_transition'
  )
})

test('setStatus：普通 super_admin 不能停用另一位 super_admin，但仍可管理 member', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)
  const superA = await addMemberWithIdentity(seed.db, seed.clubId, 'super-a', '超管A', 'super_admin')
  const superB = await addMemberWithIdentity(seed.db, seed.clubId, 'super-b', '超管B', 'super_admin')
  const member = await addMemberWithIdentity(seed.db, seed.clubId, 'member-1', '成员', 'member')

  await assert.rejects(
    () =>
      setStatus(deps(seed), superA.identity, seed.clubId, {
        targetMemberId: superB.memberId,
        targetStatus: 'DISABLED',
        expectedRevision: 1,
        mutationId: ids('super-blocked'),
      }),
    (e: unknown) => (e as { code?: string }).code === 'permission_denied'
  )

  const disabled = await setStatus(deps(seed), superA.identity, seed.clubId, {
    targetMemberId: member.memberId,
    targetStatus: 'DISABLED',
    expectedRevision: 1,
    mutationId: ids('member-disabled'),
  })
  assert.equal(disabled.status, 'DISABLED')
})

test('updateMyProfile：本人改展示名；任何成员可自改职务（2026-10-18 解除仅 owner 限制）', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)
  const member = await addMemberWithIdentity(seed.db, seed.clubId, 'm1', '小张', 'member')

  const updated = await updateMyProfile(deps(seed), member.identity, seed.clubId, {
    displayName: '小张同学',
    expectedRevision: 1,
    mutationId: ids('u1'),
  })
  assert.equal(updated.displayName, '小张同学')

  // 普通成员也能改自己的职务（职务不参与授权）
  const memberWithDuty = await updateMyProfile(deps(seed), member.identity, seed.clubId, {
    displayName: '小张同学',
    duty: '宣传',
    expectedRevision: 2,
    mutationId: ids('u2'),
  })
  assert.equal(memberWithDuty.duty, '宣传')

  const ownerUpdated = await updateMyProfile(deps(seed), seed.ownerIdentity, seed.clubId, {
    displayName: '王同学',
    duty: '社长',
    expectedRevision: 1,
    mutationId: ids('u3'),
  })
  assert.equal(ownerUpdated.duty, '社长')
})

test('member.list：目录关闭时普通成员被拒，manager 仍可读', async () => {
  const seed = await seedTeam()
  const member = await addMemberWithIdentity(seed.db, seed.clubId, 'm1', '小张', 'member')
  const manager = await addMemberWithIdentity(seed.db, seed.clubId, 'mgr', '经理', 'manager')

  const open = await listMembers(deps(seed), member.identity, seed.clubId)
  assert.ok(open.items.length >= 3)

  await seed.db.tx(async (tx) => {
    const club = await tx.get(COLLECTIONS.clubs, seed.clubId)
    if (!club) throw new Error('夹具：club 缺失')
    await tx.set(COLLECTIONS.clubs, { ...club, settings: { memberDirectoryVisible: false } })
  })

  await assert.rejects(
    () => listMembers(deps(seed), member.identity, seed.clubId),
    (e: unknown) => (e as { code?: string }).code === 'permission_denied'
  )
  const managerView = await listMembers(deps(seed), manager.identity, seed.clubId)
  assert.ok(managerView.items.length >= 3)
})
