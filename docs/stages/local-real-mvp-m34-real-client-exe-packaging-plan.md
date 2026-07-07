# Local Real MVP M34 Real Client Exe Packaging Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

M34 的核心需求是从 M33 的“客户端 exe 验证准备”进入“真实 Windows 客户端 exe 最小打包路线”。当前 ShanHaiEdu 是 Next.js App Router + API route + Prisma SQLite + 本地素材目录的 Web 应用；桌面客户端不能只是打开浏览器，也不能只写 runbook，必须能启动本地服务、加载工作台、保留会话、支持下载，并为后续真实安装包验收留出边界。

当前最小成功标准：

- 选择一条真实 Windows exe 路线，并说明为什么适合当前 Next/Node 服务形态。
- 定义最小桌面壳架构：桌面主进程启动本地 Next standalone/server，窗口加载 loopback URL。
- 定义本地数据、素材、日志和端口占用的边界，不把用户文件写入 C 盘随机临时目录。
- 定义测试入口：至少能在本机跑 desktop readiness、桌面壳 smoke、Stage33 localhost 链路和构建。
- 明确不能宣称的内容：未生成安装包前，不能说客户端已发布；未跑真实 exe 前，不能说 exe 已验收。

本阶段规划不直接安装依赖、不生成 exe、不执行安装器、不写注册表、不 push。

## 2. 可复用方案调研

项目内可复用：

- M31 已完成 Next standalone 准备和本地生产 runbook。
- M32 已完成 loopback 同源兼容和本地安全基础。
- M33 已完成 `preflight:client-exe`、Stage33 localhost 容器等价 E2E 和客户端验证准备。
- 现有 `npm run build` 已生成 Next 可自托管输出。
- 现有 SQLite、ArtifactStorage 和 provider env 均以本机配置为边界。

官方/成熟方案参考：

- Electron 官方文档：Electron 使用 Chromium 和 Node.js 构建桌面应用，适合复用当前 Web/Node 技术栈。来源：https://www.electronjs.org/docs/latest/
- electron-builder 官方文档：electron-builder 支持打包和分发 Electron 应用，可用于 Windows installer/portable 等目标。来源：https://www.electron.build/
- Tauri 官方文档：Tauri 依赖 Rust 工具链和系统 WebView，优势是包体轻，但会引入新的 Rust/原生构建边界。来源：https://tauri.app/start/prerequisites/
- Microsoft WebView2 官方文档：WebView2 可把 Web 内容嵌入 Windows 原生应用，但需要 Win32/.NET 等宿主工程。来源：https://learn.microsoft.com/microsoft-edge/webview2/
- Next.js standalone 输出文档：`output: "standalone"` 可减少自托管部署所需文件。来源：https://nextjs.org/docs/app/api-reference/config/next-config-js/output

路线对比：

| 路线 | 优点 | 风险 | 本阶段判断 |
| --- | --- | --- | --- |
| Electron + electron-builder | 与当前 TypeScript/Node/Next 技术栈最贴近；主进程可启动本地 Node server；打包生态成熟 | 包体较大；需要处理本地端口、进程退出和下载路径 | 推荐作为首个真实 exe MVP |
| Tauri | 包体轻；Windows 使用系统 WebView | 引入 Rust、Tauri 配置和 Node 服务编排；当前项目没有 Rust 边界 | 暂缓，等 Electron MVP 跑通后再评估 |
| WebView2 原生宿主 | Windows 原生体验好；可深度集成系统能力 | 需要 .NET/Win32 工程和安装器链路；偏离当前前端/Node 团队栈 | 暂缓，作为后续 Windows 深度集成路线 |

## 3. 复用、适配和必要自研

推荐路线：Electron + electron-builder。

复用：

- 复用 Next standalone 输出，不在 Electron renderer 里重写业务 UI。
- 复用 M33 的 Stage33 localhost 链路作为桌面容器行为基线。
- 复用 M31/M33 preflight，作为桌面打包前置门禁。

适配：

- 新增 `desktop\electron-main.mjs`，负责选择本地端口、启动 Next server、创建窗口、退出时清理子进程。
- 新增 `desktop\preload.mjs`，先保持极薄边界，不暴露 Node API 到页面。
- 新增 `scripts\desktop-smoke.mjs`，用于在不生成安装包前验证主进程配置和入口文件。
- `package.json` 增加 desktop 相关脚本，例如 `desktop:smoke`、`desktop:pack`。
- `electron-builder` 配置必须把 `.next\standalone`、`.next\static`、`public`、`package.json` 必要文件和 Prisma/SQLite 运行边界纳入打包范围。

必要自研：

- 桌面端口策略：优先自动选择本地空闲端口，不硬编码 3117。
- 数据目录策略：默认把生产数据库和素材目录放入可配置的用户数据目录；本阶段先在 runbook 中定义，不迁移现有数据。
- 退出清理：窗口关闭时终止本地 Next server 子进程。
- 桌面 smoke：验证 Electron main、preload、builder 配置、standalone 输出和安全边界存在。

## 4. 开发方案、风险和验证标准

执行方案：

1. 提交 M34 路线规划和测试定义。
2. 下一阶段安装 Electron/electron-builder 依赖，更新 lockfile。
3. 写 `tests\desktop-packaging.test.mjs` 红灯测试，验证桌面入口、脚本和打包配置缺失时失败。
4. 实现最小 Electron 主进程、preload、desktop smoke 和 package scripts。
5. 跑 `npm run desktop:smoke`、`npm run preflight:client-exe`、`npm run test:e2e:stage33`、`npm test`、`npm run build`。
6. 若依赖和环境允许，再跑 `npm run desktop:pack` 生成 Windows 未签名候选包；否则把依赖/构建 blocker 写入报告，不伪装完成。
7. 更新 M34 报告和当前状态审计。

主要风险：

- Electron 依赖下载和 Windows 打包可能受网络、代理、缓存或代码签名影响。
- Next standalone + Prisma + SQLite 在 Electron 打包后可能出现路径解析差异，必须用真实 smoke 证明。
- 本阶段的未签名 exe/installer 不等于生产发布版本。
- 如果后续发现 Electron 打包体积或安全边界不可接受，可回退到 M34 文档重新选择 Tauri/WebView2。

验证标准：

- `node --test tests\desktop-packaging.test.mjs` 通过。
- `npm run desktop:smoke` 通过。
- `npm run preflight:client-exe` 通过。
- `npm run test:e2e:stage33` 通过。
- `npm test` 通过。
- `npm run build` 通过。
- 如执行 `npm run desktop:pack`，必须记录是否生成真实本地 artifact；没有生成则不能宣称 exe 已完成。
