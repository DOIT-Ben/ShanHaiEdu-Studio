# Local Real MVP M36 Installer Route Recovery Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

M36 的核心需求是把 M35 暴露的安装器 blocker 收敛到一个可验收路线。M35 已证明 unpacked exe 可以启动本地服务，默认安装包 smoke 可通过；但 assisted NSIS 静默安装会解压应用文件后长时间不退出，且不生成 `Uninstall ShanHaiEdu Studio.exe`，因此不能声明安装/卸载验收完成。

本阶段真正要证明的是：

- 首个本地 MVP 客户端分发路线可以被自动 smoke。
- 安装后 exe 能启动本地 loopback 服务。
- 卸载或清理路径可验证，不留下当前测试目录内的客户端进程。
- 失败时有足够证据区分配置问题、安装器模式问题和 Windows 本机环境问题。

本阶段不做正式签名、不做自动更新、不做公网发布、不 push，不把未签名安装包包装成生产发布版。

## 2. 可复用方案调研

项目内可复用：

- M34 `desktop:pack` 已能生成真实 Windows 未签名候选安装包和 `win-unpacked`。
- M35 `desktop:installer-smoke` 已覆盖产物存在、git ignore、资源安全和 unpacked exe HTTP 200。
- M35 排障已确认：
  - `test-results\stage35-install` 初始不存在，测试写入范围可控。
  - 加 `/currentuser` 仍不生成卸载器。
  - 注册表未发现 ShanHaiEdu 旧安装卸载项。
  - 本机用户缓存中的 installer 文件未发现锁。
  - NSIS `/LOG=...` 未产生日志。

本地一手源码证据：

- `node_modules\app-builder-lib\templates\nsis\include\installer.nsh` 中 `installApplicationFiles` 会在应用文件处理后写入 `${UNINSTALL_FILENAME}`。
- `node_modules\app-builder-lib\templates\nsis\common.nsh` 定义卸载器文件名为 `Uninstall ${PRODUCT_FILENAME}.exe`。
- 当前现象说明 assisted NSIS 已完成应用解压，但没有完成卸载器写入或安装流程退出。

成熟路线候选：

- 继续 assisted NSIS：保留可选择安装目录的用户体验，但必须解决静默 smoke 不退出的问题。
- 切 one-click NSIS：降低安装 UI 可配置性，换取更稳定的静默安装/卸载 smoke 可能性。
- 增加 portable target：不替代安装包，但可作为客户端本地分发和真机微调前的可运行兜底。

## 3. 复用、适配和必要自研

复用：

- 复用 M35 smoke 检查函数、HTTP 等待和进程清理。
- 复用 electron-builder NSIS 目标。
- 复用 ignored `test-results` 作为探针安装目录。

适配：

- 新增一个安装器路线探针脚本，用同一套输入对比 assisted NSIS、one-click NSIS 或 portable 目标。
- 探针输出只记录脱敏状态：是否退出、是否生成 exe、是否生成 server、是否生成卸载器、是否 HTTP 200、是否可卸载。
- 如果切换安装器路线，必须同步更新 `electron-builder.config.cjs`、M35 smoke 和打包测试。

必要自研：

- 对 installer 进程增加“退出状态”和“部分安装状态”分离记录，避免只用缺卸载器概括所有失败。
- 对静默安装失败记录 `install-exited`、`installed-exe`、`installed-server`、`uninstaller`、`installed-exe-http`、`silent-uninstall` 六类检查。
- 如 one-click 或 portable 路线可通过，需要把 M35 报告中的 blocker 更新为已收敛路线，而不是掩盖 assisted NSIS 的失败事实。

## 4. 开发方案、风险和验证标准

执行方案：

1. 写 M36 阶段规划和测试定义。
2. 增强安装器 smoke 的失败诊断粒度，红灯先覆盖“部分安装但缺卸载器”的场景。
3. 用最小配置实验对比 assisted NSIS 与 one-click NSIS；必要时加入 portable target。
4. 选择首个本地 MVP 可验收路线，并更新脚本、测试、runbook 和当前状态审计。
5. 跑集中验收并提交 M36，不 push。

主要风险：

- one-click NSIS 可能牺牲安装目录选择体验，但本地 MVP 更需要可重复验收。
- portable target 不等于正式安装包；若采用，只能作为分发兜底，不可替代安装/卸载验收。
- 安装器探针会写入 ignored 的 `test-results`，不能写入系统级测试路径。
- 任何清理只能限定在当前 worktree 的测试目录或安装器自身卸载范围内。

验证标准：

- `node --test tests\desktop-installer-smoke.test.mjs` 通过。
- `npm run desktop:installer-smoke` 通过。
- 显式安装器 smoke 要么通过安装、HTTP、卸载；要么输出更细粒度 blocker，且下一步路线已确定。
- `npm test` 通过。
- `npm run build` 通过。
- `git diff --check`、ignore 检查、脱敏扫描和残留进程检查通过。
