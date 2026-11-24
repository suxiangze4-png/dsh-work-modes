import { describe, it, expect, afterEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import Typert from '@deepseek-ai/dsh-typert-registry'
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import { mkdir, mkdtemp, rm, writeFile, readFile, cp } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import WorkModesProbe from '../src/index.js'
import { ROLE_MARKERS, RoleRepository, sha256 } from '../src/runtime.js'
import { remoteContribution, bindingSchema, roleRecordSchema } from '../src/contracts.js'
import { matchesRole, categoryLabel } from '../src/categories.js'
import { extractDraft } from '../src/interview.js'
import { STARTER_ROLES } from '../src/builtin-roles.js'
import { runtimeContextText } from '../src/runtime-context.js'

class Adapter extends LlmAdapter {
  calls = []
  responses = []
  async resolveModel(provider, model) { return { provider, id:model, name:model } }
  async* stream(request) {
    this.calls.push(request)
    yield {type:'block-start',index:0,blockType:'text'}
    yield {type:'block-end',index:0,block:{type:'text',text:this.responses.shift() ?? 'normal response'}}
    yield {type:'finish',reason:{kind:'stop'}}
  }
}
const contexts = new Set(), directories = new Set()
const testRoot = path.resolve(process.env.DSH_TEST_TMP ?? path.join(os.tmpdir(), 'dsh-work-modes-tests'))
afterEach(async()=>{
  for(const ctx of contexts) await ctx.fiber.dispose()
  contexts.clear()
  for(const dir of directories) {
    if (!path.resolve(dir).startsWith(testRoot+path.sep)) throw new Error('Unsafe cleanup path')
    await rm(dir,{recursive:true,force:true})
  }
  directories.clear()
})
async function directory() {
  await mkdir(testRoot,{recursive:true})
  const dir=await mkdtemp(path.join(testRoot,'case-')); directories.add(dir); return dir
}
async function harness(root, {complete=false}={}) {
  root ??= await directory()
  const ctx=new Context(); contexts.add(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjections)
  await ctx.plugin(SystemPrompt,{personaPrefix:'UNCHANGED_BASE_PROMPT'})
  if(complete) {
    ctx.systemPrompt.section({name:'test:complete',order:0,text:'UNCHANGED_COMPLETE_PROMPT',complete:true})
    ctx.systemPrompt.suppressRuntimeContext()
  }
  await ctx.plugin(ToolRuntime)
  // 新版宿主把原生工具执行器拆成独立插件。
  if (typeof ctx.tools.setExecutor === 'function') {
    const executorPackage = '@deepseek-ai/dsh-tool-executor-native'
    await ctx.plugin(await import(executorPackage))
  }
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(Typert)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson,{root:path.join(root,'storage')})
  await ctx.plugin(StorageDomain,{backend:'json'})
  await ctx.plugin(Jsonl,{root:path.join(root,'sessions')})
  await ctx.plugin(AgentLoop,{agents:[]})
  const adapter=new Adapter()
  ctx.llm.registerAdapter(['mock'],adapter)
  // 一个非空的原有工具；角色插件不得移除或增加工具。
  ctx.systemPrompt.tools(()=>({schemas:[{name:'unchanged_tool',description:'baseline',parameters:{type:'object',properties:{}}}]}))
  ctx.provide('workingDirectory',{ensure:async agent=>agent.session.header.cwd})
  ctx.provide('workspaceRegistry',{list:()=>[]})
  expect(typeof AgentPresets.prototype.composedPreset).toBe('function')
  ctx.provide('agentPresets',{composedPreset:()=> 'standard'})
  ctx.provide('sessionController',{create:async request=>{
    const handle=await ctx.agents.create({sessionId:request.sessionId,meta:{cwd:request.cwd,...request.agentPreset?{agentPreset:request.agentPreset}:{}},agentOptions:{provider:'mock',model:'unchanged-model'}})
    return {sessionId:handle.agent.id}
  }})
  const plugin=await ctx.plugin(WorkModesProbe,{libraryRoot:path.join(root,'role-library')})
  const source=await ctx.agents.create({sessionId:SessionId('normal-source'),meta:{cwd:root,agentPreset:'standard'},agentOptions:{provider:'mock',model:'unchanged-model'}})
  return {ctx,root,adapter,plugin,source:source.agent,service:ctx.workModesProbe}
}

