import assert from 'node:assert/strict'
import test from 'node:test'

import { main as rakFiles } from '../entrypoints/rak-files.ts'
import { actionsFor } from '../contracts/actions.ts'
import type { CloudResponse } from '../contracts/request-v2.ts'
import { assertStorageAdjudicated, resolveStorageCapabilities } from '../storage/capabilities.ts'
import { loadStorageAdapter } from '../storage/adapter.ts'
import * as fileVerification from '../jobs/file-verification.ts'
import * as storageCleanup from '../jobs/storage-cleanup.ts'
import * as reconcile from '../jobs/reconcile.ts'

/**
 * M5 fail-closed 骨架用例（多团队 DESIGN §11、PLAN §M5）。
 *
 * 只证明「未裁决即拒绝、无伪造字段、无副作用」；**不**证明附件可用
 * （真实字节传输/M8 依赖 M0 上传协议裁决与真实环境，见 docs/verification/m5-execution-log）。
 */

/** 每个 file.* 动作的合法 data（仅为通过信封层字段校验）。 */
const VALID_DATA: Record<string, Record<string, unknown>> = {
  'file.init': { taskId: 'task-1', expectedTaskRevision: 1, name: 'a.pdf', declaredSize: 1024 },
  'file.status': { sessionId: 'sess-1' },
  'file.confirm': { sessionId: 'sess-1' },
  'file.cancel': { sessionId: 'sess-1' },
  'file.downloadUrls': { attachmentIds: [] },
  'file.previewDraft': { attachmentId: 'att-1' },
  'file.putChunk': { sessionId: 'sess-1', index: 0, base64: 'AA==' },
}

function filesEnvelope(action: string, data: Record<string, unknown>, scope: unknown = { kind: 'TEAM', clubId: 'club-A' }) {
  return { apiVersion: 2, action, scope, requestId: 'req-file', data }
}

/** 递归收集响应中的全部 JSON 键（用于断言不存在伪造字段）。 */
function collectKeys(value: unknown, acc: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, acc)
    return acc
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      acc.add(key)
      collectKeys(child, acc)
    }
  }
  return acc
}

test('存储能力未裁决：无假定值、未裁决即拒绝', () => {
  const caps = resolveStorageCapabilities()
  assert.equal(caps.adjudicated, false)
  assert.equal(caps.uploadTransport, null)
  assert.equal(caps.maxObjectBytes, null)
  assert.equal(caps.downloadTtlSeconds, null)

  assert.throws(
    () => assertStorageAdjudicated(caps),
    (error: unknown) => (error as { code?: string }).code === 'storage_unavailable'
  )
})

test('存储适配器：未裁决适配器拒绝一切传输要求', () => {
  const adapter = loadStorageAdapter()
  const caps = adapter.capabilities()
  assert.equal(caps.adjudicated, false)
  assert.throws(
    () => adapter.requireAdjudicated(),
    (error: unknown) => (error as { code?: string }).code === 'storage_unavailable'
  )
})

test('rakFiles：注册表中每个 file.* 动作逐个 fail-closed，且不返回任何伪造字段', async () => {
  const fileActions = actionsFor('files')
  assert.ok(fileActions.length > 0, '注册表应含 files 函数动作')
  // 覆盖表必须与注册表一致：新增 file.* 动作而未在用例中覆盖即失败
  assert.deepEqual(Object.keys(VALID_DATA).sort(), [...fileActions].sort())

  for (const action of fileActions) {
    const res = (await rakFiles(filesEnvelope(action, VALID_DATA[action]))) as CloudResponse
    assert.equal(res.ok, false, `${action} 必须 fail-closed`)
    assert.ok(!('data' in res), `${action} 失败响应不得携带 data`)
    if (!res.ok) assert.equal(res.error.code, 'not_implemented', `${action} 必须为 not_implemented`)

    const text = JSON.stringify(res)
    const keys = collectKeys(res)
    for (const forbidden of ['fileID', 'expiresAt', 'uploadUrl', 'downloadUrl']) {
      assert.ok(!keys.has(forbidden), `${action} 响应不得出现伪造字段 ${forbidden}`)
      assert.ok(!text.includes(`"${forbidden}"`), `${action} 响应不得出现伪造字段 ${forbidden}`)
    }
    assert.ok(!text.includes('cloud://'), `${action} 响应不得出现 cloud:// 文件标识`)
  }
})

test('file.* 必须是 TEAM scope：GLOBAL scope 被拒', async () => {
  const res = (await rakFiles(
    filesEnvelope('file.init', VALID_DATA['file.init'], { kind: 'GLOBAL' })
  )) as CloudResponse
  assert.equal(res.ok, false)
  if (!res.ok) assert.equal(res.error.code, 'scope_mismatch')
})

test('file.* 不得由 payload 夹带 clubId/actorRole（信封 schema 拒绝）', async () => {
  const res = (await rakFiles(
    filesEnvelope('file.init', { ...VALID_DATA['file.init'], clubId: 'club-B', actorRole: 'manager' })
  )) as CloudResponse
  assert.equal(res.ok, false)
  if (!res.ok) assert.equal(res.error.code, 'validation_failed')
})

test('后台任务骨架：三种任务均返回未实现，且类型互异', async () => {
  const jobs = [fileVerification, storageCleanup, reconcile]
  const types = new Set<string>()
  for (const job of jobs) {
    const outcome = await job.run()
    assert.equal(outcome.ok, true)
    assert.equal(outcome.handled, false)
    assert.equal(outcome.reason, 'not_implemented')
    assert.equal(outcome.job, job.JOB_TYPE)
    types.add(outcome.job)
  }
  assert.equal(types.size, jobs.length, '任务类型必须互异')
})
