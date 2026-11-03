#!/usr/bin/env node
/**
 * verify:client:cloud —— cloud 客户端产物门禁（PLAN §M7 出口）。
 *
 * 受控子进程注入 TARO_APP_BACKEND=cloud + 已核实 TARO_APP_CLOUD_ENV，执行 prod weapp 构建，
 * 再扫描 dist/ 全部文本产物：
 *  - 禁止演示人物/角色数据（演示种子：陈老师 / demo-super / 演示成员）；
 *  - 禁止测试注入串；
 *  - 禁止服务端与管理员 SDK 泄漏；
 *  - 必须能证明"cloud 环境已内联"（产物含已核实的云环境 ID）。
 *
 * 环境变量通过显式 env 传给子进程，**不修改 process.env**（无需还原）。
 * 缺少依赖/注入失败一律非零退出，不 skip 成 PASS。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = join(root, 'dist')
const TARO_BIN = join(root, 'node_modules', '@tarojs', 'cli', 'bin', 'taro')
/** 已知配置：AppID 与环境 ID（不是远端验证结果，仅用于构建期注入与产物断言） */
const APP_ID = 'wxa8bf102dcfdcec4c'
const CLOUD_ENV = 'cloud1-d4g36r8z6a8908540'

const FORBIDDEN = [
  // 演示人物/角色数据（src/demo/adapter.ts 种子）
  '陈老师',
  'demo-super',
  '演示成员',
  // 测试注入
  '__RAK_TEST__',
  'RAK_TEST_INJECTION',
  'test-only',
  // 服务端 / 管理员 SDK 泄漏
  // 注：`rakFiles` 是客户端受控分片上传的公开函数（DESIGN §11），不作为服务端泄漏禁止；
  // 仍禁止 `rakMaintenance`（仅受控 worker）与服务端模块/SDK 字面量。
  '@cloudbase/node-sdk',
  'server/modules/',
  'rakMaintenance',
]

const problems = []

if (!existsSync(TARO_BIN)) {
  console.error('verify:client:cloud 失败：未找到 @tarojs/cli（请先安装依赖）。')
  process.exit(1)
}

try {
  execFileSync(process.execPath, [TARO_BIN, 'build', '--type', 'weapp', '--mode', 'production'], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      TARO_MODE: 'production',
      TARO_APP_BACKEND: 'cloud',
      TARO_APP_CLOUD_ENV: CLOUD_ENV,
      TARO_APP_ID: APP_ID,
    },
  })
} catch {
  console.error('verify:client:cloud 失败：cloud 生产构建未成功（见上方构建输出）。')
  process.exit(1)
}

function walk(dir, base = dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full, base))
    else out.push(relative(base, full).split('\\').join('/'))
  }
  return out
}

if (!existsSync(distDir)) {
  console.error('verify:client:cloud 失败：未找到 dist/ 产物。')
  process.exit(1)
}

const files = walk(distDir)
if (files.length === 0) problems.push('dist/ 为空')

let envInlined = false
for (const rel of files) {
  let text
  try {
    text = readFileSync(join(distDir, rel), 'utf8')
  } catch {
    continue // 二进制资源跳过
  }
  if (text.includes(CLOUD_ENV)) envInlined = true
  for (const bad of FORBIDDEN) {
    if (text.includes(bad)) problems.push(`dist/${rel} 含禁用串 ${bad}`)
  }
}

if (!envInlined) {
  problems.push(`产物内未出现已核实的云环境 ID ${CLOUD_ENV}（TARO_APP_CLOUD_ENV 未内联）`)
}

if (problems.length) {
  console.error('verify:client:cloud 失败：')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log(
  `verify:client:cloud 通过：cloud prod 产物无演示数据/测试注入/服务端 SDK，且已内联云环境 ${CLOUD_ENV}。`
)
