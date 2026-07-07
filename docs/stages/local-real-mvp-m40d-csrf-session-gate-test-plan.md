# Local Real MVP M40-D 测试定义

日期：2026-07-08

## 1. 行为红线

M40-D 的测试必须证明：

- public/password actor 不再从 cookie 明文直接伪造。
- CSRF token 不是纯前端状态，必须绑定真实 `AuthSession.id` 并落库。
- workbench 写请求只有在同源、已登录、CSRF 有效三者同时满足时才允许执行。
- local mode 不因 public 安全门禁而回归失败。

## 2. 新增 focused tests

### 2.1 `tests\public-auth-session-gate.test.mjs`

覆盖：

- `resolveWorkbenchSession` 在 password mode 下会查询 `AuthSession`。
- 缺 cookie、过期 session、revoked session 返回未认证。
- 有效 session 返回真实 `LocalUser.id/displayName/role/authMode`。
- 用户 membership 被装入 actor.projectRoles。

红灯预期：

- 当前实现只根据 cookie 构造 `session:<token>` actor，不查 DB。

命令：

```powershell
node --test tests\public-auth-session-gate.test.mjs
```

### 2.2 扩展 `tests\public-auth-csrf.test.mjs`

覆盖：

- `issueCsrfToken` 会写入 `CsrfToken`。
- `validateCsrfToken` 只接受同 session、同 user、未过期 token。
- 错 session、错 token、过期 token 返回 false。

红灯预期：

- 当前 `csrf.ts` 没有落库 issue/validate 方法。

命令：

```powershell
node --test tests\public-auth-csrf.test.mjs
```

### 2.3 `tests\public-auth-workbench-csrf.test.mjs`

覆盖：

- password mode POST 缺少 `x-shanhai-csrf` 返回 403。
- password mode POST 带有效 token 后进入 handler。
- password mode GET 不要求 CSRF。
- local mode POST 不要求 CSRF。

红灯预期：

- 当前 wrapper 没有 CSRF 落库校验。

命令：

```powershell
node --test tests\public-auth-workbench-csrf.test.mjs
```

### 2.4 扩展 `tests\password-auth-client.test.mjs`

覆盖：

- auth client 从 register/login/me 响应捕获 `csrfToken`。
- logout 或 anonymous me 清空 token。
- workbench api 在 password mode 的写请求自动加 `x-shanhai-csrf`。

命令：

```powershell
node --test tests\password-auth-client.test.mjs
```

## 3. 集中验收命令

完成实现后集中运行：

```powershell
node --test tests\public-auth-session-gate.test.mjs tests\public-auth-csrf.test.mjs tests\public-auth-workbench-csrf.test.mjs tests\password-auth-client.test.mjs
npm test
npm run build
npm run test:e2e:stage40c
npm run test:e2e:stage2
npm run test:e2e:stage7
git diff --check
```

## 4. 审查清单

- 不输出 session 明文 token、token hash、CSRF token、私有 provider 响应或 `.env`。
- 不把 CSRF token 写入 localStorage。
- 不让 React 组件直接接触后端 DB 或 provider SDK。
- 不扩大为 OAuth/SSO 或完整共享协作 UI。
- 不破坏 local mode 的本地 MVP 路径。

