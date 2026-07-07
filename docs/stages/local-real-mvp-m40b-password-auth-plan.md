# Local Real MVP M40-B Password Auth Plan

日期：2026-07-08

## 1. 第一性原理：当前阶段核心需求

M40-B 的核心需求是把 M40-A 的公网认证服务端底座推进到“密码登录最小闭环”：用户可以通过服务端 API 注册、登录、退出和读取当前用户；密码只以强哈希保存；登录失败不泄露账户是否存在；session 由服务端记录、可过期、可撤销，并通过 `shanhai_session` httpOnly cookie 传递。

本阶段不做登录 UI、不开放远端部署、不做 OAuth/SSO、不做复杂组织管理，也不把当前能力包装成完整公网安全体系。

## 2. 可复用方案调研

项目内可复用：

- M40-A 已新增 `AuthSession`、`AuditLog`、`ProjectMembership` 和 `CsrfToken` schema。
- `src\server\auth\session.ts` 已区分本地 cookie 与 public session cookie。
- `src\server\auth\actor.ts` 已定义 `local/password/oauth/sso` auth mode。
- `src\server\auth\audit-log.ts` 已提供审计 metadata 脱敏。
- `src\server\auth\workbench-route.ts` 已能在 public auth mode 下对缺 session 请求返回 401。

官方/一手依据：

- OWASP Password Storage Cheat Sheet 建议密码使用现代、慢速且带 salt 的哈希算法；Argon2id 不可用时可用 scrypt。
- OWASP Authentication Cheat Sheet 要求认证错误响应避免泄露账户枚举信息。
- OWASP Session Management Cheat Sheet 要求 session id 高熵、不可预测，并具备生命周期管理。
- Node.js 官方 `crypto.scrypt` 提供内置 scrypt KDF，适合在不新增依赖的前提下实现最小强哈希。

## 3. 复用、适配和必要自研

复用：

- 复用 Node `crypto.scrypt`、`randomBytes` 和 `timingSafeEqual`。
- 复用 `LocalUser.passwordHash` 存储密码哈希。
- 复用 `AuthSession.sessionTokenHash` 存储 session token hash，不保存明文 session token。
- 复用 `createPublicSessionSetCookieHeader` 设置 httpOnly、SameSite 和 Secure cookie。
- 复用 `AuditLog` 记录注册、登录、退出事件。

适配：

- 新增 `src\server\auth\password.ts`：hash/verify password。
- 新增 `src\server\auth\password-auth.ts`：注册、登录、退出、当前用户服务。
- 扩展 `src\server\auth\session.ts`：支持明文 session token 生成、hash、解析 public session cookie、清除 cookie。
- 新增 API route：
  - `POST /api/auth/register`
  - `POST /api/auth/login`
  - `POST /api/auth/logout`
  - `GET /api/auth/me`

必要自研：

- 输入校验：email 规范化、密码长度限制、显示名裁剪。
- 登录失败统一返回“账号或密码不正确”，不区分用户不存在或密码错误。
- 审计事件只记录 action、actor、目标和脱敏 metadata，不记录密码、session token 或密码哈希。

## 4. 开发方案、风险和验证标准

开发步骤：

1. 写 M40-B 阶段计划和测试定义。
2. 写红灯测试：密码哈希、auth service、auth API route。
3. 实现 password hash/verify。
4. 实现 password auth service。
5. 实现注册、登录、退出、当前用户 API。
6. 跑 M40-B 聚焦测试、M40-A 回归、`npm test` 和 `npm run build`。
7. 更新 M40-B 报告和当前状态审计。

主要风险：

- 登录错误泄露账户存在性。
- session 明文 token 被写入数据库、日志或响应 body。
- 注册/登录测试使用假的长 token/password 字面量触发敏感扫描。
- public auth mode 与 local auth mode 相互污染，导致本地 exe 或浏览器 MVP 回归。

验证标准：

- `node --test tests\password-auth.test.mjs` 通过。
- `node --test tests\password-auth-routes.test.mjs` 通过。
- `node --test tests\public-auth-model.test.mjs tests\auth-security-hardening.test.mjs` 通过。
- `npm test` 通过。
- `npm run build` 通过。
- 脱敏扫描不命中 key、token、密码或 session 明文形态。
