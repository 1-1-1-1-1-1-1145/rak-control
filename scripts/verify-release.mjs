#!/usr/bin/env node
/**
 * verify:release —— 组合静态/发布包门禁（不代替真实云/真机验收）。
 *
 * 依次运行：verify-cloud-config、verify-no-client-db、verify-cloud-artifacts、verify-routes、
 * verify-client-cloud（cloud 客户端产物；最慢，置末尾）。
 * 任一失败即非零退出。真实云测试与真机验收在 M8/M9，由 test:cloud:integration 覆盖。
 */
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const checks = [
  'scripts/verify-cloud-config.mjs',
  'scripts/verify-no-client-db.mjs',
  'scripts/verify-cloud-artifacts.mjs',
  'scripts/verify-routes.mjs',
  'scripts/verify-client-cloud.mjs',
]

let failed = false
for (const check of checks) {
  try {
    execFileSync(process.execPath, [join(root, check)], { stdio: 'inherit', cwd: root })
  } catch {
    failed = true
  }
}

if (failed) {
  console.error('verify:release 失败：以上存在未通过的门禁。')
  process.exit(1)
}
console.log('verify:release 通过（静态与发布包层；不代替真实云/真机验收）。')
