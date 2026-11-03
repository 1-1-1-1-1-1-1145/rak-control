import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PendingIntentStore,
  parseCloudDeepLink,
  parseLegacyDeepLink,
} from '../src/utils/pending-intent.ts'

test('cloud 业务深链必须带 apiVersion=2 + clubId + 合法 resourceKind', () => {
  assert.deepEqual(
    parseCloudDeepLink({ apiVersion: '2', clubId: 'clubA', resourceKind: 'task', resourceId: 't1' }),
    { clubId: 'clubA', resourceKind: 'task', resourceId: 't1' }
  )
  // resourceId 可缺省
  assert.deepEqual(parseCloudDeepLink({ apiVersion: '2', clubId: 'clubA', resourceKind: 'club' }), {
    clubId: 'clubA',
    resourceKind: 'club',
    resourceId: null,
  })
  // 缺 apiVersion / 版本不是 2
  assert.equal(parseCloudDeepLink({ clubId: 'clubA', resourceKind: 'task' }), null)
  assert.equal(parseCloudDeepLink({ apiVersion: '1', clubId: 'clubA', resourceKind: 'task' }), null)
  // 缺/空 clubId
  assert.equal(parseCloudDeepLink({ apiVersion: '2', resourceKind: 'task' }), null)
  assert.equal(parseCloudDeepLink({ apiVersion: '2', clubId: '', resourceKind: 'task' }), null)
  // 未知 resourceKind 一律拒绝（不接受任意集合名）
  assert.equal(parseCloudDeepLink({ apiVersion: '2', clubId: 'clubA', resourceKind: 'anything' }), null)
  assert.equal(parseCloudDeepLink({ apiVersion: '2', clubId: 'clubA', resourceKind: 'collection' }), null)
})

test('旧链接仅 id：不查找归属；带 apiVersion/clubId 则不算旧链接', () => {
  assert.deepEqual(parseLegacyDeepLink({ id: 't1' }), { resourceId: 't1' })
  assert.equal(parseLegacyDeepLink({ id: '' }), null)
  assert.equal(parseLegacyDeepLink({}), null)
  // 带归属字段的新链接不得按旧链接解释
  assert.equal(parseLegacyDeepLink({ id: 't1', clubId: 'clubA' }), null)
  assert.equal(parseLegacyDeepLink({ id: 't1', apiVersion: '2' }), null)
})

test('pendingIntent 绑定账户代次与目标队，一次消费', () => {
  const store = new PendingIntentStore()
  store.set({ accountEpoch: 3, switchAttemptId: null, target: { clubId: 'clubB', resourceKind: 'task', resourceId: 't9' } })

  assert.equal(store.matches(3, 'clubB'), true)
  assert.equal(store.matches(4, 'clubB'), false)
  assert.equal(store.matches(3, 'clubA'), false)

  // 账户代次不匹配：不消费（保留原 intent）
  assert.equal(store.consume(4, 'clubB'), null)
  assert.equal(store.peek()?.target.clubId, 'clubB')

  // 目标队不匹配：不消费
  assert.equal(store.consume(3, 'clubA'), null)
  assert.equal(store.peek()?.target.resourceId, 't9')

  // 匹配：一次消费后清空
  assert.deepEqual(store.consume(3, 'clubB'), { clubId: 'clubB', resourceKind: 'task', resourceId: 't9' })
  assert.equal(store.peek(), null)
  assert.equal(store.consume(3, 'clubB'), null)
})

test('切换尝试编号可绑定而不改动目标；取消则 clear 不消费', () => {
  const store = new PendingIntentStore()
  store.set({ accountEpoch: 1, switchAttemptId: null, target: { clubId: 'clubC', resourceKind: 'roi', resourceId: null } })
  store.bindSwitchAttempt('switch-2')
  assert.equal(store.peek()?.switchAttemptId, 'switch-2')
  assert.equal(store.peek()?.target.clubId, 'clubC')

  // 用户取消切换：intent 不消费（仍属于自己的目标）
  store.clear()
  assert.equal(store.peek(), null)
  assert.equal(store.consume(1, 'clubC'), null)
})

test('GLOBAL 入会期间切到别的队：本人账户级结果不改变当前队', () => {
  const store = new PendingIntentStore()
  // 在 A 时发起 GLOBAL 加入 C 的申请，只提升本人账户级状态（不设当前队）
  store.set({ accountEpoch: 5, switchAttemptId: null, target: { clubId: 'clubC', resourceKind: 'club', resourceId: null } })
  // 切到 B 后：C 的 intent 不属于 B，不得在 B 消费
  assert.equal(store.consume(5, 'clubB'), null)
  assert.equal(store.peek()?.target.clubId, 'clubC')
})