describe('official DSH runtime integration',()=>{
  it('declares host imports as peers so linked plugins use the official runtime resolver',async()=>{
    const manifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'))
    for(const file of ['index.js','runtime.js','contracts.js','client.js','role-library.js','role-manager.js','interview.js','interview-ui.js','modes.js','builtin-roles.js']) {
      const source=await readFile(new URL(`../src/${file}`,import.meta.url),'utf8')
      for(const [,specifier] of source.matchAll(/from ['"]([^'"]+)['"]/g)) {
        if(specifier.startsWith('@deepseek-ai/') || specifier==='react') {
          expect(manifest.peerDependencies, `${file}: ${specifier}`).toHaveProperty(specifier)
        }
      }
    }
  })
  it('registers a public strict Remote endpoint and rejects unknown wire input',async()=>{
    const h=await harness()
    const descriptor=h.ctx.typert.local.get('workModesProbe/execute')
    expect(descriptor.id).toBe(remoteContribution.descriptors[0].id)
    expect(()=>descriptor.parameters[0].codec.create().parse({action:'create',sourceSessionId:'x',roleId:'../../invalid'})).toThrow()
    const catalog = await h.service.execute({action:'catalog'})
    const manifest = JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'))
    expect(catalog.roles.map(role=>role.roleId)).toEqual(expect.arrayContaining(['role-a','role-b','default']))
    expect(catalog.compatibleVersion).toBe(manifest.engines.dsh)
  })
  it('answers auxiliary title requests locally without counting them as Agent requests',async()=>{
    const h=await harness()
    const a=await h.service.execute({action:'create',sourceSessionId:h.source.id,roleId:'role-a'})
    const chunks=[...h.service.runtime.observeRequest({sessionId:a.sessionId,purpose:'session-title',messages:[]},()=>{throw new Error('must stay local')})]
    expect(chunks.some(chunk=>chunk.text==='Work Modes 角色测试')).toBe(true)
    expect((await h.service.execute({action:'status',sessionId:a.sessionId})).diagnostic).toBeNull()
    expect((await h.service.execute({action:'probe',sessionId:a.sessionId})).diagnostic.requestNumber).toBe(1)
  })
  it('sends A/B/A/default role material to the real first-request boundary and never calls the adapter',async()=>{
    const h=await harness()
    const results=[]
    for(const roleId of ['role-a','role-b','role-a','default']){
      const created=await h.service.execute({action:'create',sourceSessionId:h.source.id,roleId})
      expect(created.loaded).toBe(true)
      expect(created.locked).toBe(false)
      expect(h.adapter.calls).toHaveLength(0)
      const result=await h.service.execute({action:'probe',sessionId:created.sessionId})
      expect(result.diagnostic.roleCorrect).toBe(true)
      expect(result.diagnostic.requestNumber).toBe(1)
      expect(result.diagnostic.toolCount).toBe(1)
      expect(result.diagnostic.model).toBe('unchanged-model')
      expect(result.diagnostic.provider).toBe('mock')
      expect(result.diagnostic.cwd).toBe(h.root)
      expect(result.diagnostic.preset).toBe('standard')
      expect(result.locked).toBe(true)
      results.push(result)
    }
    expect(results[0].hash).toBe(results[2].hash)
    expect(results[0].diagnostic.present).toEqual({'role-a':true,'role-b':false})
    expect(results[1].diagnostic.present).toEqual({'role-a':false,'role-b':true})
    expect(results[3].diagnostic.present).toEqual({'role-a':false,'role-b':false})
    expect(new Set(results.map(r=>r.diagnostic.toolsHash)).size).toBe(1)
    expect(h.adapter.calls).toHaveLength(0)
  })
  it('preserves ordinary session requests and its prompt configuration',async()=>{
    const h=await harness()
    h.source.followup(createUserMessage({content:[{type:'text',text:'ordinary task'}],source:{kind:'user'}}))
    await h.source.whenIdle()
    expect(h.adapter.calls).toHaveLength(1)
    expect(JSON.stringify(h.adapter.calls[0].messages)).not.toContain(ROLE_MARKERS['role-a'])
    expect(JSON.stringify(h.adapter.calls[0].messages)).toContain('UNCHANGED_BASE_PROMPT')
    expect((await h.service.execute({action:'status',sessionId:h.source.id})).managed).toBe(false)
  })
  it('allows blank selection, locks after work, and refuses changing ordinary sessions',async()=>{
    const h=await harness()
    const a=await h.service.execute({action:'create',sourceSessionId:h.source.id,roleId:'role-a'})
    await h.service.execute({action:'bind',sessionId:a.sessionId,roleId:'role-b'})
    const checked=await h.service.execute({action:'probe',sessionId:a.sessionId})
    expect(checked.roleId).toBe('role-b')
    await expect(h.service.execute({action:'bind',sessionId:a.sessionId,roleId:'role-a'})).rejects.toThrow('禁止换角色')
    await expect(h.service.execute({action:'bind',sessionId:h.source.id,roleId:'role-a'})).rejects.toThrow('空白角色会话')
  })
  it('keeps required role context with complete prompt and optional context disabled',async()=>{
    const h=await harness(undefined,{complete:true})
    const a=await h.service.execute({action:'create',sourceSessionId:h.source.id,roleId:'role-a'})
    const checked=await h.service.execute({action:'probe',sessionId:a.sessionId})
    expect(checked.diagnostic.roleCorrect).toBe(true)
    const agent=h.ctx.agents.get(a.sessionId)
    expect(renderPrompt(await h.ctx.systemPrompt.assemble({scope:agent}))).toBe('UNCHANGED_COMPLETE_PROMPT')
  })
  it('restores the original role/version after all Context and store objects are recreated',async()=>{
    const h=await harness()
    const a=await h.service.execute({action:'create',sourceSessionId:h.source.id,roleId:'role-a'})
    await h.service.execute({action:'probe',sessionId:a.sessionId})
    await h.ctx.sessions.flush(h.ctx.agents.get(a.sessionId).session)
    await h.ctx.fiber.dispose();contexts.delete(h.ctx)
    const resumed=await harness(h.root)
    const handle=await resumed.ctx.agents.resume({resumeSessionId:SessionId(a.sessionId),agentOptions:{provider:'mock',model:'unchanged-model'}})
    const state=await resumed.service.execute({action:'status',sessionId:handle.agent.id})
    expect(state.roleId).toBe('role-a');expect(state.hash).toBe(a.hash);expect(state.locked).toBe(true);expect(state.loaded).toBe(true)
    expect((await resumed.service.execute({action:'probe',sessionId:a.sessionId})).diagnostic.roleCorrect).toBe(true)
    expect(resumed.adapter.calls).toHaveLength(0)
  })
  it('fails closed on missing or modified role files',async()=>{
    const h=await harness()
    const roles=await directory()
    await cp(new URL('../roles/',import.meta.url),roles,{recursive:true})
    h.service.runtime.repository=new RoleRepository(pathToFileURL(roles+path.sep))
    const a=await h.service.execute({action:'create',sourceSessionId:h.source.id,roleId:'role-a'})
    await writeFile(path.join(roles,'role-a/AGENTS.md'),ROLE_MARKERS['role-a']+' changed')
    await expect(h.service.execute({action:'probe',sessionId:a.sessionId})).rejects.toThrow('未到达模型发送边界')
    expect(h.adapter.calls).toHaveLength(0)
    expect((await h.service.execute({action:'status',sessionId:a.sessionId})).error).toContain('变化')
  })
  it('unloads its scoped context and keeps durable bindings',async()=>{
    const h=await harness()
    const a=await h.service.execute({action:'create',sourceSessionId:h.source.id,roleId:'role-a'})
    const agent=h.ctx.agents.get(a.sessionId)
    const before=await h.ctx.systemPrompt.assemble({scope:agent})
    expect(JSON.stringify(before)).toContain(ROLE_MARKERS['role-a'])
    await h.plugin.dispose()
    expect(JSON.stringify(await h.ctx.systemPrompt.assemble({scope:agent}))).not.toContain(ROLE_MARKERS['role-a'])
    expect(h.ctx.typert.local.get('workModesProbe/execute')).toBeUndefined()
  })
  it('does not report an earlier success when a later request is blocked',async()=>{
    const h=await harness()
    const roles=await directory()
    await cp(new URL('../roles/',import.meta.url),roles,{recursive:true})
    h.service.runtime.repository=new RoleRepository(pathToFileURL(roles+path.sep))
    const a=await h.service.execute({action:'create',sourceSessionId:h.source.id,roleId:'role-a'})
    await h.service.execute({action:'probe',sessionId:a.sessionId})
    await writeFile(path.join(roles,'role-a/AGENTS.md'),ROLE_MARKERS['role-a']+' changed')
    await expect(h.service.execute({action:'probe',sessionId:a.sessionId})).rejects.toThrow('本轮未到达')
    expect(h.adapter.calls).toHaveLength(0)
  })
})

