import assert from 'node:assert/strict'
import test from 'node:test'

import { AppError } from '../contracts/errors.ts'
import { validateEnvelope } from '../contracts/request-v2.ts'

function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    apiVersion: 2,
    action: 'auth.bootstrap',
    scope: { kind: 'GLOBAL' },
    requestId: 'req-1',
    data: {},
    ...overrides,
  }
}

function codeOf(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    if (error instanceof AppError) return error.code
    throw error
  }
  throw new Error('预期抛出 AppError，但未抛出')
}

test('接受合法的 GLOBAL 信封', () => {
  const parsed = validateEnvelope(envelope())
  assert.equal(parsed.request.action, 'auth.bootstrap')
  assert.deepEqual(parsed.request.scope, { kind: 'GLOBAL' })
  assert.equal(parsed.spec.fn, 'api')
})

test('接受合法的 TEAM 信封（带 clubId）', () => {
  const parsed = validateEnvelope(
    envelope({ action: 'task.list', scope: { kind: 'TEAM', clubId: 'club-A' } })
  )
  assert.deepEqual(parsed.request.scope, { kind: 'TEAM', clubId: 'club-A' })
  assert.equal(parsed.spec.scope, 'TEAM')
})

test('拒绝非 2 的 apiVersion', () => {
  assert.equal(codeOf(() => validateEnvelope(envelope({ apiVersion: 1 }))), 'validation_failed')
})

test('拒绝未注册的 action', () => {
  assert.equal(codeOf(() => validateEnvelope(envelope({ action: 'db.query' }))), 'validation_failed')
  assert.equal(codeOf(() => validateEnvelope(envelope({ action: 'task.everything' }))), 'validation_failed')
})

test('拒绝缺失 requestId', () => {
  assert.equal(codeOf(() => validateEnvelope(envelope({ requestId: '' }))), 'validation_failed')
})

test('拒绝 TEAM action 配 GLOBAL scope', () => {
  assert.equal(codeOf(() => validateEnvelope(envelope({ action: 'task.list' }))), 'scope_mismatch')
})

test('拒绝 GLOBAL action 配 TEAM scope', () => {
  assert.equal(
    codeOf(() => validateEnvelope(envelope({ scope: { kind: 'TEAM', clubId: 'club-A' } }))),
    'scope_mismatch'
  )
})

test('拒绝 TEAM scope 缺少 clubId', () => {
  assert.equal(
    codeOf(() => validateEnvelope(envelope({ action: 'task.list', scope: { kind: 'TEAM' } }))),
    'scope_mismatch'
  )
})

test('拒绝 data 内的归属字段（含嵌套）', () => {
  assert.equal(codeOf(() => validateEnvelope(envelope({ data: { clubId: 'x' } }))), 'validation_failed')
  assert.equal(codeOf(() => validateEnvelope(envelope({ data: { userId: 'u' } }))), 'validation_failed')
  assert.equal(
    codeOf(() => validateEnvelope(envelope({ data: { nested: { openid: 'o' } } }))),
    'validation_failed'
  )
  assert.equal(
    codeOf(() => validateEnvelope(envelope({ data: { list: [{ actorRole: 'super_admin' }] } }))),
    'validation_failed'
  )
})

test('拒绝非法 expectedRevision 与数组 data', () => {
  assert.equal(codeOf(() => validateEnvelope(envelope({ expectedRevision: -1 }))), 'validation_failed')
  assert.equal(codeOf(() => validateEnvelope(envelope({ expectedRevision: 1.5 }))), 'validation_failed')
  assert.equal(codeOf(() => validateEnvelope(envelope({ data: [] }))), 'validation_failed')
})

test('command.status 允许 GLOBAL 与 TEAM（且必填 action/mutationId）', () => {
  const data = { action: 'task.submit', mutationId: 'm-1' }
  assert.deepEqual(
    validateEnvelope(envelope({ action: 'command.status', data })).request.scope,
    { kind: 'GLOBAL' }
  )
  assert.deepEqual(
    validateEnvelope(
      envelope({ action: 'command.status', scope: { kind: 'TEAM', clubId: 'club-A' }, data })
    ).request.scope,
    { kind: 'TEAM', clubId: 'club-A' }
  )
  assert.equal(codeOf(() => validateEnvelope(envelope({ action: 'command.status' }))), 'validation_failed')
})

