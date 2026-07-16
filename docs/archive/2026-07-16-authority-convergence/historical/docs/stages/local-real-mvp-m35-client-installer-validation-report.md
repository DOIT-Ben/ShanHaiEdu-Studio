# Local Real MVP M35 Client Installer Validation Report

日期：2026-07-07

## 1. 阶段目标

M35 目标是在 M34 真实 Windows 未签名候选包基础上，补齐客户端安装包的可重复验收边界：候选安装包存在且被 git 忽略，打包资源不带入本地敏感或测试目录，unpacked exe 能启动本地服务，并明确静默安装/卸载 smoke 当前是否可作为通过证据。

本阶段不做正式代码签名、不做自动更新、不做公网发布、不 push，也不把未签名候选包表述为生产发布版。

## 2. 本阶段变更

- 新增 `npm run desktop:installer-smoke`。
- 新增 `scripts\desktop-installer-smoke.mjs`。
- 新增 `tests\desktop-installer-smoke.test.mjs`。
- 更新 `electron-builder.config.cjs`，关闭 NSIS 安装完成后自动运行应用。
- 更新 `tests\desktop-packaging.test.mjs`，覆盖 `runAfterFinish: false`。

新增 smoke 覆盖：

- `dist-desktop\ShanHaiEdu Studio Setup 0.1.0.exe` 存在。
- `dist-desktop\win-unpacked\ShanHaiEdu Studio.exe` 存在。
- `dist-desktop\` 和 `desktop-bundle\` 被 git ignore。
- 打包资源不包含 `.env`、data、`.tmp`、docs、tests 或 test-results。
- 默认模式启动 unpacked exe，并验证 `http://127.0.0.1:3127` 返回 200。
- 显式模式通过 `SHANHAI_RUN_INSTALLER_SMOKE=1` 尝试静默安装、启动安装后 exe、静默卸载。

## 3. 验收记录

| 命令 | 结果 |
| --- | --- |
| `node --test tests\desktop-installer-smoke.test.mjs` | 通过；3 tests passed |
| `npm run desktop:installer-smoke` | 通过；`installerMode=skipped`；unpacked exe HTTP 200 |
| `$env:SHANHAI_RUN_INSTALLER_SMOKE='1'; npm run desktop:installer-smoke` | 未通过；安装文件已解压，但未生成卸载器 |

默认 smoke 输出显示：

- 安装包产物存在。
- unpacked exe 存在。
- `dist-desktop` 和 `desktop-bundle` 均被忽略。
- packaged resources 排除了本地专用文件。
- unpacked exe 在端口 3127 返回 HTTP 200。

显式安装器 smoke 输出显示：

- 安装包产物存在。
- unpacked exe smoke 仍通过。
- 静默安装目录中已出现 `ShanHaiEdu Studio.exe` 和 `resources\app\desktop-bundle\server.js`。
- `Uninstall ShanHaiEdu Studio.exe` 在 180 秒内未生成。
- 因卸载器缺失，静默卸载无法执行。

## 4. 排障记录

已确认事实：

- `test-results\stage35-install` 初始不存在，本轮显式 smoke 只写入该测试目录。
- 加 `/currentuser` 的安装探针仍 180 秒不退出，仍未生成卸载器。
- 注册表中未发现 ShanHaiEdu 旧安装卸载项，排除旧版本卸载残留卡住。
- 本机用户缓存中的 `shanhai-edu-studio-updater\installer.exe` 可独占打开，未发现文件锁。
- NSIS `/LOG=...` 探针未产生日志文件。
- 进程检查未发现当前 worktree 下的 `ShanHaiEdu Studio.exe`、Next dev、Playwright、Jest 或 Vitest 残留进程。

基于 electron-builder 本地模板证据，卸载器应在 NSIS `installApplicationFiles` 中由 `File "/oname=${UNINSTALL_FILENAME}" "${UNINSTALLER_OUT_FILE}"` 写入 `$INSTDIR`。当前现象说明安装流程已完成应用解压，但未走到卸载器写入或未能完成该步骤。

## 5. 审查结论

M35 已补齐客户端安装包的默认可重复 smoke 边界：

- 当前本地 MVP 可以通过 unpacked exe 启动。
- 当前安装包产物和打包资源安全边界可自动检查。
- 默认 smoke 可作为“候选包可运行”证据。

M35 不能表述为完整安装器验收通过：

- 静默安装/卸载 smoke 当前失败。
- 不能声明安装器安装、卸载和系统权限验收完成。
- 未签名候选包仍不能作为生产发布版。

## 6. 下一步最小动作

优先级从高到低：

1. 继续 M36：定位 NSIS assisted installer 静默安装不退出且不生成卸载器的根因。
2. 对比 one-click NSIS、assisted NSIS 和 portable target 的安装/卸载 smoke 表现，选择本地 MVP 首个可验收安装器路线。
3. 若继续保留 assisted installer，补可观测日志或自定义 NSIS include，让失败点能落到明确日志。
4. 静默安装/卸载通过后，再做人工安装路径、快捷方式、用户数据目录和卸载残留专项验收。
