import React from 'react'
import { categoryLabel } from './categories.js'
import { MODE_LABELS, MODE_LIMITATION } from './modes.js'

const h = React.createElement

export function InheritSwitch({ mode, disabled, onChange }) {
  const helpId = React.useId()
  const inherits = mode !== 'independent'
  return h('div', { className: 'wm-mode' },
    h('label', { className: 'wm-switch-label' },
      h('input', { type: 'checkbox', role: 'switch', className: 'wm-switch', checked: inherits, disabled,
        'aria-describedby': helpId, onChange: event => onChange(event.target.checked ? 'inherit' : 'independent') }),
      MODE_LABELS.inherit),
    h('p', { className: 'wm-subtext', id: helpId }, inherits
      ? '关闭后使用独立领域规范（提示词层）。'
      : `当前使用独立领域规范（提示词层）。${MODE_LIMITATION}`))
}

export function RoleCard({ role, selected, pinned, busy, archiveDisabled, onSelect, onPin, onArchive }) {
  const menu = React.useRef(null)
  const more = React.useRef(null)
  const menuId = React.useId()

  React.useEffect(() => {
    const popup = menu.current
    const button = more.current
    const syncExpanded = () => button.setAttribute('aria-expanded', String(popup.matches(':popover-open')))
    popup.addEventListener('toggle', syncExpanded)
    return () => popup.removeEventListener('toggle', syncExpanded)
  }, [])

  const openMenu = event => {
    event.preventDefault()
    if (busy) return
    const popup = menu.current
    const trigger = event.currentTarget
    const isContextMenu = event.type === 'contextmenu'
    if (popup.matches(':popover-open')) {
      popup.hidePopover()
      if (!isContextMenu) return
    }
    const anchor = trigger.getBoundingClientRect()
    const fromPointer = isContextMenu && event.button === 2
    const x = fromPointer ? event.clientX : anchor.left
    const y = fromPointer ? event.clientY : anchor.bottom + 4
    trigger.focus({ preventScroll: true })
    popup.showPopover()
    const { width, height } = popup.getBoundingClientRect()
    popup.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`
    popup.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`
    popup.querySelector('[role="menuitem"]').focus()
  }

  const navigateMenu = event => {
    const popup = menu.current
    if (event.key === 'Tab') {
      popup.hidePopover()
      return
    }
    const steps = { ArrowDown: 1, ArrowUp: -1, Home: 0, End: -1 }
    if (!Object.hasOwn(steps, event.key)) return
    event.preventDefault()
    const items = [...popup.querySelectorAll('button:not(:disabled)')]
    const index = ['Home', 'End'].includes(event.key) ? steps[event.key] : items.indexOf(event.target) + steps[event.key]
    items[(index + items.length) % items.length].focus()
  }

  const choose = action => {
    menu.current.hidePopover()
    action(role)
  }

  return h('li', { className: 'wm-role-row' },
    h('button', { className: 'role-item', disabled: busy, 'aria-pressed': selected, onClick: onSelect, onContextMenu: openMenu },
      h('span', { className: 'wm-role-detail' }, h('strong', null, role.name), pinned && h('small', { className: 'wm-pin' }, '置顶')),
      role.description && h('small', { className: 'wm-role-description' }, role.description),
      h('span', { className: 'wm-role-detail' },
        h('small', null, categoryLabel(role.categories)),
        h('small', null, role.builtin ? '内置模板' : `v${role.version}`),
        h('small', null, `${role.references} 个会话绑定`),
        role.archived && h('small', null, '已归档'))),
    h('button', { ref: more, className: 'wm-role-more', type: 'button', disabled: busy, title: '角色卡操作',
      'aria-label': `${role.name} 操作`, 'aria-haspopup': 'menu', 'aria-controls': menuId, 'aria-expanded': false, onClick: openMenu }, '⋯'),
    h('div', { ref: menu, id: menuId, className: 'wm-role-menu', popover: 'auto', role: 'menu',
      'aria-label': `${role.name} 操作`, onKeyDown: navigateMenu },
      h('button', { role: 'menuitem', tabIndex: -1, onClick: () => choose(onPin) }, pinned ? '取消置顶' : '置顶'),
      !role.builtin && h('button', { role: 'menuitem', tabIndex: -1, disabled: archiveDisabled,
        className: role.archived ? undefined : 'wm-danger', onClick: () => choose(onArchive) },
        role.archived ? '恢复角色' : '删除（可恢复）')))
}
