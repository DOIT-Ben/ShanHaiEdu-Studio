# Local Real MVP M40-D CSRF 与真实会话门禁报告

日期：2026-07-08

## 1. 阶段结论

M40-D 已完成 password/public auth mode 下的真实 session 装载与 CSRF 落库校验闭环。

当前可以表述为：

- workbench public actor 不再由 cookie 明文直接构造。
- password mode 会从 `AuthSession` 查询有效、未过期、未撤销 session，并装载真实 `LocalUser`。
- actor.userId 使用真实用户 id，displayName/role 来自用户记录。
- actor.projectRoles 会从 `ProjectMembership` 装载，既有 owner/editor/viewer 授权底座可基于真实 membership 工作。
- public/password 写请求必须带同 session 绑定、服务端落库、未过期的 `x-shanhai-csrf` token。
- 登录、注册和 `me` 会返回新的 CSRF token，前端只保存在运行时内存，workbench 写请求自动携带。
- logout 会撤销 session，并同步消费该 session 下未消费的 CSRF token。
- local auth mode 继续不强制 CSRF，M1-M39 本地默认 MVP 路径未被打断。

当前不能表述为：

- OAuth/SSO 已完成。
- 完整共享协作 UI、邀请模型或成员管理 UI 已完成。
- 审计查询 UI、rate limit、登录风控或完整公网安全监控已完成。

## 2. 实现内容

### 2.1 后端安全门禁

- `src\server\auth\csrf.ts`
  - 新增 `publicCsrfHeaderName`。
  - 新增 `issueCsrfToken`，生成 session-bound token hash 并写入 `CsrfToken`。
  - 新增 `validateCsrfToken`，按 sessionId、userId、tokenHash、未过期、未消费校验。
- `src\server\auth\session.ts`
  - public auth mode 改为查询 `AuthSession`。
  - 校验 session 未撤销、未过期且 authMode 匹配。
  - 装载 `LocalUser` 与 `ProjectMembership`。
  - membership role 只接受 owner/editor/viewer。
- `src\server\auth\workbench-route.ts`
  - public write requests 强制校验 `x-shanhai-csrf`。
  - 失败返回教师可理解 403，不暴露 token 或内部细节。
- `src\server\auth\password-auth.ts`
  - 注册/登录/me 返回 CSRF token。
  - logout 撤销 session 后消费未消费 CSRF token。
- `src\server\workbench\repository.ts`
  - 修复创建项目时误把已有 password 用户 upsert 成 local 用户的问题。

### 2.2 前端接入

- `src\lib\csrf-token.ts`
  - 新增运行时内存 token store。
- `src\lib\auth-api.ts`
  - 捕获 register/login/me 响应中的 `csrfToken`。
  - anonymous/logout 时清空 token。
- `src\lib\workbench-api.ts`
  - password auth mode 的 POST/PUT/PATCH/DELETE 自动携带 `x-shanhai-csrf`。

## 3. 测试新增与更新

新增：

- `tests\public-auth-session-gate.test.mjs`
- `tests\public-auth-workbench-csrf.test.mjs`
- `src\lib\csrf-token.ts`

扩展：

- `tests\public-auth-csrf.test.mjs`
- `tests\password-auth-client.test.mjs`
- `tests\password-auth.test.mjs`
- `tests\auth-security-hardening.test.mjs`
- `tests\public-auth-model.test.mjs`
- `tests\workbench-api.test.mjs`
- `src\server\workbench\__tests__\stage29-local-auth-access.test.ts`

红灯证据：

- M40-D focused tests 初次运行失败，覆盖：
  - 缺少 `issueCsrfToken`/`validateCsrfToken`。
  - public actor 仍为 `session:<token>`。
  - public write request 缺 CSRF 仍进入 handler。
  - workbench api 未携带 CSRF header。
- stage40c 初次运行发现真实回归：创建项目时 repository 把已有 password user 更新为 local user，导致后续 snapshot 401。已通过 repository 修复和回归测试收口。

## 4. 集中验收

通过命令：

```powershell
node --test tests\public-auth-session-gate.test.mjs tests\public-auth-csrf.test.mjs tests\public-auth-workbench-csrf.test.mjs tests\password-auth-client.test.mjs
npm test
npm run build
npm run test:e2e:stage40c
npm run test:e2e:stage2
npm run test:e2e:stage7
```

最新结果：

- Focused M40-D Node tests：9 passed。
- `npm test`：Node 91/91 passed；Vitest 24 files / 92 tests passed。
- `npm run build`：通过。
- `npm run test:e2e:stage40c`：Chromium desktop + Chromium narrow，2 passed。
- `npm run test:e2e:stage2`：Chromium desktop，2 passed。
- `npm run test:e2e:stage7`：Chromium desktop，1 passed。

## 5. 审查结论

- 未把 session 明文 token、session hash、CSRF token、私有 endpoint、provider 响应或 `.env` 写入文档。
- CSRF token 不进入 localStorage，不进入 URL。
- OpenAI/Coze/图片/视频 provider 逻辑未被触碰。
- React 组件没有直接接触 DB 或 provider SDK。
- local mode 主链路和 password auth mode 浏览器闭环都通过。

## 6. 剩余风险

- M40-D 仍不是完整公网认证体系；OAuth/SSO、共享协作 UI、管理员 UI、审计查询 UI、rate limit、登录风控仍需后续阶段。
- 当前 CSRF token 采用可重复使用至 session 过期的 session-bound token；后续生产安全阶段可增加 token 轮换、过期清理和更细粒度审计。
- 旧的本地 SQLite 数据库若早于 M40 schema，可能缺少 auth/session/csrf 相关列；正式本地生产运行前仍需执行迁移或重建策略确认。

## 7. 下一步

M40-D 可作为账号权限安全闭环的阶段收尾。下一阶段可进入 M41：智能体端到端自动交付演示规划与实施，把本地交付流程编排成一条命令可验收的 production-like demo。

