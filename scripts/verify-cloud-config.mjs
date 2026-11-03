#!/usr/bin/env node
/**
 * verify:cloud:config —— 校验 infra/cloudbase 配置与集合/规则/索引清单一致。
 *
 * 硬门禁：任何集合不得对客户端开放读写；存储私有；worker 拒绝客户端 invoke；
 * 索引引用的集合必须已声明。禁止 public-write 与 worker 客户端 invoke。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const infraDir = join(root, 'infra', 'cloudbase')

const problems = []

function load(file) {
  const path = join(infraDir, file)
  if (!existsSync(path)) {
    problems.push(`缺少 infra/cloudbase/${file}`)
    return null
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    problems.push(`infra/cloudbase/${file} 不是合法 JSON：${error.message}`)
    return null
  }
}

const collections = load('collections.json')
const dbRules = load('database-rules.json')
const storageRules = load('storage-rules.json')
const fnRules = load('function-rules.json')
const indexes = load('indexes.json')

if (dbRules) {
  if (dbRules.clientAccess?.read !== false || dbRules.clientAccess?.write !== false) {
    problems.push('database-rules.clientAccess 必须 read/write=false')
  }
  for (const [name, rule] of Object.entries(dbRules.collections ?? {})) {
    if (rule.read !== false || rule.write !== false) {
      problems.push(`集合规则 ${name} 未同时拒绝客户端 read/write`)
    }
  }
  if (collections) {
    const declared = new Set(collections.collections.map((c) => c.name))
    for (const name of declared) {
      if (!dbRules.collections?.[name]) problems.push(`database-rules 缺少集合 ${name}`)
    }
    for (const name of Object.keys(dbRules.collections ?? {})) {
      if (!declared.has(name)) problems.push(`database-rules 含未声明的集合 ${name}`)
    }
  }
}

if (storageRules) {
  if (storageRules.clientAccess?.read !== false || storageRules.clientAccess?.write !== false) {
    problems.push('storage-rules.clientAccess 必须 read/write=false（私有，禁止客户端直访）')
  }
}

if (fnRules) {
  const fns = fnRules.functions ?? {}
  if (fns.rakMaintenance?.clientInvoke !== false) {
    problems.push('function-rules: rakMaintenance 必须拒绝客户端 invoke')
  }
  for (const name of ['rakApi', 'rakFiles']) {
    if (fns[name]?.anonymous !== false) problems.push(`function-rules: ${name} 必须拒绝匿名调用`)
    if (fns[name]?.clientInvoke !== true) problems.push(`function-rules: ${name} 应允许客户端调用（函数内仍鉴权）`)
  }
}

if (indexes && collections) {
  const declared = new Set(collections.collections.map((c) => c.name))
  for (const ix of indexes.indexes) {
    if (!declared.has(ix.collection)) problems.push(`索引 ${ix.name} 引用了未声明集合 ${ix.collection}`)
  }
}

if (problems.length) {
  console.error('verify:cloud:config 失败：')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log('verify:cloud:config 通过：集合/规则/索引清单一致，无客户端公开读写与 worker 客户端 invoke。')
