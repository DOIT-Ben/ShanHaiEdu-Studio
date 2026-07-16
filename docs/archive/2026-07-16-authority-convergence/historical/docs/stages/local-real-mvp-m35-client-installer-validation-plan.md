# Local Real MVP M35 Client Installer Validation Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

M35 的核心需求是把 M34 的“能生成真实 Windows 未签名候选包”推进到“安装包和桌面运行具备可验收边界”。M34 已证明 unpacked exe 能启动本地 HTTP 服务，但还没有形成可重复的安装包 smoke、用户数据目录检查、进程清理检查和安装/卸载边界记录。

当前最小成功标准：

- 有固定命令验证安装包产物存在、被 git ignore，且打包资源未带入 `.env`、data、测试报告或 docs。
- 有固定命令启动 unpacked exe，验证本地 HTTP 返回 200，并在结束后清理 Electron 进程。
- 有固定命令可在显式开关下执行静默安装/卸载 smoke，且安装目录限定在 `test-results` 下。
- 文档明确未签名候选包不等于正式生产发布。

本阶段不做正式代码签名、不做自动更新、不改系统默认文件关联、不做远端发布、不 push。

## 2. 可复用方案调研

项目内可复用：

- M34 已生成 `dist-desktop\ShanHaiEdu Studio Setup 0.1.0.exe`。
- M34 已生成 `dist-desktop\win-unpacked\ShanHaiEdu Studio.exe`。
- M34 `SHANHAI_DESKTOP_PORT` 可用于固定端口 smoke。
- M34 `desktop:prepare` 已过滤敏感和本地临时目录。
- `.gitignore` 已忽略 `dist-desktop\` 与 `desktop-bundle\`。

成熟方案参考：

- Electron-builder NSIS 目标支持 Windows 安装器；当前项目配置 `oneClick=false`、`perMachine=false`、`allowToChangeInstallationDirectory=true`，适合用自定义目录做本机 smoke。
- Windows 本机验证应尽量限定写入范围，避免把测试安装混入系统级目录。

本阶段取舍：

- 默认 smoke 不执行安装器，只验证候选包、资源安全、unpacked exe 启动和进程清理。
- 静默安装/卸载需要显式设置 `SHANHAI_RUN_INSTALLER_SMOKE=1`，避免日常 `npm test` 误安装。
- 如果静默安装器行为受 NSIS 或 Windows 策略影响，报告记录失败点和下一步最小动作，不把失败包装为完成。

## 3. 复用、适配和必要自研

复用：

- 复用 M34 未签名候选包。
- 复用 Electron 主进程固定端口能力。
- 复用 PowerShell/Node 进程清理思路。

适配：

- 新增 `npm run desktop:installer-smoke`。
- 新增 `scripts\desktop-installer-smoke.mjs`。
- 新增 `tests\desktop-installer-smoke.test.mjs`。
- 更新 runbook 和当前状态审计。

必要自研：

- installer smoke 检查项：
  - 安装器存在。
  - unpacked exe 存在。
  - `dist-desktop` 与 `desktop-bundle` 被 git ignore。
  - app resources 不含 `.env`、data、`.tmp`、docs、tests、test-results。
  - unpacked exe 可用固定端口返回 HTTP 200。
  - smoke 结束后无当前 worktree 下的 `ShanHaiEdu Studio.exe` 残留进程。
  - 显式安装模式下，安装目录位于 `test-results\stage35-install`，安装后 exe 可启动，随后静默卸载。

## 4. 开发方案、风险和验证标准

执行方案：

1. 写 M35 阶段规划和测试定义。
2. 写红灯测试：缺 `desktop:installer-smoke` 和脚本时失败。
3. 实现 `scripts\desktop-installer-smoke.mjs`。
4. 跑 Node 测试、`npm run desktop:installer-smoke`、显式安装器 smoke、`npm test`、`npm run build`。
5. 更新 M35 报告、runbook 和当前状态审计。
6. 提交 M35，不 push。

主要风险：

- 静默安装可能创建用户级快捷方式或注册表项；脚本必须静默卸载并限定安装目录。
- 未签名安装包可能被 Windows 安全策略拦截。
- 安装器 smoke 不等于人工体验验收；仍需后续手动安装/卸载截图或 UI 证据。
- 真实下载路径、快捷方式、图标、自动更新和代码签名仍不在本阶段完成范围。

验证标准：

- `node --test tests\desktop-installer-smoke.test.mjs` 通过。
- `npm run desktop:installer-smoke` 通过。
- `$env:SHANHAI_RUN_INSTALLER_SMOKE='1'; npm run desktop:installer-smoke` 通过，或记录明确 blocker。
- `npm test` 通过。
- `npm run build` 通过。
- 提交前 `git diff --check`、ignore 检查、脱敏扫描和残留进程检查通过。
