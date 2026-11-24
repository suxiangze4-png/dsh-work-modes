import React from 'react'
import { MODE_LABELS } from './modes.js'
import { sameCategories, categoryLabel } from './categories.js'
import { CategoryChoices } from './category-ui.js'
import { InheritSwitch } from './role-controls.js'
const h = React.createElement
const blank = () => ({ name: '', description: '', text: '', sourceMessageId: null, categories: [] })
const lifecycleLabel = { active: '进行中', saved: '已保存', cancelled: '已结束，未保存' }

export function InterviewBuilder({ call, changed, memory, openSession, subscribeNavigation, onBack, theme }) {
  const [need, setNeed] = React.useState(memory.interviewNeed ?? '')
  const [mode, setMode] = React.useState(memory.interviewMode ?? 'inherit')
  const [id, setId] = React.useState(memory.interviewSessionId ?? '')
  const [items, setItems] = React.useState([])
  const [view, setView] = React.useState(null)
  const [draft, setDraft] = React.useState(() => memory.interviewDrafts?.[memory.interviewSessionId] ?? blank())
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [message, setMessage] = React.useState('')
  const [replaceDraft, setReplaceDraft] = React.useState(false)
  const generation = React.useRef(0)
  const mounted = React.useRef(true)
  const running = React.useRef(false)
  const initialized = React.useRef('')
  const active = view?.lifecycle === 'active'
  const reviewMatches = !!view?.review && ['name', 'description', 'text'].every(key =>
    (key === 'text' ? draft[key] : draft[key].trim()) === view.review[key]) && sameCategories(draft.categories, view.review.categories)
  const refreshList = async () => { const value = await call({ action: 'interview/list' }); if (mounted.current) setItems(value.interviews) }
  React.useEffect(() => {
    memory.interviewNeed = need; memory.interviewMode = mode; memory.interviewSessionId = id
    if (id) { memory.interviewDrafts ??= {}; memory.interviewDrafts[id] = draft }
  }, [need, mode, id, draft, memory])
  React.useEffect(() => {
    mounted.current = true
    void refreshList().catch(e => setError(e.message))
    return () => { mounted.current = false }
  }, [call])
  const select = value => {
    setId(value); setView(null); setDraft(memory.interviewDrafts?.[value] ?? blank()); setError(''); setMessage('')
    setReplaceDraft(false)
    initialized.current = ''; memory.interviewSessionId = value
  }
  React.useEffect(() => subscribeNavigation(() => select(memory.interviewSessionId ?? '')), [subscribeNavigation])
  React.useEffect(() => {
    const current = ++generation.current
    if (!id) return
    const refresh = async () => {
      try {
        const value = await call({ action: 'interview/status', sessionId: id })
        if (mounted.current && current === generation.current) {
          setView(value)
          if (initialized.current !== id) {
            initialized.current = id
            if (!memory.interviewDrafts?.[id]?.text && value.review) setDraft({ name: value.review.name, description: value.review.description, text: value.review.text, sourceMessageId: value.review.sourceMessageId, categories: value.review.categories ?? [] })
          }
        }
      } catch (failure) { if (mounted.current && current === generation.current) setError(failure.message) }
    }
    void refresh()
    const timer = setInterval(refresh, 2000)
    return () => { ++generation.current; clearInterval(timer) }
  }, [id, call])
  const run = async operation => {
    if (running.current) return
    running.current = true; setBusy(true); setError(''); setMessage('')
    try { await operation() }
    catch (failure) { if (mounted.current) setError(failure.message || String(failure)) }
    finally { running.current = false; if (mounted.current) setBusy(false) }
  }
  const create = () => run(async () => {
    if (!memory.sourceSessionId) throw new Error('请先打开一个正常 DSH 会话，再创建访谈')
    const value = await call({ action: 'interview/create', sourceSessionId: memory.sourceSessionId, need, inheritMode: mode })
    select(value.sessionId); setView(value); await refreshList()
    memory.interviewSessionId = value.sessionId; memory.interviewOpen = true
    openSession(value.sessionId)
  })
  const extract = () => run(async () => {
    const value = await call({ action: 'interview/extract', sessionId: id })
    // 分类由用户选择，重新提取 AI 正文时保留已有选择。
    setDraft(current => ({ name: value.name, description: value.description, text: value.text, sourceMessageId: value.sourceMessageId, categories: current.categories ?? [] }))
    setReplaceDraft(false)
    setMessage('已提取最新助手草稿。请检查专业定位、个人偏好、边界及输出要求，再准备审核。')
  })
  const prepare = () => run(async () => {
    const value = await call({ action: 'interview/review', sessionId: id, ...draft, inheritMode: view.inheritMode })
    setView(value)
    setMessage('审核内容已固定。确认名称、正文、分类和规范模式后，点击“确认保存此草稿”。修改任意内容后需重新准备审核。')
  })
  const confirm = () => run(async () => {
    const value = await call({ action: 'interview/confirm', sessionId: id, expectedHash: view.review.hash, confirmed: true })
    setView(value); changed(); await refreshList()
    setMessage(`已保存“${value.review.name}”v1。尚未创建工作会话或发送任务。`)
  })
  const cancel = () => run(async () => {
    const value = await call({ action: 'interview/cancel', sessionId: id })
    setView(value); await refreshList(); setMessage('访谈已结束，未注册角色。对话历史保留。')
  })
  const dirty = !!draft.text && active && !reviewMatches
  React.useEffect(() => {
    const guard = event => { if (dirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty])
  const update = key => event => setDraft(value => ({ ...value, [key]: event.target.value }))
  return h('section', { className: 'wm-ui wm-library wm-interview', 'data-wm-theme': theme, 'aria-label': 'AI 辅助建卡' },
    h('style', null, '.wm-interview{height:calc(100dvh - 24px);max-height:calc(100dvh - 24px)}'),
    h('style', null, '.wm-interview .need{min-height:100px}.wm-interview .split{display:grid;grid-template-columns:minmax(250px,340px) minmax(0,1fr);gap:24px;margin-top:20px}.wm-interview .fields{margin-top:10px}.wm-interview .preview{white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto;padding:12px;border:1px solid currentColor;border-radius:7px;font-size:13px}.wm-interview select{max-width:100%}.wm-interview .hash{overflow-wrap:anywhere;font-size:12px}@media(max-width:900px){.wm-interview .split{grid-template-columns:1fr}}'),
    h('header', null, h('div', null, h('h1', null, 'AI 辅助建卡'), h('p', null, '需求访谈 → 编辑草稿 → 审核确认 → 保存角色 → 新建工作会话')),
      h('button', { onClick: onBack, disabled: busy }, '返回角色库')),
    error && h('p', { className: 'notice error', role: 'alert' }, error),
    message && h('p', { className: 'notice', role: 'status' }, message),
    h('div', { className: 'split' },
      h('div', null, h('h2', null, '1. 创建角色需求访谈'),
        h(InheritSwitch, { mode, disabled: busy, onChange: setMode }),
        h('div', { className: 'fields' },
          h('label', null, '你想创建什么角色？', h('textarea', { className: 'need', value: need, maxLength: 2000, disabled: busy, onChange: e => setNeed(e.target.value), placeholder: '例如：设计一个适合我当前基础的 C 语言指针学习教练。' }))),
        h('button', { className: 'primary', disabled: busy || !need.trim(), onClick: create }, '创建访谈并打开（尚不调用模型）'),
        h('p', null, '打开后点击“开始访谈”，或在正常输入框提交需求，才会调用已配置的模型。访谈沿用原生用户和项目上下文，不复制来源聊天历史。'),
        h('h2', { style: { marginTop: 24 } }, '2. 选择已有访谈'),
        h('select', { value: id, disabled: busy, onChange: e => select(e.target.value), 'aria-label': '选择角色访谈' },
          h('option', { value: '' }, '请选择访谈'), id && !items.some(item => item.sessionId === id) && h('option', { value: id }, '正在加载所选访谈…'),
          ...items.map(item => h('option', { key: item.sessionId, value: item.sessionId }, `${lifecycleLabel[item.lifecycle]} · ${item.need.slice(0, 35)} · ${item.sessionId.slice(-6)}`))),
        view && h('div', null, h('p', null, `状态：${lifecycleLabel[view.lifecycle]}${view.running ? ' · 正在生成' : ''}`),
          h('p', null, `模式：${MODE_LABELS[view.inheritMode]}`), h('p', null, view.need),
          h('div', { className: 'toolbar' }, h('button', { disabled: busy, onClick: () => openSession(id) }, '打开访谈对话'),
            active && h('button', { disabled: busy || view.running || view.publicationPending, onClick: cancel }, '结束访谈（不保存）')))),
      h('div', null, h('h2', null, '3. 审核角色草稿'),
        !view ? h('p', null, id ? '正在加载所选访谈…' : '先创建或选择一个访谈。模型生成后可提取草稿，也可以手动粘贴。') : h(React.Fragment, null,
          view.error && h('p', { className: 'notice error', role: 'alert' }, view.error),
          view.publicationPending && h('p', { className: 'notice' }, '角色已确认发布，保存状态待完成。请重试确认，不会重复创建角色。'),
          active && h('button', { disabled: busy || view.running || view.publicationPending, onClick: () => draft.text ? setReplaceDraft(true) : extract() }, '提取最新助手草稿'),
          active && replaceDraft && h('div', { className: 'notice', role: 'alert' },
            h('p', null, '再次提取会替换编辑区的名称、说明和正文。是否保留当前修改？'),
            h('div', { className: 'toolbar' },
              h('button', { disabled: busy || view.running || view.publicationPending, onClick: extract }, '替换为最新助手草稿'),
              h('button', { disabled: busy, onClick: () => setReplaceDraft(false) }, '保留当前修改'))),
          h('p', null, '只有确认后的专业规范会进入角色库。请删除画像原文、具体任务和个人敏感信息，核对是否符合你的使用定位。'),
          h(CategoryChoices, { value: draft.categories, disabled: busy || !active || view.publicationPending, onChange: categories => setDraft(current => ({ ...current, categories })) }),
          h('div', { className: 'fields' },
            h('label', null, '角色名称', h('input', { value: draft.name, maxLength: 80, readOnly: !active || view.publicationPending, disabled: busy, onChange: update('name') })),
            h('label', null, '简短说明', h('input', { value: draft.description, maxLength: 240, readOnly: !active || view.publicationPending, disabled: busy, onChange: update('description') })),
            h('label', null, 'AGENTS.md 草稿（可编辑或粘贴）', h('textarea', { value: draft.text, maxLength: 65536, readOnly: !active || view.publicationPending, disabled: busy, onChange: update('text'), spellCheck: false }))),
          active && h('div', { className: 'toolbar' },
            h('button', { disabled: busy || view.running || view.publicationPending || !draft.name.trim() || !draft.text.trim(), onClick: prepare }, '准备审核'),
            h('button', { className: 'primary', disabled: busy || view.running || !reviewMatches, onClick: confirm }, '确认保存此草稿')),
          reviewMatches && h('div', { className: 'notice' }, h('p', null, `审核对象：${view.review.name} · ${MODE_LABELS[view.review.inheritMode]}`),
            h('p', null, `角色分类：${categoryLabel(view.review.categories)}`),
            h('p', { className: 'hash' }, `内容 SHA-256：${view.review.hash}`),
            h('details', null, h('summary', null, '查看待保存的完整正文'), h('pre', { className: 'preview' }, view.review.text))),
          view.lifecycle === 'saved' && h('button', { className: 'primary', disabled: busy, onClick: () => run(async () => {
            const value = await call({ action: 'create', sourceSessionId: id, roleId: view.savedRoleId, runMode: 'work' })
            openSession(value.sessionId)
          }) }, '用此角色新建工作会话')))))
}
