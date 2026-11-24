import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
const result = await build({entryPoints:['src/client.js'],bundle:true,write:false,format:'cjs',platform:'browser',target:'es2022',external:['react'],minify:true,legalComments:'none'})
await mkdir('dist',{recursive:true})
await writeFile('dist/client.js',`window.__ModuleLoader__.load({id:"dsh-work-modes-probe",factory(require){const module={exports:{}};const exports=module.exports;${result.outputFiles[0].text}\nreturn module.exports;}});\n`)
console.log('已构建 DSH Client 插件 dist/client.js')
