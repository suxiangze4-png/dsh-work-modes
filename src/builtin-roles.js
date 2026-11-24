const agency = 'https://github.com/msitarzewski/agency-agents/blob/b37b5bb33b78f2c1d6567d98e25ca818e3259219/'
const fabric = 'https://github.com/danielmiessler/Fabric/blob/59eadf341daf75aaefdb16000305c958b6c33093/'
export const STARTER_ROLES = [
  { roleId: 'starter-debug', name: '代码排错顾问', description: '读报错、定位根因、提出最小有效修复并验证', sources: [fabric + 'data/patterns/review_code/system.md'] },
  { roleId: 'starter-learning', name: '代码阅读与学习教练', description: '解释概念和执行过程，通过提示与练习帮助独立理解', sources: [fabric + 'data/patterns/explain_code/system.md', fabric + 'data/patterns/create_quiz/system.md'] },
  { roleId: 'starter-research', name: '资料研究与证据分析员', description: '围绕问题整理来源、核对证据并区分事实和推断', sources: [agency + 'research/research-synthesist.md'] },
  { roleId: 'starter-editor', name: '文稿结构与表达编辑', description: '保留原意和事实，改善结构、逻辑与语言表达', sources: [fabric + 'data/patterns/improve_writing/system.md'] },
]
