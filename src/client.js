import React from 'react'
import { remoteContribution } from './contracts.js'
import { RoleManager, RoleLibraryIcon } from './role-manager.js'
import { MODE_LABELS, MODE_LIMITATION } from './modes.js'
import { matchesRole } from './categories.js'
import { CategoryFilter, categoryCss } from './category-ui.js'
import { createThemePreference, uiCss } from './ui-theme.js'
const h = React.createElement
const css = `
.wm-entry .wm-toggle-row { display: flex; justify-content: flex-end; margin: 2px 0; }
.wm-entry .wm-toggle {
  position: relative; display: inline-flex; align-items: center; justify-content: center;
  width: 34px; min-height: 30px; padding: 0; border: 1px solid transparent;
  border-radius: 6px; background-color: transparent;
}
.wm-entry .wm-error-badge {
  position: absolute; right: 0; top: 0; min-width: 13px; height: 13px; border-radius: 50%;
  background: #a52824; color: #fff; font: 700 10px/13px sans-serif; text-align: center;
}
.wm-entry .wm-sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden;
  clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}
.wm-entry [hidden] { display: none !important; }
.wm-probe {
  font: inherit; font-size: 13px; line-height: 1.5; border: 1px solid var(--wm-line);
  border-radius: 12px; padding: 14px; margin: 8px 0; background: var(--wm-bg);
}
.wm-probe h3 { margin: 0; font-size: 15px; }
.wm-probe p { margin: 6px 0; }
.wm-probe .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.wm-probe .wm-role-filters input { background: var(--wm-bg); color: var(--wm-text); border-color: var(--wm-control-line); }
.wm-probe dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 12px; font-size: 12px; }
.wm-probe dt { font-weight: 600; }
.wm-probe dd { margin: 0; overflow-wrap: anywhere; }
.wm-probe .error { border-left: 3px solid var(--wm-danger); padding-left: 9px; }
.wm-probe .tag { font-size: 12px; border: 1px solid var(--wm-line); border-radius: 5px; padding: 1px 6px; }
.wm-probe details { font-size: 12px; margin-top: 10px; }
.wm-probe summary { cursor: pointer; min-height: 32px; }
.wm-probe .lead { display: flex; justify-content: space-between; gap: 8px; align-items: center; flex-wrap: wrap; }
`

