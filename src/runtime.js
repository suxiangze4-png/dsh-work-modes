import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import manifest from '../package.json' with { type: 'json' }
import { bindingSchema } from './contracts.js'
import { sha256, bindingMarker } from './role-library.js'
import { modePolicy } from './modes.js'
import { STARTER_ROLES } from './builtin-roles.js'
import { runtimeContextText } from './runtime-context.js'
export { sha256 } from './role-library.js'

export const PREFIX = 'wm-probe-'
export const WORK_PREFIX = 'wm-work-'
export const isManagedSession = id => typeof id === 'string' && (id.startsWith(PREFIX) || id.startsWith(WORK_PREFIX))
export const ROLE_MARKERS = { 'role-a': 'WORK_MODES_PROBE_ROLE_A_V1_47a1', 'role-b': 'WORK_MODES_PROBE_ROLE_B_V1_82b6' }
const roleNames = { ...Object.fromEntries(STARTER_ROLES.map(role => [role.roleId, role.name])), 'role-a': '角色 A · 分析教练', 'role-b': '角色 B · 行动顾问', default: 'DSH 默认状态' }
const events = session => session.snapshotEvents()
export const started = session => events(session).some(event => event.type === 'turn/start')

export class RoleRepository {
  constructor(root = new URL('../roles/', import.meta.url)) { this.root = root }
  async read(roleId, version = 1) {
    if (version !== 1) throw new Error('内置角色仅有 v1')
    if (roleId === 'default') return { roleId, name: roleNames[roleId], version: 1, hash: 'default', text: '', inheritMode: 'inherit' }
    if (!Object.hasOwn(roleNames, roleId)) throw new Error('未知内置角色')
    const text = await readFile(new URL(`${roleId}/AGENTS.md`, this.root), 'utf8')
    if (Buffer.byteLength(text) > 16384 || !text.trim() || Object.hasOwn(ROLE_MARKERS, roleId) && !text.includes(ROLE_MARKERS[roleId])) throw new Error('角色文件损坏或超过 16 KiB')
    return { roleId, name: roleNames[roleId], version: 1, hash: sha256(text), text, inheritMode: 'inherit', sources: STARTER_ROLES.find(role => role.roleId === roleId)?.sources ?? [] }
  }
}

