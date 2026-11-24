# 默认角色来源与第三方声明

4 张默认角色均为适配 DSH 与本项目目标的中文改编；学习教练主要借鉴解释与测验结构，教学流程为本项目补充。未直接照搬完整英文角色，未引入特定模型、工具、团队、固定执行环境或隐藏推理要求。

| 默认角色 | 原始文本 |
|---|---|
| 代码排错顾问 | [Fabric / review_code](https://github.com/danielmiessler/Fabric/blob/59eadf341daf75aaefdb16000305c958b6c33093/data/patterns/review_code/system.md) |
| 代码阅读与学习教练 | [Fabric / explain_code](https://github.com/danielmiessler/Fabric/blob/59eadf341daf75aaefdb16000305c958b6c33093/data/patterns/explain_code/system.md)、[create_quiz](https://github.com/danielmiessler/Fabric/blob/59eadf341daf75aaefdb16000305c958b6c33093/data/patterns/create_quiz/system.md) |
| 资料研究与证据分析员 | [agency-agents / research-synthesist](https://github.com/msitarzewski/agency-agents/blob/b37b5bb33b78f2c1d6567d98e25ca818e3259219/research/research-synthesist.md) |
| 文稿结构与表达编辑 | [Fabric / improve_writing](https://github.com/danielmiessler/Fabric/blob/59eadf341daf75aaefdb16000305c958b6c33093/data/patterns/improve_writing/system.md) |

## Fabric

仓库：danielmiessler/Fabric；固定版本：`59eadf341daf75aaefdb16000305c958b6c33093`。实际 [LICENSE](https://github.com/danielmiessler/Fabric/blob/59eadf341daf75aaefdb16000305c958b6c33093/LICENSE) 为 MIT，版权行按源文件原样保留：`Copyright (c) 2012-2024 Scott Chacon and others`。

完整许可文本：[licenses/Fabric-MIT.txt](licenses/Fabric-MIT.txt)。对应角色的 AGENTS.md 末尾也以 Markdown 注释附完整许可，复制和导出时随正文保留。

## agency-agents

仓库：msitarzewski/agency-agents；固定版本：`b37b5bb33b78f2c1d6567d98e25ca818e3259219`。实际 [LICENSE](https://github.com/msitarzewski/agency-agents/blob/b37b5bb33b78f2c1d6567d98e25ca818e3259219/LICENSE) 为 MIT，版权行：`Copyright (c) 2025 AgentLand Contributors`。

完整许可文本：[licenses/agency-agents-MIT.txt](licenses/agency-agents-MIT.txt)，并附于研究角色 AGENTS.md。

## 改编范围

- 排错角色增加触发条件、最小修改及验证边界，避免把风格偏好当作缺陷。
- 学习角色按用户目标解释执行过程，使用提示和小练习；不以学历推定能力，不强制用户走问答流程。
- 研究角色保留原始来源、独立证据、争议与缺口；不承诺不存在的数据库、联网、团队或持久记忆能力。
- 编辑角色保留作者原意及事实，按要求调整修改幅度；不伪造事实，也不自动发送或发布。

原作者与项目名称仅用于来源归属，不表示其参与或认可本插件。A/B 为此前本项目自写测试模板，默认角色列表中隐藏，历史会话保持兼容。
