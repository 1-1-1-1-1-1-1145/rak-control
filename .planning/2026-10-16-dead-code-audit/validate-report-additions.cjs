const ts = require('typescript')
const fs = require('fs')
const path = require('path')
const root = process.cwd()
const patches = new Map()
const edits = [
  ['src/components/page-shell.tsx', [['  bare?: boolean\n',''],['  bare = false,\n',''],["className={bare ? 'page page--flush' : 'page'}","className='page'"]]],
  ['src/store/index.ts', [['export function fail(', 'function fail(']]],
  ['src/services/task.ts', [['  updateTask,\n','']]],
]
for(const [file,replacements] of edits) {
  let text = fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n')
  for(const [from,to] of replacements) {if(!text.includes(from))throw new Error('Anchor missing: '+file);text=text.replace(from,to)}
  patches.set(path.resolve(file).toLowerCase(),text)
}
const parsed=ts.parseJsonConfigFileContent(ts.readConfigFile('tsconfig.json',ts.sys.readFile).config,ts.sys,root)
const options={...parsed.options,noEmit:true,skipLibCheck:true}
const host=ts.createCompilerHost(options)
const read=host.readFile.bind(host)
host.readFile=file=>patches.get(path.resolve(file).toLowerCase())??read(file)
const diagnostics=ts.getPreEmitDiagnostics(ts.createProgram(parsed.fileNames,options,host))
const invocations=[]
for(const file of parsed.fileNames.filter(f=>f.endsWith('.tsx'))) {
 const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true)
 function visit(node) {
  if((ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))&&node.tagName.getText(source)==='PageShell')invocations.push({file:path.relative(root,file),attributes:node.attributes.properties.map(p=>p.getText(source)),spread:node.attributes.properties.some(ts.isJsxSpreadAttribute)})
  ts.forEachChild(node,visit)
 }
 visit(source)
}
console.log(JSON.stringify({mode:'in-memory only, no application files changed',diagnosticCount:diagnostics.length,diagnostics:ts.formatDiagnostics(diagnostics,{getCanonicalFileName:f=>f,getCurrentDirectory:()=>root,getNewLine:()=> '\n'}),pageShellUses:invocations.length,spreadUsages:invocations.filter(i=>i.spread),bareUsages:invocations.filter(i=>i.attributes.some(a=>/^bare(?:=|$)/.test(a)))},null,2))
if(diagnostics.length)process.exitCode=1
