const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const sass = require('sass')
const postcss = require('postcss')
const patches = new Map()
const root = process.cwd()
function transform(file, spec) {
  const original = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const source = ts.createSourceFile(file, original, ts.ScriptTarget.Latest, true)
  const removals = []
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && spec.functions?.includes(node.name?.text)) removals.push([node.getFullStart(), node.end])
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(d=>spec.variables?.includes(d.name.getText(source)))) removals.push([node.getFullStart(), node.end])
    if ((ts.isMethodDeclaration(node)||ts.isGetAccessorDeclaration(node)||ts.isPropertyDeclaration(node)) && ts.isClassDeclaration(node.parent) && spec.classes?.[node.parent.name?.text]?.includes(node.name?.getText(source))) removals.push([node.getFullStart(),node.end])
    ts.forEachChild(node,visit)
  }
  visit(source)
  let changed=original
  for(const [start,end] of removals.sort((a,b)=>b[0]-a[0]))changed=changed.slice(0,start)+changed.slice(end)
  for(const [from,to] of spec.replace||[]) { if(!changed.includes(from))throw new Error('Expected text missing: '+file+' '+from);changed=changed.replace(from,to) }
  patches.set(path.resolve(file).toLowerCase(),changed)
  return {file,removedDeclarations:removals.length,removedLines:original.split('\n').length-changed.split('\n').length}
}
const changes = [
  transform('src/components/ui.tsx',{functions:['SectionTitle','EmptyState','MetricCard']}),
  transform('src/utils/format.ts',{functions:['formatMoney']}),
  transform('src/utils/toast.ts',{functions:['toastError']}),
  transform('src/utils/permission.ts',{functions:['useAuthGuard'],replace:[["import Taro from '@tarojs/taro'\n",''],["import { useEffect } from 'react'\n",''],["import { authStore } from '@/store'\n",''],["import { ROUTES } from '@/constants'\n",''],["import { toast } from '@/utils/toast'\n",'']]}),
  transform('src/services/club.ts',{variables:['storageKeys'],replace:[['DEMO_MODE, STORAGE_KEYS','DEMO_MODE']]}),
  transform('src/types/domain.ts',{variables:['QUALITY_SCORE']}),
  transform('src/demo/adapter.ts',{functions:['resetDemoState'],classes:{DemoAdapter:['isLoggedIn']}}),
  transform('src/store/index.ts',{classes:{TaskStore:['openTasks','pendingReview','myTasks','myActive','resetFilters','fetchOne'],TeamStore:['loading']},replace:[['API_BASE, ROUTES, STORAGE_KEYS, WECHAT_UI_BASE','ROUTES, STORAGE_KEYS'],['export { API_BASE, WECHAT_UI_BASE }','']]}),
  transform('src/pages/index/index.tsx',{replace:[['authStore, taskStore, uiStore','authStore, uiStore'],['{taskStore.total ? null : null}','']]}),
  transform('src/pages/me/profile.tsx',{replace:[['authStore, taskStore, uiStore','authStore, uiStore'],['void taskStore','']]}),
]
const config=ts.readConfigFile('tsconfig.json',ts.sys.readFile)
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,root)
const host=ts.createCompilerHost({...parsed.options,noEmit:true,skipLibCheck:true})
const read=host.readFile.bind(host)
host.readFile=file=>patches.get(path.resolve(file).toLowerCase())??read(file)
const program=ts.createProgram(parsed.fileNames,{...parsed.options,noEmit:true,skipLibCheck:true},host)
const diagnostics=ts.getPreEmitDiagnostics(program)
const formatHost={getCanonicalFileName:f=>f,getCurrentDirectory:()=>root,getNewLine:()=> '\n'}
const before=sass.compile('src/app.scss',{logger:sass.Logger.silent}).css
const after=sass.compileString(fs.readFileSync('src/app.scss','utf8').split('\n').slice(1).join('\n'),{loadPaths:['src'],logger:sass.Logger.silent}).css
const dedup=css=>{const ast=postcss.parse(css);const seen=new Set();for(const node of [...ast.nodes].reverse()){if(node.type==='comment'){node.remove();continue}const key=node.toString();if(seen.has(key))node.remove();else seen.add(key)}return ast.toString().replace(/\s+/g,' ').trim()}
const result={mode:'in-memory only; no application files changed',changes,diagnosticCount:diagnostics.length,diagnostics:ts.formatDiagnostics(diagnostics,formatHost),sassEquivalentAfterDuplicateRemoval:dedup(before)===dedup(after),sassSavedExpandedBytes:Buffer.byteLength(before)-Buffer.byteLength(after)}
fs.writeFileSync('.planning/2026-10-16-dead-code-audit/validation-results.json',JSON.stringify(result,null,2))
console.log(JSON.stringify(result,null,2))
if(diagnostics.length)process.exitCode=1
