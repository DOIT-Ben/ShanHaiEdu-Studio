# Local Real MVP M33 Client Exe Readiness Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

M33 的核心需求是把“浏览器网站已经可用”推进到“具备客户端 exe 验证前置条件”：当前仓库没有 Electron、Tauri、MSIX 或其他真实 exe 打包工程，因此本阶段不能宣称已经生成或验收客户端 exe。最小目标是证明当前 Next 本地服务可以被桌面容器按 loopback 地址加载，且关键用户动作、会话、下载和本地素材目录不会因为容器化入口而失效。

当前最小成功标准：

- 有固定命令检查客户端 exe 验证前置条件。
- 检查项覆盖 Next standalone、本地生产启动脚本、下载路由、素材存储根目录、loopback 地址兼容和是否存在真实 exe 打包工程。
- 检查输出只显示 present/missing、ready/not_configured 和安全摘要，不打印密钥、token、私有端点、完整 `.env` 或本机敏感路径。
- 新增浏览器容器等价 E2E：使用 `localhost` 入口访问本地服务，覆盖新建项目、发送需求、刷新恢复、Markdown 下载和教师可见工程词扫描。
- 文档明确：M33 是客户端 exe 验证准备，不等于真实 exe 已打包、安装或发布。

本阶段不引入 Electron/Tauri，不生成安装包，不写注册表，不创建系统服务，不上线，不 push。

## 2. 可复用方案调研

项目内可复用：

- M31 已配置 `next.config.ts` 的 `output: "standalone"`，可作为桌面容器内置服务的基础。
- M31 已提供 `npm run preflight:production` 和 `docs\runbooks\local-real-mvp-production-readiness.md`。
- M32 已修复 loopback alias 同源判断，`localhost`、`127.0.0.1`、`::1` 在同协议同端口下可兼容。
- 现有 Playwright 配置支持通过 `E2E_BASE_URL` 切换入口地址。
- Stage2、Stage7、Stage27 已覆盖浏览器主链路、会话隔离和真实素材下载联动。

成熟方案参考：

- Next.js standalone 输出适合自托管运行包边界，M31 已采用该路线。
- Playwright 已在本项目作为浏览器 E2E 标准工具，适合模拟桌面容器的 loopback WebView 入口。
- 桌面 exe 真实打包后续可在 Electron、Tauri 或 WebView2 等路线中选择，但当前缺少已定产品约束和工程脚手架，本阶段只做封装前置验证。

本阶段取舍：

- 先复用 Next standalone + Playwright，不新增桌面框架依赖。
- 用 `localhost` E2E 补充现有 `127.0.0.1` 覆盖，贴近常见桌面容器内置服务入口。
- readiness 脚本把“没有真实 exe 打包工程”作为 warning 记录，不作为本阶段失败，因为 M33 的目标是验证准备而非真实打包。

## 3. 复用、适配和必要自研

复用：

- 复用 `scripts\production-preflight.mjs` 的生产准备边界。
- 复用现有 E2E 流程和教师界面红线扫描。
- 复用 M32 的 loopback 同源兼容能力。

适配：

- `package.json` 增加 `preflight:client-exe` 和 `test:e2e:stage33`。
- 新增 `scripts\client-exe-readiness.mjs`，输出客户端 exe 验证准备 JSON。
- 新增 `scripts\run-stage33-e2e.mjs`，使用独立 SQLite 和 `E2E_BASE_URL=http://localhost:<port>`。
- 新增 `tests\e2e\stage33-client-exe-readiness.spec.ts`，覆盖容器等价入口。

必要自研：

- `client-exe-readiness` 检查项：
  - package build/start 脚本存在。
  - Next standalone 输出已配置。
  - 本地下载能力所需 API route 存在。
  - `ARTIFACT_STORAGE_ROOT` 若配置，则必须是绝对可访问目录。
  - M32 loopback 兼容代码存在。
  - 当前是否存在真实桌面打包工程；没有时输出 warning，不宣称 exe 已完成。

## 4. 开发方案、风险和验证标准

执行方案：

1. 写 M33 阶段规划和测试定义。
2. 写红灯测试：`client-exe-readiness` 脚本和 npm 命令不存在时失败。
3. 实现 `scripts\client-exe-readiness.mjs` 和 `tests\client-exe-readiness.test.mjs`。
4. 新增 Stage33 E2E 脚本与用例。
5. 跑 M33 专项测试、`npm run preflight:client-exe`、Stage33、`npm test`、`npm run build`。
6. 更新 M33 报告和当前状态审计。
7. 审查后提交 M33，不 push。

主要风险：

- Playwright 只能模拟桌面容器的浏览器行为，不能证明真实 exe 安装、自动更新、窗口生命周期或系统权限。
- 当前没有真实 exe 工程，不能把 readiness 结果包装为客户端已发布。
- 下载目录在真实 WebView2/Electron/Tauri 中可能受宿主配置影响，后续真实 exe 验收必须复跑。
- `localhost` 和 `127.0.0.1` 的网络策略在安全软件或公司网络下可能不同，当前只证明本机默认环境。

验证标准：

- `node --test tests\client-exe-readiness.test.mjs` 通过。
- `npm run preflight:client-exe` exit 0，输出 `ok=true`，且 warning 明确真实 exe 打包工程未配置。
- `npm run test:e2e:stage33` 通过。
- `npm test` 通过。
- `npm run build` 通过。
- `git diff --check`、脱敏扫描和残留进程检查通过。