describe('normal role work sessions',()=>{
  const createWork = (h, roleId='role-a') => h.service.execute({action:'create',sourceSessionId:h.source.id,roleId,runMode:'work'})
  const send = async (h, id, text='Explain a small Python error without using tools.') => {
    const agent=h.ctx.agents.get(id)
    agent.followup(createUserMessage({content:[{type:'text',text}],source:{kind:'user'}}))
    await agent.whenIdle()
    return h.service.execute({action:'status',sessionId:id})
  }

  it('creates idle work sessions and sends A/B/default to the adapter with isolated role context',async()=>{
    const h=await harness()
    const statuses=[]
    for(const roleId of ['role-a','role-b','default']) {
      const before=h.adapter.calls.length
      const session=await createWork(h,roleId)
      expect(session.sessionId).toMatch(/^wm-work-/)
      expect(session.runMode).toBe('work');expect(session.localOnly).toBe(false)
      expect(session.loaded).toBe(true);expect(session.locked).toBe(false)
      expect(h.adapter.calls).toHaveLength(before)
      const result=await send(h,session.sessionId)
      expect(h.adapter.calls).toHaveLength(before+1)
      expect(result.locked).toBe(true);expect(result.diagnostic.roleCorrect).toBe(true)
      expect(result.diagnostic.localOnly).toBe(false)
      expect(result.diagnostic.provider).toBe('mock');expect(result.diagnostic.model).toBe('unchanged-model')
      expect(result.diagnostic.cwd).toBe(h.root);expect(result.diagnostic.preset).toBe('standard')
      expect(result.diagnostic.toolCount).toBe(1)
      const prompt=JSON.stringify(h.adapter.calls.at(-1).messages)
      expect(prompt).toContain('UNCHANGED_BASE_PROMPT')
      for(const [key,marker] of Object.entries(ROLE_MARKERS)) expect(prompt.includes(marker)).toBe(key===roleId)
      statuses.push(result)
    }
    expect(new Set(statuses.map(s=>s.diagnostic.toolsHash)).size).toBe(1)
    const probe=await h.service.execute({action:'create',sourceSessionId:h.source.id,roleId:'role-a'})
    expect(probe.runMode).toBe('probe')
    await h.service.execute({action:'probe',sessionId:probe.sessionId})
    expect(h.adapter.calls).toHaveLength(3)
    await send(h,h.source.id)
    expect(h.adapter.calls).toHaveLength(4)
    expect(JSON.stringify(h.adapter.calls.at(-1).messages)).not.toContain('WORK_MODES_BINDING:')
  })
  it('rejects probe actions on work sessions before queuing any user task',async()=>{
    const h=await harness();const session=await createWork(h)
    const before=h.ctx.agents.get(session.sessionId).session.snapshotEvents().length
    await expect(h.service.execute({action:'probe',sessionId:session.sessionId})).rejects.toThrow('正常工作会话不能执行本地探针')
    expect(h.ctx.agents.get(session.sessionId).session.snapshotEvents()).toHaveLength(before)
    expect(h.adapter.calls).toHaveLength(0)
  })
  it('supports blank selection and locks work-session roles after the first task',async()=>{
    const h=await harness();const session=await createWork(h)
    await h.service.execute({action:'bind',sessionId:session.sessionId,roleId:'role-b'})
    const result=await send(h,session.sessionId)
    expect(result.runMode).toBe('work');expect(result.diagnostic.present).toEqual({'role-a':false,'role-b':true})
    await expect(h.service.execute({action:'bind',sessionId:session.sessionId,roleId:'role-a'})).rejects.toThrow('禁止换角色')
  })
  it('passes work-session title requests through without miscounting role diagnostics',async()=>{
    const h=await harness();const session=await createWork(h)
    let calls=0
    const result=h.service.runtime.observeRequest({sessionId:session.sessionId,purpose:'session-title',messages:[]},()=>{calls++;return 'host title stream'})
    expect(result).toBe('host title stream');expect(calls).toBe(1)
    expect((await h.service.execute({action:'status',sessionId:session.sessionId})).diagnostic).toBeNull()
  })
  it('preserves required work-role material when the preset uses a complete prompt',async()=>{
    const h=await harness(undefined,{complete:true});const session=await createWork(h)
    const result=await send(h,session.sessionId)
    expect(result.diagnostic.roleCorrect).toBe(true);expect(h.adapter.calls).toHaveLength(1)
    expect(JSON.stringify(h.adapter.calls[0].messages)).toContain('UNCHANGED_COMPLETE_PROMPT')
  })
  it('restores work mode and archived v1 after v2 is published and all services restart',async()=>{
    const h=await harness()
    const role=await h.service.execute({action:'roles/create',name:'Work review',description:'version test',text:'# v1\nReview carefully.'})
    const old=await createWork(h,role.roleId)
    await send(h,old.sessionId)
    const v2=await h.service.execute({action:'roles/save',roleId:role.roleId,expectedRevision:role.revision,name:role.name,description:role.description,text:'# v2\nGive steps.'})
    const fresh=await createWork(h,role.roleId)
    expect(fresh.version).toBe(2)
    await h.service.execute({action:'roles/archive',roleId:role.roleId,expectedRevision:v2.revision,archived:true})
    await h.ctx.sessions.flush(h.ctx.agents.get(old.sessionId).session)
    await h.ctx.fiber.dispose();contexts.delete(h.ctx)
    const resumed=await harness(h.root)
    await resumed.ctx.agents.resume({resumeSessionId:SessionId(old.sessionId),agentOptions:{provider:'mock',model:'unchanged-model'}})
    const result=await send(resumed,old.sessionId,'Continue the review.')
    expect(result.runMode).toBe('work');expect(result.localOnly).toBe(false)
    expect(result.version).toBe(1);expect(result.hash).toBe(role.hash)
    expect(result.loaded).toBe(true);expect(result.locked).toBe(true)
    expect(resumed.adapter.calls).toHaveLength(1)
    const prompt=JSON.stringify(resumed.adapter.calls[0].messages)
    expect(prompt).toContain('# v1');expect(prompt).not.toContain('# v2')
  })
  it.each(['corrupted','missing'])('blocks a work request when its role file is %s',async kind=>{
    const h=await harness()
    const role=await h.service.execute({action:'roles/create',name:'File integrity',description:'',text:'# Original role'})
    const session=await createWork(h,role.roleId)
    if(kind==='corrupted') await writeFile(role.file,'changed externally')
    else await rm(role.file)
    const result=await send(h,session.sessionId)
    expect(result.error).toBeTruthy();expect(result.diagnostic).toBeNull();expect(h.adapter.calls).toHaveLength(0)
  })
  it('reads legacy bindings without a mode as probes and never upgrades their requests',async()=>{
    const h=await harness()
    const session=await h.service.execute({action:'create',sourceSessionId:h.source.id,roleId:'role-a'})
    const table=h.service.runtime.table
    h.service.runtime.table={get:id=>{const value=table.get(id);if(!value)return value;const {runMode,...legacy}=value;return legacy},put:(...args)=>table.put(...args),entries:()=>table.entries()}
    expect(bindingSchema.parse(h.service.runtime.table.get(session.sessionId)).runMode).toBe('probe')
    const result=await send(h,session.sessionId)
    expect(result.runMode).toBe('probe');expect(result.localOnly).toBe(true)
    expect(result.diagnostic.roleCorrect).toBe(true);expect(h.adapter.calls).toHaveLength(0)
  })
  it('rejects mismatched modes, unknown modes and managed sessions without bindings',async()=>{
    const h=await harness();const session=await createWork(h)
    await expect(h.service.execute({action:'create',sourceSessionId:h.source.id,roleId:'role-a',runMode:'unknown'})).rejects.toThrow()
    const table=h.service.runtime.table
    const binding=table.get(session.sessionId)
    h.service.runtime.table={get:id=>id===session.sessionId?{...binding,runMode:'probe'}:table.get(id),entries:()=>table.entries()}
    await expect(h.service.execute({action:'status',sessionId:session.sessionId})).rejects.toThrow('会话类型')
    expect(()=>h.service.runtime.observeRequest({sessionId:'wm-work-unbound',messages:[]},()=>{throw new Error('must not forward')})).toThrow('绑定')
    expect(h.adapter.calls).toHaveLength(0)
  })
  it('blocks forwarding when the assembled role marker is missing or belongs to another role',async()=>{
    const h=await harness();const session=await createWork(h)
    await send(h,session.sessionId)
    const request=h.adapter.calls[0]
    const messages=request.messages.filter(message=>message.source.kind!=='runtime-context')
    expect(()=>h.service.runtime.observeRequest({...request,messages},()=>{throw new Error('must not forward')})).toThrow('角色标记')
    const forged=createUserMessage({content:[{type:'text',text:runtimeContextText(request.messages)}],source:{kind:'user'}})
    expect(()=>h.service.runtime.observeRequest({...request,messages:[...messages,forged]},()=>{throw new Error('must not forward')})).toThrow('角色标记')
    const cleared=createUserMessage({content:[{type:'text',text:'Runtime context cleared.'}],source:{kind:'runtime-context'}})
    expect(()=>h.service.runtime.observeRequest({...request,messages:[...request.messages,cleared]},()=>{throw new Error('must not forward')})).toThrow('角色标记')
    const wrongRole=structuredClone(request)
    for(const message of wrongRole.messages) for(const part of message.content??[]) {
      if(part.type==='text') part.text=part.text.replaceAll(ROLE_MARKERS['role-a'],ROLE_MARKERS['role-b'])
    }
    expect(()=>h.service.runtime.observeRequest(wrongRole,()=>{throw new Error('must not forward')})).toThrow('角色标记')
    expect((await h.service.execute({action:'status',sessionId:session.sessionId})).diagnostic.roleCorrect).toBe(false)
    expect(h.adapter.calls).toHaveLength(1)
  })
})

