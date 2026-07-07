# Local Real MVP M33 Client Exe Readiness Report

日期：2026-07-07

## 1. 阶段目标

M33 目标是在 M31 本地生产准备和 M32 loopback 安全边界基础上，补齐客户端 exe 验证前置条件：证明当前本地服务可以通过 `localhost` 入口完成核心教师流程，并用固定 preflight 命令区分“具备封装验证准备”和“真实 exe 尚未打包”。

本阶段不引入 Electron、Tauri、WebView2 宿主工程，不生成安装包，不执行远端部署，不宣称客户端 exe 已完成。

## 2. 本阶段变更

脚本与命令：

- 新增 `npm run preflight:client-exe`。
- 新增 `scripts\client-exe-readiness.mjs`，检查客户端 exe 验证前置条件。
- 新增 `npm run test:e2e:stage33`。
- 新增 `scripts\run-stage33-e2e.mjs`，使用独立 SQLite 和 `http://localhost:<port>` 入口运行浏览器容器等价验收。

测试：

- 新增 `tests\client-exe-readiness.test.mjs`。
- 新增 `tests\e2e\stage33-client-exe-readiness.spec.ts`。

文档：

- 新增 `docs\stages\local-real-mvp-m33-client-exe-readiness-plan.md`。
- 新增 `docs\stages\local-real-mvp-m33-client-exe-readiness-test-plan.md`。
- 更新 `docs\runbooks\local-real-mvp-production-readiness.md`。
- 更新 `docs\stages\local-real-mvp-current-state-audit.md`。

## 3. 验收记录

| 命令 | 结果 |
| --- | --- |
| `node --test tests\client-exe-readiness.test.mjs` | 通过；4 tests passed |
| `npm run preflight:client-exe` | 通过；`ok=true`；包含 `desktop-wrapper-not-configured` warning |
| `npm run test:e2e:stage33` | 通过；Chromium desktop 1 passed |
| `npm test` | 通过；Node 59 tests passed；Vitest 23 files / 88 tests passed |
| `npm run build` | 通过；仍有 1 条既有 Turbopack output tracing warning |

## 4. 审查结论

M33 已完成客户端 exe 验证准备：

- 当前本地服务可通过 `localhost` 入口完成核心工作台链路。
- 会话刷新恢复在 localhost 入口下可用。
- Markdown 下载在 localhost 入口下可用。
- 教师可见界面未新增工程词。
- readiness 输出不泄露真实 key、token、私有 endpoint 或完整 `.env`。
- readiness 输出明确提示真实桌面打包工程尚未配置。

当前不能表述为：

- 已完成真实 exe 打包。
- 已完成安装器、自动更新、窗口生命周期、系统权限或桌面文件关联。
- 已完成真实 WebView2/Electron/Tauri 宿主环境验收。

## 5. 剩余风险

- Stage33 是浏览器容器等价验证，不能替代真实 exe 安装包验收。
- 真实 exe 的下载目录、进程生命周期、端口占用、日志路径和素材目录权限仍需后续专项。
- 当前仓库仍没有桌面打包工程；后续若选择 Electron/Tauri/WebView2，需要单独规划和测试。

## 6. 下一阶段建议

优先级从高到低：

1. 做真实客户端 exe 打包路线规划，先选择 Electron/Tauri/WebView2 之一并定义最小安装包验收。
2. 做公网正式认证规划，覆盖密码/OAuth/SSO、CSRF token、管理员、共享协作和审计日志。
3. 做任务队列生产化规划，覆盖 worker、重试、取消、限流、监控和失败 repair。
