import assert from 'node:assert/strict'
import test from 'node:test'

import { AccountSession } from '../src/store/account.ts'
import { TeamSessionStore, type ActiveTeam } from '../src/store/team-session.ts'
import { ScopedCache } from '../src/utils/scoped-cache.ts'

function team(clubId: string, memberId: string): ActiveTeam {
  return {
    clubId,
    clubName: clubId,
    displayCode: clubId.toUpperCase(),
    memberId,
    displayName: '王同学',
    duty: null,
    role: 'member',
    membershipRevision: 1,
    permissions: [],
  }
}

test('AccountSession：首次 bootstrap 尝试与安装栅栏', () => {
  const session = new AccountSession({ backend: 'cloud', env: 'cloud1', appId: 'wxa' })
  assert.equal(session.isIdentified, false)
  session.beginBootstrapAttempt('attempt-1')
  assert.equal(session.install('key-1', 'attempt-1'), true)
  assert.equal(session.isIdentified, true)

  // 过期尝试不得安装（迟到响应不回填）
  const other = new AccountSession({ backend: 'cloud', env: 'cloud1', appId: 'wxa' })
  other.beginBootstrapAttempt('attempt-new')
  assert.equal(other.install('key-x', 'attempt-stale'), false)
  assert.equal(other.isIdentified, false)
})

test('AccountSession：invalidate 递增 epoch，旧 ctx 不再 current', () => {
  const session = new AccountSession({ backend: 'cloud', env: 'cloud1', appId: 'wxa' })
  session.install('key-1')
  const ctx = session.capture()
  assert.equal(session.isCurrent(ctx), true)
  session.invalidate()
  assert.equal(session.isCurrent(ctx), false)
})

test('TeamSessionStore：进入成功/失败与就绪上下文', () => {
  const store = new TeamSessionStore()
  store.bindAccount({ backend: 'cloud', env: 'cloud1', appId: 'wxa', accountKey: 'key-1', accountEpoch: 1 })
  assert.equal(store.state, 'TEAM_SELECTION')
  assert.throws(() => store.captureReadyContext(), /未就绪/)

  const attempt = store.beginEnter()
  assert.equal(store.state, 'ENTERING')
  // 旧/错 attempt 不得安装
  assert.equal(store.install(team('club-A', 'mA'), 'wrong-attempt'), false)
  assert.equal(store.install(team('club-A', 'mA'), attempt), true)
  assert.equal(store.state, 'READY')

  const ctx = store.captureReadyContext()
  assert.equal(ctx.clubId, 'club-A')
  assert.equal(ctx.memberId, 'mA')
  assert.equal(ctx.accountEpoch, 1)

  store.failEnter('网络错误')
  assert.equal(store.state, 'TEAM_SELECTION')
  assert.equal(store.active, null)
})

test('A→B→A：以 epoch 区分两次 A，旧 ctx 不再 current', () => {
  const store = new TeamSessionStore()
  store.bindAccount({ backend: 'cloud', env: 'cloud1', appId: 'wxa', accountKey: 'key-1', accountEpoch: 1 })

  const a1 = store.beginEnter()
  store.install(team('club-A', 'mA'), a1)
  const ctxA1 = store.captureReadyContext()

  const b = store.beginEnter()
  store.install(team('club-B', 'mB'), b)
  assert.equal(store.isCurrent(ctxA1), false)
  const ctxB = store.captureReadyContext()
  assert.equal(ctxB.clubId, 'club-B')

  const a2 = store.beginEnter()
  store.install(team('club-A', 'mA'), a2)
  const ctxA2 = store.captureReadyContext()
  assert.equal(store.isCurrent(ctxA1), false, '两次 A 必须靠 epoch 区分')
  assert.equal(store.isCurrent(ctxA2), true)
  assert.notEqual(ctxA1.epoch, ctxA2.epoch)
})

test('ScopedCache：命名空间隔离与精确清理', () => {
  const cache = new ScopedCache<string>()
  const base = { backend: 'cloud', env: 'cloud1', appId: 'wxa', accountKey: 'key-1', schemaVersion: 1 }
  const scopeA = { ...base, clubId: 'club-A', memberId: 'mA', resourceKind: 'task-list' }
  const scopeB = { ...base, clubId: 'club-B', memberId: 'mB', resourceKind: 'task-list' }

  cache.set(scopeA, 'A-data', 1000)
  cache.set(scopeB, 'B-data', 1000)
  assert.equal(cache.get(scopeA, 1), 'A-data')
  assert.equal(cache.get(scopeB, 1), 'B-data')

  cache.clearMatching({ clubId: 'club-A' })
  assert.equal(cache.get(scopeA, 1), null)
  assert.equal(cache.get(scopeB, 1), 'B-data')

  // 过期不返回
  assert.equal(cache.get(scopeB, 1000), null)
  cache.set(scopeB, 'B2', 5000)
  cache.clearAll()
  assert.equal(cache.size, 0)
})
