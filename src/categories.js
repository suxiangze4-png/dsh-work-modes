export const ROLE_CATEGORIES = [
  { id: 'work', label: '工作' },
  { id: 'research', label: '研究' },
  { id: 'learning', label: '学习' },
  { id: 'daily', label: '日常' },
]

export const orderedCategories = (values = []) => ROLE_CATEGORIES.filter(item => values.includes(item.id)).map(item => item.id)
export const sameCategories = (left, right) => JSON.stringify(orderedCategories(left)) === JSON.stringify(orderedCategories(right))
export const categoryLabel = (values = []) => ROLE_CATEGORIES.filter(item => values.includes(item.id)).map(item => item.label).join('、') || '未归类角色卡'

export function matchesRole(role, query = '', category = 'all') {
  const categories = role.categories ?? []
  const inCategory = category === 'all' || role.roleId !== 'default' && (category === 'uncategorized' ? categories.length === 0 : categories.includes(category))
  return inCategory && `${role.name} ${role.description ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
}
