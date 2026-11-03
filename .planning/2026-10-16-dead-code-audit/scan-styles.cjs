const fs = require('fs')
const path = require('path')
const sass = require('sass')
const postcss = require('postcss')
const files = fs.readdirSync('src', {recursive:true}).map(f=>path.join('src',f)).filter(f=>fs.statSync(f).isFile())
const logic = files.filter(f=>/\.(tsx?|jsx?)$/.test(f)).map(file=>({file,text:fs.readFileSync(file,'utf8')}))
const sheets = files.filter(f=>f.endsWith('.scss'))
const classes = new Map()
for (const file of sheets) {
  const css = sass.compile(file, { logger:sass.Logger.silent, style:'expanded' }).css
  postcss.parse(css).walkRules(rule=>{
    for (const match of rule.selector.matchAll(/\.([_a-zA-Z][_a-zA-Z0-9-]*)/g)) {
      const name=match[1]
      if(!classes.has(name))classes.set(name,new Set())
      classes.get(name).add(file)
    }
  })
}
const result = [...classes].filter(([name])=>!logic.some(f=>f.text.includes(name))).map(([name,files])=>({name,files:[...files]}))
console.log(JSON.stringify({ note:'Candidates only: manually exclude dynamic class interpolation and Sass import duplication', classes:classes.size, candidates:result },null,2))
const app=sass.compile('src/app.scss',{logger:sass.Logger.silent,style:'expanded'}).css
console.log(JSON.stringify({appCssBytes:Buffer.byteLength(app),colorBackgroundDefinitions:[...app.matchAll(/--color-background:/g)].length, duplicatedTokenImport:app.indexOf('--color-background:')!==app.lastIndexOf('--color-background:')}))
