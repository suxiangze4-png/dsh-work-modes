# 开发与验证说明

运行版本为 0.5.2。产品操作见[使用指南](USER_GUIDE.md)，安装包构建见[安装说明](INSTALLATION.md)。

## 请求与数据流

会话面板通过宿主 Remote 调用插件 Host。Host 校验请求、读取角色版本并创建会话绑定，在首次模型请求前加载角色规范。工作会话到达模型发送边界时，再校验实际请求中的角色 ID、版本和正文哈希，检查通过后交还宿主模型流程。

`runtime-context.js` 从宿主标记为 `runtime-context` 的 user-role 消息中取最新快照，读取实际内容块。普通用户发送的同文案、旧快照里的角色标记都无法替代当前快照。工作会话与 AI 访谈共用这段提取逻辑。

## 代码结构

| 文件 | 职责 |
|---|---|
| `src/index.js` | Cordis 生命周期、存储域与严格 Remote 入口 |
| `src/contracts.js` | 请求、绑定和版本元数据 Schema |
| `src/role-library.js` | Markdown 版本文件、发布、冲突与归档 |
| `src/runtime.js` | 工作/探针 Session 创建、绑定、恢复、作用域注入和请求分流 |
| `src/runtime-context.js` | 按宿主来源提取最新上下文快照，供工作会话与访谈共用 |
| `src/role-manager.js` | 独立管理面板、编辑、版本和文件导入导出 |
| `src/interview.js` / `src/interview-ui.js` | 访谈生命周期、草稿校验、审核确认与界面 |
| `src/modes.js` / `src/builtin-roles.js` | 模式策略与默认卡目录 |
| `src/categories.js` / `src/category-ui.js` | 四个固定分类、组合搜索、分类选择与筛选控件 |
| `templates/role-interview.md` | 固定 v1 访谈规范；已有访谈校验模板哈希 |
| `src/client.js` | 会话选择卡、面板和侧边栏 Slots 注册 |
| `tests/integration.test.ts` | 官方运行包及真实文件、存储的集成测试 |

异常处理集中在 UI 请求、I/O、生命周期和绑定回滚边界；参数及状态直接校验，不逐层捕获再重复抛出。

## 数据与版本

| 数据 | 保存方式 |
|---|---|
| Session → Role ID、版本、哈希、规范模式 | 官方 storageDomain，沿用 `work_modes_probe` 域 |
| 角色元数据、版本目录、归档状态、修订号 | 官方 storageDomain，新增 `work_modes_roles` 域 |
| 自定义正文 | `<libraryRoot>/<Role ID>/v<版本>-<SHA-256>/AGENTS.md` |
| 内置模板 | 包内 `roles/starter-*/AGENTS.md` 和兼容的 A/B 测试模板 |
| 访谈、模板哈希、审核对象和保存状态 | 官方 storageDomain，`work_modes_interviews` 域 |
| 请求诊断 | 内存，重启清空；角色绑定独立持久化 |

默认 libraryRoot 使用官方 `dshHomePath('work-modes', 'roles')`，位于 `DSH_HOME` 下的 `work-modes/roles`。可在“存储与版本信息”查看实际位置。元数据位置由 DSH storage-json 配置决定。

插件配置可以指定 libraryRoot；改路径不会迁移已有文件，不要直接改路径后继续使用历史会话。升级保留旧存储域，没有清空旧绑定。

多个 Session 共享同一版本文件，不按 Session 复制。发布先写带哈希的不可变文件，再提交元数据。提交失败的文件不会成为可用版本；重试不覆盖已有文件。读文件时校验 SHA-256，缺失或被外部修改会阻止相关请求，不会静默换角色。

并发保护针对同一 DSH Host 的多个请求/窗口：写入串行化并检查修订号。尚未实现多个独立 DSH 进程共用角色库的跨进程协调。卸载不自动删除用户角色或历史版本。

## 本地构建

```powershell
npm ci
npm run check
npm run build
```

源码语法检查覆盖 `src` 下的 JavaScript 文件。前端经 esbuild 生成 `dist/client.js`，React 和宿主模块由 DSH 提供。`dist` 由构建生成并被 Git 忽略。

官方模块由宿主通过 `peerDependencies` 提供。`optional` 元数据用于避免 npm 自动下载另一套核心，实际运行时仍需由宿主提供这些模块。

