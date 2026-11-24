// 只读提取本机 Electron ASAR 中的官方包，供兼容性检查与隔离测试。
import fs from 'node:fs'
import path from 'node:path'
const archive = process.argv[2]
if (!archive) throw new Error('用法：node scripts/inspect-installed.mjs <app.asar 路径> [提取目录]')
const destination = process.argv[3]
const fd = fs.openSync(archive, 'r')
try {
  const header = Buffer.alloc(16)
  fs.readSync(fd, header, 0, 16, 0)
  const json = Buffer.alloc(header.readUInt32LE(12))
  fs.readSync(fd, json, 0, json.length, 16)
  const tree = JSON.parse(json.toString('utf8'))
  const dataOffset = 8 + header.readUInt32LE(4)
  const read = (name, item) => {
    if (item.unpacked) return fs.readFileSync(path.join(archive + '.unpacked', name))
    const buffer = Buffer.alloc(item.size)
    fs.readSync(fd, buffer, 0, item.size, dataOffset + Number(item.offset))
    return buffer
  }
  const summaries = []
  function visit(node, prefix = '') {
    for (const [name, item] of Object.entries(node.files ?? {})) {
      const relative = prefix ? `${prefix}/${name}` : name
      if (item.files) { visit(item, relative); continue }
      if (!relative.startsWith('dsh/')) continue
      if (item.link) continue
      if (relative.endsWith('/package.json') || relative === 'dsh/package.json') {
        const manifest = JSON.parse(read(relative,item).toString('utf8'))
        if (manifest.name?.startsWith('@deepseek-ai/')) summaries.push({name:manifest.name,version:manifest.version,path:relative})
      }
      if (destination) {
        const target = path.resolve(destination, relative)
        if (!target.startsWith(path.resolve(destination) + path.sep)) throw new Error('Archive path escapes target')
        fs.mkdirSync(path.dirname(target), {recursive:true})
        fs.writeFileSync(target, read(relative,item))
      }
    }
  }
  visit(tree)
  console.log(JSON.stringify({archive,destination,packages:summaries.filter(x=>/dsh-(?:desktop|agent|api-session|storage|system-prompt|typert|client-ui-conversation|scope)/.test(x.name))},null,2))
} finally { fs.closeSync(fd) }
