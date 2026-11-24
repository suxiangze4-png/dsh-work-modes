import { z } from 'zod'
import { STARTER_ROLES } from './builtin-roles.js'
import { ROLE_CATEGORIES, orderedCategories } from './categories.js'

export const PACKAGE = 'dsh-work-modes-probe'
export const customRoleIdSchema = z.string().regex(/^card-[a-f0-9-]{36}$/)
export const roleIdSchema = z.union([z.enum(['role-a', 'role-b', 'default', ...STARTER_ROLES.map(role => role.roleId)]), customRoleIdSchema])
export const runModeSchema = z.enum(['probe', 'work'])
export const inheritModeSchema = z.enum(['inherit', 'independent'])
export const categoriesSchema = z.array(z.enum(ROLE_CATEGORIES.map(item => item.id))).max(4).transform(orderedCategories)
const categoryRoleIdSchema = roleIdSchema.refine(id => id !== 'default', 'DSH 默认状态不是角色卡，不能设置分类')
export const roleFields = {
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240),
  text: z.string().max(65536).refine(text => text.trim().length > 0, '角色正文不能为空'),
  inheritMode: inheritModeSchema.optional(),
}
export const requestSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('catalog') }),
  z.strictObject({ action: z.literal('create'), sourceSessionId: z.string().min(1), roleId: roleIdSchema, runMode: runModeSchema.default('probe') }),
  z.strictObject({ action: z.literal('status'), sessionId: z.string().min(1) }),
  z.strictObject({ action: z.literal('bind'), sessionId: z.string().min(1), roleId: roleIdSchema }),
  z.strictObject({ action: z.literal('probe'), sessionId: z.string().min(1) }),
  z.strictObject({ action: z.literal('roles/list'), includeArchived: z.boolean().optional() }),
  z.strictObject({ action: z.literal('roles/read'), roleId: roleIdSchema, version: z.number().int().positive().optional() }),
  z.strictObject({ action: z.literal('roles/create'), ...roleFields, categories: categoriesSchema.optional() }),
  z.strictObject({ action: z.literal('roles/save'), roleId: customRoleIdSchema, expectedRevision: z.number().int().positive(), ...roleFields, categories: categoriesSchema.optional() }),
  z.strictObject({ action: z.literal('roles/categories'), roleId: categoryRoleIdSchema, expectedRevision: z.number().int().nonnegative(), categories: categoriesSchema }),
  z.strictObject({ action: z.literal('roles/copy'), roleId: roleIdSchema, version: z.number().int().positive().optional(), name: roleFields.name }),
  z.strictObject({ action: z.literal('roles/archive'), roleId: customRoleIdSchema, expectedRevision: z.number().int().positive(), archived: z.boolean() }),
  z.strictObject({ action: z.literal('interview/create'), sourceSessionId: z.string().min(1), need: z.string().trim().min(1).max(2000), inheritMode: inheritModeSchema }),
  z.strictObject({ action: z.literal('interview/list') }),
  z.strictObject({ action: z.literal('interview/status'), sessionId: z.string().min(1) }),
  z.strictObject({ action: z.literal('interview/start'), sessionId: z.string().min(1) }),
  z.strictObject({ action: z.literal('interview/extract'), sessionId: z.string().min(1) }),
  z.strictObject({ action: z.literal('interview/review'), sessionId: z.string().min(1), ...roleFields, categories: categoriesSchema.optional(), sourceMessageId: z.string().nullable().optional() }),
  z.strictObject({ action: z.literal('interview/confirm'), sessionId: z.string().min(1), expectedHash: z.string().regex(/^[a-f0-9]{64}$/), confirmed: z.literal(true) }),
  z.strictObject({ action: z.literal('interview/cancel'), sessionId: z.string().min(1) }),
])
const codec = (schema, name) => ({ mode: 'strict', typeSymbol: `${PACKAGE}#${name}`, create: () => schema })
// 使用公开 Typert 描述符合同；Host/Client 共用相同、可验证的 wire schema。
export const remoteContribution = {
  package: PACKAGE,
  descriptors: [{
    id: `${PACKAGE}#workModesProbe/execute`, service: 'workModesProbe', namespace: 'workModesProbe', method: 'execute',
    invocation: { kind: 'direct' },
    parameters: [{ name: 'request', wire: 'request', source: 'json', codec: codec(requestSchema, 'Request'), strictCodec: codec(requestSchema, 'Request') }],
    result: codec(z.json(), 'Result'),
  }],
}
export const bindingSchema = z.strictObject({
  sessionId: z.string(), roleId: roleIdSchema, version: z.number().int().positive(), hash: z.string(),
  state: z.enum(['preparing', 'ready']), createdAt: z.number(),
  // 旧客户端和历史绑定缺少此字段时，继续使用本地探针，不能自动放行真实请求。
  runMode: runModeSchema.default('probe'),
  inheritMode: inheritModeSchema.default('inherit'),
})
export const roleVersionSchema = z.strictObject({
  version: z.number().int().positive(), name: roleFields.name, description: roleFields.description,
  hash: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.number(),
  inheritMode: inheritModeSchema.default('inherit'),
})
export const roleRecordSchema = z.strictObject({
  roleId: customRoleIdSchema, revision: z.number().int().positive(), archived: z.boolean(),
  categories: categoriesSchema.default([]),
  versions: z.array(roleVersionSchema).min(1), createdAt: z.number(), updatedAt: z.number(),
})
export const builtinCategoriesSchema = z.strictObject({
  roleId: categoryRoleIdSchema.refine(id => !id.startsWith('card-')), categories: categoriesSchema,
  revision: z.number().int().positive(), updatedAt: z.number(),
})
export const draftPayloadSchema = z.strictObject({ name: roleFields.name, description: roleFields.description, text: roleFields.text })
export const interviewRecordSchema = z.strictObject({
  sessionId: z.string().regex(/^wm-interview-[a-f0-9-]{36}$/), need: z.string().min(1).max(2000), inheritMode: inheritModeSchema,
  templateVersion: z.literal(1), templateHash: z.string().regex(/^[a-f0-9]{64}$/), state: z.enum(['preparing', 'ready']),
  lifecycle: z.enum(['active', 'cancelled', 'saved']), createdAt: z.number(), updatedAt: z.number(), startedAt: z.number().nullable(),
  review: z.strictObject({ ...roleFields, inheritMode: inheritModeSchema, categories: categoriesSchema.optional(), hash: z.string().regex(/^[a-f0-9]{64}$/),
    targetRoleId: customRoleIdSchema, sourceMessageId: z.string().nullable(), createdAt: z.number() }).nullable(),
  savedRoleId: customRoleIdSchema.optional(), savedDraftHash: z.string().optional(),
})
