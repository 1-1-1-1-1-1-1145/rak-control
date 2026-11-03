#!/usr/bin/env node
/**
 * verify:routes —— 从 src/app.config.ts 生成路由/角色/作用域/生命周期矩阵，
 * 并检测：新增页缺少 .tsx / .config.ts、业务页缺少路由守卫（PageShell）。
 *
 * 说明（PLAN M7）：矩阵是"配置即事实"的派生结果，不是手写清单；
 * 守卫豁免仅限账户页（登录/入会/入队结果）——它们自行处理未识别态，
 * 否则新加入页会被旧 login 的 AUTHED 重定向拦住。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const configPath = join(root, 'src', 'app.config.ts')
const config = readFileSync(configPath, 'utf8')

/** 账户页：允许不使用 PageShell（自行处理未识别态与"已在别的队"）。 */
const GUARD_EXEMPT = new Set(['pages/auth/login', 'pages/auth/join-status'])

/** 不需要本队业务数据的页面（可获得 GLOBAL/账户作用域）。 */
const ACCOUNT_SCOPE = new Set(['pages/auth/login', 'pages/auth/join-status'])

function extractArray(source, startIndex) {
  const open = source.indexOf('[', startIndex)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '[') depth += 1
    else if (ch === ']') {
      depth -= 1
      if (depth === 0) return source.slice(open + 1, i)
    }
  }
  return null
}

function stringLiterals(source) {
  const out = []
  for (const match of source.matchAll(/'([^']*)'/g)) out.push(match[1])
  return out
}

const mainPages = stringLiterals(extractArray(config, config.indexOf('pages:') + 1) ?? '')

const subRoots = []
const subPackageBlock = extractArray(config, config.indexOf('subPackages:')) ?? ''
for (const chunk of subPackageBlock.split('{').slice(1)) {
  const rootMatch = chunk.match(/root:\s*'([^']*)'/)
  const pagesChunk = extractArray(chunk, chunk.indexOf('pages:'))
  if (!rootMatch || pagesChunk === null) continue
  const prefix = rootMatch[1].replace(/\/$/, '')
  for (const page of stringLiterals(pagesChunk)) subRoots.push({ route: `${prefix}/${page}`, prefixed: true })
}

const routes = [
  ...mainPages.map((route) => ({ route, prefixed: false })),
  ...subRoots,
]

const rows = []
const problems = []

for (const { route } of routes) {
  const tsx = join(root, 'src', `${route}.tsx`)
  const cfg = join(root, 'src', `${route}.config.ts`)
  if (!existsSync(tsx)) problems.push(`缺页面文件：src/${route}.tsx`)
  if (!existsSync(cfg)) problems.push(`缺页面配置：src/${route}.config.ts`)

  const source = existsSync(tsx) ? readFileSync(tsx, 'utf8') : ''
  const usesShell = source.includes('@/components/page-shell')
  const exempt = GUARD_EXEMPT.has(route)
  if (!exempt && !usesShell) {
    problems.push(`业务页缺少路由守卫（未使用 PageShell）：src/${route}.tsx`)
  }

  const roleMatch = source.match(/requireRole=\{?'?(manage|super)'?'?\}/)
  const lifecycle = []
  if (source.includes('useDidShow')) lifecycle.push('useDidShow')
  if (source.includes('useEffect')) lifecycle.push('useEffect')
  if (source.includes('usePullDownRefresh')) lifecycle.push('usePullDownRefresh')

  rows.push({
    route,
    scope: ACCOUNT_SCOPE.has(route) ? 'GLOBAL/账户' : 'TEAM.clubId',
    guard: exempt ? '守卫豁免（账户页）' : usesShell ? 'PageShell' : '缺失',
    role: roleMatch ? roleMatch[1] : '—',
    lifecycle: lifecycle.length > 0 ? lifecycle.join(' + ') : '—',
  })
}

const outDir = join(root, 'docs', 'verification')
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
const outPath = join(outDir, `route-guard-matrix-${today}.md`)

const lines = [
  `# 路由守卫矩阵（${today}）`,
  '',
  '由 `pnpm verify:routes` 从 `src/app.config.ts` **自动生成**；不要手工编辑。',
  '作用域：业务页 = TEAM.clubId（需 activeTeam）；账户页 = GLOBAL/账户级。',
  '守卫：PageShell 负责"先 bootstrap/enter 再 load"与角色校验；账户页豁免以便处理未识别态。',
  '',
  '| 路由 | 作用域 | 守卫 | requireRole | 生命周期钩子 |',
  '|---|---|---|---|---|',
  ...rows.map(
    (row) => `| \`${row.route}\` | ${row.scope} | ${row.guard} | ${row.role} | ${row.lifecycle} |`
  ),
  '',
  `合计 ${rows.length} 个路由；业务页 ${rows.filter((r) => r.scope.startsWith('TEAM')).length} 个，账户页 ${rows.filter((r) => r.scope.startsWith('GLOBAL')).length} 个。`,
  '',
]
writeFileSync(outPath, lines.join('\n'), 'utf8')

if (problems.length > 0) {
  console.error('verify:routes 失败：')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log(`verify:routes 通过：${rows.length} 个路由均有页面/配置与守卫；矩阵写入 docs/verification/route-guard-matrix-${today}.md`)
