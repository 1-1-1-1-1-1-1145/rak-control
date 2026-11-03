const fs = require('fs')
const path = require('path')
const assert = require('assert/strict')
const crypto = require('crypto')
const ts = require('typescript')
const sass = require('sass')
const postcss = require('postcss')
const planDir = '.planning/2026-10-16-dead-code-audit'
const cleanup = JSON.parse(fs.readFileSync(planDir + '/cleanup-result.json', 'utf8'))
const read = file => fs.readFileSync(file, 'utf8')
const failures = []
const checks = []
function check(name, fn) {
  try { fn(); checks.push(name) } catch (e) { failures.push({name, error: e.message}) }
}
check('5 target files removed', () => { for (const file of cleanup.deleted) assert(!fs.existsSync(file), file) })
check('unused symbols and bare prop removed', () => {
  const symbols = {
    'src/components/ui.tsx': ['SectionTitle', 'EmptyState', 'MetricCard'],
    'src/utils/format.ts': ['formatMoney'],
    'src/utils/toast.ts': ['toastError'],
    'src/utils/permission.ts': ['useAuthGuard'],
    'src/services/club.ts': ['storageKeys'],
    'src/types/domain.ts': ['QUALITY_SCORE'],
    'src/demo/adapter.ts': ['resetDemoState'],
    'src/components/page-shell.tsx': ['bare'],
    'src/pages/index/index.tsx': ['taskStore'],
    'src/pages/me/profile.tsx': ['taskStore'],
  }
  for (const [file, names] of Object.entries(symbols)) {
    const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true)
    const identifiers = new Set()
    function visit(node) { if (ts.isIdentifier(node)) identifiers.add(node.text); ts.forEachChild(node, visit) }
    visit(source)
    for (const name of names) assert(!identifiers.has(name), file + ':' + name)
  }
})
check('only targeted Store and DemoAdapter members removed', () => {
  const specs = {
    'src/store/index.ts': {TaskStore: ['openTasks', 'pendingReview', 'myTasks', 'myActive', 'resetFilters', 'fetchOne'], TeamStore: ['loading']},
    'src/demo/adapter.ts': {DemoAdapter: ['isLoggedIn']},
  }
  for (const [file, classes] of Object.entries(specs)) {
    const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true)
    for (const [name, members] of Object.entries(classes)) {
      const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === name)
      assert(cls, name)
      for (const member of members) assert(!cls.members.some(n => n.name?.getText(source) === member), name + '.' + member)
    }
  }
  const store = read('src/store/index.ts')
  assert(store.includes('function fail(') && !store.includes('export function fail('))
  assert(!store.includes('export { API_BASE, WECHAT_UI_BASE }'))
  assert(store.includes('get isLoggedIn()') && store.includes('async fetchOne(') && store.includes('setFilters('))
  assert(!read('src/services/task.ts').includes('  updateTask,'))
  assert(read('src/services/domain-entry.ts').includes('updateTask('))
  assert(read('src/demo/adapter.ts').includes('updateTask(') && read('src/demo/adapter.ts').includes('createDemoSeed('))
})
check('only specified CSS rules removed; retained rule content unchanged', () => {
  const files = {
    'src/styles/helpers.scss': ['page--flush', 'surface-muted', 'btn-primary--pressed', 'metric-card__value--sm', 'mt-8', 'home-badge-dot'],
    'src/styles/form.scss': ['form__input', 'profile__avatar', 'profile__avatar-text'],
    'src/pages/club/club.scss': ['team-row--me', 'club-stats', 'club-stats__item', 'club-stats__num'],
    'src/pages/me/me.scss': ['me-counts', 'me-counts__item'],
  }
  const normalize = (css, removed = []) => {
    const ast = postcss.parse(css)
    ast.walkComments(n => n.remove())
    ast.walkRules(n => { if (removed.includes(n.selector)) n.remove() })
    return ast.toString().replace(/\s+/g, ' ').trim()
  }
  for (const [file, names] of Object.entries(files)) {
    const original = read(path.join(cleanup.backupRoot, file))
    const expected = sass.compileString(original, {loadPaths: [path.dirname(file)], logger: sass.Logger.silent}).css
    const current = sass.compile(file, {logger: sass.Logger.silent}).css
    assert.equal(normalize(current), normalize(expected, names.map(n => '.' + n)), file)
  }
  assert(!read('src/app.scss').includes('@import "./styles/tokens.scss"'))
  assert(read('src/styles/helpers.scss').includes('@import "./tokens.scss"'))
  for (const cls of ['.empty-state', '.section-label', '.metric-card']) assert(read('src/styles/helpers.scss').includes(cls))
  assert(read('src/styles/form.scss').includes('.form__textarea'))
})
check('weapp scripts and dependencies intact; package importer matches lock', () => {
  const pkg = JSON.parse(read('package.json'))
  const lock = read('pnpm-lock.yaml')
  const importer = lock.slice(lock.indexOf('importers:'), lock.indexOf('packages:'))
  const entries = Object.fromEntries([...importer.matchAll(/^      (.+):\r?\n        specifier: (.+)\r?\n        version: ([^\r\n]+)/gm)].map(m => [m[1].replace(/^'|'$/g, ''), m[2]]))
  assert.deepEqual(entries, {...pkg.dependencies, ...pkg.devDependencies})
  assert.equal(pkg.dependencies['@tarojs/plugin-platform-weapp'], '4.2.1')
  assert.equal(Object.keys(pkg.dependencies).filter(k => k.startsWith('@tarojs/plugin-platform-')).length, 1)
  assert(!pkg.devDependencies['lint-staged'])
  assert.deepEqual(Object.keys(pkg.scripts).filter(k => /^(build|dev):/.test(k)), ['build:weapp', 'build:weapp:prod', 'dev:weapp'])
  assert(!/\b(h5|rn):/.test(read('config/index.ts') + read('config/dev.ts') + read('config/prod.ts')))
  const originalPkg = JSON.parse(read(path.join(cleanup.backupRoot, 'package.json')))
  for (const [key, version] of Object.entries({...pkg.dependencies, ...pkg.devDependencies})) assert.equal(version, originalPkg.dependencies[key] || originalPkg.devDependencies[key])
})
check('26 registered page artifacts and 20 theme icons intact', () => {
  const app = JSON.parse(read('dist/app.json'))
  const pages = [...app.pages, ...(app.subPackages || app.subpackages || []).flatMap(s => s.pages.map(p => s.root + '/' + p))]
  assert.equal(pages.length, 26)
  for (const page of pages) for (const extension of ['.js', '.json', '.wxml']) assert(fs.existsSync(path.join('dist', page + extension)), page + extension)
  const icons = fs.readdirSync('src/assets/tabbar').filter(f => f.endsWith('.png'))
  assert.equal(icons.length, 20)
  for (const file of icons) assert(fs.readFileSync(path.join('src/assets/tabbar', file)).equals(fs.readFileSync(path.join('dist/assets/tabbar', file))), file)
  for (const item of app.tabBar.list) for (const key of ['iconPath', 'selectedIconPath']) {
    assert(fs.existsSync(path.join('dist', item[key])))
    const base = item[key].split('/').pop().replace(/(-active)?[.]png$/, '')
    const suffix = key === 'selectedIconPath' ? '-dark-active.png' : '-dark.png'
    assert(fs.existsSync(path.join('dist/assets/tabbar', base + suffix)), base + suffix)
  }
  assert.equal(JSON.parse(read('project.config.json')).miniprogramRoot, 'dist/')
  assert(!fs.readdirSync('dist', {recursive: true}).filter(f => f.endsWith('.js')).some(f => read(path.join('dist', f)).includes('https://example.invalid')))
})
check('pending modules, icon tooling, runtime JS and declarations retained', () => {
  for (const file of ['scripts/gen-tabbar-icons.py', 'scripts/requirements.txt', 'src/utils/auth-contract.js', 'src/utils/auth-contract.d.ts', 'src/utils/task-attachment-policy.js', 'src/utils/task-attachment-policy.d.ts', 'src/styles/theme/taroify-overrides.scss', '.husky/commit-msg']) assert(fs.existsSync(file), file)
  assert(JSON.parse(read('package.json')).dependencies['@taroify/core'])
  assert(!fs.existsSync('cloudfunctions'))
  assert(!fs.existsSync('config/cloudbase-env.local'))
  assert(!Object.hasOwn(JSON.parse(read('project.config.json')), 'cloudfunctionRoot'))
  assert(!Object.hasOwn(JSON.parse(read('dist/project.config.json')), 'cloudfunctionRoot'))
})
check('all original backup hashes verified', () => {
  const manifest = JSON.parse(read(path.join(cleanup.backupRoot, 'manifest.json')))
  for (const file of manifest.files) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(cleanup.backupRoot, file.file))).digest('hex'), file.sha256, file.file)
})
const result = {checks, failures, passed: checks.length, failed: failures.length}
fs.writeFileSync(planDir + '/cleanup-verification.json', JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
if (failures.length) process.exitCode = 1
