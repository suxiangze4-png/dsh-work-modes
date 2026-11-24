import React from 'react'
import { ROLE_CATEGORIES, orderedCategories, categoryLabel } from './categories.js'
const h = React.createElement

export const categoryCss = `.wm-categories{border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:7px;padding:10px 12px;margin:12px 0;min-width:0}.wm-categories legend{font-size:13px;font-weight:600;padding:0 4px}.wm-categories .wm-category-options{display:flex;flex-wrap:wrap;gap:8px 16px}.wm-categories label{display:inline-flex!important;align-items:center;gap:7px;min-height:36px;font-size:13px;font-weight:400;cursor:pointer}.wm-categories input[type=checkbox]{width:17px!important;height:17px;min-height:0!important;margin:0!important;padding:0!important;accent-color:Highlight}.wm-categories p{margin:6px 0 0;font-size:12px}.wm-category-summary{display:block;font-size:12px;overflow-wrap:anywhere}.wm-role-filters{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:10px}.wm-role-filters label{display:grid;gap:4px;font-size:13px}.wm-role-filters input{font:inherit;min-height:40px;box-sizing:border-box;max-width:100%;border:1px solid currentColor;border-radius:7px;padding:6px 10px;background:Canvas;color:CanvasText}.wm-role-filters input:focus-visible{outline:2px solid Highlight;outline-offset:3px}`

export function CategoryChoices({ value = [], onChange, disabled = false }) {
  return h('fieldset', { className: 'wm-categories', disabled },
    h('legend', null, '角色分类（可多选）'),
    h('div', { className: 'wm-category-options' }, ...ROLE_CATEGORIES.map(item => h('label', { key: item.id },
      h('input', { type: 'checkbox', checked: value.includes(item.id), onChange: event => onChange(orderedCategories(event.target.checked ? [...value, item.id] : value.filter(id => id !== item.id))) }), item.label))),
    h('p', null, value.length ? `已选：${categoryLabel(value)}。取消勾选即可撤销分类。` : '未选择分类，保存后放入“未归类角色卡”。'))
}

export function CategoryFilter({ value, onChange, disabled = false, label = '角色分类筛选' }) {
  return h('select', { value, disabled, onChange: event => onChange(event.target.value), 'aria-label': label },
    h('option', { value: 'all' }, '全部分类'),
    ...ROLE_CATEGORIES.map(item => h('option', { key: item.id, value: item.id }, item.label)),
    h('option', { value: 'uncategorized' }, '未归类角色卡'))
}