describe('role library and immutable versions',()=>{
  const fields = {name:'Python 审查员',description:'检查边界和可读性',text:'# 工作规范\n\n先定位问题，再给修改建议。\n'}
  const createRole = (h, input=fields) => h.service.execute({action:'roles/create',...input})
  const createSession = (h, roleId) => h.service.execute({action:'create',sourceSessionId:h.source.id,roleId})
  const saveRole = (h, role, text) => h.service.execute({action:'roles/save',roleId:role.roleId,expectedRevision:role.revision,
    name:role.name,description:role.description,text})

  it('stores real AGENTS.md files, lists cards and rejects empty or oversized input',async()=>{
    const h=await harness()
    const role=await createRole(h)
    expect(path.basename(role.file)).toBe('AGENTS.md')
    expect(await readFile(role.file,'utf8')).toBe(fields.text)
    expect((await h.service.execute({action:'roles/list'})).roles.find(item=>item.roleId===role.roleId).builtin).toBe(false)
    await expect(createRole(h,{...fields,text:' \n '})).rejects.toThrow()
    await expect(createRole(h,{...fields,text:'中'.repeat(22000)})).rejects.toThrow('64 KiB')
    await expect(h.service.execute({action:'roles/read',roleId:'../../outside'})).rejects.toThrow()
    expect(h.service.runtime.library.list()).toHaveLength(1)
  })
  it('uses v2 for new sessions while old sessions and shared v1 files remain unchanged',async()=>{
    const h=await harness()
    const role=await createRole(h)
    const old=await createSession(h,role.roleId)
    const shared=await createSession(h,role.roleId)
    const v2=await saveRole(h,role,'# 工作规范 v2\n先提供结论，再展开证据。')
    const fresh=await createSession(h,role.roleId)
    expect(v2.version).toBe(2)
    expect(fresh.version).toBe(2)
    expect(old.hash).toBe(shared.hash)
    expect(fresh.hash).not.toBe(old.hash)
    expect(await readFile(role.file,'utf8')).toBe(fields.text)
    for(const [session,version] of [[old,1],[shared,1],[fresh,2]]) {
      const result=await h.service.execute({action:'probe',sessionId:session.sessionId})
      expect(result.version).toBe(version)
      expect(result.diagnostic.roleCorrect).toBe(true)
      expect(result.diagnostic.boundRole.version).toBe(version)
    }
    const detail=await h.service.execute({action:'roles/read',roleId:role.roleId})
    expect(detail.references).toBe(3)
    expect(detail.versions).toHaveLength(2)
    expect(h.adapter.calls).toHaveLength(0)
  })
  it('keeps archived historical bindings usable and excludes the card from new selections',async()=>{
    const h=await harness()
    const role=await createRole(h)
    const session=await createSession(h,role.roleId)
    const archived=await h.service.execute({action:'roles/archive',roleId:role.roleId,expectedRevision:role.revision,archived:true})
    expect((await h.service.execute({action:'catalog'})).roles.some(item=>item.roleId===role.roleId)).toBe(false)
    await expect(createSession(h,role.roleId)).rejects.toThrow('已归档')
    await expect(saveRole(h,archived,'不能编辑')).rejects.toThrow('先恢复')
    expect((await h.service.execute({action:'probe',sessionId:session.sessionId})).diagnostic.roleCorrect).toBe(true)
    expect((await h.service.execute({action:'roles/read',roleId:role.roleId})).references).toBe(1)
    expect(h.service.runtime.library.list()).toHaveLength(0)
    expect(h.service.runtime.library.list(true)).toHaveLength(1)
    await h.service.execute({action:'roles/archive',roleId:role.roleId,expectedRevision:archived.revision,archived:false})
    expect((await createSession(h,role.roleId)).version).toBe(1)
  })
  it('rejects stale simultaneous saves instead of overwriting another editor',async()=>{
    const h=await harness()
    const role=await createRole(h)
    const results=await Promise.allSettled([saveRole(h,role,'编辑器一'),saveRole(h,role,'编辑器二')])
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1)
    expect(results.find(result=>result.status==='rejected').reason.message).toContain('重新加载')
    const detail=await h.service.execute({action:'roles/read',roleId:role.roleId})
    expect(detail.text).toBe('编辑器一')
    expect(detail.versions).toHaveLength(2)
    await expect(h.service.execute({action:'roles/archive',roleId:role.roleId,expectedRevision:role.revision,archived:true})).rejects.toThrow('重新加载')
  })
  it('does not publish a file whose metadata commit failed and supports a safe retry',async()=>{
    const h=await harness()
    const role=await createRole(h)
    const library=h.service.runtime.library
    const table=library.table
    library.table={get:id=>table.get(id),entries:()=>table.entries(),put:async()=>{throw new Error('disk full')}}
    await expect(saveRole(h,role,'未提交正文')).rejects.toThrow('disk full')
    expect(library.get(role.roleId).versions).toHaveLength(1)
    expect((await createSession(h,role.roleId)).version).toBe(1)
    library.table=table
    const retry=await saveRole(h,role,'重试的另一份正文')
    expect(retry.version).toBe(2)
    expect(retry.text).toBe('重试的另一份正文')
    expect(await readFile(role.file,'utf8')).toBe(fields.text)
  })
  it('copies builtin or archived cards to independent identities without changing their source',async()=>{
    const h=await harness()
    const builtin=await h.service.execute({action:'roles/copy',roleId:'role-a',name:'我的分析教练'})
    const original=await h.service.execute({action:'roles/read',roleId:'role-a'})
    expect(builtin.roleId).not.toBe('role-a')
    expect(builtin.text).toBe(original.text)
    await saveRole(h,builtin,'独立的副本正文')
    expect((await h.service.execute({action:'roles/read',roleId:'role-a'})).text).toBe(original.text)
    const role=await createRole(h)
    await h.service.execute({action:'roles/archive',roleId:role.roleId,expectedRevision:role.revision,archived:true})
    const copy=await h.service.execute({action:'roles/copy',roleId:role.roleId,name:'归档卡副本'})
    expect(copy.archived).toBe(false)
    expect(copy.text).toBe(fields.text)
  })
  it('does not create a redundant version for an unchanged save',async()=>{
    const h=await harness()
    const role=await createRole(h)
    const same=await saveRole(h,role,role.text)
    expect(same.version).toBe(1)
    expect(same.revision).toBe(role.revision)
    const rename=await h.service.execute({action:'roles/save',roleId:role.roleId,expectedRevision:role.revision,...fields,name:'新的名称'})
    expect(rename.version).toBe(2)
    expect((await h.service.execute({action:'roles/read',roleId:role.roleId,version:1})).name).toBe(fields.name)
  })
  it('blocks a corrupted latest file without silently replacing a pinned historical version',async()=>{
    const h=await harness()
    const role=await createRole(h)
    const old=await createSession(h,role.roleId)
    const latest=await saveRole(h,role,'新版正文')
    await writeFile(latest.file,'外部修改')
    await expect(createSession(h,role.roleId)).rejects.toThrow('损坏')
    expect((await h.service.execute({action:'probe',sessionId:old.sessionId})).diagnostic.roleCorrect).toBe(true)
    await expect(h.service.execute({action:'roles/read',roleId:role.roleId,version:99})).rejects.toThrow('版本不存在')
    expect((await h.service.execute({action:'roles/archive',roleId:role.roleId,expectedRevision:latest.revision,archived:true})).archived).toBe(true)
    expect((await h.service.execute({action:'probe',sessionId:old.sessionId})).diagnostic.roleCorrect).toBe(true)
  })
  it('restores an archived custom v1 after saving v2 and recreating all services',async()=>{
    const h=await harness()
    const role=await createRole(h)
    const session=await createSession(h,role.roleId)
    await h.service.execute({action:'probe',sessionId:session.sessionId})
    const latest=await saveRole(h,role,'归档前新版')
    await h.service.execute({action:'roles/archive',roleId:role.roleId,expectedRevision:latest.revision,archived:true})
    await h.ctx.sessions.flush(h.ctx.agents.get(session.sessionId).session)
    await h.ctx.fiber.dispose();contexts.delete(h.ctx)
    const resumed=await harness(h.root)
    await resumed.ctx.agents.resume({resumeSessionId:SessionId(session.sessionId),agentOptions:{provider:'mock',model:'unchanged-model'}})
    const result=await resumed.service.execute({action:'probe',sessionId:session.sessionId})
    expect(result.version).toBe(1)
    expect(result.hash).toBe(role.hash)
    expect(result.roleName).toBe(fields.name)
    expect(result.locked).toBe(true)
    expect(result.diagnostic.roleCorrect).toBe(true)
    expect(resumed.adapter.calls).toHaveLength(0)
  })
  it('can start the plugin with one damaged existing binding while still blocking that session',async()=>{
    const h=await harness()
    const role=await createRole(h)
    const session=await createSession(h,role.roleId)
    await h.plugin.dispose()
    await writeFile(role.file,'损坏')
    await h.ctx.plugin(WorkModesProbe,{libraryRoot:path.join(h.root,'role-library')})
    expect((await h.ctx.workModesProbe.execute({action:'catalog'})).roles.find(item=>item.roleId===role.roleId).available).toBe(false)
    await expect(h.ctx.workModesProbe.execute({action:'probe',sessionId:session.sessionId})).rejects.toThrow('本轮未到达')
    expect(h.adapter.calls).toHaveLength(0)
  })
})

