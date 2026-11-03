import assert from 'node:assert/strict'
import test from 'node:test'

import { main as rakApi } from '../entrypoints/rak-api.ts'
import { main as rakFiles } from '../entrypoints/rak-files.ts'
import { main as rakMaintenance } from '../entrypoints/rak-maintenance.ts'
import type { CloudResponse } from '../contracts/request-v2.ts'

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

test('rakApi 对已注册但未实现的业务动作为 not_implemented', async () => {
  const res = (await rakApi(envelope())) as CloudResponse
  assert.equal(res.ok, false)
  if (!res.ok) assert.equal(res.error.code, 'not_implemented')
})

test('rakApi 拒绝不属于本函数的 action', async () => {
  const res = (await rakApi(
    envelope({
      action: 'file.init',
      scope: { kind: 'TEAM', clubId: 'club-A' },
      data: { taskId: 't', expectedTaskRevision: 1, name: 'a.pdf', declaredSize: 10 },
    })
  )) as CloudResponse
  assert.equal(res.ok, false)
  if (!res.ok) assert.equal(res.error.code, 'validation_failed')
})

test('rakFiles 对未实现文件动作为 not_implemented', async () => {
  const res = (await rakFiles(
    envelope({
      action: 'file.init',
      scope: { kind: 'TEAM', clubId: 'club-A' },
      data: { taskId: 't', expectedTaskRevision: 1, name: 'a.pdf', declaredSize: 10 },
    })
  )) as CloudResponse
  assert.equal(res.ok, false)
  if (!res.ok) assert.equal(res.error.code, 'not_implemented')
})

test('非法信封返回 ok:false，且请求解析失败时 requestId 为空', async () => {
  const res = (await rakApi({ apiVersion: 1, action: 'auth.bootstrap' })) as CloudResponse
  assert.equal(res.ok, false)
  assert.equal(res.requestId, '')
})

test('rakMaintenance 骨架明确未实现业务', async () => {
  const res = await rakMaintenance()
  assert.equal(res.ok, true)
  assert.equal(res.handled, false)
  assert.equal(res.reason, 'not_implemented')
})
