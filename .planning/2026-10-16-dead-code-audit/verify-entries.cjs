const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const config = fs.readFileSync('src/app.config.ts', 'utf8')
const source = ts.createSourceFile('src/app.config.ts', config, ts.ScriptTarget.Latest, true)
const declaration = source.statements[0].expression.arguments[0]
const prop = (obj,name) => obj.properties.find(p=>p.name.getText(source)===name).initializer
const main=prop(declaration,'pages').elements.map(e=>e.text)
const sub=prop(declaration,'subPackages').elements.flatMap(p=>prop(p,'pages').elements.map(e=>prop(p,'root').text+'/'+e.text))
const pages=[...main,...sub]
const disk=fs.readdirSync('src',{recursive:true}).map(p=>p.split(path.sep).join('/')).filter(p=>/pages\/.*\.tsx$/.test(p)).map(p=>p.slice(0,-4))
const images=fs.readdirSync('src/assets/tabbar')
console.log(JSON.stringify({registeredPages:pages.length,pageFiles:disk.length,unregistered:disk.filter(p=>!pages.includes(p)),missing:pages.filter(p=>!fs.existsSync('src/'+p+'.tsx')),tabBarImages:images.length,tabBarImageBytes:images.reduce((n,p)=>n+fs.statSync('src/assets/tabbar/'+p).size,0)},null,2))