describe('AI interview, review and context modes',()=>{
  const draft={name:'指针学习教练',description:'解释地址和内存，逐步练习',text:'# 指针学习教练\n\n## 角色定位\n帮助理解指针。\n\n## 适用目标\n地址、解引用和链表入门。\n\n## 工作流程\n先解释、手动模拟，再练习。\n\n## 行为边界\n遵守系统及项目规范，不猜测用户背景。\n\n## 输出要求\n展示关键内存变化和可运行小例子。'}
  const create=(h,inheritMode='inherit')=>h.service.execute({action:'interview/create',sourceSessionId:h.source.id,need:'设计 C 语言指针学习教练',inheritMode})
  const send=async(h,id,text='开始访谈')=>{const agent=h.ctx.agents.get(id);agent.followup(createUserMessage({content:[{type:'text',text}],source:{kind:'user'}}));await agent.whenIdle()}
  const prepare=(h,id,fields=draft)=>h.service.execute({action:'interview/review',sessionId:id,...fields})
  const confirm=(h,id,hash)=>h.service.execute({action:'interview/confirm',sessionId:id,expectedHash:hash,confirmed:true})
  const fenced=fields=>'```work-modes-role\n'+JSON.stringify(fields)+'\n```'

  it('ships four distinct sourced starter roles and loads each into work requests without A/B markers',async()=>{
    const h=await harness()
    expect(STARTER_ROLES).toHaveLength(4)
    const texts=[]
    for(const entry of STARTER_ROLES) {
      const detail=await h.service.execute({action:'roles/read',roleId:entry.roleId})
      expect(detail.sources).toEqual(entry.sources);expect(detail.builtin).toBe(true)
      expect(detail.text).toContain('MIT License');expect(detail.text).toContain('Copyright (c)')
      for(const source of entry.sources)expect(detail.text).toContain(source)
      const work=await h.service.execute({action:'create',sourceSessionId:h.source.id,roleId:entry.roleId,runMode:'work'})
      await send(h,work.sessionId,'按专业职责处理一个简短示例')
      const status=await h.service.execute({action:'status',sessionId:work.sessionId})
      expect(status.diagnostic.roleCorrect).toBe(true);expect(status.diagnostic.present).toEqual({'role-a':false,'role-b':false})
      texts.push(detail.text)
    }
    expect(new Set(texts).size).toBe(4);expect(h.adapter.calls).toHaveLength(4)
    const manifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'))
    for(const item of ['templates','licenses','THIRD_PARTY_NOTICES.md'])expect(manifest.files).toContain(item)
  })

  it('creates an idle dedicated interview, keeps native facts/config and excludes source task/role history',async()=>{
    const h=await harness()
    h.ctx.systemPrompt.context({name:'test:known-user',order:600,text:'KNOWN_USER_FACT: 已学到链表。KNOWN_BASE_STYLE: 简明讲解。',required:true})
    const source=await h.service.execute({action:'create',sourceSessionId:h.source.id,roleId:'role-a',runMode:'work'})
    await send(h,source.sessionId,'SOURCE_TASK_PRIVATE_73a4')
    const session=await h.service.execute({action:'interview/create',sourceSessionId:source.sessionId,need:'设计指针学习教练',inheritMode:'independent'})
    expect(session.sessionId).toMatch(/^wm-interview-/);expect(session.loaded).toBe(true)
    expect(h.adapter.calls).toHaveLength(1);expect(h.service.runtime.table.get(session.sessionId)).toBeUndefined()
    await h.service.execute({action:'interview/start',sessionId:session.sessionId});await h.ctx.agents.get(session.sessionId).whenIdle()
    const request=h.adapter.calls.at(-1);const prompt=JSON.stringify(request.messages)
    expect(prompt).toContain('KNOWN_USER_FACT');expect(prompt).toContain('KNOWN_BASE_STYLE')
    expect(prompt).toContain('独立领域规范（提示词层）');expect(prompt).toContain('不能声称机制级隔离')
    expect(prompt).not.toContain('SOURCE_TASK_PRIVATE_73a4');expect(prompt).not.toContain('WORK_MODES_BINDING:')
    expect(request.provider).toBe('mock');expect(request.model).toBe('unchanged-model');expect(request.tools).toHaveLength(1)
    expect(h.ctx.agents.get(session.sessionId).session.header.cwd).toBe(h.root)
    expect((await h.service.execute({action:'interview/status',sessionId:session.sessionId})).diagnostic.interviewCorrect).toBe(true)
    expect(h.service.runtime.library.list()).toHaveLength(0)
  })
  it('loads the required interview template under a complete prompt',async()=>{
    const h=await harness(undefined,{complete:true});const session=await create(h)
    await send(h,session.sessionId)
    expect(h.adapter.calls).toHaveLength(1)
    expect(JSON.stringify(h.adapter.calls[0].messages)).toContain('UNCHANGED_COMPLETE_PROMPT')
    expect(JSON.stringify(h.adapter.calls[0].messages)).toContain('WORK_MODES_INTERVIEW:')
  })
  it('supports multiple native turns, extracts the latest assistant draft and never auto-publishes',async()=>{
    const h=await harness();const session=await create(h)
    h.adapter.responses.push('已知你学过链表。你希望先模拟内存还是先写小程序？',fenced(draft))
    await h.service.execute({action:'interview/start',sessionId:session.sessionId});await h.ctx.agents.get(session.sessionId).whenIdle()
    await expect(h.service.execute({action:'interview/start',sessionId:session.sessionId})).rejects.toThrow('访谈已开始')
    await send(h,session.sessionId,'先模拟，之后给练习，不直接给完整答案。')
    const extracted=await h.service.execute({action:'interview/extract',sessionId:session.sessionId})
    expect(extracted.text).toBe(draft.text);expect(extracted.sourceMessageId).toBeTruthy();expect(extracted.inheritMode).toBe('inherit')
    expect(h.adapter.calls).toHaveLength(2);expect(h.service.runtime.library.list()).toHaveLength(0)
    expect((await h.service.execute({action:'interview/status',sessionId:session.sessionId})).review).toBeNull()
    // 后续只有问题时，不能悄悄提取更早的草稿。
    await send(h,session.sessionId,'还需要调整哪些地方？')
    await expect(h.service.execute({action:'interview/extract',sessionId:session.sessionId})).rejects.toThrow('最新助手回复')
  })
  it('rejects malformed, ambiguous and structurally incomplete AI output with a manual-edit path',()=>{
    expect(()=>extractDraft('普通回答')).toThrow('手动粘贴')
    expect(()=>extractDraft('```work-modes-role\n{"name":\n```')).toThrow('JSON')
    expect(()=>extractDraft(fenced(draft)+'\n'+fenced(draft))).toThrow('唯一')
    expect(()=>extractDraft(fenced({...draft,text:'# 缺少章节'}))).toThrow('缺少章节')
    expect(()=>extractDraft(fenced({...draft,unexpected:'field'}))).toThrow()
  })
  it('saves exactly the user-edited review and invalidates stale hashes and missing confirmation',async()=>{
    const h=await harness();const session=await create(h,'independent')
    const first=await prepare(h,session.sessionId)
    expect(h.service.runtime.library.list()).toHaveLength(0)
    const edited={...draft,name:'我审核后的指针教练',text:draft.text+'\n用户确认：练习先提供提示。'}
    const second=await prepare(h,session.sessionId,edited)
    await expect(confirm(h,session.sessionId,first.review.hash)).rejects.toThrow('审核内容已变化')
    await expect(h.service.execute({action:'interview/confirm',sessionId:session.sessionId,expectedHash:second.review.hash})).rejects.toThrow()
    const results=await Promise.all([confirm(h,session.sessionId,second.review.hash),confirm(h,session.sessionId,second.review.hash)])
    expect(results[0].savedRoleId).toBe(results[1].savedRoleId)
    const role=await h.service.execute({action:'roles/read',roleId:results[0].savedRoleId})
    expect(role.name).toBe(edited.name);expect(role.text).toBe(edited.text);expect(role.inheritMode).toBe('independent')
    expect(h.service.runtime.library.list()).toHaveLength(1)
    expect(h.adapter.calls).toHaveLength(0)
  })
  it('cancels without registering a role and prevents further generation/review/confirmation',async()=>{
    const h=await harness();const session=await create(h)
    const reviewed=await prepare(h,session.sessionId)
    await h.service.execute({action:'interview/cancel',sessionId:session.sessionId})
    await expect(confirm(h,session.sessionId,reviewed.review.hash)).rejects.toThrow('访谈已经结束')
    await expect(prepare(h,session.sessionId)).rejects.toThrow('访谈已经结束')
    await send(h,session.sessionId)
    expect(h.adapter.calls).toHaveLength(0);expect(h.service.runtime.library.list()).toHaveLength(0)
  })
  it('restores the reviewed draft and mode after a complete host restart, then creates a real work session',async()=>{
    const h=await harness();const session=await create(h,'independent')
    const reviewed=await prepare(h,session.sessionId)
    await h.ctx.sessions.flush(h.ctx.agents.get(session.sessionId).session)
    await h.ctx.fiber.dispose();contexts.delete(h.ctx)
    const resumed=await harness(h.root)
    await resumed.ctx.agents.resume({resumeSessionId:SessionId(session.sessionId),agentOptions:{provider:'mock',model:'unchanged-model'}})
    const state=await resumed.service.execute({action:'interview/status',sessionId:session.sessionId})
    expect(state.loaded).toBe(true);expect(state.inheritMode).toBe('independent');expect(state.review.hash).toBe(reviewed.review.hash)
    const saved=await confirm(resumed,session.sessionId,state.review.hash)
    const work=await resumed.service.execute({action:'create',sourceSessionId:session.sessionId,roleId:saved.savedRoleId,runMode:'work'})
    await send(resumed,work.sessionId,'解释指针解引用')
    expect(resumed.adapter.calls).toHaveLength(1)
    const prompt=JSON.stringify(resumed.adapter.calls[0].messages)
    expect(prompt).toContain(draft.text.split('\n')[0]);expect(prompt).toContain('独立领域规范（提示词层）')
    expect(prompt).not.toContain('WORK_MODES_INTERVIEW:')
    expect((await resumed.service.execute({action:'status',sessionId:work.sessionId})).inheritMode).toBe('independent')
  })
  it('retries a role metadata failure without publishing an unconfirmed draft',async()=>{
    const h=await harness();const session=await create(h);const review=await prepare(h,session.sessionId)
    const library=h.service.runtime.library;const table=library.table
    library.table={get:id=>table.get(id),entries:()=>table.entries(),put:async()=>{throw new Error('role disk full')}}
    await expect(confirm(h,session.sessionId,review.review.hash)).rejects.toThrow('role disk full')
    expect(library.list()).toHaveLength(0)
    library.table=table
    await confirm(h,session.sessionId,review.review.hash)
    expect(library.list()).toHaveLength(1)
  })
  it('does not duplicate a role if recording completion fails after publication',async()=>{
    const h=await harness();const session=await create(h);const review=await prepare(h,session.sessionId)
    const interviews=h.service.interviews;const table=interviews.table
    interviews.table={get:id=>table.get(id),entries:()=>table.entries(),put:async(id,value)=>{
      if(value.lifecycle==='saved')throw new Error('interview disk full');return table.put(id,value)
    }}
    await expect(confirm(h,session.sessionId,review.review.hash)).rejects.toThrow('interview disk full')
    expect(h.service.runtime.library.list()).toHaveLength(1)
    await expect(h.service.execute({action:'interview/cancel',sessionId:session.sessionId})).rejects.toThrow('已确认发布')
    await expect(prepare(h,session.sessionId,{...draft,name:'不应覆盖的草稿'})).rejects.toThrow('已确认发布')
    interviews.table=table
    const saved=await confirm(h,session.sessionId,review.review.hash)
    expect(saved.savedRoleId).toBe(review.review.targetRoleId);expect(h.service.runtime.library.list()).toHaveLength(1)
  })
  it('publishes a new version for mode changes and keeps old work bindings and copied modes',async()=>{
    const h=await harness()
    const role=await h.service.execute({action:'roles/create',...draft,inheritMode:'independent'})
    const old=await h.service.execute({action:'create',sourceSessionId:h.source.id,roleId:role.roleId,runMode:'work'})
    const changed=await h.service.execute({action:'roles/save',roleId:role.roleId,expectedRevision:role.revision,...draft,inheritMode:'inherit'})
    expect(changed.version).toBe(2);expect(changed.hash).toBe(role.hash)
    await send(h,old.sessionId)
    expect((await h.service.execute({action:'status',sessionId:old.sessionId})).inheritMode).toBe('independent')
    const copy=await h.service.execute({action:'roles/copy',roleId:role.roleId,version:1,name:'模式副本'})
    expect(copy.inheritMode).toBe('independent')
    const legacySave=await h.service.execute({action:'roles/save',roleId:copy.roleId,expectedRevision:copy.revision,...draft,name:'旧客户端编辑'})
    expect(legacySave.inheritMode).toBe('independent')
  })
  it('finishes a published review after the user edits and archives its role without reverting those changes',async()=>{
    const h=await harness();const session=await create(h);const review=await prepare(h,session.sessionId)
    const interviews=h.service.interviews;const table=interviews.table
    interviews.table={get:id=>table.get(id),entries:()=>table.entries(),put:async(id,value)=>{
      if(value.lifecycle==='saved')throw new Error('completion write failed');return table.put(id,value)
    }}
    await expect(confirm(h,session.sessionId,review.review.hash)).rejects.toThrow('completion write failed')
    const roleId=review.review.targetRoleId
    const v2=await h.service.execute({action:'roles/save',roleId,expectedRevision:1,...draft,text:draft.text+'\n后续人工补充。'})
    await h.service.execute({action:'roles/archive',roleId,expectedRevision:v2.revision,archived:true})
    interviews.table=table
    const saved=await confirm(h,session.sessionId,review.review.hash)
    expect(saved.lifecycle).toBe('saved');expect(saved.savedRoleId).toBe(roleId)
    const current=await h.service.execute({action:'roles/read',roleId})
    expect(current.archived).toBe(true);expect(current.version).toBe(2);expect(current.text).toBe(v2.text)
    expect(h.service.runtime.library.list(true)).toHaveLength(1)
    expect((await h.service.execute({action:'roles/read',roleId,version:1})).text).toBe(draft.text)
    await expect(h.service.runtime.library.create({...draft,text:draft.text+'\n不同的审核正文。'},roleId)).rejects.toThrow('内容不同')
  })
  it('refuses template-load failures, foreign sessions, mode changes and absent request markers',async()=>{
    const h=await harness();const session=await create(h)
    await expect(h.service.execute({action:'interview/extract',sessionId:h.source.id})).rejects.toThrow('访谈记录不存在')
    await expect(prepare(h,session.sessionId,{...draft,inheritMode:'independent'})).rejects.toThrow('访谈模式已固定')
    expect(()=>h.service.interviews.observeRequest({sessionId:session.sessionId,messages:[]},()=>{throw new Error('must not forward')})).toThrow('缺少正确模板')
    h.service.interviews.template=async()=>{throw new Error('template changed')}
    await send(h,session.sessionId)
    expect(h.adapter.calls).toHaveLength(0)
    expect((await h.service.execute({action:'interview/status',sessionId:session.sessionId})).error).toBe('template changed')
  })
  it('unloads interview contexts without removing native contexts or durable drafts',async()=>{
    const h=await harness();const session=await create(h)
    const agent=h.ctx.agents.get(session.sessionId)
    const reviewed=await prepare(h,session.sessionId)
    expect(JSON.stringify(await h.ctx.systemPrompt.assemble({scope:agent}))).toContain('WORK_MODES_INTERVIEW:')
    await h.plugin.dispose()
    const prompt=JSON.stringify(await h.ctx.systemPrompt.assemble({scope:agent}))
    expect(prompt).not.toContain('WORK_MODES_INTERVIEW:');expect(prompt).toContain('UNCHANGED_BASE_PROMPT')
    await h.ctx.plugin(WorkModesProbe,{libraryRoot:path.join(h.root,'role-library')})
    expect((await h.ctx.workModesProbe.execute({action:'interview/status',sessionId:session.sessionId})).review.hash).toBe(reviewed.review.hash)
  })
})

