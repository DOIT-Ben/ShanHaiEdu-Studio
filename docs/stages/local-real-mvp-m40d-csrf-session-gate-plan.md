# Local Real MVP M40-D CSRF 与真实会话门禁规划

日期：2026-07-08

## 1. 第一性原理

M40-A 到 M40-C 已经让 password auth mode 具备服务端账号、session cookie 和浏览器登录门禁。但本地 MVP 要继续接近“生产上线可用”，不能只看 cookie 字符串就把 workbench 写请求当成已认证用户。

本阶段核心需求是：

- public/password mode 下，workbench actor 必须来自数据库中有效、未过期、未撤销的 `AuthSession` 和 `LocalUser`。
- 写请求必须带有当前 session 绑定、服务端落库、未过期的 CSRF token。
- 前端登录、刷新恢复和 workbench API 写请求必须自动串起 token，不让教师手动处理安全细节。
- local auth mode 保持 M1-M39 本地 MVP 路径，不强制 CSRF，避免打断本地单机试用。

## 2. 可复用方案调研

行业已验证方案：

- OWASP CSRF Prevention Cheat Sheet 建议服务端生成 CSRF token，并在敏感操作请求中验证 token 是否存在且有效；token 应该和用户 session 绑定，不能依赖静态用户字段。
- OWASP 同时强调 SameSite cookie、Origin/Referer 检查和自定义 header 都是 CSRF 防护组合中的常见层。当前项目已有 SameSite=Lax cookie 与同源写入检查，本阶段补齐 session-bound token。

项目内可复用资产：

- `src\server\auth\csrf.ts`：已有 session-bound token hash helper。
- `src\server\auth\session.ts`：已有 public session cookie、token hash 和 auth mode 分流。
- `src\server\auth\password-auth.ts`：已有 `AuthSession` 查询、注册、登录、退出服务。
- `src\server\auth\workbench-route.ts`：所有 workbench API route 的统一门禁。
- `src\lib\auth-api.ts` 与 `src\lib\workbench-api.ts`：前端认证和 workbench 请求集中入口。
- `CsrfToken` Prisma/SQLite schema 已存在。

## 3. 复用与适配方式

采用服务端同步 token 模式：

- 登录或注册成功后，为刚创建的 `AuthSession.id` 生成 CSRF token，hash 后写入 `CsrfToken`。
- `GET /api/auth/me` 在已登录时返回新的 CSRF token，用于刷新页面后恢复前端内存 token。
- 前端只保存明文 CSRF token 在运行时内存，不写 localStorage，不放 URL。
- `workbench-api` 在 password mode 的写请求上自动添加 `x-shanhai-csrf` header。
- `withLocalWorkbenchActor` 在 public auth mode 下：
  - 先做现有同源/loopback 写入检查；
  - 再通过 DB session 装载真实 actor；
  - 最后对写请求做 CSRF token 落库校验。

暂不做：

- OAuth/SSO。
- 管理员 UI、审计查询 UI。
- 完整 rate limit 和登录风控。
- 共享协作 UI。M40-D 只确保 actor 会加载 DB membership，使既有授权底座可以可信工作。

## 4. 开发方案

### 4.1 后端

- 扩展 `src\server\auth\csrf.ts`
  - 增加 `publicCsrfHeaderName`。
  - 增加 `issueCsrfToken`：生成 token，hash 绑定 `AuthSession.id`，写入 `CsrfToken`。
  - 增加 `validateCsrfToken`：按 sessionId/userId/tokenHash/未过期/未消费查询。
- 扩展 `src\server\auth\session.ts`
  - public auth mode 从 `shanhai_session` token hash 查询 `AuthSession`。
  - 校验 session 未撤销、未过期、authMode 匹配。
  - 装载 `LocalUser` 与 `ProjectMembership`，生成真实 `WorkbenchActor`。
  - actor.userId 使用真实 user id，不再使用 `session:<token>`。
- 扩展 `src\server\auth\password-auth.ts`
  - 注册/登录返回 `csrfToken`。
  - `me` 已登录时返回新 `csrfToken`。
  - logout 撤销 session 后同步失效该 session 的 CSRF token。
- 扩展 `src\server\auth\workbench-route.ts`
  - 写请求在 public auth mode 下要求 `x-shanhai-csrf`。
  - token 缺失、错误、过期均返回 403 教师可理解错误。

### 4.2 前端

- 新增轻量 `src\lib\csrf-token.ts`
  - 只保存运行时内存 token。
  - 提供 set/get/clear。
- 更新 `src\lib\auth-api.ts`
  - register/login/me 成功时写入 token。
  - anonymous/logout 时清空 token。
- 更新 `src\lib\workbench-api.ts`
  - password auth mode 写请求自动带 `x-shanhai-csrf`。

## 5. 风险与回退

- 风险：刷新后 token 丢失。回退：`usePasswordAuth` 启动时已有 `me()`，本阶段让 `me()` 返回新 token。
- 风险：local mode E2E 被误拦截。回退：`requiresCsrfToken` 只对 public auth mode 写请求生效。
- 风险：测试 fake db 与 Prisma shape 不一致。回退：新增 focused Node tests 覆盖 session/CSRF 逻辑，同时保留全量 `npm test`。
- 风险：CSRF token 频繁生成导致表增长。M40-D 可接受；后续 M40-E 或生产运维阶段增加过期 token 清理。

## 6. 验收标准

- 无 session 或伪造 session cookie 的 public workbench 请求返回 401。
- 撤销或过期 session 不再生成 actor。
- public write request 缺少或带错 CSRF token 返回 403。
- public write request 带同 session 的有效 CSRF token 才进入 handler。
- GET 请求不要求 CSRF。
- local auth mode 写请求不要求 CSRF。
- password 登录、刷新恢复、退出、默认本地主链路、双上下文隔离不回归。

