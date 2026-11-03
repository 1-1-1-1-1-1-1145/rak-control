const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const ts = require('typescript')
const root = fs.realpathSync(process.cwd())
const planDir = '.planning/2026-10-16-dead-code-audit'
if (path.basename(root) !== 'rak-control') throw new Error('Unexpected project root')
const validation = fs.readFileSync(path.join(planDir, 'validate-candidates.cjs'), 'utf8')
const { patches, changes } = new Function('require', validation.slice(0, validation.indexOf('const config=')) + '\nreturn {patches,changes};')(require)
function read(file) { return patches.get(path.resolve(file).toLowerCase()) ?? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') }
function set(file, content) { patches.set(path.resolve(file).toLowerCase(), content) }
function replace(file, from, to) {
  const content = read(file)
  if (content.split(from).length !== 2) throw new Error('Expected unique anchor: ' + file + ' ' + from)
  set(file, content.replace(from, to))
}
replace('src/components/page-shell.tsx', '  bare?: boolean\n', '')
replace('src/components/page-shell.tsx', '  bare = false,\n', '')
replace('src/components/page-shell.tsx', "className={bare ? 'page page--flush' : 'page'}", "className='page'")
replace('src/store/index.ts', 'export function fail(', 'function fail(')
replace('src/services/task.ts', '  updateTask,\n', '')
replace('src/pages/index/index.tsx', '          {/* 借用 store 引用保证 observer 依赖刷新 */}\n          \n', '')
replace('src/pages/me/profile.tsx', '// 让 observer 追踪任务数（taskStore 引用防止 tree-shake 误删依赖）\n\n', '')
replace('src/app.scss', '@import "./styles/tokens.scss";\n', '')
const selectors = {
  'src/styles/helpers.scss': ['page--flush', 'surface-muted', 'btn-primary--pressed', 'metric-card__value--sm', 'mt-8', 'home-badge-dot'],
  'src/styles/form.scss': ['form__input', 'profile__avatar', 'profile__avatar-text'],
  'src/pages/club/club.scss': ['team-row--me', 'club-stats', 'club-stats__item', 'club-stats__num'],
  'src/pages/me/me.scss': ['me-counts', 'me-counts__item'],
}
for (const [file, names] of Object.entries(selectors)) {
  let content = read(file)
  for (const name of names) {
    const pattern = new RegExp('^\\.' + name + ' \\{[^{}]*\\}\\n?', 'gm')
    const matches = [...content.matchAll(pattern)]
    if (matches.length !== 1) throw new Error('Expected one flat rule: ' + file + ' .' + name)
    content = content.replace(pattern, '')
  }
  set(file, content.replace(/\n{3,}/g, '\n\n'))
}
function removeConfigProperties(file, names) {
  const content = read(file)
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true)
  const removals = []
  const found = []
  function visit(node) {
    if (ts.isPropertyAssignment(node) && names.includes(node.name.getText(source))) {
      found.push(node.name.getText(source))
      removals.push([node.getFullStart(), node.end + (content[node.end] === ',' ? 1 : 0)])
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (found.length !== names.length || names.some(name => !found.includes(name))) throw new Error('Unexpected config structure: ' + file)
  let updated = content
  for (const [start, end] of removals.sort((a, b) => b[0] - a[0])) updated = updated.slice(0, start) + updated.slice(end)
  set(file, updated)
}
removeConfigProperties('config/index.ts', ['h5', 'rn'])
removeConfigProperties('config/dev.ts', ['h5'])
removeConfigProperties('config/prod.ts', ['h5'])
const pkg = JSON.parse(read('package.json'))
const platforms = ['swan', 'alipay', 'tt', 'h5', 'rn', 'qq', 'jd', 'harmony-hybrid']
for (const platform of platforms) for (const kind of ['build', 'dev']) {
  if (!pkg.scripts[kind + ':' + platform]) throw new Error('Missing platform script')
  delete pkg.scripts[kind + ':' + platform]
}
for (const platform of platforms.filter(p => p !== 'rn')) {
  if (!pkg.dependencies['@tarojs/plugin-platform-' + platform]) throw new Error('Missing platform dependency')
  delete pkg.dependencies['@tarojs/plugin-platform-' + platform]
}
if (!pkg.devDependencies['lint-staged']) throw new Error('Missing lint-staged')
delete pkg.devDependencies['lint-staged']
if (pkg.dependencies['@tarojs/plugin-platform-weapp'] !== '4.2.1') throw new Error('WeChat plugin must remain')
set('package.json', JSON.stringify(pkg, null, 2) + '\n')
replace('docs/CONSTRUCTION.md', '│   │       ├── light.scss\n│   │       ├── dark.scss\n│   │       └── taroify-overrides.scss', '│   │       └── taroify-overrides.scss')
const deletes = ['src/styles/theme/light.scss', 'src/styles/theme/dark.scss', 'src/index.html', 'scripts/setup-github-team-repo.js', 'scripts/setup-github-team-repo.ps1']
for (const file of deletes) if (!fs.statSync(file).isFile()) throw new Error('Missing deletion target: ' + file)
const parsed = ts.parseJsonConfigFileContent(ts.readConfigFile('tsconfig.json', ts.sys.readFile).config, ts.sys, root)
const options = { ...parsed.options, noEmit: true, skipLibCheck: true }
const host = ts.createCompilerHost(options)
const originalRead = host.readFile.bind(host)
host.readFile = file => patches.get(path.resolve(file).toLowerCase()) ?? originalRead(file)
const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram(parsed.fileNames, options, host))
if (diagnostics.length) throw new Error(ts.formatDiagnostics(diagnostics, {getCanonicalFileName: f => f, getCurrentDirectory: () => root, getNewLine: () => '\n'}))
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backupRoot = path.join(path.dirname(root), 'rak-control-cleanup-backup-' + stamp)
fs.mkdirSync(backupRoot)
const targets = [...new Set([...patches.keys()].map(file => path.relative(root, file)).concat(deletes, ['pnpm-lock.yaml', 'docs/DEAD-CODE-AUDIT.md', planDir + '/task_plan.md', planDir + '/progress.md']))]
const manifest = []
for (const file of targets) {
  const full = path.resolve(root, file)
  if (!full.toLowerCase().startsWith(root.toLowerCase() + path.sep)) throw new Error('Target outside root')
  const bytes = fs.readFileSync(full)
  const dest = path.join(backupRoot, file)
  fs.mkdirSync(path.dirname(dest), {recursive: true})
  fs.writeFileSync(dest, bytes)
  if (!bytes.equals(fs.readFileSync(dest))) throw new Error('Backup verification failed')
  manifest.push({ file, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') })
}
fs.writeFileSync(path.join(backupRoot, 'manifest.json'), JSON.stringify({root, createdAt: new Date().toISOString(), files: manifest}, null, 2))
const plan = path.join(planDir, 'task_plan.md')
fs.appendFileSync(plan, '\n## Phase 5: 执行已确认清理\nStatus: in_progress\n用户已授权清理；备份后删除确认无用符号、样式、一次性工具、lint-staged，按仅 weapp 约定裁掉多端脚手架。保留 Taroify、云函数、demo、图标生成工具及有效样式。\n\n## Phase 6: 验证和交付\nStatus: pending\n同步依赖锁文件；单测、类型检查、开发和生产模式构建；核对页面资源，更新清理记录。\n')
const written = []
for (const [file, content] of patches) {
  const before = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  if (before === content) continue
  fs.writeFileSync(file, content)
  if (fs.readFileSync(file, 'utf8') !== content) throw new Error('Write verification failed')
  written.push({file: path.relative(root, file), linesBefore: before.split('\n').length, linesAfter: content.split('\n').length})
}
for (const file of deletes) fs.unlinkSync(file)
const result = {backupRoot, backupFiles: targets.length, preWriteTypeDiagnostics: 0, written, deleted: deletes, declarationChanges: changes, removedSelectors: Object.values(selectors).flat().length, removedPlatformScripts: 16, removedDependencies: 8}
fs.writeFileSync(path.join(planDir, 'cleanup-result.json'), JSON.stringify(result, null, 2))
fs.appendFileSync(path.join(planDir, 'progress.md'), '\n2026-10-16：用户授权执行清理。备份目录：' + backupRoot + '；完成 ' + written.length + ' 个文件编辑、5 个文件删除，删除 15 个选择器（含 page--flush）、16 个多端脚本、7 个非微信平台依赖及 lint-staged。写前组合类型检查诊断 0。依赖同步与构建待验证。\n')
console.log(JSON.stringify(result, null, 2))