describe('user-managed role categories and search',()=>{
  const fields={name:'C 指针学习教练',description:'模拟地址与内存，也讲解 Python 对象',text:'# 指针教练\n\n## 角色定位\n解释指针。\n\n## 适用目标\n学习地址。\n\n## 工作流程\n先模拟再练习。\n\n## 行为边界\n不猜测。\n\n## 输出要求\n给出关键状态。'}
  const create=(h,categories)=>h.service.execute({action:'roles/create',...fields,...(categories===undefined?{}:{categories})})
  const categorize=(h,role,categories)=>h.service.execute({action:'roles/categories',roleId:role.roleId,expectedRevision:role.revision,categories})
  const review=(h,id,categories)=>h.service.execute({action:'interview/review',sessionId:id,...fields,categories})
  const confirm=(h,id,hash)=>h.service.execute({action:'interview/confirm',sessionId:id,expectedHash:hash,confirmed:true})

  it('defaults to uncategorized, accepts multiple user categories and rejects unsupported values',async()=>{
    const h=await harness()
    expect((await create(h)).categories).toEqual([])
    const role=await create(h,['learning','work','learning'])
    expect(role.categories).toEqual(['work','learning'])
    expect((await h.service.execute({action:'catalog'})).roles.find(item=>item.roleId===role.roleId).categories).toEqual(['work','learning'])
    await expect(create(h,['unknown'])).rejects.toThrow()
    await expect(create(h,'work')).rejects.toThrow()
    await expect(h.service.execute({action:'roles/categories',roleId:'default',expectedRevision:0,categories:['work']})).rejects.toThrow('不是角色卡')
    expect(h.adapter.calls).toHaveLength(0)
  })

  it('changes or clears categories without changing a role version, file, locked binding or loaded prompt',async()=>{
    const h=await harness();const role=await create(h,['learning'])
    const session=await h.service.execute({action:'create',sourceSessionId:h.source.id,roleId:role.roleId})
    await h.service.execute({action:'probe',sessionId:session.sessionId})
    const agent=h.ctx.agents.get(session.sessionId)
    const prompt=JSON.stringify(await h.ctx.systemPrompt.assemble({scope:agent}))
    const binding=h.service.runtime.getBinding(session.sessionId)
    const changed=await categorize(h,role,['work','research'])
    expect(changed.version).toBe(1);expect(changed.versions).toHaveLength(1)
    expect(changed.revision).toBe(role.revision+1);expect(changed.file).toBe(role.file);expect(changed.hash).toBe(role.hash)
    expect(await readFile(role.file,'utf8')).toBe(fields.text)
    expect(h.service.runtime.getBinding(session.sessionId)).toEqual(binding)
    expect(JSON.stringify(await h.ctx.systemPrompt.assemble({scope:agent}))).toBe(prompt)
    const cleared=await categorize(h,changed,[])
    expect(cleared.categories).toEqual([]);expect(cleared.version).toBe(1)
    expect((await categorize(h,cleared,[])).revision).toBe(cleared.revision)
    expect((await h.service.execute({action:'probe',sessionId:session.sessionId})).diagnostic.roleCorrect).toBe(true)
    expect((await h.service.execute({action:'status',sessionId:session.sessionId})).categories).toEqual([])
  })

  it('supports category-only saves and preserves categories when an older client saves a new content version',async()=>{
    const h=await harness();const role=await create(h,['learning'])
    const changed=await h.service.execute({action:'roles/save',roleId:role.roleId,expectedRevision:role.revision,...fields,categories:['daily']})
    expect(changed.version).toBe(1);expect(changed.revision).toBe(2)
    const v2=await h.service.execute({action:'roles/save',roleId:role.roleId,expectedRevision:changed.revision,...fields,text:fields.text+'\n增加练习。'})
    expect(v2.version).toBe(2);expect(v2.categories).toEqual(['daily'])
    const historical=await h.service.execute({action:'roles/read',roleId:role.roleId,version:1})
    expect(historical.text).toBe(fields.text);expect(historical.categories).toEqual(['daily'])
    expect((await h.service.execute({action:'roles/copy',roleId:role.roleId,version:1,name:'历史正文副本'})).categories).toEqual(['daily'])
  })

  it('protects category writes from stale edits and leaves memory unchanged when persistence fails',async()=>{
    const h=await harness();const role=await create(h)
    const results=await Promise.allSettled([categorize(h,role,['work']),categorize(h,role,['learning'])])
    expect(results.filter(item=>item.status==='fulfilled')).toHaveLength(1)
    expect(results.find(item=>item.status==='rejected').reason.message).toContain('重新加载')
    const current=await h.service.execute({action:'roles/read',roleId:role.roleId})
    await expect(h.service.execute({action:'roles/save',roleId:role.roleId,expectedRevision:role.revision,...fields,text:fields.text+'\n过期修改。'})).rejects.toThrow('重新加载')
    const library=h.service.runtime.library,table=library.table
    library.table={get:id=>table.get(id),entries:()=>table.entries(),put:async()=>{throw new Error('category disk full')}}
    await expect(categorize(h,current,['daily'])).rejects.toThrow('category disk full')
    expect(library.get(role.roleId).categories).toEqual(['work'])
    library.table=table
    expect((await categorize(h,current,['daily'])).categories).toEqual(['daily'])
  })

  it('lets users recategorize builtin cards, persists across restart and keeps their readonly content intact',async()=>{
    const h=await harness();const original=await h.service.execute({action:'roles/read',roleId:'starter-debug'})
    expect(original.categories).toEqual([])
    const changed=await categorize(h,original,['work','learning'])
    expect(changed.text).toBe(original.text);expect(changed.hash).toBe(original.hash);expect(changed.version).toBe(1)
    await expect(categorize(h,original,['daily'])).rejects.toThrow('重新加载')
    await h.ctx.fiber.dispose();contexts.delete(h.ctx)
    const resumed=await harness(h.root)
    const restored=await resumed.service.execute({action:'roles/read',roleId:'starter-debug'})
    expect(restored.categories).toEqual(['work','learning']);expect(restored.revision).toBe(changed.revision)
    expect(restored.sources).toEqual(original.sources);expect(restored.text).toBe(original.text)
    expect((await resumed.service.execute({action:'roles/copy',roleId:restored.roleId,name:'分类副本'})).categories).toEqual(['work','learning'])
    expect((await categorize(resumed,restored,[])).categories).toEqual([])
  })

  it('preserves categories through archive, category adjustment while archived, restart and restore',async()=>{
    const h=await harness();const role=await create(h,['research'])
    const archived=await h.service.execute({action:'roles/archive',roleId:role.roleId,expectedRevision:role.revision,archived:true})
    const changed=await categorize(h,archived,['daily','learning'])
    expect((await h.service.execute({action:'catalog'})).roles.some(item=>item.roleId===role.roleId)).toBe(false)
    await h.ctx.fiber.dispose();contexts.delete(h.ctx)
    const resumed=await harness(h.root)
    const restored=await resumed.service.execute({action:'roles/archive',roleId:role.roleId,expectedRevision:changed.revision,archived:false})
    expect(restored.categories).toEqual(['learning','daily']);expect(restored.version).toBe(1)
    expect((await resumed.service.execute({action:'catalog'})).roles.find(item=>item.roleId===role.roleId).categories).toEqual(['learning','daily'])
  })

  it('opens a real legacy v1 domain without categories or a builtin category table',async()=>{
    const root=await directory(),seed=new Context();contexts.add(seed)
    await seed.plugin(Storage);await seed.plugin(StorageJson,{root:path.join(root,'storage')});await seed.plugin(StorageDomain,{backend:'json'})
    const spec=StorageDomain.defineDomain({name:'work_modes_roles',version:1,tables:{roles:StorageDomain.domainTable(roleRecordSchema.omit({categories:true}))}})
    const domain=await seed.storageDomain.open(spec)
    const roleId='card-11111111-1111-4111-8111-111111111111',hash=sha256(fields.text),now=Date.now()
    const file=path.join(root,'role-library',roleId,`v1-${hash}`,'AGENTS.md')
    await mkdir(path.dirname(file),{recursive:true});await writeFile(file,fields.text)
    await domain.table('roles').put(roleId,{roleId,revision:1,archived:false,createdAt:now,updatedAt:now,versions:[{version:1,name:fields.name,description:fields.description,hash,inheritMode:'inherit',createdAt:now}]})
    await domain.close();await seed.fiber.dispose();contexts.delete(seed)
    const h=await harness(root)
    const old=await h.service.execute({action:'roles/read',roleId})
    expect(old.categories).toEqual([]);expect(old.text).toBe(fields.text)
    expect((await categorize(h,old,['learning'])).version).toBe(1)
    const builtin=await h.service.execute({action:'roles/read',roleId:'starter-learning'})
    expect((await categorize(h,builtin,['learning'])).categories).toEqual(['learning'])
  })

  it('combines category and name/description searches and keeps default mode outside uncategorized cards',()=>{
    const roles=[
      {roleId:'coach',...fields,categories:['learning','research']},
      {roleId:'editor',name:'文稿编辑',description:'修改说明',categories:['work']},
      {roleId:'plain',name:'未决定用途',description:'',categories:[]},
      {roleId:'legacy',name:'旧卡',description:''},
      {roleId:'default',name:'DSH 默认状态'},
    ]
    expect(roles.filter(role=>matchesRole(role,'  PYTHON  ','learning')).map(role=>role.roleId)).toEqual(['coach'])
    expect(roles.filter(role=>matchesRole(role,'指针','work'))).toEqual([])
    expect(roles.filter(role=>matchesRole(role,'','uncategorized')).map(role=>role.roleId)).toEqual(['plain','legacy'])
    expect(roles.filter(role=>matchesRole(role)).map(role=>role.roleId)).toContain('default')
    expect(categoryLabel([])).toBe('未归类角色卡')
  })

  it('includes user categories in review confirmation, restores them and rejects a stale review hash',async()=>{
    const h=await harness()
    const session=await h.service.execute({action:'interview/create',sourceSessionId:h.source.id,need:'设计学习教练',inheritMode:'inherit'})
    const first=await review(h,session.sessionId,['learning'])
    const second=await review(h,session.sessionId,['research','learning'])
    expect(second.review.hash).not.toBe(first.review.hash)
    expect(h.service.runtime.library.list()).toHaveLength(0)
    await expect(confirm(h,session.sessionId,first.review.hash)).rejects.toThrow('审核内容已变化')
    await h.ctx.fiber.dispose();contexts.delete(h.ctx)
    const resumed=await harness(h.root)
    const state=await resumed.service.execute({action:'interview/status',sessionId:session.sessionId})
    expect(state.review.categories).toEqual(['research','learning']);expect(state.review.hash).toBe(second.review.hash)
    const saved=await confirm(resumed,session.sessionId,state.review.hash)
    expect((await resumed.service.execute({action:'roles/read',roleId:saved.savedRoleId})).categories).toEqual(['research','learning'])
    expect(resumed.adapter.calls).toHaveLength(0)
  })

  it('confirms a legacy review with its original hash and treats its absent categories as uncategorized',async()=>{
    const h=await harness()
    const session=await h.service.execute({action:'interview/create',sourceSessionId:h.source.id,need:'旧审核记录兼容',inheritMode:'inherit'})
    await review(h,session.sessionId,['learning'])
    const record=h.service.interviews.get(session.sessionId)
    const {categories,...oldReview}=record.review
    oldReview.hash=sha256({...fields,inheritMode:'inherit'})
    await h.service.interviews.table.put(session.sessionId,{...record,review:oldReview})
    const saved=await confirm(h,session.sessionId,oldReview.hash)
    expect((await h.service.execute({action:'roles/read',roleId:saved.savedRoleId})).categories).toEqual([])
  })

  it('retries a published review without reverting categories edited after publication',async()=>{
    const h=await harness()
    const session=await h.service.execute({action:'interview/create',sourceSessionId:h.source.id,need:'分类失败恢复',inheritMode:'inherit'})
    const prepared=await review(h,session.sessionId,['learning'])
    const interviews=h.service.interviews,table=interviews.table
    interviews.table={get:id=>table.get(id),entries:()=>table.entries(),put:async(id,value)=>{
      if(value.lifecycle==='saved')throw new Error('completion write failed');return table.put(id,value)
    }}
    await expect(confirm(h,session.sessionId,prepared.review.hash)).rejects.toThrow('completion write failed')
    const published=await h.service.execute({action:'roles/read',roleId:prepared.review.targetRoleId})
    const changed=await categorize(h,published,['work'])
    await h.service.execute({action:'roles/archive',roleId:changed.roleId,expectedRevision:changed.revision,archived:true})
    interviews.table=table
    const saved=await confirm(h,session.sessionId,prepared.review.hash)
    const current=await h.service.execute({action:'roles/read',roleId:saved.savedRoleId})
    expect(current.categories).toEqual(['work']);expect(current.archived).toBe(true);expect(current.version).toBe(1)
    expect(h.service.runtime.library.list(true)).toHaveLength(1)
  })
})
