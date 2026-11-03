#!/usr/bin/env node
/**
 * build:cloud —— 编译 server/（TS）并组装三个自包含云函数部署目录。
 *
 * 设计约束（多团队 DESIGN §4.2、§12；BASE-DESIGN §4.2）：
 * - server/ 是源码；cloudfunctions/ 是生成产物，可独立上传、不得 require 目录外源码。
 * - 生产打包共享模块（整体复制编译产物），显式 external 云 SDK；锁定并记录版本。
 * - 不写秘密、不写入 example.invalid、不注入测试专用入口。
 *
 * 云 SDK 已按 M0 实测结论锁版（H-7，`wx-server-sdk@4.0.2`）并写入各产物依赖；
 * 运行时（DB/存储绑定 + 可信身份）在 M8 由 server/entrypoints/runtime.ts 装配，
 * 配置缺失/SDK 不可用时入口仍 fail-closed（not_implemented）。
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const serverDir = join(root, 'server')
const buildDir = join(serverDir, 'build')
const outDir = join(root, 'cloudfunctions')

const FUNCTIONS = [
  { name: 'rakApi', entry: 'entrypoints/rak-api.js' },
  { name: 'rakFiles', entry: 'entrypoints/rak-files.js' },
  { name: 'rakMaintenance', entry: 'entrypoints/rak-maintenance.js' },
]

// 云 SDK 已锁版（M0 实测结论，H-7）：wx-server-sdk@4.0.2（内置 @cloudbase/node-sdk 3.17.2）。
// 精确版本写入每个产物 package.json 的 dependencies；云端以「安装依赖」方式部署。
const SDK_LOCK = { name: 'wx-server-sdk', version: '4.0.2', locked: true }

function runTsc() {
  const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
  if (!existsSync(tsc)) throw new Error(`未找到 TypeScript 编译器：${tsc}`)
  execFileSync(process.execPath, [tsc, '-p', join(serverDir, 'tsconfig.build.json')], {
    stdio: 'inherit',
    cwd: root,
  })
}

function walkFiles(dir, base = dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walkFiles(full, base))
    else out.push(relative(base, full).split('\\').join('/'))
  }
  return out
}

function hashDir(dir) {
  const files = {}
  let combined = createHash('sha256')
  for (const rel of walkFiles(dir).sort()) {
    const buf = readFileSync(join(dir, rel))
    const hash = createHash('sha256').update(buf).digest('hex')
    files[rel] = hash
    combined.update(`${rel}\u0000${hash}\n`)
  }
  return { files, digest: combined.digest('hex') }
}

function main() {
  rmSync(buildDir, { recursive: true, force: true })
  rmSync(outDir, { recursive: true, force: true })
  runTsc()
  if (!existsSync(buildDir) || !existsSync(join(buildDir, 'entrypoints'))) {
    throw new Error('tsc 未产出 server/build/entrypoints，无法组装部署包')
  }

  mkdirSync(outDir, { recursive: true })
  const manifest = { schemaVersion: 1, sdkCandidate: SDK_LOCK, functions: {} }

  for (const fn of FUNCTIONS) {
    const dir = join(outDir, fn.name)
    cpSync(buildDir, dir, { recursive: true })
    const indexJs =
      "'use strict'\n" +
      '// 生成产物，请勿手改；由 scripts/build-cloud.mjs 生成。\n' +
      `const { main } = require('./${fn.entry}')\n` +
      'exports.main = main\n'
    writeFileSync(join(dir, 'index.js'), indexJs)

    const pkg = {
      name: `rak-${fn.name.toLowerCase()}`,
      version: '0.1.0',
      private: true,
      main: 'index.js',
      // 锁定云 SDK 精确版本（H-7）；云端「安装依赖」按此版本安装。
      dependencies: { [SDK_LOCK.name]: SDK_LOCK.version },
    }
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)
    manifest.functions[fn.name] = hashDir(dir)
  }

  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`build:cloud 完成 —— 生成 ${FUNCTIONS.length} 个自包含函数目录到 cloudfunctions/`)
  for (const fn of FUNCTIONS) {
    console.log(`  cloudfunctions/${fn.name}  digest=${manifest.functions[fn.name].digest.slice(0, 16)}…`)
  }
}

main()
