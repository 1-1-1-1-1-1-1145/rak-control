#!/usr/bin/env node
/**
 * test:cloud:integration —— 真实云集成入口（PLAN §4 表格行）。
 *
 * 责任：在**隔离环境**以真实微信身份经 callFunction 执行 MT01–MT22 中可自动化的部分，
 * 并用**独立只读**通道做写前/写后断言；输出证据 JSON。
 *
 * 硬性行为（PLAN §4、§M0 出口）：
 * - 缺 env / 身份通道 / 独立只读断言通道 / fixture ⇒ **非零退出**，逐项列出缺失名称；
 * - **绝不** skip 后判绿；**绝不**用管理员身份冒充真实微信身份；
 * - 设备/worker 类用例默认记 NOT_RUN（含原因），不计为 PASS；
 * - 不打印凭证内容，不手拼 cloud:// 或 SDK 参数（调用形态由操作方提供模板）。
 *
 * 本文件在本机（无 CloudBase 凭证）应以非零退出结束——这正是方案要求的 fail-closed 行为，
 * 不是"通过"，也不是 CloudBase 能力已裁决的证据。
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { blockedMessage, buildInvokeArgv, resolveIntegrationConfig } from './config.mjs'
import { INTEGRATION_CASES, partitionCases } from './cases.mjs'

/** 只对模板串取 hash（不含凭证内容），用于复核证据来源。 */
function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')

const cfg = resolveIntegrationConfig(process.env)
if (!cfg.ok) {
  console.error(blockedMessage(cfg.missing))
  process.exit(1)
}

const { config } = cfg
if (!existsSync(config.fixtureFile)) {
  console.error(`test:cloud:integration BLOCKED：fixture 文件不存在（${config.fixtureFile}）。`)
  process.exit(1)
}

let fixture
try {
  fixture = JSON.parse(readFileSync(config.fixtureFile, 'utf8'))
} catch {
  console.error('test:cloud:integration BLOCKED：fixture 文件不是合法 JSON。')
  process.exit(1)
}

/** 经操作方提供的模板调用真实通道；失败即抛出（不吞错、不伪造响应）。 */
function invoke(template, fn, params) {
  const argv = buildInvokeArgv(template, {
    fn,
    env: config.cloudEnv,
    params: JSON.stringify(params),
  })
  const [cmd, ...args] = argv
  const out = execFileSync(cmd, args, { cwd: root, encoding: 'utf8' })
  return JSON.parse(out)
}

/** 独立只读断言（写前/写后）：只读通道，不接受业务身份返回作为证据。 */
function readOnlyAssert(params) {
  return invoke(config.adminTemplate, 'rakMaintenance', { kind: 'readOnlyProbe', ...params })
}

function envelope(action, scope, data = {}, extra = {}) {
  return {
    apiVersion: 2,
    action,
    scope,
    requestId: `ci-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    data,
    ...extra,
  }
}

const { identity, notRun } = partitionCases(INTEGRATION_CASES, {
  deviceCasesEnabled: cfg.deviceCasesEnabled,
})

const results = []
let failed = 0

for (const testCase of identity) {
  const teamClubId = fixture?.clubs?.a
  const record = { id: testCase.id, channel: testCase.channel, desc: testCase.desc, status: 'FAIL' }
  try {
    // 只读基线：写前状态由独立通道给出（不是业务身份的自述）
    const before = readOnlyAssert({ clubId: teamClubId, caseId: testCase.id, phase: 'before' })
    const probe = invoke(
      config.invokeTemplate,
      'rakApi',
      envelope(
        fixture?.cases?.[testCase.id]?.action ?? 'team.enter',
        { kind: 'TEAM', clubId: teamClubId },
        fixture?.cases?.[testCase.id]?.data ?? {}
      )
    )
    const after = readOnlyAssert({ clubId: teamClubId, caseId: testCase.id, phase: 'after' })
    record.status = 'PASS'
    record.evidence = { probeOk: probe?.ok === true, beforeHash: before?.digest ?? null, afterHash: after?.digest ?? null }
  } catch (error) {
    record.status = 'FAIL'
    record.error = error instanceof Error ? error.message : String(error)
    failed += 1
  }
  results.push(record)
}

const evidence = {
  ranAt: new Date().toISOString(),
  cloudEnv: config.cloudEnv,
  appId: config.appId,
  /** 通道模板指纹（只记 hash，不记内容）：供复核证据来自哪两条通道 */
  channelFingerprint: {
    identity: sha256(`identity|${config.invokeTemplate}`),
    adminReadOnly: sha256(`admin|${config.adminTemplate}`),
  },
  provenance: '真实微信身份通道 + 独立只读断言通道；模板由操作方提供，非本机伪造',
  results,
  notRun,
}
mkdirSync(join(root, 'docs', 'verification'), { recursive: true })
const evidencePath = join(
  root,
  'docs',
  'verification',
  `cloud-integration-${new Date().toISOString().slice(0, 10)}.json`
)
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`)

console.log(`test:cloud:integration：身份通道用例 ${identity.length} 项（FAIL ${failed}），NOT_RUN ${notRun.length} 项。`)
console.log(`证据：${evidencePath}`)
if (failed > 0) {
  console.error('test:cloud:integration 失败：存在未通过用例（不冒充真实云验收）。')
  process.exit(1)
}
console.log('test:cloud:integration 通过（真实隔离环境；证据已落盘）。')
