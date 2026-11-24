import React from 'react'
import { InterviewBuilder } from './interview-ui.js'
import { sameCategories, categoryLabel, matchesRole } from './categories.js'
import { CategoryChoices, CategoryFilter, categoryCss } from './category-ui.js'
import { InheritSwitch, RoleCard } from './role-controls.js'
import { browserPreference } from './ui-preferences.js'
import { themeLabels, uiCss } from './ui-theme.js'
import { libraryCss } from './role-manager-styles.js'
const h = React.createElement
const DESCRIPTION_LIMIT = 240
const pinsKey = 'work-modes-pinned-roles'
const emptyDraft = () => ({ name: '', description: '', text: '', inheritMode: 'inherit', categories: [] })
const panelCss = uiCss + libraryCss + categoryCss

export function RoleLibraryIcon() {
  return h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
    h('path', { d: 'M5 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3V5a1 1 0 0 1 1-1Zm-1 13a3 3 0 0 1 3-3h12M8 8h7', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }))
}

export function RoleManager({ call, changed, memory, openSession, subscribeNavigation, themePreference }) {
  const theme = React.useSyncExternalStore(themePreference.subscribe, themePreference.get)
  const [showInterview, setShowInterview] = React.useState(memory.interviewOpen ?? false)
  const [roles, setRoles] = React.useState([])
  const [root, setRoot] = React.useState('')
  const [selected, setSelected] = React.useState(() => memory.current?.selected ?? null)
  const [draft, setDraft] = React.useState(() => memory.current?.draft ?? emptyDraft())
  const [query, setQuery] = React.useState(() => memory.current?.query ?? '')
  const [filter, setFilter] = React.useState(() => memory.current?.filter ?? 'active')
  const [category, setCategory] = React.useState(() => memory.current?.category ?? 'all')
  const [pinned, setPinned] = React.useState(() => memory.pinnedRoles ?? (browserPreference(pinsKey) ?? '').split('\n').filter(Boolean))
  const [showTests, setShowTests] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [message, setMessage] = React.useState('')
  const [error, setError] = React.useState('')
  const [pending, setPending] = React.useState(null)
  const dialog = React.useRef(null)
  const importInput = React.useRef(null)
  const editorTitle = React.useRef(null)
  const descriptionId = React.useId()
  const bodyId = React.useId()
  const running = React.useRef(false)
  const mounted = React.useRef(true)
  const contentDirty = selected ? ['name', 'description', 'text', 'inheritMode'].some(key => draft[key] !== selected[key])
    : draft.name !== '' || draft.description !== '' || draft.text !== '' || draft.inheritMode !== 'inherit'
  const categoryDirty = !sameCategories(draft.categories, selected?.categories)
  const dirty = contentDirty || categoryDirty
  const historical = selected && selected.version !== selected.latestVersion
  const readOnly = selected?.builtin || selected?.archived || historical
  const references = roles.find(role => role.roleId === selected?.roleId)?.references ?? selected?.references ?? 0
  const descriptionAtLimit = draft.description.length >= DESCRIPTION_LIMIT
  // 切换 DSH 面板时保留草稿；重启仍由 beforeunload 提醒用户先保存。
  React.useEffect(() => { memory.current = { selected, draft, query, filter, category } }, [selected, draft, query, filter, category, memory])
  React.useEffect(() => subscribeNavigation(() => setShowInterview(memory.interviewOpen ?? false)), [subscribeNavigation])
  React.useEffect(() => { if (pending) dialog.current.showModal() }, [pending])
  const loadList = async () => {
    const result = await call({ action: 'roles/list', includeArchived: true })
    if (mounted.current) { setRoles(result.roles); setRoot(result.libraryRoot) }
  }
  const loadRole = async (roleId, version) => {
    const role = await call({ action: 'roles/read', roleId, ...(version ? { version } : {}) })
    if (mounted.current) { setSelected(role); setDraft({ name: role.name, description: role.description, text: role.text, inheritMode: role.inheritMode ?? 'inherit', categories: role.categories ?? [] }) }
  }
  // UI 请求在此统一展示错误；失败时不清空用户草稿。
  const run = async operation => {
    if (running.current) return
    running.current = true; setBusy(true); setError(''); setMessage('')
    try { await operation() }
    catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { running.current = false; if (mounted.current) setBusy(false) }
  }
  React.useEffect(() => {
    mounted.current = true
    void run(loadList)
    return () => { mounted.current = false }
  }, [call])
  React.useEffect(() => {
    const guard = event => { if (dirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty])
  const navigate = operation => {
    if (dirty) setPending({ label: '当前草稿尚未保存。继续操作会放弃草稿。', operation })
    else void run(operation)
  }
  const newDraft = () => {
    setSelected(null)
    setDraft(emptyDraft())
    editorTitle.current?.focus()
  }
  const update = key => event => setDraft(current => ({ ...current, [key]: event.target.value }))
  const save = () => run(async () => {
    const categoriesOnly = selected && !contentDirty
    const request = categoriesOnly ? { action: 'roles/categories', roleId: selected.roleId, expectedRevision: selected.revision, categories: draft.categories }
      : selected ? { action: 'roles/save', roleId: selected.roleId, expectedRevision: selected.revision, ...draft }
      : { action: 'roles/create', ...draft }
    const role = await call(request)
    changed(); await loadList(); await loadRole(role.roleId, categoriesOnly && historical ? selected.version : undefined)
    setMessage(categoriesOnly ? `已更新分类：${categoryLabel(role.categories)}。工作规范版本不变。`
      : `已保存 ${role.name} v${role.version}，已有会话保留原版本。`)
  })
  const copy = () => run(async () => {
    const role = await call({ action: 'roles/copy', roleId: selected.roleId, version: selected.version, name: `${selected.name.slice(0, 75)} 副本` })
    changed(); await loadList(); await loadRole(role.roleId)
    setMessage('已复制为独立的新角色。')
  })
  const archive = role => {
    const { roleId, revision, name } = role
    const archived = !role.archived
    const count = roles.find(item => item.roleId === roleId)?.references ?? role.references ?? 0
    setPending({
      label: archived
        ? `将“${name}”移到「已归档」。可随时恢复，${count} 个绑定和全部历史版本会保留。`
        : `恢复“${name}”后，这张角色卡可再次用于新会话。`,
      operation: async () => {
        await call({ action: 'roles/archive', roleId, expectedRevision: revision, archived })
        changed()
        await loadList()
        if (selected?.roleId === roleId) await loadRole(roleId)
        setMessage(archived ? `已归档“${name}”，历史会话仍可使用原版本。` : `已恢复“${name}”，可用于新会话。`)
      },
    })
  }
  const togglePin = ({ roleId }) => {
    const next = pinned.includes(roleId) ? pinned.filter(id => id !== roleId) : [...pinned, roleId]
    memory.pinnedRoles = next
    browserPreference(pinsKey, next.join('\n'))
    setPinned(next)
  }
  const importFile = event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    navigate(async () => {
      if (file.size > 65536) throw new Error('文件超过 64 KiB，请精简后导入')
      const text = await file.text()
      setSelected(null); setDraft({ name: file.name === 'AGENTS.md' ? '导入的角色' : file.name.replace(/\.md$/i, '').slice(0, 80), description: '', text, inheritMode: 'inherit', categories: [] })
      editorTitle.current?.focus()
      setMessage('已导入为草稿，审核后点击保存。')
    })
  }
  const exportFile = () => {
    const url = URL.createObjectURL(new Blob([draft.text], { type: 'text/markdown;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url; link.download = 'AGENTS.md'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setMessage(dirty ? '已导出当前未保存草稿。' : '已导出当前版本 AGENTS.md。')
  }
  const visible = roles.filter(role => (showTests || !role.testing) && (filter === 'all' || (filter === 'archived' ? role.archived : !role.archived))
    && matchesRole(role, query, category))
    .sort((left, right) => pinned.indexOf(right.roleId) - pinned.indexOf(left.roleId))
  const hasFilters = query || filter !== 'active' || category !== 'all' || showTests
  const clearFilters = () => { setQuery(''); setFilter('active'); setCategory('all'); setShowTests(false) }
  const closePrompt = () => { dialog.current.close(); setPending(null) }
  if (showInterview) return h(React.Fragment, null, h('style', null, panelCss),
    h(InterviewBuilder, { call, changed, memory, openSession, subscribeNavigation, theme,
      onBack: () => { memory.interviewOpen = false; setShowInterview(false); void run(loadList) } }))
  return h('section', { className: 'wm-ui wm-library', 'data-wm-theme': theme, 'aria-label': 'Work Modes 角色库' },
    h('style', null, panelCss),
    h('header', null, h('div', null, h('h1', null, '角色库'), h('p', { className: 'wm-subtext' }, '管理工作规范。新会话使用最新版，历史会话保留原版。')),
      h('div', { className: 'toolbar' },
        h('button', { className: 'primary', disabled: busy, onClick: () => navigate(newDraft) }, '新建角色'),
        h('button', { disabled: busy, onClick: () => { memory.interviewOpen = true; setShowInterview(true) } }, 'AI 辅助建卡'),
        h('button', { disabled: busy, onClick: () => importInput.current.click() }, '导入 Markdown'),
        h('input', { ref: importInput, className: 'wm-import-input', type: 'file', accept: '.md,text/markdown,text/plain', disabled: busy, onChange: importFile }),
        h('button', { disabled: busy, onClick: () => run(loadList) }, '刷新列表'),
        h('select', { value: theme, onChange: event => themePreference.set(event.target.value), 'aria-label': 'Work Modes 主题' },
          ...Object.entries(themeLabels).map(([value, label]) => h('option', { key: value, value }, label))))),
    pending && h('dialog', { ref: dialog, className: 'prompt', 'aria-label': '确认角色操作',
      onCancel: event => { event.preventDefault(); closePrompt() } },
      h('p', null, pending.label),
      h('div', { className: 'toolbar' },
        h('button', { onClick: closePrompt }, '取消'),
        h('button', { className: 'primary', onClick: () => { closePrompt(); void run(pending.operation) } }, '确认继续'))),
    h('div', { className: 'layout' },
      h('aside', { 'aria-label': '角色列表' },
        h('div', { className: 'toolbar' }, h('h2', null, '角色列表'), h('small', { role: 'status' }, `${visible.length} 张`)),
        h('div', { className: 'wm-filters' },
          h('label', { className: 'wm-field' }, '搜索角色',
            h('input', { type: 'search', value: query, onChange: event => setQuery(event.target.value), placeholder: '输入名称或说明' })),
          h('div', { className: 'wm-filter-row' },
            h('select', { value: filter, onChange: event => setFilter(event.target.value), 'aria-label': '角色状态筛选' },
              h('option', { value: 'active' }, '可用角色'), h('option', { value: 'archived' }, '已归档'), h('option', { value: 'all' }, '全部角色')),
            h(CategoryFilter, { value: category, onChange: setCategory, disabled: busy })),
          h('div', { className: 'toolbar' },
            h('label', { className: 'wm-switch-label' },
              h('input', { type: 'checkbox', role: 'switch', className: 'wm-switch', checked: showTests, disabled: busy,
                onChange: event => setShowTests(event.target.checked) }), '显示 A/B 测试模板'),
            hasFilters && h('button', { disabled: busy, onClick: clearFilters }, '清空筛选'))),
        h('ul', { className: 'wm-role-list' }, ...visible.map(role => h(RoleCard, {
          key: role.roleId,
          role,
          selected: selected?.roleId === role.roleId,
          pinned: pinned.includes(role.roleId),
          busy,
          archiveDisabled: selected?.roleId === role.roleId && dirty,
          onSelect: () => navigate(async () => { await loadRole(role.roleId); editorTitle.current?.focus() }),
          onPin: togglePin,
          onArchive: archive,
        }))),
        visible.length === 0 && h('p', { className: 'empty' },
          busy && !roles.length ? '正在读取角色…' : '没有符合条件的角色。可修改搜索词或清空筛选。')),
      h('div', { className: 'editor' },
        h('div', { className: 'toolbar' }, h('h2', { ref: editorTitle, tabIndex: -1 }, selected ? selected.name : '新角色草稿'),
          selected && h('select', { value: selected.version, disabled: busy, onChange: event => navigate(() => loadRole(selected.roleId, Number(event.target.value))), 'aria-label': '查看角色版本' },
            ...selected.versions.slice().reverse().map(version => h('option', { key: version.version, value: version.version }, `v${version.version}${version.version === selected.latestVersion ? '（最新版）' : '（历史版本）'}`))),
          dirty && h('small', null, '有未保存的修改')),
        selected && h('div', { className: 'meta' }, h('span', null, `${references} 个会话绑定`), h('span', null, selected.builtin ? '内置只读模板' : selected.archived ? '已归档' : historical ? '历史版本只读' : '自定义角色')),
        selected?.sources?.length > 0 && h('p', null, '参考来源：', ...selected.sources.map((url, index) =>
          h('a', { key: url, href: url, target: '_blank', rel: 'noreferrer', style: { marginRight: 12 } }, `原始文本 ${index + 1}`))),
        h(InheritSwitch, { mode: draft.inheritMode, disabled: busy || readOnly,
          onChange: inheritMode => setDraft(current => ({ ...current, inheritMode })) }),
        h('div', { className: 'fields' },
          h('label', null, '角色名称', h('input', { value: draft.name, onChange: update('name'), maxLength: 80, readOnly, disabled: busy, placeholder: '例如：Python 代码审查员' })),
          h('div', { className: 'wm-field' },
            h('label', { htmlFor: descriptionId }, '简短说明'),
            h('input', { id: descriptionId, value: draft.description, onChange: update('description'), maxLength: DESCRIPTION_LIMIT,
              readOnly, disabled: busy, 'aria-describedby': `${descriptionId}-help`, placeholder: '例如：检查代码中的边界条件' }),
            h('div', { id: `${descriptionId}-help`, className: 'wm-field-help wm-subtext' },
              h('span', null, '可选，用一句话说明用途。'),
              h('span', { className: descriptionAtLimit ? 'at-limit' : undefined },
                `${draft.description.length} / ${DESCRIPTION_LIMIT}`),
              descriptionAtLimit && h('span', { className: 'at-limit', role: 'status' }, '已达上限，超出的粘贴内容会被截断。'))),
          h('div', { className: 'wm-field' },
            h('label', { htmlFor: bodyId }, 'AGENTS.md 工作规范'),
            h('textarea', { id: bodyId, value: draft.text, onChange: update('text'), maxLength: 65536,
              readOnly, disabled: busy, spellCheck: false, 'aria-describedby': `${bodyId}-help`, placeholder: '在这里粘贴整段 Markdown' }),
            h('p', { id: `${bodyId}-help`, className: 'wm-subtext' }, '这里接收完整 Markdown，可保留标题、列表和代码块。'))),
        h(CategoryChoices, { value: draft.categories, disabled: busy, onChange: categories => setDraft(current => ({ ...current, categories })) }),
        selected && h('p', { className: 'wm-subtext' }, '仅调整分类会保留工作规范版本。'),
        h('div', { className: 'toolbar wm-actions' },
          h('div', { className: 'toolbar' },
            h('button', { className: 'primary', disabled: busy || (readOnly && contentDirty) || !draft.name.trim() || !draft.text.trim() || !dirty, onClick: save }, busy ? '处理中…' : selected ? contentDirty ? '保存新版本' : '保存分类' : '保存角色'),
            selected && h('button', { disabled: busy || dirty, onClick: copy }, '复制为新角色'),
            h('button', { disabled: busy || !draft.text.trim(), onClick: exportFile }, '导出 AGENTS.md'),
            selected && h('button', { disabled: busy, onClick: () => navigate(() => loadRole(selected.roleId)) }, '重新加载最新版')),
          selected && !selected.builtin && h('button', { className: selected.archived ? undefined : 'wm-danger',
            disabled: busy || dirty, onClick: () => archive(selected) }, selected.archived ? '恢复角色' : '归档角色')),
        error && h('p', { className: 'notice error', role: 'alert' }, error),
        message && h('p', { className: 'notice', role: 'status' }, message),
        h('p', { className: 'wm-subtext' }, '保存角色只写入角色库。Markdown 导入默认使用继承通用规范模式。'),
        h('details', null, h('summary', null, '存储与版本信息'), h('p', { className: 'storage' }, root),
          selected && h('p', { className: 'storage' }, `${selected.roleId} / v${selected.version} / SHA-256: ${selected.hash}`)))))
}
