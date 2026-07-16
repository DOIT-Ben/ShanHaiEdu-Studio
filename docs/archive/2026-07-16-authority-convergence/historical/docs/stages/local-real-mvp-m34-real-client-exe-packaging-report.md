# Local Real MVP M34 Real Client Exe Packaging Report

日期：2026-07-07

## 1. 阶段目标

M34 目标是在 M33 客户端 exe 验证准备基础上，建立真实 Windows 客户端打包最小闭环：选择 Electron 路线，新增桌面壳，生成未签名 Windows 候选安装包，并用 unpacked exe smoke 证明客户端能启动本地服务。

本阶段不做公网发布、不签正式证书、不做自动更新、不做安装器人工安装验收，也不把未签名候选包包装为生产发布版。

## 2. 本阶段变更

桌面壳：

- 新增 `desktop\electron-main.mjs`。
- 新增 `desktop\preload.mjs`，保持空 preload，不暴露 Node API。
- Electron 主进程启动 Next standalone server，并加载本地 loopback URL。
- 支持 `SHANHAI_DESKTOP_PORT`，用于真实 exe smoke 固定端口验证。
- 默认桌面数据目录来自 Electron `userData`，数据库和素材目录不写入随机系统临时目录。

打包：

- 新增 Electron 和 electron-builder 开发依赖。
- 新增 `electron-builder.config.cjs`。
- 新增 `npm run desktop:prepare`。
- 新增 `npm run desktop:smoke`。
- 新增 `npm run desktop:pack`。
- 新增 `scripts\prepare-desktop-bundle.mjs`，从 `.next\standalone` 准备安全桌面 bundle，过滤 `.env`、`.tmp`、`data`、`artifact-storage-root`、`docs`、`tests`、`test-results`、`playwright-report` 和嵌套 `node_modules`。
- 新增 `scripts\desktop-smoke.mjs`。
- `.gitignore` 增加 `desktop-bundle\` 和 `dist-desktop\`。

测试：

- 新增 `tests\desktop-packaging.test.mjs`。
- 更新 `tests\client-exe-readiness.test.mjs`，M34 后当前仓库应识别到真实桌面工程，不再输出 `desktop-wrapper-not-configured` warning；同时用临时 fixture 保留无桌面壳 warning 覆盖。

## 3. 验收记录

| 命令 | 结果 |
| --- | --- |
| `node --test tests\desktop-packaging.test.mjs` | 通过；3 tests passed |
| `node --test tests\client-exe-readiness.test.mjs tests\desktop-packaging.test.mjs` | 通过；8 tests passed |
| `npm run build` | 通过；仍有 1 条既有 Turbopack output tracing warning |
| `npm run desktop:prepare` | 通过；`desktop-bundle` 已生成 |
| `npm run desktop:smoke` | 通过；`ok=true` |
| `npm run preflight:client-exe` | 通过；`ok=true`；M34 后 `warnings=[]` |
| `npm run test:e2e:stage33` | 通过；Chromium desktop 1 passed |
| `npm test` | 通过；Node 63 tests passed；Vitest 23 files / 88 tests passed |
| `npm run desktop:pack` | 通过；生成 Windows 未签名候选安装包和 unpacked 目录 |
| unpacked exe smoke | 通过；`http://127.0.0.1:3127` 返回 200；结束后清理客户端进程 |

生成的本地候选产物位于 ignored 目录：

- `dist-desktop\ShanHaiEdu Studio Setup 0.1.0.exe`
- `dist-desktop\win-unpacked\ShanHaiEdu Studio.exe`

安全核验：

- `desktop-bundle\.env` 不存在。
- `desktop-bundle\data` 不存在。
- `desktop-bundle\.tmp` 不存在。
- `desktop-bundle\test-results` 不存在。
- `desktop-bundle\docs` 不存在。
- `dist-desktop\win-unpacked\resources\app\.env` 不存在。
- `dist-desktop\win-unpacked\resources\app\data` 不存在。
- `dist-desktop\win-unpacked\resources\app\desktop-bundle\.env` 不存在。

## 4. 审查结论

M34 已完成真实 Windows 客户端打包最小闭环：

- 当前仓库已经存在真实 Electron 桌面壳。
- 已生成本地未签名 Windows 候选安装包。
- unpacked exe 已实测可启动本地服务并返回 HTTP 200。
- 打包前通过安全 bundle 过滤，避免把 `.env`、data 和测试产物直接带入安装包。
- preload 未暴露 Node API 到页面。

当前不能表述为：

- 已完成正式签名生产安装包。
- 已完成自动更新。
- 已完成安装器人工安装/卸载验收。
- 已完成图标、品牌、崩溃日志、窗口生命周期全量体验。
- 已完成 asar 最佳实践。

## 5. 剩余风险

- electron-builder 提示 package 缺少 `description` 和 `author`。
- electron-builder 使用默认 Electron 图标。
- 当前 `asar` 为 false；后续应切换为 asar + asarUnpack 明确解包需要外部访问的文件。
- `npm install` 后 npm audit 报 5 个 moderate vulnerabilities；本阶段未执行 `npm audit fix --force`，避免破坏依赖树。
- `npm run build` 仍有既有 Turbopack tracing warning，因此 `desktop:prepare` 的安全过滤是当前必要门禁，后续仍应修 tracing 根因。
- unpacked exe smoke 只证明本地服务启动，不等于完整 UI 自动化、安装器安装、卸载或真实下载路径验收。

## 6. 下一阶段建议

优先级从高到低：

1. 做 M35 客户端安装包验收：安装、启动、关闭、卸载、下载路径、用户数据目录和进程清理。
2. 修 Next standalone tracing 根因，减少 `desktop:prepare` 对过滤的依赖。
3. 补 Electron 图标、description、author、asar/asarUnpack 和基础 crash/log 目录。
4. 进入公网正式认证规划与实现。
