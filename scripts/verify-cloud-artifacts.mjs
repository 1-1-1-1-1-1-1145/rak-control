#!/usr/bin/env node
/**
 * verify:cloud:artifacts —— 校验 cloudfunctions/ 自包含产物。
 *
 * 检查：每目录 index.js/package.json（main=index.js）/entrypoints、无 .ts 源文件、
 * 无 node_modules、无禁用串（example.invalid/测试注入/秘密标记）、manifest 哈希一致。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'cloudfunctions')
const FUNCTIONS = ['rakApi', 'rakFiles', 'rakMaintenance']
const FORBIDDEN = ['example.invalid', 'TEST_ONLY', '__INJECT__', 'RAK_TEST_', 'SECRET_KEY', 'SECRETID']

const problems = []

function walk(dir, base = dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full, base))
    else out.push(relative(base, full).split('\\').join('/'))
  }
  return out
}

if (!existsSync(outDir) || !existsSync(join(outDir, 'manifest.json'))) {
  console.error('verify:cloud:artifacts 失败：未找到 cloudfunctions/ 产物。请先运行 pnpm build:cloud。')
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'))

for (const name of FUNCTIONS) {
  const dir = join(outDir, name)
  if (!existsSync(dir)) {
    problems.push(`缺少函数目录 cloudfunctions/${name}`)
    continue
  }
  if (!existsSync(join(dir, 'index.js'))) problems.push(`${name}: 缺少 index.js`)
  if (!existsSync(join(dir, 'entrypoints'))) problems.push(`${name}: 缺少 entrypoints/`)

  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) problems.push(`${name}: 缺少 package.json`)
  else {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    if (pkg.main !== 'index.js') problems.push(`${name}: package.json main 必须为 index.js`)
  }

  for (const rel of walk(dir)) {
    if (rel.endsWith('.ts')) problems.push(`${name}: 产物含 TS 源文件 ${rel}`)
    if (rel.includes('node_modules')) problems.push(`${name}: 产物含 node_modules ${rel}`)
    const text = readFileSync(join(dir, rel), 'utf8')
    for (const bad of FORBIDDEN) {
      if (text.includes(bad)) problems.push(`${name}: ${rel} 含禁用串 ${bad}`)
    }
  }

  const rec = manifest.functions?.[name]
  if (!rec) {
    problems.push(`${name}: manifest 缺少该函数记录`)
    continue
  }
  const combined = createHash('sha256')
  let hashesOk = true
  for (const rel of Object.keys(rec.files).sort()) {
    const full = join(dir, rel)
    if (!existsSync(full)) {
      problems.push(`${name}: manifest 记录的文件缺失 ${rel}`)
      hashesOk = false
      continue
    }
    const hash = createHash('sha256').update(readFileSync(full)).digest('hex')
    if (hash !== rec.files[rel]) {
      problems.push(`${name}: 文件哈希与 manifest 不一致 ${rel}`)
      hashesOk = false
    }
    combined.update(`${rel}\u0000${hash}\n`)
  }
  if (hashesOk && combined.digest('hex') !== rec.digest) {
    problems.push(`${name}: 目录摘要与 manifest 不一致`)
  }
}

if (problems.length) {
  console.error('verify:cloud:artifacts 失败：')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log('verify:cloud:artifacts 通过：3 个自包含函数目录结构/哈希/无禁用串。')