function* localResponse(text = '【Work Modes 本地探针】已在模型发送边界检查本次请求，未调用模型。请查看上方角色测试诊断。') {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

export class ProbeRuntime {
  constructor(ctx, table, repository = new RoleRepository(), library) {
    this.ctx = ctx; this.table = table; this.repository = repository; this.library = library
    this.installed = new Map(); this.diagnostics = new Map(); this.pending = new Set(); this.tails = new Map(); this.active = true
  }
  async catalog() {
    const entries = [...this.listRoles(false).roles, { roleId: 'default', name: roleNames.default, description: '不绑定角色卡', version: 1, categories: [] }]
    const reads = await Promise.allSettled(entries.map(role => this.readRole(role.roleId)))
    const roles = entries.map((role, index) => ({ ...role, available: reads[index].status === 'fulfilled' }))
    return { roles, runModes: ['work', 'probe'], compatibleVersion: manifest.engines.dsh }
  }
  readRole(roleId, version) {
    return roleId.startsWith('card-') ? this.library.read(roleId, version) : this.repository.read(roleId, version)
  }
  references(roleId) {
    return [...this.table.entries()].map(([, raw]) => bindingSchema.parse(raw)).filter(binding => binding.roleId === roleId)
  }
  listRoles(includeArchived) {
    const builtin = [...STARTER_ROLES, ...['role-a', 'role-b'].map(roleId => ({ roleId, name: roleNames[roleId], description: '历史只读测试角色，可复制为自定义卡', testing: true }))]
      .map(role => ({ ...role, version: 1, latestVersion: 1, builtin: true, archived: false,
        ...this.library.builtinCategoryInfo(role.roleId), inheritMode: 'inherit' }))
    return { roles: [...builtin, ...this.library.list(includeArchived)].map(role => ({ ...role, references: this.references(role.roleId).length })), libraryRoot: this.library.root }
  }
  async roleDetail(roleId, version) {
    const role = roleId.startsWith('card-') ? await this.library.detail(roleId, version) : await this.repository.read(roleId, version)
    const builtinInfo = roleId === 'default' || roleId.startsWith('card-') ? {} : this.library.builtinCategoryInfo(roleId)
    const builtinDescription = STARTER_ROLES.find(item => item.roleId === roleId)?.description
    return { ...role, ...builtinInfo, description: role.description ?? builtinDescription ?? '', builtin: !roleId.startsWith('card-'), revision: role.revision ?? builtinInfo.revision ?? 0,
      latestVersion: role.latestVersion ?? 1, archived: role.archived ?? false, versions: role.versions ?? [{ version: 1, name: role.name, hash: role.hash }],
      references: this.references(roleId).length }
  }
  getBinding(id) {
    const raw = this.table.get(id)
    if (raw === undefined) return undefined
    const binding = bindingSchema.parse(raw)
    const prefix = binding.runMode === 'work' ? WORK_PREFIX : PREFIX
    if (binding.sessionId !== id || !id.startsWith(prefix)) throw new Error('会话类型与持久化绑定不符，已阻止请求')
    return binding
  }
  async put(binding) { await this.table.put(binding.sessionId, bindingSchema.parse(binding)) }
  async install(agent) {
    if (!isManagedSession(agent.id)) return
    const binding = this.getBinding(agent.id)
    if (!binding) throw new Error('角色会话缺少绑定，已阻止启动')
    const role = await this.readRole(binding.roleId, binding.version)
    if (role.hash !== binding.hash || role.inheritMode !== binding.inheritMode) throw new Error('角色版本哈希或规范模式不符，拒绝使用修改后的规范')
    if (!this.active) throw new Error('角色插件正在停用')
    this.installed.get(agent.id)?.dispose()
    const dispose = role.text ? agent.ctx.systemPrompt.context({
      name: 'work-modes-probe:role', order: 700, text: `${bindingMarker(role)}\n\n${modePolicy(binding.inheritMode)}\n\n${role.text}`, interpolate: false, required: true,
    }) : () => {}
    this.installed.set(agent.id, { agent, hash: role.hash, dispose })
    if (binding.state !== 'ready') await this.put({ ...binding, state: 'ready' })
  }
  async sessionOptions(sourceSessionId) {
    const source = this.ctx.agents.get(sourceSessionId)
    if (!source) throw new Error('请先打开一个正常 DSH 会话，再新建角色会话')
    const cwd = await this.ctx.workingDirectory.ensure(source)
    const workspace = this.ctx.workspaceRegistry.list().find(w => w.sessionIds.includes(sourceSessionId) && w.path === cwd)
    const preset = this.ctx.get('agentPresets')?.composedPreset(source.ctx)
    return { ...(workspace ? { workspaceId: workspace.id } : { cwd }), ...(preset ? { agentPreset: preset } : {}) }
  }
  async openSession(id, options) {
    const result = await this.ctx.sessionController.create({ sessionId: id, ...options })
    if (result.sessionId !== id) throw new Error('DSH 返回不同的 Session ID，创建已停止，请勿使用该空白会话')
    if (!this.ctx.agents.get(id)) throw new Error('新会话 Agent 尚未就绪')
  }
  async create(sourceSessionId, roleId, runMode = 'probe') {
    const options = await this.sessionOptions(sourceSessionId)
    const role = await this.readRole(roleId)
    const id = SessionId(`${runMode === 'work' ? WORK_PREFIX : PREFIX}${randomUUID()}`)
    await this.put({ sessionId: id, roleId, version: role.version, hash: role.hash, inheritMode: role.inheritMode, state: 'preparing', createdAt: Date.now(), runMode })
    await this.openSession(id, options)
    const agent = this.ctx.agents.get(id)
    if (!agent || !this.installed.has(id)) throw new Error('角色未在 Agent 创建阶段加载')
    return this.status(id)
  }
  async status(id) {
    const binding = this.getBinding(id)
    if (!binding) {
      if (isManagedSession(id)) throw new Error('角色会话缺少绑定，已阻止请求')
      return { sessionId: id, managed: false, localOnly: false, runMode: null }
    }
    const agent = this.ctx.agents.get(id)
    let error = null
    let role
    try { role = await this.readRole(binding.roleId, binding.version); if (role.hash !== binding.hash || role.inheritMode !== binding.inheritMode) error = `角色文件或模式已变化，绑定的 v${binding.version} 不可用` }
    catch (failure) { error = `角色版本无法读取：${failure.message}` }
    return {
      sessionId: id, managed: true, roleId: binding.roleId, roleName: role?.name ?? binding.roleId, version: binding.version,
      categories: role?.categories ?? (binding.roleId !== 'default' && !binding.roleId.startsWith('card-') ? this.library.builtinCategoryInfo(binding.roleId).categories : []),
      hash: binding.hash, loaded: this.installed.get(id)?.hash === binding.hash, state: binding.state,
      locked: agent ? started(agent.session) : null, error, runMode: binding.runMode, inheritMode: binding.inheritMode, localOnly: binding.runMode === 'probe',
      diagnostic: this.diagnostics.get(id) ?? null,
    }
  }
  async bind(id, roleId) {
    const previous = this.tails.get(id) ?? Promise.resolve()
    const operation = previous.then(async () => {
      const agent = this.ctx.agents.get(id)
      const old = this.getBinding(id)
      if (!agent || !old) throw new Error('只能为插件创建的空白角色会话选择角色')
      if (started(agent.session)) throw new Error('会话已经开始工作，禁止换角色，请新建会话')
      this.pending.add(id)
      try {
        const role = await this.readRole(roleId)
        if (started(agent.session)) throw new Error('会话已在选择期间开始工作，请新建会话')
        await this.put({ ...old, roleId, version: role.version, hash: role.hash, inheritMode: role.inheritMode, state: 'preparing' })
        if (started(agent.session)) { await this.put(old); throw new Error('会话已开始工作，选择未生效') }
        try { await this.install(agent) } catch (error) { await this.put(old); await this.install(agent); throw error }
      } finally { this.pending.delete(id) }
      return this.status(id)
    })
    const settled = operation.catch(() => {})
    this.tails.set(id, settled)
    try { return await operation } finally { if (this.tails.get(id) === settled) this.tails.delete(id) }
  }
  async preStep(agent, next) {
    if (!isManagedSession(agent.id)) return next()
    const binding = this.getBinding(agent.id)
    if (!binding || this.pending.has(agent.id) || binding.state !== 'ready') throw new Error('角色绑定尚未就绪，已阻止请求')
    const role = await this.readRole(binding.roleId, binding.version)
    if (role.hash !== binding.hash || role.inheritMode !== binding.inheritMode || this.installed.get(agent.id)?.hash !== binding.hash) throw new Error('角色版本缺失或未加载，已阻止请求')
    return next()
  }
  observeRequest(request, next) {
    const id = request.sessionId
    if (!isManagedSession(id)) return next()
    const binding = this.getBinding(id)
    if (!binding || binding.state !== 'ready') throw new Error('请求缺少有效角色绑定')
    // 标题不是 Agent 主请求，不要求角色标记，也不覆盖主请求诊断。
    if (request.purpose === 'session-title') return binding.runMode === 'probe' ? localResponse('Work Modes 角色测试') : next()
    const agent = this.ctx.agents.get(id)
    if (!agent || this.installed.get(id)?.hash !== binding.hash) throw new Error('角色会话 Agent 不存在或规范尚未加载')
    const texts = runtimeContextText(request.messages)
    const present = Object.fromEntries(Object.entries(ROLE_MARKERS).map(([key, marker]) => [key, texts.includes(marker)]))
    const markers = texts.match(/WORK_MODES_BINDING:[a-z0-9-]+:v\d+:[a-f0-9]{64}/g) ?? []
    const expectedMarker = bindingMarker(binding)
    const correct = binding.roleId === 'default' ? !Object.values(present).some(Boolean) && markers.length === 0
      : markers.includes(expectedMarker) && markers.every(marker => marker === expectedMarker)
        && (!Object.hasOwn(ROLE_MARKERS, binding.roleId) || present[binding.roleId] && Object.entries(present).every(([key, value]) => key === binding.roleId || !value))
    const previous = this.diagnostics.get(id)
    this.diagnostics.set(id, {
      requestNumber: (previous?.requestNumber ?? 0) + 1, checkedAt: Date.now(), roleCorrect: correct, present,
      boundRole: { roleId: binding.roleId, version: binding.version, hash: binding.hash },
      provider: request.provider, model: request.model, reasoningEffort: request.reasoningEffort ?? null,
      toolCount: request.tools?.length ?? 0, toolsHash: sha256(request.tools ?? []),
      cwd: agent.session.header.cwd ?? null,
      preset: this.ctx.get('agentPresets')?.composedPreset(agent.ctx) ?? null,
      permissionState: this.ctx.sessionProjections.snapshot(agent.session).values.permissions ?? null,
      runMode: binding.runMode, localOnly: binding.runMode === 'probe',
    })
    if (!correct) throw new Error('实际请求的角色标记检查失败，已阻止模型调用')
    // 工作会话仅校验角色材料，继续宿主正常请求链；旧探针仍本地响应。
    return binding.runMode === 'probe' ? localResponse() : next()
  }
  async probe(id) {
    const binding = this.getBinding(id)
    if (binding?.runMode === 'work') throw new Error('正常工作会话不能执行本地探针；请直接在输入框提交任务')
    const agent = this.ctx.agents.get(id)
    if (!agent || !binding) throw new Error('请先打开角色测试会话')
    if (agent.status === 'running') throw new Error('测试会话正在工作，请等待结束')
    const before = this.diagnostics.get(id)?.requestNumber ?? 0
    agent.followup(createUserMessage({ content: [{ type: 'text', text: '执行 Work Modes 本地请求检查。' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    if ((this.diagnostics.get(id)?.requestNumber ?? 0) <= before) throw new Error('本轮未到达模型发送边界，请检查角色文件与 DSH 错误提示')
    if (!this.diagnostics.get(id).roleCorrect) throw new Error('本轮角色标记检查失败，已阻止模型调用')
    return this.status(id)
  }
  async dispose() {
    this.active = false
    await Promise.allSettled([...this.tails.values()])
    await this.library?.tail
    for (const entry of this.installed.values()) entry.dispose()
    this.installed.clear()
  }
}
