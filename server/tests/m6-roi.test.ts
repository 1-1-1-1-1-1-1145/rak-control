import assert from 'node:assert/strict'
import test from 'node:test'

import { COLLECTIONS } from '../repositories/collections.ts'
import { memberId } from '../repositories/ids.ts'
import {
  createRoiItem,
  deleteRoiItem,
  getRoiItem,
  listRoiItems,
  roiOverview,
  updateRoiItem,
} from '../modules/roi/index.ts'
import { addMemberWithIdentity, labelIds, seedTeam, type SeedResult } from './helpers.ts'

function deps(seed: SeedResult) {
  return { db: seed.db, now: seed.clock.now }
}

/** 上海 2026-10-15 00:00 对应的 UTC 毫秒。 */
const SH_2026_10_15 = Date.UTC(2026, 9, 14, 16, 0, 0)

function base(ids: (label: string) => string) {
  return { title: '示例项目', category: 'activity', cost: '0.10', revenue: '0.30', mutationId: ids('roi') }
}

test('ROI 金额精度：元字符串严格转分，成本 0 时比例为 null', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)

  const item = await createRoiItem(deps(seed), seed.ownerIdentity, seed.clubId, {
    title: '校园市集',
    category: 'activity',
    cost: '0.10',
    revenue: '0.30',
    mutationId: ids('r1'),
  })
  assert.equal(item.costCents, 10)
  assert.equal(item.revenueCents, 30)
  assert.equal(item.roiRatio, 2)

  seed.clock.advance(1000)
  const zeroCost = await createRoiItem(deps(seed), seed.ownerIdentity, seed.clubId, {
    title: '纯赞助',
    category: 'project',
    cost: '0',
    revenue: '5.00',
    mutationId: ids('r2'),
  })
  assert.equal(zeroCost.costCents, 0)
  assert.equal(zeroCost.roiRatio, null)

  seed.clock.advance(1000)
  const max = await createRoiItem(deps(seed), seed.ownerIdentity, seed.clubId, {
    title: '上限',
    category: 'other',
    cost: '999999999.99',
    revenue: '0',
    mutationId: ids('r3'),
  })
  assert.equal(max.costCents, 99999999999)
})

test('ROI 非法金额与日期拒绝', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)
  const cases: { cost: unknown; revenue?: string }[] = [
    { cost: '1.234' },
    { cost: '-1' },
    { cost: 1 },
    { cost: '1,000.00' },
    { cost: '1000000000.00' },
    { cost: '.5' },
  ]
  for (const [index, item] of cases.entries()) {
    await assert.rejects(
      () =>
        createRoiItem(deps(seed), seed.ownerIdentity, seed.clubId, {
          title: 'x',
          category: 'activity',
          cost: item.cost as string,
          revenue: item.revenue ?? '0',
          mutationId: ids(`bad${index}`),
        }),
      (e: unknown) => (e as { code?: string }).code === 'validation_failed'
    )
    seed.clock.advance(1000)
  }

  await assert.rejects(
    () =>
      createRoiItem(deps(seed), seed.ownerIdentity, seed.clubId, {
        title: 'x',
        category: 'activity',
        cost: '1',
        revenue: '1',
        periodStart: '2026-02-30',
        mutationId: ids('badday'),
      }),
    (e: unknown) => (e as { code?: string }).code === 'validation_failed'
  )
  await assert.rejects(
    () =>
      createRoiItem(deps(seed), seed.ownerIdentity, seed.clubId, {
        title: 'x',
        category: 'activity',
        cost: '1',
        revenue: '1',
        periodStart: '2026-05-10',
        periodEnd: '2026-05-01',
        mutationId: ids('badrange'),
      }),
    (e: unknown) => (e as { code?: string }).code === 'validation_failed'
  )
})

test('ROI 上海周期左闭右开，含 CANCELLED 未删除口径', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)
  seed.clock.set(SH_2026_10_15)

  await createRoiItem(deps(seed), seed.ownerIdentity, seed.clubId, {
    title: '九月活动',
    category: 'activity',
    cost: '10.00',
    revenue: '20.00',
    periodStart: '2026-09-30',
    mutationId: ids('r-sep'),
  })
  await createRoiItem(deps(seed), seed.ownerIdentity, seed.clubId, {
    title: '十月活动',
    category: 'activity',
    cost: '5.00',
    revenue: '5.00',
    periodStart: '2026-10-01',
    mutationId: ids('r-oct'),
  })
  await createRoiItem(deps(seed), seed.ownerIdentity, seed.clubId, {
    title: '已取消项目',
    category: 'project',
    cost: '1.00',
    revenue: '0',
    periodStart: '2026-10-02',
    status: 'CANCELLED',
    mutationId: ids('r-cancel'),
  })

  const month = await roiOverview(deps(seed), seed.ownerIdentity, seed.clubId, 'month')
  assert.equal(month.itemCount, 2)
  assert.equal(month.totalCost, 600)
  assert.equal(month.totalRevenue, 500)
  assert.equal(month.includesCancelled, true)
  assert.equal(month.seriesWindow, 'last6')
  assert.equal(month.series.length, 6)
  assert.deepEqual(
    month.series.map((bucket) => bucket.label),
    ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']
  )

  const quarter = await roiOverview(deps(seed), seed.ownerIdentity, seed.clubId, 'quarter')
  assert.equal(quarter.itemCount, 2)
  assert.equal(quarter.totalCost, 600)

  const year = await roiOverview(deps(seed), seed.ownerIdentity, seed.clubId, 'year')
  assert.equal(year.itemCount, 3)
  assert.equal(year.totalCost, 1600)

  const all = await roiOverview(deps(seed), seed.ownerIdentity, seed.clubId, 'all')
  assert.equal(all.itemCount, 3)
  assert.equal(all.totalCost, 1600)
})

