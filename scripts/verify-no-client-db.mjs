#!/usr/bin/env node
/**
 * verify:no-client-db —— 扫描前端 src/，拒绝客户端 DB 调用与服务端 SDK 泄漏。
 *
 * 覆盖：wx.cloud.database、.collection()、.aggregate()、.watch()、wx-server-sdk、
 * @cloudbase/node-sdk、@cloudbase/js-sdk。先剥离注释避免文档/字符串误报。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, 'src')

const PATTERNS = [
  { re: /wx\.cloud\.database\b/, msg: 'wx.cloud.database 客户端直连数据库' },
  { re: /\.collection\s*\(/, msg: '.collection() 集合操作' },
  { re: /\.aggregate\s*\(/, msg: '.aggregate() 聚合' },
  { re: /\.watch\s*\(/, msg: '.watch() 实时监听' },
  { re: /\bwx-server-sdk\b/, msg: 'wx-server-sdk 服务端 SDK 出现在前端' },
  { re: /@cloudbase\/node-sdk/, msg: '@cloudbase/node-sdk 服务端 SDK 出现在前端' },
  { re: /@cloudbase\/js-sdk/, msg: '@cloudbase/js-sdk 直连数据库' },
]

const problems = []

/** 剥离块注释与行注释（避免 https:// 误判：// 前是冒号则保留）。 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
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

if (!existsSync(srcDir)) {
  console.error('verify:no-client-db 失败：未找到 src/ 目录')
  process.exit(1)
}

for (const rel of walk(srcDir)) {
  if (!/\.(ts|tsx|js|mjs|jsx)$/.test(rel)) continue
  const text = stripComments(readFileSync(join(srcDir, rel), 'utf8'))
  const lines = text.split('\n')
  lines.forEach((line, index) => {
    for (const { re, msg } of PATTERNS) {
      if (re.test(line)) problems.push(`src/${rel}:${index + 1} ${msg}`)
    }
  })
}

if (problems.length) {
  console.error('verify:no-client-db 失败：前端出现禁止的数据库/SDK 调用')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log('verify:no-client-db 通过：src/ 无客户端 DB 调用与服务端 SDK 泄漏。')
