#!/usr/bin/env node
/**
 * bootstrap-cloud-platform —— 平台受控初始化（PLAN §3.2 运维脚本；DESIGN §5.3、§M3）。
 *
 * 责任：仅做**一次**平台初始化（写 system_config/main），不重置已初始化平台、不建任何队。
 * 调用形态：经 `rakMaintenance`（平台受控后台来源），**不进入公共 action 注册表**，
 * 客户端也不得 invoke（见 infra function-rules）。
 *
 * fail-closed：缺云环境/AppID/平台调用通道即非零退出并说明缺失项；不伪造初始化结果。
 * 本机（无 CloudBase 凭证）应以非零退出结束——这是方案要求的失败闭合行为，不是"通过"。
 */
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildInvokeArgv } from './cloud-integration/config.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REQUIRED = ['RAK_CLOUD_ENV', 'RAK_APP_ID', 'RAK_PLATFORM_INVOKE_TEMPLATE']

const missing = REQUIRED.filter((key) => String(process.env[key] ?? '').trim().length === 0)
if (missing.length > 0) {
  console.error('bootstrap-cloud-platform BLOCKED：缺少受控平台初始化所需配置（不伪造结果）：')
  for (const key of missing) console.error(`  - ${key}`)
  console.error('解锁条件（人工）：见 docs/MANUAL-OPERATIONS.md H-1。')
  process.exit(1)
}

const cloudEnv = String(process.env.RAK_CLOUD_ENV).trim()
const appId = String(process.env.RAK_APP_ID).trim()
const params = { kind: 'platformInitialize', appId }
const argv = buildInvokeArgv(String(process.env.RAK_PLATFORM_INVOKE_TEMPLATE).trim(), {
  fn: 'rakMaintenance',
  env: cloudEnv,
  params: JSON.stringify(params),
})

try {
  const [cmd, ...args] = argv
  const out = execFileSync(cmd, args, { cwd: root, encoding: 'utf8' })
  const parsed = JSON.parse(out)
  // 已核实的通道形态：`tcb fn invoke ... --json` 的 stdout 是外壳
  // `{ data: { RetMsg: "<函数返回值的 JSON 字符串>" } }`，函数原始返回值在 `data.RetMsg`；
  // 也兼容"模板直接输出函数返回值"的形态。任一形态未确认 `initialized` 即失败（fail-closed）。
  const result = typeof parsed?.data?.RetMsg === 'string' ? JSON.parse(parsed.data.RetMsg) : parsed
  if (result?.initialized !== true) {
    console.error('bootstrap-cloud-platform 失败：函数未确认初始化（不视作成功）。')
    process.exit(1)
  }
  console.log(`bootstrap-cloud-platform：平台已初始化（already=${result.alreadyInitialized === true}）。`)
} catch (error) {
  console.error(`bootstrap-cloud-platform 失败：${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
