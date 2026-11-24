import { defineConfig } from 'vitest/config'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const installed = process.env.DSH_TEST_RUNTIME
if (!installed) throw new Error('请设置 DSH_TEST_RUNTIME，指向包含 package.json 和 node_modules 的 DSH 运行目录')
const runtimeRequire = createRequire(path.join(installed,'package.json'))
export default defineConfig({
  root:fileURLToPath(new URL('.',import.meta.url)),
  plugins:[{name:'installed-official-dsh',enforce:'pre',resolveId(id){
    if(id.startsWith('/tests/')) return path.join(fileURLToPath(new URL('.',import.meta.url)),id.slice(1)).replaceAll('\\','/')
    if(id.startsWith('@deepseek-ai/')) return runtimeRequire.resolve(id).replaceAll('\\','/')
  }}],
  test:{include:['tests/**/*.test.ts'],maxWorkers:1,testTimeout:15000,reporters:['default','json'],outputFile:{json:'test-results.json'}},
})