function ProbeCard(props) {
  const theme = React.useSyncExternalStore(props.themePreference.subscribe, props.themePreference.get)
  const [roleId, setRoleId] = React.useState('starter-debug')
  const [runMode, setRunMode] = React.useState('work')
  const [query, setQuery] = React.useState('')
  const [category, setCategory] = React.useState('all')
  const [catalog, setCatalog] = React.useState(null)
  const [status, setStatus] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const generation = React.useRef(0)
  const sessionId = props.sessionId
  const [disclosure, setDisclosure] = React.useState({sessionId, expanded:false})
  const expanded = disclosure.sessionId === sessionId && disclosure.expanded
  const panelId = `wm-options-${sessionId}`
  React.useEffect(() => { props.rememberSource(sessionId) }, [sessionId, props.rememberSource])
  React.useEffect(() => {
    const current = ++generation.current
    let active = true
    let initialized = false
    setStatus(null); setError(''); setBusy(false)
    setDisclosure({sessionId, expanded:false})
    setQuery(''); setCategory('all')
    const refresh = async () => {
      try {
        const value = await props.call({action:'status',sessionId})
        if (active && generation.current === current) {
          setStatus(value)
          if (!initialized) { initialized = true; setRoleId(value.managed ? value.roleId : 'starter-debug') }
        }
      } catch (e) { if (active) setError(e.message) }
    }
    const refreshCatalog = () => props.call({action:'catalog'}).then(value=>{if(active)setCatalog(value)}).catch(e=>{if(active)setError(e.message)})
    void refreshCatalog()
    const unsubscribe = props.subscribeCatalog(refreshCatalog)
    void refresh()
    const timer = setInterval(refresh, 2000)
    return () => { active = false; clearInterval(timer); unsubscribe() }
  }, [sessionId, props.call])
  const run = async action => {
    setBusy(true); setError('')
    const current = generation.current
    try {
      const value = await action()
      if (generation.current === current && value) setStatus(value)
    } catch (e) { if(generation.current===current)setError(e.message || String(e)) }
    finally { if(generation.current===current)setBusy(false) }
  }
  const diagnostic = status?.diagnostic
  const managed = status?.managed === true
  const roles = [...(catalog?.roles ?? [])].filter(role => !role.testing || runMode === 'probe' || role.roleId === status?.roleId)
  if (managed && !roles.some(role => role.roleId === status.roleId)) roles.push({roleId:status.roleId,name:status.roleName,categories:status.categories ?? [],available:false,historicalOnly:true,version:status.version})
  const visibleRoles = roles.filter(role => matchesRole(role, query, category))
  const visibleSelection = visibleRoles.some(role => role.roleId === roleId)
  const selectable = visibleRoles.some(role => role.roleId === roleId && role.available)
  const displayError = disclosure.sessionId === sessionId ? error || status?.error : ''
  const toggleLabel = `${expanded?'收起':'展开'} Work Modes 角色选项${displayError?'：有错误，请查看':''}`
  if (status?.interview) return h('section', { className: 'wm-ui wm-entry', 'data-wm-theme': theme, 'aria-label': 'Work Modes 角色访谈入口' },
    h('style', null, categoryCss + uiCss + css),
    h('div', { className: 'wm-probe', hidden: !expanded, id: panelId },
      h('h3', null, 'Work Modes · AI 角色访谈'),
      h('p', null, `模式：${MODE_LABELS[status.inheritMode]} · ${status.lifecycle === 'active' ? status.started ? '访谈已开始' : '待开始' : status.lifecycle === 'saved' ? '角色已保存' : '已结束，未保存'}`),
      h('p', null, status.need), h('p', null, MODE_LIMITATION),
      h('div', { className: 'row' },
        status.lifecycle === 'active' && !status.started && h('button', { disabled: busy || !status.loaded || !!status.error || status.publicationPending,
          onClick: () => run(() => props.call({ action: 'interview/start', sessionId })) }, '开始访谈（调用模型）'),
        h('button', { disabled: busy, onClick: () => props.openInterview(sessionId) }, '审核角色草稿')),
      status.diagnostic && h('p', null, status.diagnostic.interviewCorrect ? '访谈模板检查通过；调用结果以对话为准。' : '访谈模板检查失败'),
      status.publicationPending && h('p', null, '角色已确认发布，请返回审核面板完成保存状态。'),
      (error || status.error) && h('p', { role: 'alert' }, error || status.error)),
    h('div', { className: 'wm-toggle-row' }, h('button', { className: 'wm-toggle', type: 'button', title: toggleLabel,
      'aria-label': toggleLabel, 'aria-expanded': expanded, 'aria-controls': panelId,
      onClick: () => setDisclosure({ sessionId, expanded: !expanded }) },
      h('svg',{width:18,height:18,viewBox:'0 0 24 24',fill:'none','aria-hidden':true},
        h('path',{d:expanded?'M6 9l6 6 6-6':'M6 15l6-6 6 6',stroke:'currentColor',strokeWidth:1.8,strokeLinecap:'round',strokeLinejoin:'round'})))))
  return h('section', {className:'wm-ui wm-entry','data-wm-theme':theme,'aria-label':'Work Modes 角色入口'},
    h('style', null, categoryCss + uiCss + css),
    h('div', {className:'wm-probe',id:panelId,hidden:!expanded,'aria-label':'Work Modes 角色选项'},
    h('div',{className:'lead'},h('h3',null,'Work Modes · 专业角色'),h('span',{className:'tag'},managed ? status.localOnly?'本地验证 · 不调用模型':'正常工作 · 调用宿主模型' : '选择角色，创建新会话')),
    h('p',null,managed ? status.localOnly ? '此测试会话的消息会得到本地模拟回复，用于检查请求材料。' : '角色规范已绑定；直接在下方输入任务，使用 DSH 正常模型流程。' : '沿用来源会话的工作目录和 Preset 新建空白会话；输入任务后才开始工作。'),
    h('div', { className: 'wm-role-filters' },
      h('label', null, '搜索新会话角色', h('input', { type: 'search', value: query, disabled: busy, placeholder: '输入名称或说明', onChange: event => setQuery(event.target.value) })),
      h('label', null, '筛选分类', h(CategoryFilter, { value: category, onChange: setCategory, disabled: busy, label: '新会话角色分类筛选' })),
      (query || category !== 'all') && h('button', { disabled: busy, onClick: () => { setQuery(''); setCategory('all') } }, '清空筛选')),
    h('div',{className:'row'},
      h('label',{htmlFor:`wm-mode-${sessionId}`},'新会话用途'),
      h('select',{id:`wm-mode-${sessionId}`,value:runMode,disabled:busy,onChange:e=>setRunMode(e.target.value)},
        h('option',{value:'work'},'正常工作（调用模型）'),h('option',{value:'probe'},'本地验证（模拟回复）')),
      h('label',{htmlFor:`wm-role-${sessionId}`},'新会话角色'),
      h('select',{id:`wm-role-${sessionId}`,value:visibleSelection ? roleId : '',disabled:busy,onChange:e=>setRoleId(e.target.value)},
        h('option', { value: '', disabled: true }, visibleRoles.length ? '请选择符合条件的角色' : '没有符合条件的角色'),
        ...visibleRoles.map(role=>h('option',{key:role.roleId,value:role.roleId,disabled:!role.available},`${role.name} / v${role.version}${role.available?'':role.historicalOnly?'（仅供原会话）':'（不可用）'}`))),
      h('button',{className:'primary',disabled:busy||!selectable,onClick:()=>run(async()=>{const value=await props.call({action:'create',sourceSessionId:sessionId,roleId,runMode});props.open(value.sessionId);return null})},busy?'处理中…':runMode==='work'?'新建工作会话':'新建测试会话'),
      h('button',{disabled:busy,onClick:props.openManager},'管理角色卡'),
      managed && h('button',{disabled:busy||!selectable||status.locked!==false,onClick:()=>run(()=>props.call({action:'bind',sessionId,roleId}))},'应用到当前空白会话'),
      managed && status.runMode==='probe' && h('button',{disabled:busy||!status.loaded||!!status.error,onClick:()=>run(()=>props.call({action:'probe',sessionId}))},diagnostic?'再次本地检查':status.locked?'检查恢复后的请求':'检查第一次请求')),
    !visibleRoles.length && h('p', { role: 'status' }, '没有符合条件的角色，请修改搜索词或清空筛选。'),
    h('div',{'aria-live':'polite'},
      error && h('p',{className:'error',role:'alert'},error),
      status?.error && h('p',{className:'error',role:'alert'},status.error),
      managed && h('dl',null,
        h('dt',null,'会话用途'),h('dd',null,status.localOnly?'本地验证（模拟回复）':'正常工作（宿主模型）'),
        h('dt',null,'当前角色'),h('dd',null,`${status.roleName} / v${status.version}`),
        h('dt',null,'规范模式'),h('dd',null,MODE_LABELS[status.inheritMode ?? 'inherit']),
        h('dt',null,'会话状态'),h('dd',null,status.locked?'已开始工作，角色已锁定':status.loaded?'已加载，尚未开始工作':'加载中或恢复失败'),
        h('dt',null,'请求检查'),h('dd',null,diagnostic?(diagnostic.roleCorrect?'角色标记正确':'检查失败'):'尚未到达模型发送边界'),
        diagnostic && !status.localOnly && h('dt',null,'检查范围'),
        diagnostic && !status.localOnly && h('dd',null,'仅检查请求材料；模型是否调用成功以对话结果为准。'))),
    managed && h('details',null,h('summary',null,'查看诊断详情'),h('dl',null,
      h('dt',null,'Session ID'),h('dd',null,sessionId),
      h('dt',null,'角色文件 SHA-256'),h('dd',null,status.hash),
      ...(diagnostic ? [
        h('dt',{key:'n1'},'请求序号'),h('dd',{key:'n2'},diagnostic.requestNumber),
        h('dt',{key:'m1'},'模型 / Provider'),h('dd',{key:'m2'},`${diagnostic.model} / ${diagnostic.provider}`),
        h('dt',{key:'t1'},'工具数量 / SHA-256'),h('dd',{key:'t2'},`${diagnostic.toolCount} / ${diagnostic.toolsHash}`),
        h('dt',{key:'p1'},'Preset'),h('dd',{key:'p2'},diagnostic.preset ?? '无'),
        h('dt',{key:'c1'},'工作目录'),h('dd',{key:'c2'},diagnostic.cwd),
        h('dt',{key:'v1'},'角色 A / B 标记'),h('dd',{key:'v2'},`${diagnostic.present['role-a']?'有':'无'} / ${diagnostic.present['role-b']?'有':'无'}`),
        h('dt',{key:'r1'},'绑定版本检查'),h('dd',{key:'r2'},`${diagnostic.boundRole?.roleId ?? status.roleId} / v${diagnostic.boundRole?.version ?? status.version}`),
      ]:[]))),
    ),
    h('div',{className:'wm-toggle-row'},h('button',{
      className:'wm-toggle',type:'button','aria-label':toggleLabel,title:toggleLabel,
      'aria-expanded':expanded,'aria-controls':panelId,
      onClick:()=>setDisclosure({sessionId,expanded:!expanded}),
    },h('svg',{width:18,height:18,viewBox:'0 0 24 24',fill:'none','aria-hidden':true},
      h('path',{d:expanded?'M6 9l6 6 6-6':'M6 15l6-6 6 6',stroke:'currentColor',strokeWidth:1.8,strokeLinecap:'round',strokeLinejoin:'round'})),
      displayError && h('span',{className:'wm-error-badge','aria-hidden':true},'!'))),
    h('span',{className:'wm-sr-only',role:'status','aria-live':'polite'},displayError ? `Work Modes 角色状态异常：${displayError}。展开角色选项查看详情。` : ''),
  )
}

