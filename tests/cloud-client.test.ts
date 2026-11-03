import assert from 'node:assert/strict'
import test from 'node:test'

import { createCloudClient, type CloudEnvelope, type RequestScope } from '../src/services/cloud/client.ts'
import { BackendError } from '../src/utils/backend-error.js'

const TEAM: RequestScope = { kind: 'TEAM', clubId: 'club-A' }

function makeClient(response: unknown, onCall?: (env: CloudEnvelope) => void) {
  let seq = 0
  return createCloudClient({
    requestIdFactory: () => `req-${++seq}`,
    transport: {
      async callFunction(_fn, payload) {
        onCall?.(payload)
        return response
      },
    },
  })
}

test('构造 apiVersion=2 信封并透传 mutationId/expectedRevision', async () => {
  let seen: CloudEnvelope | null = null
  const client = makeClient(
    { ok: true, requestId: 'req-1', scope: TEAM, data: { items: [] }, serverTime: 'now' },
    (env) => {
      seen = env
    }
  )
  const data = await client.call('rakApi', 'task.list', TEAM, { cursor: 'c1' }, { mutationId: 'm-1', expectedRevision: 3 })
  assert.deepEqual(data, { items: [] })
  assert.equal(seen!.apiVersion, 2)
  assert.equal(seen!.action, 'task.list')
  assert.deepEqual(seen!.scope, TEAM)
  assert.equal(seen!.mutationId, 'm-1')
  assert.equal(seen!.expectedRevision, 3)
  assert.equal(seen!.requestId, 'req-1')
})

test('ok:false 抛 BackendError 且不被当作成功或空数组', async () => {
  const client = makeClient({ ok: false, requestId: 'req-1', scope: TEAM, error: { code: 'permission_denied', message: 'x', retryable: false }, serverTime: 'now' })
  await assert.rejects(
    () => client.call('rakApi', 'task.claim', TEAM, {}, {}),
    (e: unknown) => e instanceof BackendError && e.code === 'permission_denied' && e.retryable === false
  )
})

test('响应 scope 与请求不一致 → scope_mismatch', async () => {
  const client = makeClient({ ok: true, requestId: 'req-1', scope: { kind: 'TEAM', clubId: 'club-B' }, data: {}, serverTime: 'now' })
  await assert.rejects(
    () => client.call('rakApi', 'task.list', TEAM, {}, {}),
    (e: unknown) => e instanceof BackendError && e.code === 'scope_mismatch'
  )
})

test('GLOBAL 响应带 clubId 视为 scope 不一致', async () => {
  const client = makeClient({ ok: true, requestId: 'req-1', scope: { kind: 'GLOBAL', clubId: 'club-A' }, data: {}, serverTime: 'now' })
  await assert.rejects(
    () => client.call('rakApi', 'auth.me', { kind: 'GLOBAL' }, {}, {}),
    (e: unknown) => e instanceof BackendError && e.code === 'scope_mismatch'
  )
})

test('响应缺 ok / requestId → internal_error', async () => {
  const bad1 = makeClient({ data: {} })
  await assert.rejects(() => bad1.call('rakApi', 'auth.me', { kind: 'GLOBAL' }, {}, {}), (e: unknown) => e instanceof BackendError && e.code === 'internal_error')
  const bad2 = makeClient({ ok: true, scope: { kind: 'GLOBAL' }, data: {} })
  await assert.rejects(() => bad2.call('rakApi', 'auth.me', { kind: 'GLOBAL' }, {}, {}), (e: unknown) => e instanceof BackendError && e.code === 'internal_error')
})

test('未知错误码规范化 internal_error；传输异常不回退 demo', async () => {
  const badCode = makeClient({ ok: false, requestId: 'req-1', scope: TEAM, error: { code: 'totally_unknown', retryable: false }, serverTime: 'now' })
  await assert.rejects(() => badCode.call('rakApi', 'task.list', TEAM, {}, {}), (e: unknown) => e instanceof BackendError && e.code === 'internal_error')

  const throwing = createCloudClient({
    requestIdFactory: () => 'req-1',
    transport: {
      async callFunction() {
        throw new Error('network down')
      },
    },
  })
  await assert.rejects(
    () => throwing.call('rakApi', 'task.list', TEAM, {}, {}),
    (e: unknown) => e instanceof BackendError && e.code === 'internal_error' && e.retryable === true
  )
})
