# Local Real MVP M40-B Password Auth Report

日期：2026-07-08

## 1. 阶段目标

M40-B 目标是把 M40-A 的公网认证服务端底座推进到密码登录最小闭环：注册、登录、退出和当前用户 API 可用；密码只保存带 salt 的 scrypt verifier；public session 明文 token 只进入 `shanhai_session` httpOnly cookie，数据库只保存 hash；登录失败不泄露账户是否存在。

本阶段不做登录 UI、OAuth/SSO、完整组织协作、rate limit、验证码、风控和公网部署。

## 2. 实现内容

- 新增 `src\server\auth\password.ts`：使用 Node 内置 `crypto.scrypt`、`randomBytes` 和 `timingSafeEqual` 实现密码 hash/verify。
- 新增 `src\server\auth\password-auth.ts`：实现 password 用户注册、登录、退出、当前用户查询和审计写入。
- 扩展 `src\server\auth\session.ts`：新增 public session token 生成、hash、读取和清除 cookie helper。
- 新增 `POST /api/auth/register`、`POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/me`。
- 新增 `tests\password-auth.test.mjs` 和 `tests\password-auth-routes.test.mjs`。

## 3. 验收记录

| 命令 | 结果 |
| --- | --- |
| `node --test tests\password-auth.test.mjs` | 通过：3 tests passed |
| `node --test tests\password-auth-routes.test.mjs` | 通过：2 tests passed |
| `node --test tests\public-auth-model.test.mjs tests\auth-security-hardening.test.mjs` | 通过：7 tests passed |
| `node --test tests\public-auth-csrf.test.mjs tests\public-auth-audit-log.test.mjs tests\local-session-auth.test.mjs` | 通过：5 tests passed |
| `npm test` | 通过：Node 84/84；Vitest 24 files / 91 tests |
| `npm run build` | 通过；Next 识别 4 个 `/api/auth/*` 动态 route |
| `npm run test:e2e:stage7` | 通过：Chromium desktop 1 passed |
| standalone HTTP smoke | 通过：临时 SQLite 下 register 201、me 200/authenticated、login 200、logout 200/revoked |
| 测试 worker 残留检查 | 通过；未发现 Vitest/Jest/Playwright/Stage7 残留 Node 进程 |

## 4. 审查结论

已完成：

- 密码强哈希与校验。
- 注册、登录、退出和当前用户 API。
- public session 明文 token 不入库。
- session cookie 使用 `HttpOnly`、`SameSite=Lax`，HTTPS/forwarded HTTPS 下带 `Secure`。
- 登录失败错误通用。
- API 响应体不暴露密码 hash、session 明文 token 或 session hash。
- M40-A public auth 模型、CSRF helper、审计脱敏和本地会话回归通过。

仍未完成：

- 登录/注册 UI。
- 完整 CSRF 落库校验在 auth route 上的强制接入。
- rate limit、验证码、登录风控、密码重置、多因素认证。
- OAuth/SSO、组织/班级/邀请协作、管理员和审计查询 UI。
- 公网部署、域名、HTTPS 和生产安全监控。

## 5. 下一步建议

优先做 M40-C：把当前 password auth API 接入浏览器最小登录界面，并在 `SHANHAI_AUTH_MODE=password` 下验证工作台 API 不再回退本地匿名 actor。
