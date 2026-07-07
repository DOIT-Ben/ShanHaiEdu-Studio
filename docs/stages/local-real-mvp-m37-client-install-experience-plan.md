# Local Real MVP M37 Client Install Experience Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

M37 的核心需求是把 M36 的“静默安装、启动、卸载 smoke 通过”推进到“客户端安装体验关键系统证据可验收”。MVP 不是只要 exe 能打开，还要能证明用户安装后能从系统入口启动、系统卸载入口可识别、桌面运行会写入合理用户数据目录、卸载后不会留下当前测试安装目录中的核心二进制残留。

本阶段不做正式签名、不做自动更新、不做图标品牌精修、不做公网发布、不 push。人工 UI 向导截图不作为本阶段强制项，因为无人值守自动化环境下可见窗口、UAC、系统语言和桌面状态不稳定；本阶段优先做可重复的系统证据。

## 2. 可复用方案调研

项目内可复用：

- M36 已让 `desktop:installer-smoke` 在显式模式下完成静默安装、安装后 HTTP 200、卸载器生成和静默卸载。
- Electron 主进程会在 `app.getPath("userData")` 下创建 `data` 和 `artifact-storage-root`。
- electron-builder NSIS 默认会写 Windows 卸载注册表项，并创建开始菜单快捷方式。
- 当前安装目录限定在 ignored 的 `test-results\stage35-install`。

可复用系统证据：

- 卸载注册表项：证明 Windows 能识别该应用的卸载入口。
- 开始菜单快捷方式：证明用户有系统启动入口。
- Electron userData 子目录：证明桌面端运行时数据不写入随机临时目录。
- 卸载后注册表项、快捷方式和安装目录核心文件消失：证明卸载闭环不是只退出进程。

## 3. 复用、适配和必要自研

复用：

- 复用 M36 的安装器等待、安装后 HTTP smoke、静默卸载和进程清理。
- 复用 Node + PowerShell 检查 Windows 注册表和 Known Folder。

适配：

- 在显式安装器 smoke 中增加安装体验检查项：
  - `uninstall-registry-entry`
  - `start-menu-shortcut`
  - `desktop-user-data`
  - `uninstall-removes-registry`
  - `uninstall-removes-start-menu`
  - `uninstall-removes-core-files`
- 输出只报告检查项状态，不输出隐私路径、token、私有 endpoint 或完整本机配置。

必要自研：

- 增加可单元测试的 `summarizeInstallExperienceState`，避免只能靠真实 Windows 安装才能验证聚合逻辑。
- 增加 registry 和快捷方式探测 helper，探测失败时给出明确检查项，不影响默认 unpacked smoke。

## 4. 开发方案、风险和验证标准

执行方案：

1. 写 M37 阶段规划和测试定义。
2. TDD：先让 `tests\desktop-installer-smoke.test.mjs` 要求安装体验聚合检查。
3. 扩展 `scripts\desktop-installer-smoke.mjs` 的显式安装器 smoke。
4. 跑默认 smoke 和显式安装体验 smoke。
5. 更新 M37 报告、runbook 和当前状态审计。
6. 集中验收并提交 M37，不 push。

主要风险：

- Windows 快捷方式策略可能因用户环境差异而变化；若未创建桌面快捷方式，本阶段只强制开始菜单快捷方式。
- userData 目录默认保留，不作为卸载后删除项；用户数据清理应由后续明确策略处理。
- 安装器 smoke 运行时间较长，显式安装体验 smoke 不进入默认 `npm test`。
- 卸载注册表和快捷方式路径属于本机系统状态，输出必须脱敏为检查项，不打印完整用户隐私路径。

验证标准：

- `node --test tests\desktop-installer-smoke.test.mjs` 通过。
- `npm run desktop:installer-smoke` 通过。
- `$env:SHANHAI_RUN_INSTALLER_SMOKE='1'; npm run desktop:installer-smoke` 通过，且包含 M37 安装体验检查项。
- `npm test` 通过。
- `npm run build` 通过。
- `git diff --check`、ignore 检查、脱敏扫描和残留进程检查通过。
