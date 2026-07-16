# Local Real MVP M39 Client Productization Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

M39 的核心需求是把 M37-M38 的“未签名客户端可打包、可安装、可启动、可卸载”推进到更像真实客户端候选版的工程边界：应用 metadata、图标入口、asar 打包边界、必要 unpack、日志目录和崩溃转储目录。

本阶段不做正式代码签名、不做自动更新、不做公网发布、不改业务工作台 UI、不改真实 provider 调用，也不把未签名候选包表述为生产发布版。

## 2. 可复用方案调研

项目内可复用：

- M34 已建立 Electron + electron-builder Windows 打包工程。
- M35-M37 已建立默认 installer smoke 和显式安装体验 smoke。
- M38 已收敛 Next standalone tracing warning，并保留 `desktop:prepare` 安全过滤门禁。
- `desktop\electron-main.mjs` 已集中处理本地 Next server 启动、userData 目录和窗口生命周期。
- `tests\desktop-packaging.test.mjs` 和 `tests\desktop-installer-smoke.test.mjs` 已覆盖桌面配置和候选包边界。

官方/一手依据：

- electron-builder 配置支持 `asar`、`asarUnpack`、`win.icon`、`directories.output`、NSIS 等桌面打包字段。参考：electron-builder configuration 文档。
- Electron `app` 模块支持日志路径和崩溃转储路径配置，可用 `app.setAppLogsPath()` 和 `app.setPath("crashDumps", ...)` 建立明确运行目录。参考：Electron app API 文档。

## 3. 复用、适配和必要自研

复用：

- 复用 electron-builder 的 `asar` 和 `asarUnpack`，不自研压缩或复制策略。
- 复用 Electron `userData` 目录作为本地数据库、素材、日志和崩溃转储的统一根。
- 复用现有 smoke，通过固定 `SHANHAI_DESKTOP_USER_DATA_DIR` 验证目录创建。

适配：

- `electron-builder.config.cjs` 增加 `icon`、`asar: true`、`asarUnpack`、`win.icon`、`extraMetadata.description/author`。
- 桌面主进程增加日志目录和崩溃目录创建。
- standalone server 解析增加 `app.asar.unpacked` 候选路径，避免开启 asar 后外部 Node 子进程无法读取 asar 内 server.js。
- 增加一个本地品牌图标资产，作为未签名候选客户端的基础图标，不声明最终品牌视觉完成。

必要自研：

- 生成一个最小 Windows `.ico` 资产，放在 `desktop\assets\icon.ico`。
- 扩展桌面打包测试，静态验证 metadata、icon、asar/unpack 和日志/崩溃目录入口。
- 扩展 installer smoke，验证隔离 userData 下 `logs` 与 `crash-dumps` 目录存在。

## 4. 开发方案、风险和验证标准

执行方案：

1. 写 M39 阶段规划和测试定义。
2. TDD：先扩展桌面打包测试和 installer smoke 测试。
3. 增加 icon 资产和 electron-builder metadata/asar 配置。
4. 调整 Electron main：创建 logs/crash-dumps，支持 asar unpacked server 路径。
5. 跑聚焦测试、build、desktop prepare、desktop pack、默认 installer smoke。
6. 更新 M39 报告、runbook 和当前状态审计。
7. 审查、脱敏扫描、提交，不 push。

主要风险：

- 开启 asar 后，Next standalone server 必须位于 unpacked 路径，否则子进程启动可能失败。
- 图标资产只是基础候选图标，不等于完整品牌系统。
- 崩溃转储目录存在不等于已经完成崩溃上报或监控。
- `desktop:prepare` 仍是桌面包安全过滤门禁，M39 不删除它。

验证标准：

- `node --test tests\desktop-packaging.test.mjs` 通过。
- `node --test tests\desktop-installer-smoke.test.mjs` 通过。
- `npm run build` 通过。
- `npm run desktop:prepare` 通过。
- `npm run desktop:pack` 通过，生成未签名候选包。
- `npm run desktop:installer-smoke` 通过，默认 unpacked exe HTTP 200。
- `git diff --check`、脱敏扫描和残留进程检查通过。
