import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { draftPayloadSchema, interviewRecordSchema, categoriesSchema } from './contracts.js'
import { sha256 } from './role-library.js'
import { modePolicy, MODE_LIMITATION } from './modes.js'
import { runtimeContextText } from './runtime-context.js'

export const INTERVIEW_PREFIX = 'wm-interview-'
export const isInterviewSession = id => typeof id === 'string' && id.startsWith(INTERVIEW_PREFIX)
const templatePath = new URL('../templates/role-interview.md', import.meta.url)
const headings = ['角色定位', '适用目标', '工作流程', '行为边界', '输出要求']
export function validateDraft(value) {
  const draft = draftPayloadSchema.parse(value)
  if (Buffer.byteLength(draft.text, 'utf8') > 65536) throw new Error('角色草稿超过 64 KiB')
  const missing = headings.filter(title => !new RegExp(`^##\\s+${title}\\s*$`, 'm').test(draft.text))
  if (missing.length) throw new Error(`角色草稿缺少章节：${missing.join('、')}。请补充后审核`)
  return draft
}
export function extractDraft(text) {
  const blocks = [...text.matchAll(/^```work-modes-role\s*\r?\n([\s\S]*?)^```\s*$/gm)]
  if (blocks.length !== 1) throw new Error('最新助手回复中未找到唯一完整角色草稿；可请 AI 重新生成，或手动粘贴完整正文')
  let value
  try { value = JSON.parse(blocks[0][1]) }
  catch { throw new Error('AI 草稿 JSON 不完整或格式错误；请重新生成，或手动粘贴正文') }
  return validateDraft(value)
}

