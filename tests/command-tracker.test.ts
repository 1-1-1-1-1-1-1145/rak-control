import assert from 'node:assert/strict'
import test from 'node:test'

import { CommandTracker, scopeKeyOf } from '../src/store/command-tracker.ts'

/** M7 §(d)/M4：客户端最小命令追踪器（scope 隔离、未知写只查询不重放）。 */

const TEAM_A = { kind: 'TEAM', clubId: 'clubA' } as const
const TEAM_B = { kind: 'TEAM', clubId: 'clubB' } as const
const GLOBAL = { kind: 'GLOBAL' } as const

test('scopeKeyOf：GLOBAL 与 TEAM 规范键', () => {
  assert.equal(scopeKeyOf(GLOBAL), 'GLOBAL')
  assert.equal(scopeKeyOf(TEAM_A), 'TEAM:clubA')
})

test('begin → resolve：结果确定后不再保留指针', () => {
  const tracker = new CommandTracker()
  tracker.begin(TEAM_A, 'task.claim', 'm-1', 100)
  assert.equal(tracker.list().length, 1)
  assert.equal(tracker.pendingInScope('TEAM:clubA').length, 0, 'PENDING 不进入待查询集合')

  tracker.resolve(TEAM_A, 'task.claim', 'm-1')
  assert.equal(tracker.list().length, 0)
})

test('结果未知：保留原键等待查询，且不产生新键', () => {
  const tracker = new CommandTracker()
  tracker.begin(TEAM_A, 'task.submit', 'm-unknown', 100)
  tracker.markUnknown(TEAM_A, 'task.submit', 'm-unknown', 101)

  const pending = tracker.pendingInScope('TEAM:clubA')
  assert.equal(pending.length, 1)
  assert.equal(pending[0].mutationId, 'm-unknown', '必须复用原 mutationId（不新键重做）')
  assert.equal(pending[0].action, 'task.submit')
  assert.equal(pending[0].state, 'UNKNOWN')
})

test('scope 隔离：A 队的未知写不得在 B 队查询或续跑', () => {
  const tracker = new CommandTracker()
  tracker.markUnknown(TEAM_A, 'announcement.create', 'm-a', 10)
  tracker.markUnknown(TEAM_B, 'announcement.create', 'm-b', 11)

  // B 队只查询 B 自己的指针
  assert.deepEqual(
    tracker.pendingInScope('TEAM:clubB').map((e) => e.mutationId),
    ['m-b']
  )
  // A 的指针在 B 视角下属于"异 scope"，本队不得处理
  assert.deepEqual(
    tracker.pendingOutOfScope('TEAM:clubB').map((e) => e.mutationId),
    ['m-a']
  )
  // 回到 A 后仍可查询原键
  assert.deepEqual(
    tracker.pendingInScope('TEAM:clubA').map((e) => e.mutationId),
    ['m-a']
  )
})

test('GLOBAL 与 TEAM 指针互不混淆', () => {
  const tracker = new CommandTracker()
  tracker.markUnknown(GLOBAL, 'invite.redeem', 'm-g', 10)
  assert.deepEqual(
    tracker.pendingInScope('GLOBAL').map((e) => e.mutationId),
    ['m-g']
  )
  assert.equal(tracker.pendingInScope('TEAM:clubA').length, 0)
})

test('持久化只留最小指针：重启后丢弃 PENDING（无 payload 不可重放），仅保留 UNKNOWN', () => {
  const tracker = new CommandTracker()
  tracker.begin(TEAM_A, 'task.claim', 'm-pending', 10)
  tracker.markUnknown(TEAM_A, 'task.submit', 'm-unknown', 11)

  const restored = new CommandTracker()
  restored.loadFrom(tracker.toJSON())

  const entries = restored.list()
  assert.equal(entries.length, 1)
  assert.equal(entries[0].mutationId, 'm-unknown')
  assert.equal(entries[0].state, 'UNKNOWN')
  // 最小指针：字段集合固定，不含 payload
  assert.deepEqual(Object.keys(entries[0]).sort(), ['action', 'mutationId', 'scopeKey', 'state', 'updatedAt'])
})

test('持久化数据形状非法即丢弃，不猜测内容', () => {
  const tracker = new CommandTracker()
  tracker.loadFrom([
    null,
    42,
    {},
    { scopeKey: 'TEAM:clubA', action: 'task.claim' },
    { scopeKey: 'TEAM:clubA', action: 'task.claim', mutationId: 'm-1', updatedAt: 'x' },
    { scopeKey: 'TEAM:clubA', action: 'task.claim', mutationId: 'm-2', updatedAt: 5, state: 'UNKNOWN' },
  ])
  assert.deepEqual(
    tracker.list().map((e) => e.mutationId),
    ['m-2']
  )
  tracker.loadFrom('not-an-array')
  assert.equal(tracker.list().length, 0)
})

test('clearAll：换账号/登出后清空指针', () => {
  const tracker = new CommandTracker()
  tracker.markUnknown(TEAM_A, 'task.claim', 'm-1', 1)
  tracker.clearAll()
  assert.equal(tracker.list().length, 0)
})
