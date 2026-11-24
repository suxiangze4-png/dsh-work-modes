import { readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
const files = (await readdir('src')).filter(name => name.endsWith('.js')).sort()
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', `src/${file}`], { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
console.log(`已检查 ${files.length} 个源码文件的语法`)