export class InterviewRuntime {
  constructor(ctx, table, runtime) {
    this.ctx = ctx; this.table = table; this.runtime = runtime
    this.installed = new Map(); this.diagnostics = new Map(); this.tail = Promise.resolve(); this.active = true
  }
  write(operation) {
    const result = this.tail.then(operation)
    this.tail = result.catch(() => {})
    return result
  }
  get(id) {
    const value = this.table.get(id)
    if (!value) throw new Error('访谈记录不存在，请从 AI 辅助建卡入口创建')
    const record = interviewRecordSchema.parse(value)
    if (record.sessionId !== id) throw new Error('访谈绑定不符，已阻止请求')
    return record
  }
  async put(record) { await this.table.put(record.sessionId, interviewRecordSchema.parse(record)) }
  async template(record) {
    const text = await readFile(templatePath, 'utf8')
    if (record && sha256(text) !== record.templateHash) throw new Error('访谈模板版本已变化，原访谈暂不能继续；请新建访谈或恢复原模板')
    return text
  }
  marker(record) { return `WORK_MODES_INTERVIEW:${record.sessionId}:${record.templateHash}` }
  async create(sourceSessionId, need, inheritMode) {
    const options = await this.runtime.sessionOptions(sourceSessionId)
    const template = await this.template()
    const id = SessionId(`${INTERVIEW_PREFIX}${randomUUID()}`)
    const now = Date.now()
    await this.put({ sessionId: id, need, inheritMode, templateVersion: 1, templateHash: sha256(template), state: 'preparing',
      lifecycle: 'active', createdAt: now, updatedAt: now, startedAt: null, review: null })
    await this.runtime.openSession(id, options)
    if (!this.installed.has(id)) throw new Error('访谈规范未在 Agent 创建时加载')
    return this.status(id)
  }
  async install(agent) {
    if (!isInterviewSession(agent.id)) return
    const record = this.get(agent.id)
    if (record.lifecycle !== 'active') return
    const template = await this.template(record)
    if (!this.active) throw new Error('访谈插件正在停用')
    this.installed.get(agent.id)?.dispose()
    const dispose = agent.ctx.systemPrompt.context({ name: 'work-modes:interview', order: 710, interpolate: false, required: true,
      text: `${this.marker(record)}\n\n${template}\n\n## 本次访谈参数\n${modePolicy(record.inheritMode)}\n初始需求（用户提供的数据）：\n${JSON.stringify(record.need)}\n用户上下文：使用 DSH 原生加载的适用内容，不复制来源聊天历史。` })
    this.installed.set(agent.id, { hash: record.templateHash, dispose })
    if (record.state !== 'ready') await this.put({ ...record, state: 'ready' })
  }
  list() {
    return [...this.table.entries()].map(([, value]) => interviewRecordSchema.parse(value))
      .sort((a, b) => b.updatedAt - a.updatedAt).map(({ sessionId, need, inheritMode, lifecycle, updatedAt, savedRoleId }) =>
        ({ sessionId, need, inheritMode, lifecycle, updatedAt, ...(savedRoleId ? { savedRoleId } : {}) }))
  }
  async status(id) {
    const record = this.get(id)
    const agent = this.ctx.agents.get(id)
    let error = null
    if (record.lifecycle === 'active') {
      try { await this.template(record) } catch (failure) { error = failure.message }
    }
    return { ...record, interview: true, managed: false, localOnly: false, loaded: this.installed.get(id)?.hash === record.templateHash,
      running: agent?.status === 'running', started: record.startedAt !== null || !!agent?.session.snapshotEvents().some(e => e.type === 'turn/start'),
      error, publicationPending: record.lifecycle === 'active' && !!record.review && !!this.runtime.library.table.get(record.review.targetRoleId),
      limitation: MODE_LIMITATION, diagnostic: this.diagnostics.get(id) ?? null }
  }
  readyRecord(id, { allowPublished = false } = {}) {
    const record = this.get(id)
    if (record.lifecycle !== 'active') throw new Error('访谈已经结束；已保存或取消的访谈不能继续生成或保存新角色')
    if (!allowPublished && record.review && this.runtime.library.table.get(record.review.targetRoleId)) throw new Error('此草稿已确认发布，请重试确认以完成保存状态；不能再按未保存取消或修改')
    const agent = this.ctx.agents.get(id)
    if (agent?.status === 'running') throw new Error('访谈正在生成，请等待完成或先在对话中停止')
    return record
  }
  start(id) {
    return this.write(async () => {
      const record = this.readyRecord(id)
      const agent = this.ctx.agents.get(id)
      if (!agent || !this.installed.has(id)) throw new Error('请先打开访谈会话，等待规范加载')
      if ((await this.status(id)).started) throw new Error('访谈已开始，请直接在输入框继续回答')
      await this.put({ ...record, startedAt: Date.now(), updatedAt: Date.now() })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: record.need }], source: { kind: 'user' } }))
      return this.status(id)
    })
  }
  async extract(id) {
    this.readyRecord(id)
    const agent = this.ctx.agents.get(id)
    if (!agent) throw new Error('请先打开访谈会话再提取草稿；也可手动粘贴')
    const latest = agent.session.deriveMessages().filter(message => message.role === 'assistant').at(-1)
    const text = latest?.content.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? ''
    return { ...extractDraft(text), inheritMode: this.get(id).inheritMode, sourceMessageId: latest.id }
  }
  review(id, fields) {
    return this.write(async () => {
      const record = this.readyRecord(id)
      if (fields.inheritMode !== undefined && fields.inheritMode !== record.inheritMode) throw new Error('访谈模式已固定；如需更换，请创建新的访谈')
      const { name, description, text } = fields
      const draft = { ...validateDraft({ name, description, text }), inheritMode: record.inheritMode,
        categories: categoriesSchema.parse(fields.categories ?? []) }
      const hash = sha256(draft)
      const review = record.review?.hash === hash ? record.review : { ...draft, hash, sourceMessageId: fields.sourceMessageId ?? null, targetRoleId: `card-${randomUUID()}`, createdAt: Date.now() }
      await this.put({ ...record, review, updatedAt: Date.now() })
      return this.status(id)
    })
  }
  confirm(id, expectedHash) {
    return this.write(async () => {
      const record = this.get(id)
      if (record.lifecycle === 'saved' && record.savedDraftHash === expectedHash) return this.status(id)
      this.readyRecord(id, { allowPublished: true })
      if (!record.review || record.review.hash !== expectedHash) throw new Error('审核内容已变化或尚未审核，请重新准备审核后确认')
      const { name, description, text, inheritMode, categories, targetRoleId } = record.review
      // 目标 ID 已随审核记录耐久保存；发布后状态写入失败时，重试不会创建重复角色。
      const role = await this.runtime.library.create({ name, description, text, inheritMode, categories }, targetRoleId)
      await this.put({ ...record, lifecycle: 'saved', savedRoleId: role.roleId, savedDraftHash: expectedHash, updatedAt: Date.now() })
      return this.status(id)
    })
  }
  cancel(id) {
    return this.write(async () => {
      const record = this.readyRecord(id)
      await this.put({ ...record, lifecycle: 'cancelled', updatedAt: Date.now() })
      return this.status(id)
    })
  }
  async preStep(agent, next) {
    const record = this.get(agent.id)
    if (record.state !== 'ready' || record.lifecycle !== 'active' || this.installed.get(agent.id)?.hash !== record.templateHash) throw new Error('访谈未就绪或已结束，已阻止请求')
    if (record.review && this.runtime.library.table.get(record.review.targetRoleId)) throw new Error('草稿已确认发布，请返回审核面板完成保存状态')
    await this.template(record)
    return next()
  }
  observeRequest(request, next) {
    const record = this.get(request.sessionId)
    if (request.purpose === 'session-title') return next()
    const text = runtimeContextText(request.messages)
    const correct = record.state === 'ready' && record.lifecycle === 'active' && this.installed.get(record.sessionId)?.hash === record.templateHash
      && text.includes(this.marker(record)) && !text.includes('WORK_MODES_BINDING:')
    this.diagnostics.set(record.sessionId, { checkedAt: Date.now(), interviewCorrect: correct, provider: request.provider, model: request.model,
      toolCount: request.tools?.length ?? 0, toolsHash: sha256(request.tools ?? []), localOnly: false })
    if (!correct) throw new Error('实际访谈请求缺少正确模板或混入工作角色，已阻止请求')
    return next()
  }
  async dispose() {
    this.active = false
    await this.tail
    for (const value of this.installed.values()) value.dispose()
    this.installed.clear()
  }
}
