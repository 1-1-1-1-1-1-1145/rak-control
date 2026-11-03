const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const root = process.cwd()
const normalize = p => path.relative(root, p).split(path.sep).join('/')
const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile)
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
const tests = fs.readdirSync('tests').filter(f => /\.(ts|mjs)$/.test(f)).map(f => path.resolve('tests', f))
const program = ts.createProgram([...parsed.fileNames, ...tests], { ...parsed.options, noEmit: true, skipLibCheck: true, checkJs: false })
const checker = program.getTypeChecker()
const sources = program.getSourceFiles().filter(s => !s.fileName.includes('node_modules') && /^(src|tests|config)\//.test(normalize(s.fileName)))
const refs = new Map()
const actual = symbol => {
  if (!symbol) return symbol
  const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
  return checker.getRootSymbols(resolved)[0] || resolved
}
const loc = (s, n) => normalize(s.fileName) + ':' + (s.getLineAndCharacterOfPosition(n.getStart()).line + 1)
for (const s of sources) {
  function walk(n) {
    if (ts.isIdentifier(n) || ts.isStringLiteral(n)) {
      const sym = actual(checker.getSymbolAtLocation(n))
      if (sym) {
        if (!refs.has(sym)) refs.set(sym, [])
        refs.get(sym).push({ file: normalize(s.fileName), at: loc(s, n), kind: ts.SyntaxKind[n.parent.kind], declaration: (sym.declarations || []).some(d => d.name === n), import: ts.isImportSpecifier(n.parent) || ts.isExportSpecifier(n.parent) })
      }
    }
    ts.forEachChild(n, walk)
  }
  walk(s)
}
const exportedSymbols = []
const members = []
const imports = []
for (const s of sources) {
  if (!normalize(s.fileName).startsWith('src/')) continue
  const module = checker.getSymbolAtLocation(s)
  if (module) for (const exp of checker.getExportsOfModule(module)) {
    if (exp.name === 'default') continue
    const sym = actual(exp)
    const decl = (sym.declarations || [])[0]
    const use = (refs.get(sym) || []).filter(r => !r.declaration && !r.import)
    if (decl) exportedSymbols.push({ name: exp.name, at: loc(s, decl), usageCount: use.length, uses: use.slice(0, 12) })
  }
  function walk(n) {
    if ((ts.isMethodDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isPropertyDeclaration(n)) && n.name && ts.isClassDeclaration(n.parent)) {
      const sym = actual(checker.getSymbolAtLocation(n.name))
      const use = (refs.get(sym) || []).filter(r => !r.declaration && !r.import)
      members.push({ name: n.name.getText(), class: n.parent.name?.text, at: loc(s, n), usageCount: use.length, uses: use.slice(0, 12) })
    }
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const spec = n.moduleSpecifier.text
      const resolved = ts.resolveModuleName(spec, s.fileName, parsed.options, ts.sys).resolvedModule
      imports.push({ from: normalize(s.fileName), spec, to: resolved ? normalize(resolved.resolvedFileName) : null })
    }
    ts.forEachChild(n, walk)
  }
  walk(s)
}
const result = { sourceCount: sources.length, exports: exportedSymbols, members, imports }
fs.writeFileSync('.planning/2026-10-16-dead-code-audit/reference-scan.json', JSON.stringify(result, null, 2))
console.log(JSON.stringify({ sourceCount: sources.length, unusedExports: exportedSymbols.filter(e => e.usageCount === 0), unusedMembers: members.filter(e => e.usageCount === 0), inbound: sources.filter(s => normalize(s.fileName).startsWith('src/')).map(s => ({file: normalize(s.fileName), importers: imports.filter(i => i.to === normalize(s.fileName)).map(i => i.from)})).filter(i => !i.importers.length) }, null, 2))
