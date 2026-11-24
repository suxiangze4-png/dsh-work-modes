export function runtimeContextText(messages) {
  // 来源字段由宿主提供。只取最新快照，正文以实际请求内容为准。
  const snapshot = messages.findLast(message => message.role === 'user' && message.source?.kind === 'runtime-context')
  return snapshot?.content.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? ''
}
