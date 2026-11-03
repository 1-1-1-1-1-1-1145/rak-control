#!/usr/bin/env node
/**
 * provision-cloud-team —— 每队受控开通（PLAN §3.2 运维脚本；DESIGN §5.3、§M3）。
 *
 * 责任：受控创建**一个**团队（club/member/唯一 owner/审计/消费参考号/操作记录同事务）。
 * - 幂等：op 键 = hash(appId, env, provisioningKey)；重复执行不建第二个队。
 * - 普通用户不可调用；不进入公共 action 注册表；经 `rakMaintenance` 平台来源执行。
 *
 * 用法：
 *   RAK_CLOUD_ENV=... RAK_APP_ID=... RAK_PLATFORM_INVOKE_TEMPLATE='...' \
 *     node scripts/provision-cloud-team.mjs --key <provisioningKey> --club-name <名> \
 *       --slug <slug> --display-code <码> --owner-reference <参考号> [--owner-name <展示名>]
 *
 * fail-closed：缺配置/缺参数即非零退出（列出缺失项），不伪造开通结果。
 * 本机（无 CloudBase 凭证）应以非零退出结束——失败闭合行为，不是"通过"。
 */
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildInvokeArgv } from './cloud-integration/config.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REQUIRED = ['RAK_CLOUD_ENV', 'RAK_APP_ID', 'RAK_PLATFORM_INVOKE_TEMPLATE']

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const part = argv[i]
    if (!part.startsWith('--')) continue
    const key = part.slice(2)
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) continue
    out[key] = value
    i += 1
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const missingEnv = REQUIRED.filter((key) => String(process.env[key] ?? '').trim().length === 0)
const missingArgs = ['key', 'club-name', 'slug', 'display-code', 'owner-reference'].filter(
  (key) => String(args[key] ?? '').trim().length === 0
)

if (missingEnv.length > 0 || missingArgs.length > 0) {
  console.error('provision-cloud-team BLOCKED：缺少受控开通所需配置/参数（不伪造结果）：')
  for (const key of missingEnv) console.error(`  - 环境变量 ${key}`)
  for (const key of missingArgs) console.error(`  - 参数 --${key}`)
  console.error(
    '用法：node scripts/provision-cloud-team.mjs --key <provisioningKey> --club-name <名> --slug <slug> --display-code <码> --owner-reference <参考号> [--owner-name <展示名>]'
  )
  console.error('解锁条件（人工）：见 docs/MANUAL-OPERATIONS.md H-1。')
  process.exit(1)
}

const params = {
  kind: 'provisionTeam',
  provisioningKey: args.key,
  appId: String(process.env.RAK_APP_ID).trim(),
  env: String(process.env.RAK_CLOUD_ENV).trim(),
  clubName: args['club-name'],
  slug: args.slug,
  displayCode: args['display-code'],
  ownerReferenceCode: args['owner-reference'],
  ownerDisplayName: args['owner-name'] ?? '',
}
const argv = buildInvokeArgv(String(process.env.RAK_PLATFORM_INVOKE_TEMPLATE).trim(), {
  fn: 'rakMaintenance',
  env: params.env,
  params: JSON.stringify(params),
})

try {
  const [cmd, ...rest] = argv
  const out = execFileSync(cmd, rest, { cwd: root, encoding: 'utf8' })
  const parsed = JSON.parse(out)
  // 已核实的通道形态：`tcb fn invoke ... --json` 的 stdout 是外壳
  // `{ data: { RetMsg: "<函数返回值的 JSON 字符串>" } }`；函数原始返回值在 `data.RetMsg`。
  const result = typeof parsed?.data?.RetMsg === 'string' ? JSON.parse(parsed.data.RetMsg) : parsed
  if (typeof result?.clubId !== 'string' || result.clubId.length === 0) {
    console.error(
      `provision-cloud-team 失败：函数未返回 clubId（不视作成功）。` +
        ` reason=${result?.reason ?? '-'} code=${result?.errorCode ?? '-'}`
    )
    process.exit(1)
  }
  console.log(`provision-cloud-team：已开通 clubId=${result.clubId}（replayed=${result.replayed === true}）。`)
  if (String(process.env.RAK_PRINT_SECRETS ?? '') !== '1') {
    console.log('（其余结果字段按最小披露原则不回显；如需排查请用独立只读断言。）')
  }
} catch (error) {
  console.error(`provision-cloud-team 失败：${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
