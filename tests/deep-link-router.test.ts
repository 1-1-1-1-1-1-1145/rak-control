import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PendingIntentStore,
  parseCloudDeepLink,
  parseLegacyDeepLink,
  planDeepLink,
  resolveDeepLinkRoute,
} from '../src/utils/pending-intent.ts'
import type { TeamState } from '../src/store/team-session.ts'

/** M7：业务深链计划 + 一次消费语义（纯函数层，不涉及 Taro）。 */

const READY: TeamState = 'READY'

test('同队 cloud 深链 → 直接进入目标路由（保留 apiVersion/clubId 供目标页二次校验）', () => {
  const query = { apiVersion: '2', clubId: 'clubA', resourceKind: 'task', resourceId: 't-1' }
  assert.deepEqual(parseCloudDeepLink(query), { clubId: 'clubA', resourceKind: 'task', resourceId: 't-1' })

  const plan = planDeepLink({ query, accountEpoch: 7, activeClubId: 'clubA', teamState: READY })
  assert.equal(plan.action, 'consumed')
  if (plan.action !== 'consumed') return
  assert.ok(plan.route.startsWith('/pages/task/detail?id=t-1'))
  assert.ok(plan.route.includes('apiVersion=2'))
  assert.ok(plan.route.includes('clubId=clubA'))
  assert.ok(plan.route.includes('resourceKind=task'))
})

test('异队 cloud 深链 → 记录 pendingIntent 并走同一切换（不直接进入）', () => {
  const plan = planDeepLink({
    query: { apiVersion: '2', clubId: 'clubB', resourceKind: 'task', resourceId: 't-9' },
    accountEpoch: 3,
    activeClubId: 'clubA',
    teamState: READY,
  })
  assert.equal(plan.action, 'switch')
  if (plan.action !== 'switch') return
  assert.equal(plan.clubId, 'clubB')
  assert.equal(plan.intent.accountEpoch, 3)
  assert.equal(plan.intent.switchAttemptId, null)
  assert.deepEqual(plan.intent.target, { clubId: 'clubB', resourceKind: 'task', resourceId: 't-9' })
})

test('仅 id 的旧链：不查找归属、不重定向（由目标页在当前 READY 队内解释）', () => {
  assert.deepEqual(parseLegacyDeepLink({ id: 't-1' }), { resourceId: 't-1' })
  assert.equal(parseCloudDeepLink({ id: 't-1' }), null)

  const plan = planDeepLink({ query: { id: 't-1' }, accountEpoch: 1, activeClubId: 'clubA', teamState: READY })
  assert.equal(plan.action, 'ignored')
  // 无 READY 队时同样不重定向（不做全库归属查找）
  assert.equal(
    planDeepLink({ query: { id: 't-1' }, accountEpoch: 1, activeClubId: null, teamState: 'TEAM_SELECTION' }).action,
    'ignored'
  )
})

test('缺 apiVersion/clubId/resourceKind 一律 ignored', () => {
  for (const query of [
    null,
    undefined,
    {},
    { apiVersion: '1', clubId: 'A', resourceKind: 'task' },
    { apiVersion: '2', resourceKind: 'task' },
    { apiVersion: '2', clubId: 'A' },
    { apiVersion: '2', clubId: 'A', resourceKind: 'unknown' },
  ]) {
    assert.equal(
      planDeepLink({ query, accountEpoch: 1, activeClubId: 'A', teamState: READY }).action,
      'ignored',
      JSON.stringify(query)
    )
  }
})

test('intent 一次消费：同代次同队才可消费，消费后清空', () => {
  const store = new PendingIntentStore()
  store.set({
    accountEpoch: 5,
    switchAttemptId: null,
    target: { clubId: 'B', resourceKind: 'roi', resourceId: 'r-1' },
  })
  assert.equal(store.peek()?.target.clubId, 'B')
  assert.equal(store.matches(5, 'B'), true)

  const consumed = store.consume(5, 'B')
  assert.deepEqual(consumed, { clubId: 'B', resourceKind: 'roi', resourceId: 'r-1' })
  assert.equal(store.consume(5, 'B'), null)
  assert.equal(store.peek(), null)
})

test('取消/失败不消费；账户代次或目标不一致时不得误消费', () => {
  const store = new PendingIntentStore()
  store.set({
    accountEpoch: 5,
    switchAttemptId: null,
    target: { clubId: 'B', resourceKind: 'task', resourceId: null },
  })

  // 旧账户代次（换账号后迟到结果）不得消费
  assert.equal(store.consume(4, 'B'), null)
  // 切到了别的队：目标不匹配，不消费
  assert.equal(store.consume(5, 'C'), null)
  // 未消费 ⇒ intent 仍在，换回目标队后可再次消费
  assert.equal(store.matches(5, 'B'), true)
  assert.ok(store.consume(5, 'B'))
})

test('resolveDeepLinkRoute：无 resourceId 时进入对应列表页', () => {
  assert.ok(
    (resolveDeepLinkRoute({ clubId: 'A', resourceKind: 'task', resourceId: null }) ?? '').startsWith(
      '/pages/task/pool?'
    )
  )
  assert.ok(
    (resolveDeepLinkRoute({ clubId: 'A', resourceKind: 'announcement', resourceId: null }) ?? '').includes(
      '/pages/club/announcement-list'
    )
  )
})
