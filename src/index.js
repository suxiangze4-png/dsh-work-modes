import { Service } from '@deepseek-ai/cordis'
import { TypertRemoteService, principalOf } from '@deepseek-ai/dsh-typert-protocol'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { PACKAGE, remoteContribution, requestSchema, bindingSchema, roleRecordSchema, interviewRecordSchema, builtinCategoriesSchema } from './contracts.js'
import { ProbeRuntime, isManagedSession } from './runtime.js'
import { RoleLibrary } from './role-library.js'
import { InterviewRuntime, isInterviewSession } from './interview.js'

const spec = defineDomain({ name: 'work_modes_probe', version: 1, tables: { bindings: domainTable(bindingSchema) } })
const rolesSpec = defineDomain({ name: 'work_modes_roles', version: 1, tables: {
  roles: domainTable(roleRecordSchema), builtin_categories: domainTable(builtinCategoriesSchema),
} })
const interviewsSpec = defineDomain({ name: 'work_modes_interviews', version: 1, tables: { interviews: domainTable(interviewRecordSchema) } })

export default class WorkModesProbe extends TypertRemoteService {
  static inject = ['agents', 'systemPrompt', 'storageDomain', 'sessionController', 'workingDirectory', 'workspaceRegistry', 'sessionProjections', 'typert']
  constructor(ctx, config = {}) {
    super(ctx, 'workModesProbe')
    this.runtime = null
    this.interviews = null
    this.libraryRoot = config.libraryRoot ?? dshHomePath('work-modes', 'roles')
    this.ready = Promise.withResolvers()
    // 初始化失败也保留被观察的拒绝，避免未处理的 Promise rejection。
    this.ready.promise.catch(() => {})
    ctx.on('agent/created', async ({ agent }) => {
      if (!isManagedSession(agent.id) && !isInterviewSession(agent.id)) return
      await this.ready.promise
      await (isInterviewSession(agent.id) ? this.interviews : this.runtime).install(agent)
    })
    ctx.on('agent/pre-step', async ({ agent }, next) => {
      if (!isManagedSession(agent.id) && !isInterviewSession(agent.id)) return next()
      await this.ready.promise
      return (isInterviewSession(agent.id) ? this.interviews : this.runtime).preStep(agent, next)
    })
    ctx.on('llm/stream', (request, next) => {
      if (!isManagedSession(request.sessionId) && !isInterviewSession(request.sessionId)) return next()
      if (!this.runtime) throw new Error('角色插件尚未初始化')
      return (isInterviewSession(request.sessionId) ? this.interviews : this.runtime).observeRequest(request, next)
    })
    ctx.on('agent/disposed', ({ agent }) => {
      for (const runtime of [this.runtime, this.interviews]) { runtime?.installed.get(agent.id)?.dispose(); runtime?.installed.delete(agent.id) }
    })
  }
  async [Service.init]() {
    try {
      const domain = await this.ctx.storageDomain.open(spec)
      let rolesDomain
      let interviewsDomain
      this.ctx.effect(() => async () => {
        await this.interviews?.dispose()
        await this.runtime?.dispose()
        await interviewsDomain?.close()
        await rolesDomain?.close()
        await domain.close()
      })
      rolesDomain = await this.ctx.storageDomain.open(rolesSpec)
      const library = new RoleLibrary(rolesDomain.table('roles'), this.libraryRoot, rolesDomain.table('builtin_categories'))
      const runtime = new ProbeRuntime(this.ctx, domain.table('bindings'), undefined, library)
      this.runtime = runtime
      interviewsDomain = await this.ctx.storageDomain.open(interviewsSpec)
      const interviews = new InterviewRuntime(this.ctx, interviewsDomain.table('interviews'), runtime)
      this.interviews = interviews
      this.ctx.typert.register({ package: PACKAGE, face: 'host', schemas: [], invocations: remoteContribution.descriptors, model: { services: [], events: [], objects: [] } })
      this.ready.resolve()
      const agents = this.ctx.agents.list()
      const restored = await Promise.allSettled(agents.map(agent => isInterviewSession(agent.id) ? interviews.install(agent) : runtime.install(agent)))
      restored.forEach((result, index) => {
        if (result.status === 'rejected') this.ctx.logger.warn(`Work Modes 角色未恢复 ${agents[index].id}: ${result.reason.message}`)
      })
    } catch (error) { this.ready.reject(error); throw error }
  }
  async execute(request) {
    if (principalOf(this.ctx.invocation)) throw new Error('角色管理仅供此 DSH 的本地所有者使用')
    const input = requestSchema.parse(request)
    await this.ready.promise
    switch (input.action) {
      case 'catalog': return this.runtime.catalog()
      case 'create': return this.runtime.create(input.sourceSessionId, input.roleId, input.runMode)
      case 'status': return isInterviewSession(input.sessionId) ? this.interviews.status(input.sessionId) : this.runtime.status(input.sessionId)
      case 'bind': return this.runtime.bind(input.sessionId, input.roleId)
      case 'probe': return this.runtime.probe(input.sessionId)
      case 'roles/list': return this.runtime.listRoles(input.includeArchived)
      case 'roles/read': return this.runtime.roleDetail(input.roleId, input.version)
      case 'roles/create': return this.runtime.library.create({ name: input.name, description: input.description, text: input.text, inheritMode: input.inheritMode, categories: input.categories })
      case 'roles/save': return this.runtime.library.save(input.roleId, input.expectedRevision, { name: input.name, description: input.description, text: input.text, inheritMode: input.inheritMode, categories: input.categories })
      case 'roles/categories':
        await this.runtime.library.setCategories(input.roleId, input.expectedRevision, input.categories)
        return this.runtime.roleDetail(input.roleId)
      case 'roles/copy': {
        const source = await this.runtime.roleDetail(input.roleId, input.version)
        return this.runtime.library.create({ name: input.name, description: source.description, text: source.text, inheritMode: source.inheritMode, categories: source.categories })
      }
      case 'roles/archive': return this.runtime.library.archive(input.roleId, input.expectedRevision, input.archived)
      case 'interview/create': return this.interviews.create(input.sourceSessionId, input.need, input.inheritMode)
      case 'interview/list': return { interviews: this.interviews.list() }
      case 'interview/status': return this.interviews.status(input.sessionId)
      case 'interview/start': return this.interviews.start(input.sessionId)
      case 'interview/extract': return this.interviews.extract(input.sessionId)
      case 'interview/review': return this.interviews.review(input.sessionId, { name: input.name, description: input.description, text: input.text, inheritMode: input.inheritMode, categories: input.categories, sourceMessageId: input.sourceMessageId })
      case 'interview/confirm': return this.interviews.confirm(input.sessionId, input.expectedHash)
      case 'interview/cancel': return this.interviews.cancel(input.sessionId)
    }
  }
}