test('ROI 软删：列表/详情/概览均不含，且不可重复删除', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)
  const member = await addMemberWithIdentity(seed.db, seed.clubId, 'm1', '小张', 'member')

  const item = await createRoiItem(deps(seed), seed.ownerIdentity, seed.clubId, base(ids))
  const memberView = await listRoiItems(deps(seed), member.identity, seed.clubId, {})
  assert.equal(memberView.items.length, 1)

  await deleteRoiItem(deps(seed), seed.ownerIdentity, seed.clubId, {
    roiId: item.roiId,
    mutationId: ids('del'),
  })
  const afterList = await listRoiItems(deps(seed), seed.ownerIdentity, seed.clubId, {})
  assert.equal(afterList.items.length, 0)
  const afterOverview = await roiOverview(deps(seed), seed.ownerIdentity, seed.clubId, 'all')
  assert.equal(afterOverview.itemCount, 0)
  await assert.rejects(
    () => getRoiItem(deps(seed), seed.ownerIdentity, seed.clubId, item.roiId),
    (e: unknown) => (e as { code?: string }).code === 'resource_not_found'
  )
  await assert.rejects(
    () => deleteRoiItem(deps(seed), seed.ownerIdentity, seed.clubId, { roiId: item.roiId, mutationId: ids('del2') }),
    (e: unknown) => (e as { code?: string }).code === 'resource_not_found'
  )
})

test('ROI 编辑空 periodStart 不改变月份；成员写入拒绝', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)
  const member = await addMemberWithIdentity(seed.db, seed.clubId, 'm1', '小张', 'member')

  const item = await createRoiItem(deps(seed), seed.ownerIdentity, seed.clubId, {
    title: '三月项目',
    category: 'project',
    cost: '1.00',
    revenue: '2.00',
    periodStart: '2026-03-05',
    mutationId: ids('r1'),
  })
  assert.equal(item.accountingDate, '2026-03-05')

  const renamed = await updateRoiItem(deps(seed), seed.ownerIdentity, seed.clubId, {
    roiId: item.roiId,
    title: '三月项目（改名）',
    expectedRevision: 1,
    mutationId: ids('u1'),
  })
  assert.equal(renamed.accountingDate, '2026-03-05')

  const cleared = await updateRoiItem(deps(seed), seed.ownerIdentity, seed.clubId, {
    roiId: item.roiId,
    periodStart: '',
    expectedRevision: 2,
    mutationId: ids('u2'),
  })
  assert.equal(cleared.periodStart, null)
  assert.equal(cleared.accountingDate, '2026-03-05')

  await assert.rejects(
    () =>
      createRoiItem(deps(seed), member.identity, seed.clubId, {
        ...base(ids),
        mutationId: ids('member'),
      }),
    (e: unknown) => (e as { code?: string }).code === 'permission_denied'
  )
})

test('ROI 异队 cursor 与异队指针拒绝', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)
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
      role: 'manager',
      status: 'ACTIVE',
      createdAt: 1,
      joinedAt: 1,
      revision: 1,
      mutationSeq: 0,
    })
  })

  for (let i = 0; i < 2; i += 1) {
    await createRoiItem(deps(seed), seed.ownerIdentity, seed.clubId, {
      ...base(ids),
      title: `A${i}`,
      mutationId: ids(`ra${i}`),
    })
    seed.clock.advance(1000)
  }
  const pageA = await listRoiItems(deps(seed), seed.ownerIdentity, seed.clubId, { pageSize: 1 })
  assert.ok(pageA.nextCursor)

  const a = await createRoiItem(deps(seed), seed.ownerIdentity, seed.clubId, {
    ...base(ids),
    title: 'A指针',
    mutationId: ids('ptr'),
  })
  await assert.rejects(
    () => getRoiItem(deps(seed), seed.ownerIdentity, 'clubB', a.roiId),
    (e: unknown) => (e as { code?: string }).code === 'resource_not_found'
  )
  await assert.rejects(
    () => listRoiItems(deps(seed), seed.ownerIdentity, 'clubB', { pageSize: 1, cursor: pageA.nextCursor as string }),
    (e: unknown) => (e as { code?: string }).code === 'cursor_scope_mismatch'
  )
})
