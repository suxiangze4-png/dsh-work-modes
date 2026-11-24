import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { customRoleIdSchema, roleFields, roleRecordSchema, inheritModeSchema, categoriesSchema, builtinCategoriesSchema } from './contracts.js'
import { sameCategories } from './categories.js'
import { z } from 'zod'

export const sha256 = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
export const bindingMarker = role => `WORK_MODES_BINDING:${role.roleId}:v${role.version}:${role.hash}`
const fieldsSchema = z.strictObject({ ...roleFields, inheritMode: inheritModeSchema.default('inherit') })

export class RoleLibrary {
  constructor(table, root, builtinCategories) {
    this.table = table
    this.builtinCategories = builtinCategories
    this.root = path.resolve(root)
    this.tail = Promise.resolve()
  }
  // 单进程写入串行化；失败返回调用者，不阻断后续正常写入。
  write(operation) {
    const result = this.tail.then(operation)
    this.tail = result.catch(() => {})
    return result
  }
  get(roleId) {
    customRoleIdSchema.parse(roleId)
    const raw = this.table.get(roleId)
    if (!raw) throw new Error('角色不存在，请刷新角色库')
    return roleRecordSchema.parse(raw)
  }
  summary(record) {
    const latest = record.versions.at(-1)
    return { roleId: record.roleId, ...latest, latestVersion: latest.version, revision: record.revision,
      archived: record.archived, builtin: false, categories: record.categories, updatedAt: record.updatedAt }
  }
  list(includeArchived = false) {
    return [...this.table.entries()].map(([, raw]) => roleRecordSchema.parse(raw))
      .filter(role => includeArchived || !role.archived).map(role => this.summary(role))
      .sort((a, b) => b.updatedAt - a.updatedAt || a.roleId.localeCompare(b.roleId))
  }
  file(roleId, version, hash) {
    customRoleIdSchema.parse(roleId)
    return path.join(this.root, roleId, `v${version}-${hash}`, 'AGENTS.md')
  }
  async read(roleId, version, { allowArchived = false } = {}) {
    const record = this.get(roleId)
    if (record.archived && version === undefined && !allowArchived) throw new Error('角色已归档，不能用于新会话')
    const selected = version ?? record.versions.at(-1).version
    const entry = record.versions.find(item => item.version === selected)
    if (!entry) throw new Error('绑定的角色版本不存在，已阻止加载')
    const file = this.file(roleId, entry.version, entry.hash)
    const text = await readFile(file, 'utf8')
    if (sha256(text) !== entry.hash) throw new Error('角色版本文件已损坏或被外部修改，已阻止加载')
    return { roleId, ...entry, text, file, categories: record.categories }
  }
  async detail(roleId, version) {
    const record = this.get(roleId)
    const role = await this.read(roleId, version, { allowArchived: true })
    return { ...this.summary(record), ...role, versions: record.versions }
  }
  async publish(roleId, version, fields) {
    const input = fieldsSchema.parse(fields)
    if (Buffer.byteLength(input.text) > 65536) throw new Error('角色正文超过 64 KiB，请精简后保存')
    const hash = sha256(input.text)
    const file = this.file(roleId, version, hash)
    await mkdir(path.dirname(file), { recursive: true })
    // 路径包含内容哈希。元数据提交失败时，未发布文件可安全复用，绝不覆盖旧版本。
    await writeFile(file, input.text, { flag: 'wx' }).catch(async error => {
      if (error.code !== 'EEXIST') throw error
      if (sha256(await readFile(file, 'utf8')) !== hash) throw new Error('已有版本文件损坏，请保留文件并检查存储目录')
    })
    return { version, name: input.name, description: input.description, inheritMode: input.inheritMode, hash, createdAt: Date.now() }
  }
  create(fields, requestedRoleId) {
    return this.write(async () => {
      const { categories: rawCategories, ...roleFields } = fields
      const categories = categoriesSchema.parse(rawCategories ?? [])
      const roleId = requestedRoleId ?? `card-${randomUUID()}`
      customRoleIdSchema.parse(roleId)
      if (this.table.get(roleId)) {
        // 重试只核对已发布的审核版本；后续编辑或归档不应阻止完成，也不能被回退。
        const role = await this.detail(roleId, 1)
        const input = fieldsSchema.parse(roleFields)
        if (['name', 'description', 'text', 'inheritMode'].some(key => role[key] !== input[key])) throw new Error('审核保存目标已存在且内容不同，请重新审核')
        return role
      }
      const entry = await this.publish(roleId, 1, roleFields)
      const record = roleRecordSchema.parse({ roleId, revision: 1, archived: false, categories, versions: [entry],
        createdAt: entry.createdAt, updatedAt: entry.createdAt })
      await this.table.put(roleId, record)
      return this.detail(roleId)
    })
  }
  checkRevision(record, expectedRevision) {
    if (record.revision !== expectedRevision) throw new Error('角色已被其他操作修改，请重新加载后再保存；当前草稿仍保留')
  }
  save(roleId, expectedRevision, fields) {
    return this.write(async () => {
      const record = this.get(roleId)
      this.checkRevision(record, expectedRevision)
      if (record.archived) throw new Error('请先恢复已归档角色，再进行编辑')
      const previous = record.versions.at(-1)
      const { categories: rawCategories, ...roleFields } = fields
      const categories = categoriesSchema.parse(rawCategories ?? record.categories)
      const input = fieldsSchema.parse({ ...roleFields, inheritMode: fields.inheritMode ?? previous.inheritMode })
      const contentChanged = previous.hash !== sha256(input.text) || previous.name !== input.name || previous.description !== input.description || previous.inheritMode !== input.inheritMode
      if (!contentChanged && sameCategories(categories, record.categories)) return this.detail(roleId)
      const entry = contentChanged ? await this.publish(roleId, previous.version + 1, input) : null
      await this.table.put(roleId, { ...record, categories, revision: record.revision + 1,
        versions: entry ? [...record.versions, entry] : record.versions, updatedAt: Date.now() })
      return this.detail(roleId)
    })
  }
  builtinCategoryInfo(roleId) {
    const raw = this.builtinCategories.get(roleId)
    if (!raw) return { categories: [], revision: 0 }
    const record = builtinCategoriesSchema.parse(raw)
    if (record.roleId !== roleId) throw new Error('分类记录与角色不符，请检查角色库存储')
    return { categories: record.categories, revision: record.revision }
  }
  setCategories(roleId, expectedRevision, values) {
    return this.write(async () => {
      const categories = categoriesSchema.parse(values)
      if (roleId.startsWith('card-')) {
        const record = this.get(roleId)
        this.checkRevision(record, expectedRevision)
        if (!sameCategories(categories, record.categories)) await this.table.put(roleId, { ...record, categories, revision: record.revision + 1, updatedAt: Date.now() })
      } else {
        const previous = this.builtinCategoryInfo(roleId)
        this.checkRevision(previous, expectedRevision)
        if (!sameCategories(categories, previous.categories)) await this.builtinCategories.put(roleId,
          builtinCategoriesSchema.parse({ roleId, categories, revision: previous.revision + 1, updatedAt: Date.now() }))
      }
    })
  }
  archive(roleId, expectedRevision, archived) {
    return this.write(async () => {
      const record = this.get(roleId)
      this.checkRevision(record, expectedRevision)
      if (record.archived !== archived) await this.table.put(roleId, { ...record, archived, revision: record.revision + 1, updatedAt: Date.now() })
      return this.summary(this.get(roleId))
    })
  }
}
