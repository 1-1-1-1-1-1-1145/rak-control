import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEVICE_CASES_ENV,
  REQUIRED_ENV,
  blockedMessage,
  buildInvokeArgv,
  resolveIntegrationConfig,
} from '../scripts/cloud-integration/config.mjs'
import { INTEGRATION_CASES, partitionCases } from '../scripts/cloud-integration/cases.mjs'

/**
 * test:cloud:integration 的 fail-closed 门禁（PLAN §4：缺 env/身份/证据必须非零退出，
 * 不能 skip 后全绿）。此处只验证**判定逻辑**，不产生任何真实云结论。
 */

test('缺 env：判定为不可运行，并逐项列出缺失名称（不含值）', () => {
  const resolved = resolveIntegrationConfig({})
  assert.equal(resolved.ok, false)
  assert.deepEqual(resolved.missing, REQUIRED_ENV)
  assert.equal(resolved.config, null)

  const message = blockedMessage(resolved.missing)
  assert.ok(message.includes('BLOCKED'))
  for (const key of REQUIRED_ENV) assert.ok(message.includes(key), key)
  assert.ok(message.includes('不得') && message.includes('skip'), '必须写明不得 skip 成 PASS')
})

test('部分 env：仍判定为不可运行（缺一不可）', () => {
  const partial = Object.fromEntries(REQUIRED_ENV.slice(0, REQUIRED_ENV.length - 1).map((k) => [k, 'x']))
  const resolved = resolveIntegrationConfig(partial)
  assert.equal(resolved.ok, false)
  assert.deepEqual(resolved.missing, [REQUIRED_ENV[REQUIRED_ENV.length - 1]])
})

test('空白值等同缺失（不接受占位空串冒充配置）', () => {
  const blank = Object.fromEntries(REQUIRED_ENV.map((k) => [k, '   ']))
  assert.equal(resolveIntegrationConfig(blank).ok, false)
})

test('配置齐全：可运行，且真机用例默认关闭（不冒充 PASS）', () => {
  const env = Object.fromEntries(REQUIRED_ENV.map((k) => [k, `value-${k}`]))
  const resolved = resolveIntegrationConfig(env)
  assert.equal(resolved.ok, true)
  assert.equal(resolved.deviceCasesEnabled, false)

  const withDevice = resolveIntegrationConfig({ ...env, [DEVICE_CASES_ENV]: '1' })
  assert.equal(withDevice.deviceCasesEnabled, true)
})

test('模板替换：只替换 {fn}/{env}/{params}，不猜 CLI 参数', () => {
  const argv = buildInvokeArgv('tcb fn invoke {fn} -e {env} --params {params}', {
    fn: 'rakApi',
    env: 'cloud1-x',
    params: '{"a":1}',
  })
  assert.deepEqual(argv, ['tcb', 'fn', 'invoke', 'rakApi', '-e', 'cloud1-x', '--params', '{"a":1}'])
})

test('MT01–MT22 矩阵完整、id 唯一、通道合法', () => {
  const ids = INTEGRATION_CASES.map((c) => c.id)
  assert.equal(ids.length, 22)
  assert.equal(new Set(ids).size, 22)
  const expected = Array.from({ length: 22 }, (_, i) => `MT${String(i + 1).padStart(2, '0')}`)
  assert.deepEqual([...ids].sort(), expected)
  for (const c of INTEGRATION_CASES) {
    assert.ok(['identity', 'admin', 'device', 'worker'].includes(c.channel), c.id)
    assert.ok(c.desc.length > 0, c.id)
  }
})

test('非身份通道一律记 NOT_RUN 并写明原因（不计 PASS）', () => {
  const { identity, notRun } = partitionCases(INTEGRATION_CASES, { deviceCasesEnabled: false })
  assert.ok(identity.length > 0)
  assert.equal(identity.length + notRun.length, INTEGRATION_CASES.length)
  assert.ok(notRun.every((c) => c.reason.length > 0 && c.channel !== 'identity'))
  // 设备/worker 类不被错误地当成身份用例
  assert.ok(!identity.some((c) => c.channel === 'device' || c.channel === 'worker'))
})