## 配置测试运行时

需要 Node.js ≥ 24.9.0。测试 DSH 0.2.3-alpha.2 时，使用 Node.js 24.22.3+（24.x）或 26.13.1+。

将 `DSH_TEST_RUNTIME` 指向一个含 `package.json`、`node_modules` 的官方运行目录，保持宿主包版本一致。测试使用该目录解析 `@deepseek-ai/*` 模块。

如果使用桌面安装包，可以用项目脚本从 `app.asar` 提取运行目录。以下路径均为示例，`app.asar.unpacked` 应与 `app.asar` 保持原来的相邻关系。

```powershell
node scripts/inspect-installed.mjs 'C:/test-dsh/resources/app.asar' 'C:/test-runtimes/extracted'
$env:DSH_TEST_RUNTIME = 'C:/test-runtimes/extracted/dsh'
npm test
```

脚本以只读方式读取原归档，向指定输出目录提取文件。手动准备 npm 运行环境时，要安装当前 Windows 平台所需的原生依赖，例如会话持久化使用的 Koffi 模块。

可选环境变量 `DSH_TEST_TMP` 用于指定测试临时目录。默认位置为系统临时目录下的 `dsh-work-modes-tests`，每个用例使用独立子目录，完成后清理。

```powershell
$env:DSH_TEST_TMP = 'C:/test-data/work-modes'
npm test
```

## 已有验证记录

以下为 **2026-11-24** 的 0.5.2 验证，四组测试分别加载对应官方运行包。测试模型为 Mock。

| DSH 版本 | 集成测试结果 | 覆盖说明 |
| --- | --- | --- |
| 0.2.1-rc.2 | 57 / 57 通过 | 旧基线回归 |
| 0.2.2-rc.1 | 57 / 57 通过 | 既有适配回归 |
| 0.2.2-rc.5 | 57 / 57 通过 | 新版请求上下文与持久化流程 |
| 0.2.3-alpha.2 | 57 / 57 通过 | Alpha 运行时与新版 Cordis |

用例覆盖角色加载、空白会话改选与锁定、普通会话透传、版本恢复、文件完整性、归档、并发修订冲突、存储提交失败、分类管理、AI 审核和发布后重试。

同日另在 Windows x64 官方 0.2.3-alpha.2 桌面中安装 0.5.2 包，在隔离配置验证了以下流程。

- 手动建卡、组合筛选、置顶、主题和窄窗口操作。
- 本地验证会话到达实际请求边界，角色标记和绑定版本检查通过。
- 保存 v2 后查看只读 v1，确认旧正文和原模式仍可读取。
- AI 访谈、草稿提取、人工审核、确认入库和角色工作会话。
- 冷启动后继续工作，角色库保持 v2，原测试会话仍按 v1 检查。

桌面模型阶段经过完整宿主请求链，由独立模拟适配器响应。这组结果验证调用机制；真实模型的内容质量和长期角色遵循程度需要实际任务样本。

## 当前边界

| 项目 | 当前范围 |
| --- | --- |
| 独立领域规范 | 由提示词引导，宿主仍加载适用的原生上下文 |
| 来源会话配置 | 沿用工作目录和公开 Preset；临时 UI 选择的完整继承尚未逐项验证 |
| 跨进程并发 | 写入串行化与修订检查以同一 Host 为范围 |
| 草稿恢复 | 已准备审核的 AI 草稿持久化；普通编辑草稿保存在当前前端进程 |
| 删除与历史 | 归档可恢复，历史文件保留；会话删除与绑定数量清理尚未联动 |
| 平台与界面 | 主要验证 Windows x64，其他平台、全部 DPI 与窗口组合待补 |
| 原生 Fork | 自动角色继承作为后续扩展 |

## 调整后的验证顺序

1. 核对影响到的 Host、Client 或存储入口。
2. 检查语法并构建前端，运行受影响的集成用例。
3. 对兼容声明中的目标宿主做回归，涉及请求与持久化时核对旧数据。
4. 在隔离桌面配置验证实际入口，并记录模型阶段使用的是模拟响应还是真实服务。

版本声明应与已经验证的组合一致。第三方角色资源的来源和许可随正文保留，详见[来源声明](../THIRD_PARTY_NOTICES.md)。
