# 安装、更新和卸载

当前插件包名为 `dsh-work-modes-probe`，版本为 **0.5.2**。安装前先核对 DSH 的完整版本。受测版本见[仓库首页](../README.md)。

## 准备条件

- Windows 桌面上的 DSH 已至少启动过一次，用于初始化 `desktop` 配置。
- 已能在 PowerShell 中运行 `dsh --version`。如果命令未安装，可先在 DSH 的「应用 → 管理 dsh 命令」中安装。
- 从源码构建需要 Node.js ≥ 24.9.0 和 npm。运行 DSH 0.2.3-alpha.2 的测试环境需要 Node.js 24.22.3+（24.x）或 26.13.1+，桌面包自带对应运行时。

```powershell
dsh --version
node --version
npm --version
```

当前验收主要覆盖 Windows x64。其他平台需要补充平台验证。

## 从源码构建

获取源码并进入项目目录。使用 Git 克隆时，私有仓库需要有访问权限。下面的命令获取默认分支。

```powershell
git clone https://github.com/suxiangze4-png/dsh-work-modes.git
Set-Location .\dsh-work-modes
npm ci
npm run check
npm run build
npm pack
```

`npm ci` 按锁文件安装开发依赖；`check` 检查源码语法；`build` 生成前端文件；`pack` 生成可安装的 `.tgz` 包。0.5.2 源码生成的包名为 `dsh-work-modes-probe-0.5.2.tgz`。

## 安装本地包

通过 DSH 的「应用 → 退出」完全退出桌面端。使用包的绝对路径安装，将下面的路径替换为实际位置。

```powershell
dsh plugin --profile desktop add 'file:C:/packages/dsh-work-modes-probe-0.5.2.tgz'
```

重新打开 DSH，确认左侧出现「角色库」。若插件管理页显示尚未启用，先启用再完整退出重开。

可以在退出 DSH 后用下面的命令核对包版本。

```powershell
dsh plugin --profile desktop list dsh-work-modes-probe --depth 0
```

## 更新已有安装

1. 记录当前插件版本，并按[使用指南](USER_GUIDE.md)确认角色和历史会话能正常读取。
2. 完全退出 DSH。
3. 对新版本 `.tgz` 再执行一次 `plugin --profile desktop add`。
4. 重开 DSH，核对角色库、分类、历史版本和旧会话绑定。

角色正文与元数据保存于宿主数据目录，更新包沿用原存储域。原有链接安装也可替换为本地包安装。

## 链接安装用于开发

完全退出 DSH 后，将路径替换为实际源码目录。

```powershell
dsh plugin --profile desktop add 'link:C:/projects/dsh-work-modes'
```

链接安装会让宿主读取该源码目录。修改前端后运行 `npm run build`，修改 Host 后完整退出并重开 DSH。

## 停用与卸载

停用可以在 DSH 插件管理页完成，随后完整退出重开。插件停用期间，角色注入、请求检查和会话锁定逻辑会停止；继续受管会话前先重新启用。

卸载时，先完全退出 DSH，再执行。

```powershell
dsh plugin --profile desktop remove dsh-work-modes-probe
```

卸载保留角色文件和宿主存储域。重新安装后，使用相同的 DSH 数据目录和 `desktop` 配置读取原有数据。

## 安装问题

| 现象 | 检查方法 |
| --- | --- |
| 找不到 `dsh` 命令 | 在 DSH 中安装命令，重新打开 PowerShell 后执行 `dsh --version` |
| 插件提示宿主版本不兼容 | 对照首页的完整版本号，使用已验证组合 |
| 安装后找不到角色库 | 确认安装目标为 `desktop`，插件已启用，并完全退出重开过 DSH |
| 修改前端后仍是旧界面 | 重新构建；确认当前采用包安装还是链接安装，再重启宿主 |
| 重装后看不到原角色 | 核对 `DSH_HOME`、桌面配置和角色库存储位置是否与原安装相同 |

实际操作步骤见[使用指南](USER_GUIDE.md)，测试运行时配置见[开发与验证说明](DEVELOPMENT.md)。