test('member.setRole 只接受 targetRole，拒绝含混 role 与缺字段', () => {
  const base = { action: 'member.setRole', scope: { kind: 'TEAM', clubId: 'club-A' } }
  assert.doesNotThrow(() =>
    validateEnvelope(envelope({ ...base, data: { targetMemberId: 'm1', targetRole: 'manager' } }))
  )
  assert.equal(
    codeOf(() => validateEnvelope(envelope({ ...base, data: { targetMemberId: 'm1', role: 'manager' } }))),
    'validation_failed'
  )
  assert.equal(
    codeOf(() => validateEnvelope(envelope({ ...base, data: { targetRole: 'manager' } }))),
    'validation_failed'
  )
})

test('member.setStatus 只接受 targetStatus', () => {
  const base = { action: 'member.setStatus', scope: { kind: 'TEAM', clubId: 'club-A' } }
  assert.doesNotThrow(() =>
    validateEnvelope(envelope({ ...base, data: { targetMemberId: 'm1', targetStatus: 'DISABLED' } }))
  )
  assert.equal(
    codeOf(() => validateEnvelope(envelope({ ...base, data: { targetMemberId: 'm1', status: 'DISABLED' } }))),
    'validation_failed'
  )
})

test('invite.redeem 的 code/sceneToken 互斥且 displayName 必填', () => {
  assert.doesNotThrow(() => validateEnvelope(envelope({ action: 'invite.redeem', data: { code: 'ABC', displayName: '张三' } })))
  assert.doesNotThrow(() => validateEnvelope(envelope({ action: 'invite.redeem', data: { sceneToken: 't', displayName: '张三' } })))
  assert.equal(
    codeOf(() => validateEnvelope(envelope({ action: 'invite.redeem', data: { code: 'A', sceneToken: 't', displayName: '张三' } }))),
    'validation_failed'
  )
  assert.equal(codeOf(() => validateEnvelope(envelope({ action: 'invite.redeem', data: { code: 'A' } }))), 'validation_failed')
})

test('club.searchForAdmin 只接受 keyword，拒绝 data 内归属字段', () => {
  assert.doesNotThrow(() =>
    validateEnvelope(envelope({ action: 'club.searchForAdmin', data: { keyword: '摄影' } }))
  )
  assert.equal(
    codeOf(() => validateEnvelope(envelope({ action: 'club.searchForAdmin', data: {} }))),
    'validation_failed'
  )
  assert.equal(
    codeOf(() => validateEnvelope(envelope({ action: 'club.searchForAdmin', data: { clubId: 'x' } }))),
    'validation_failed'
  )
  assert.equal(
    codeOf(() => validateEnvelope(envelope({ action: 'club.searchForAdmin', data: { limit: 5 } }))),
    'validation_failed'
  )
})

test('GLOBAL 解散动作用 targetClubId，拒绝 data 内 clubId', () => {
  assert.doesNotThrow(() =>
    validateEnvelope(
      envelope({ action: 'club.dissolveAny', data: { targetClubId: 'club-B', reason: '合并' } })
    )
  )
  assert.doesNotThrow(() =>
    validateEnvelope(
      envelope({ action: 'club.dissolution.decide', data: { targetClubId: 'club-B', approve: true } })
    )
  )
  assert.equal(
    codeOf(() =>
      validateEnvelope(envelope({ action: 'club.dissolveAny', data: { clubId: 'club-B', reason: '合并' } }))
    ),
    'validation_failed'
  )
  assert.equal(
    codeOf(() =>
      validateEnvelope(envelope({ action: 'club.dissolution.decide', data: { clubId: 'club-B', approve: true } }))
    ),
    'validation_failed'
  )
})

test('file.init 必填字段与未知字段拒绝；team.joinLink.rotate 仅允许空 data', () => {
  const fileBase = { action: 'file.init', scope: { kind: 'TEAM', clubId: 'club-A' } }
  assert.doesNotThrow(() =>
    validateEnvelope(envelope({ ...fileBase, data: { taskId: 't', expectedTaskRevision: 1, name: 'a.pdf', declaredSize: 10 } }))
  )
  assert.equal(
    codeOf(() => validateEnvelope(envelope({ ...fileBase, data: { taskId: 't', expectedTaskRevision: 1, name: 'a.pdf' } }))),
    'validation_failed'
  )
  assert.equal(
    codeOf(() =>
      validateEnvelope(envelope({ ...fileBase, data: { taskId: 't', expectedTaskRevision: 1, name: 'a.pdf', declaredSize: 10, fileID: 'x' } }))
    ),
    'validation_failed'
  )
  const rotate = { action: 'team.joinLink.rotate', scope: { kind: 'TEAM', clubId: 'club-A' } }
  assert.doesNotThrow(() => validateEnvelope(envelope({ ...rotate, data: {} })))
  assert.equal(codeOf(() => validateEnvelope(envelope({ ...rotate, data: { expectedRevision: 3 } }))), 'validation_failed')
})
