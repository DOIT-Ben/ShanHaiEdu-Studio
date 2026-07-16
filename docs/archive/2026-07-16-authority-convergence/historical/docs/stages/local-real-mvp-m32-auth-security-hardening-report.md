# Local Real MVP M32 Auth Security Hardening Report

日期：2026-07-07

## 1. 阶段目标

M32 目标是在 M29 本地账号/权限最小闭环基础上补齐系统性安全边界：所有 workbench 写接口具备统一来源校验，HTTPS 场景本地会话 cookie 自动带 `Secure`，页面和 API 具备基础安全响应头。

本阶段不做公网注册、密码登录、OAuth、SSO、组织/班级、管理员后台或正式多租户权限系统。

## 2. 本阶段变更

认证与会话：

- `withLocalWorkbenchActor` 增加写接口来源校验。
- 跨站 `POST`、`PUT`、`PATCH`、`DELETE` 会返回 403。
- 同源请求允许继续执行 handler。
- `localhost`、`127.0.0.1`、`::1` 在同协议同端口下按 loopback 同源处理，避免误伤本地浏览器和客户端 exe 容器。
- 无 `Origin`、`Referer`、`Sec-Fetch-Site` 的本地内部调用暂时兼容。
- `createLocalSessionSetCookieHeader` 在 HTTPS 或 `x-forwarded-proto=https` 场景自动增加 `Secure`。

安全响应头：

- `next.config.ts` 增加全局 headers：
  - `X-Frame-Options: SAMEORIGIN`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`

文档与测试：

- 新增 `docs\stages\local-real-mvp-m32-auth-security-hardening-plan.md`。
- 新增 `docs\stages\local-real-mvp-m32-auth-security-hardening-test-plan.md`。
- 新增 `tests\auth-security-hardening.test.mjs`。

## 3. 验收记录

| 命令 | 结果 |
| --- | --- |
| `node --test tests\auth-security-hardening.test.mjs` | 通过；5 tests passed |
| `npm test` | 通过；Node 55 tests passed；Vitest 23 files / 88 tests passed |
| `npm run build` | 通过；仍有 1 条既有 Turbopack output tracing warning |
| `npm run test:e2e:stage7` | 修复 loopback 同源误判后通过；Chromium desktop 1 passed |
| `node scripts\run-stage27-e2e.mjs` | 通过；Chromium desktop 1 passed |

## 4. 审查结论

M32 已完成本地账号权限系统的浏览器安全加固：

- M29 owner 隔离继续保留。
- 写接口新增跨站来源阻断。
- 本地 loopback 场景不误伤。
- HTTPS/代理 HTTPS 场景 cookie 自动带 `Secure`。
- 页面/API 已有基础安全响应头。
- 教师可见 UI 未新增安全实现细节或工程词。

当前不能表述为：

- 已完成公网正式账号系统。
- 已完成密码、OAuth、SSO、组织/班级、管理员、共享协作或审计日志。
- 已完成完整 CSP、HSTS、rate limit、登录风控或生产安全监控。

## 5. 剩余风险

- 无浏览器来源头的本地内部调用仍被允许，这是为了兼容 Node 测试、脚本和客户端容器；公网部署前可考虑开启更严格策略。
- 当前安全头未启用完整 CSP 和 HSTS，避免破坏本地开发与未上线 HTTP 场景。
- 本地会话 cookie 仍不是公网登录凭证。

## 6. 下一阶段建议

优先进入客户端 exe 验证准备或公网认证升级：

- 客户端 exe 验证准备：确认封装容器内的 loopback origin、下载、素材目录和会话行为。
- 公网认证升级：密码/OAuth/SSO、CSRF token、管理员、共享协作和审计日志。
