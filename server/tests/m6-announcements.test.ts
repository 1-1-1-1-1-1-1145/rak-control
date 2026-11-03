import assert from 'node:assert/strict'
import test from 'node:test'

import { COLLECTIONS } from '../repositories/collections.ts'
import { memberId } from '../repositories/ids.ts'
import {
  archiveAnnouncement,
  createAnnouncement,
  getAnnouncement,
  listAnnouncements,
  publishAnnouncement,
  updateAnnouncement,
} from '../modules/announcements/index.ts'
import { addMemberWithIdentity, labelIds, seedTeam, type SeedResult } from './helpers.ts'

function deps(seed: SeedResult) {
  return { db: seed.db, now: seed.clock.now }
}

async function seedSecondClub(seed: SeedResult, role: 'member' | 'manager' = 'member'): Promise<string> {
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
      role,
      status: 'ACTIVE',
      createdAt: 1,
      joinedAt: 1,
      revision: 1,
      mutationSeq: 0,
    })
  })
  return 'clubB'
}

test('公告草稿只本队管理者可见；普通成员只读 PUBLISHED', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)
  const member = await addMemberWithIdentity(seed.db, seed.clubId, 'm1', '小张', 'member')

  const draft = await createAnnouncement(deps(seed), seed.ownerIdentity, seed.clubId, {
    title: '草稿',
    body: '正文',
    pinned: false,
    mutationId: ids('c1'),
  })
  assert.equal(draft.status, 'DRAFT')
  assert.equal(draft.authorMemberId, seed.ownerMemberId)
  assert.equal(draft.authorDisplayName, '王同学')

  const hidden = await listAnnouncements(deps(seed), member.identity, seed.clubId, {})
  assert.equal(hidden.items.length, 0)
  await assert.rejects(
    () => getAnnouncement(deps(seed), member.identity, seed.clubId, draft.announcementId),
    (e: unknown) => (e as { code?: string }).code === 'resource_not_found'
  )
  await assert.rejects(
    () =>
      publishAnnouncement(deps(seed), member.identity, seed.clubId, {
        announcementId: draft.announcementId,
        expectedRevision: 1,
        mutationId: ids('member-pub'),
      }),
    (e: unknown) => (e as { code?: string }).code === 'permission_denied'
  )

  await publishAnnouncement(deps(seed), seed.ownerIdentity, seed.clubId, {
    announcementId: draft.announcementId,
    expectedRevision: 1,
    mutationId: ids('pub'),
  })
  const visible = await listAnnouncements(deps(seed), member.identity, seed.clubId, {})
  assert.equal(visible.items.length, 1)
  assert.equal(visible.items[0].announcementId, draft.announcementId)
})

test('公告状态机：仅 DRAFT 可发布；归档后不可编辑/发布', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)
  const created = await createAnnouncement(deps(seed), seed.ownerIdentity, seed.clubId, {
    title: '活动通知',
    body: '第一行\r\n第二行',
    mutationId: ids('c1'),
  })
  assert.equal(created.body, '第一行\n第二行')

  const published = await publishAnnouncement(deps(seed), seed.ownerIdentity, seed.clubId, {
    announcementId: created.announcementId,
    expectedRevision: 1,
    mutationId: ids('pub'),
  })
  assert.equal(published.status, 'PUBLISHED')
  assert.ok(published.publishedAt)

  await assert.rejects(
    () =>
      publishAnnouncement(deps(seed), seed.ownerIdentity, seed.clubId, {
        announcementId: created.announcementId,
        expectedRevision: 2,
        mutationId: ids('pub2'),
      }),
    (e: unknown) => (e as { code?: string }).code === 'invalid_transition'
  )

  const archived = await archiveAnnouncement(deps(seed), seed.ownerIdentity, seed.clubId, {
    announcementId: created.announcementId,
    expectedRevision: 2,
    mutationId: ids('arc'),
  })
  assert.equal(archived.status, 'ARCHIVED')

  await assert.rejects(
    () =>
      updateAnnouncement(deps(seed), seed.ownerIdentity, seed.clubId, {
        announcementId: created.announcementId,
        title: '改名',
        expectedRevision: 3,
        mutationId: ids('upd'),
      }),
    (e: unknown) => (e as { code?: string }).code === 'invalid_transition'
  )
  await assert.rejects(
    () =>
      publishAnnouncement(deps(seed), seed.ownerIdentity, seed.clubId, {
        announcementId: created.announcementId,
        expectedRevision: 3,
        mutationId: ids('pub3'),
      }),
    (e: unknown) => (e as { code?: string }).code === 'invalid_transition'
  )
})

test('公告列表 (pinned desc, createdAt desc, _id desc) 三值游标跨页不漏重', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)
  const created: string[] = []
  for (let i = 0; i < 5; i += 1) {
    const doc = await createAnnouncement(deps(seed), seed.ownerIdentity, seed.clubId, {
      title: `公告${i}`,
      body: '正文',
      pinned: i % 2 === 0,
      mutationId: ids(`c${i}`),
    })
    created.push(doc.announcementId)
    seed.clock.advance(1000)
  }

  const seen: string[] = []
  let cursor: string | undefined
  for (let guard = 0; guard < 10; guard += 1) {
    const page = await listAnnouncements(deps(seed), seed.ownerIdentity, seed.clubId, { pageSize: 1, cursor })
    assert.ok(page.items.length <= 1)
    seen.push(...page.items.map((item) => item.announcementId))
    if (!page.hasMore || !page.nextCursor) break
    cursor = page.nextCursor
  }
  assert.equal(seen.length, 5)
  assert.equal(new Set(seen).size, 5)
  assert.deepEqual([...seen].sort(), [...created].sort())
  // 置顶（pinned desc）优先
  const first = await listAnnouncements(deps(seed), seed.ownerIdentity, seed.clubId, { pageSize: 1 })
  assert.equal(first.items[0].pinned, true)
})

test('异队 cursor 拒绝 cursor_scope_mismatch', async () => {
  const seed = await seedTeam()
  const ids = labelIds(seed.clock)
  const clubB = await seedSecondClub(seed, 'manager')

  for (let i = 0; i < 2; i += 1) {
    const doc = await createAnnouncement(deps(seed), seed.ownerIdentity, seed.clubId, {
      title: `A队公告${i}`,
      body: '正文',
      mutationId: ids(`ca${i}`),
    })
    await publishAnnouncement(deps(seed), seed.ownerIdentity, seed.clubId, {
      announcementId: doc.announcementId,
      expectedRevision: 1,
      mutationId: ids(`cpa${i}`),
    })
    seed.clock.advance(1000)
  }

  // 同一 identity 在 A 队是 super_admin（admin 指纹）
  const pageA = await listAnnouncements(deps(seed), seed.ownerIdentity, seed.clubId, { pageSize: 1 })
  assert.equal(pageA.items.length, 1)
  assert.ok(pageA.nextCursor)

  // 同一 identity 在 B 队是 manager → 仍为 admin 指纹，仅 clubId 不同 → 必须拒绝
  const pageB = await listAnnouncements(deps(seed), seed.ownerIdentity, clubB, { pageSize: 1 })
  assert.equal(pageB.items.length, 0)

  await assert.rejects(
    () => listAnnouncements(deps(seed), seed.ownerIdentity, clubB, { pageSize: 1, cursor: pageA.nextCursor as string }),
    (e: unknown) => (e as { code?: string }).code === 'cursor_scope_mismatch'
  )
})
