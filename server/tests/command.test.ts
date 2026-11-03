import assert from 'node:assert/strict'
import test from 'node:test'

import { AppError } from '../contracts/errors.ts'
import type { RequestScope } from '../contracts/request-v2.ts'
import {
  assertMutationFresh,
  canonicalJson,
  commandKey,
  inputHash,
  mutationTimeMs,
  scopeCanonical,
} from '../shared/command.ts'
import { decodeCursor, encodeCursor } from '../shared/cursor.ts'
import { assertTxBudget } from '../shared/transaction.ts'
import { assertTrustedIdentity, deriveIdentityId, deriveMemberId } from '../shared/identity.ts'

function uuidV7(ms: number): string {
  const hex = ms.toString(16).padStart(12, '0')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7abc-8def-0123456789ab`
}

function codeOf(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    if (error instanceof AppError) return error.code
    throw error
  }
  throw new Error('预期抛出 AppError')
}

test('UUIDv7 内嵌时间可提取且稳定', () => {
  assert.equal(mutationTimeMs(uuidV7(1_700_000_000_000)), 1_700_000_000_000)
  assert.equal(codeOf(() => mutationTimeMs('not-a-uuid')), 'validation_failed')
})

test('命令年龄门禁：未来偏差与过期窗口', () => {
  const base = 1_700_000_000_000
  assert.doesNotThrow(() => assertMutationFresh(uuidV7(base), base + 1000))
  assert.equal(codeOf(() => assertMutationFresh(uuidV7(base), base - 10 * 60 * 1000)), 'validation_failed')
  assert.equal(codeOf(() => assertMutationFresh(uuidV7(base), base + 25 * 60 * 60 * 1000)), 'command_expired')
})

test('canonicalJson 不受键顺序影响，inputHash 随之稳定', () => {
  assert.equal(canonicalJson({ a: 1, b: 2 }), canonicalJson({ b: 2, a: 1 }))
  const scope: RequestScope = { kind: 'TEAM', clubId: 'club-A' }
  const h1 = inputHash({ apiVersion: 2, action: 'task.submit', scope, data: { note: 'x', ids: ['1'] } })
  const h2 = inputHash({ apiVersion: 2, action: 'task.submit', scope, data: { ids: ['1'], note: 'x' } })
  assert.equal(h1, h2)
  const h3 = inputHash({ apiVersion: 2, action: 'task.submit', scope, data: { note: 'y', ids: ['1'] } })
  assert.notEqual(h1, h3)
})

test('命令键包含 scope：同 mutationId 两队不同键', () => {
  const a = commandKey({ kind: 'TEAM', clubId: 'club-A' }, 'id-1', 'task.submit', uuidV7(1))
  const b = commandKey({ kind: 'TEAM', clubId: 'club-B' }, 'id-1', 'task.submit', uuidV7(1))
  const g = commandKey({ kind: 'GLOBAL' }, 'id-1', 'task.submit', uuidV7(1))
  assert.notEqual(a, b)
  assert.notEqual(a, g)
  assert.equal(scopeCanonical({ kind: 'GLOBAL' }), 'GLOBAL')
  assert.equal(scopeCanonical({ kind: 'TEAM', clubId: 'club-A' }), 'TEAM:club-A')
})

test('游标绑定 scope：异 scope 解码被拒', () => {
  const raw = encodeCursor({ v: 1, action: 'task.list', clubId: 'club-A', fingerprint: 'f1', sort: ['2026-01-01', 'id-1'] })
  const ok = decodeCursor(raw, { action: 'task.list', clubId: 'club-A', fingerprint: 'f1' })
  assert.deepEqual(ok.sort, ['2026-01-01', 'id-1'])
  assert.equal(
    codeOf(() => decodeCursor(raw, { action: 'task.list', clubId: 'club-B', fingerprint: 'f1' })),
    'cursor_scope_mismatch'
  )
  assert.equal(
    codeOf(() => decodeCursor(raw, { action: 'task.list', clubId: 'club-A', fingerprint: 'f2' })),
    'cursor_scope_mismatch'
  )
})

test('事务操作数超过平台上限被拒', () => {
  assert.doesNotThrow(() => assertTxBudget(40))
  assert.throws(() => assertTxBudget(101))
})

test('身份：确定性 ID 与 AppID/环境校验', () => {
  assert.equal(deriveIdentityId('app', 'openid'), deriveIdentityId('app', 'openid'))
  assert.notEqual(deriveIdentityId('app', 'openid'), deriveIdentityId('app', 'openid2'))
  assert.equal(deriveMemberId('club-A', 'user-1'), deriveMemberId('club-A', 'user-1'))
  assert.notEqual(deriveMemberId('club-A', 'user-1'), deriveMemberId('club-B', 'user-1'))

  const identity = { appId: 'app-1', openid: 'oid-1', env: 'env-1' }
  assert.doesNotThrow(() => assertTrustedIdentity(identity, { appId: 'app-1', env: 'env-1' }))
  assert.equal(codeOf(() => assertTrustedIdentity(null, { appId: 'app-1', env: 'env-1' })), 'identity_required')
  assert.equal(codeOf(() => assertTrustedIdentity(identity, { appId: 'app-2', env: 'env-1' })), 'app_mismatch')
  assert.equal(codeOf(() => assertTrustedIdentity(identity, { appId: 'app-1', env: 'env-2' })), 'environment_mismatch')
})