export const inject = ['slots','remote']
export function apply(ctx) {
  ctx.remote.$mount(remoteContribution)
  ctx.inject(['remote.workModesProbe','uiWorkspace','layout'], child => {
    const listeners = new Set()
    const navigation = new Set()
    const memory = { current: null }
    const themePreference = createThemePreference()
    const subscribeNavigation = listener => { navigation.add(listener); return () => navigation.delete(listener) }
    const openInterview = sessionId => {
      memory.interviewSessionId = sessionId; memory.interviewOpen = true
      for (const listener of navigation) listener()
      child.layout.selectPanel('work-modes-roles')
    }
    const rememberSource = id => { memory.sourceSessionId = id }
    const subscribeCatalog = listener => { listeners.add(listener); return () => listeners.delete(listener) }
    const changed = () => { for (const listener of listeners) void listener() }
    const call = async request => {
      const result = await child.remote.workModesProbe.execute(request)
      if (!result.ok) throw new Error(result.error.message || '角色请求失败')
      return result.value
    }
    child.slots.inject('conversation.input.dock', () => child.slots.register({
      name:'conversation.input.dock', id:'work-modes-probe', order:10,
      inject: () => ({call,open:id=>child.uiWorkspace.openSession(id),themePreference,subscribeCatalog,rememberSource,openInterview,openManager:()=>{memory.interviewOpen=false;for(const listener of navigation)listener();child.layout.selectPanel('work-modes-roles')}}),
    },ProbeCard))
    child.slots.inject('main', () => child.slots.register({ name:'main', key:'work-modes-roles', inject:()=>({call,changed,memory,themePreference,openSession:id=>child.uiWorkspace.openSession(id),subscribeNavigation}) }, RoleManager))
    child.slots.inject('sidebar.panellist', () => child.slots.register({ name:'sidebar.panellist', id:'work-modes-roles', order:20, label:()=> '角色库' }, RoleLibraryIcon))
  })
}
