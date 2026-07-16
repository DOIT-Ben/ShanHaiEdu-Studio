# Local Real MVP M40 Public Auth Test Plan

日期：2026-07-07

## 1. 测试目标

M40 测试目标是证明账号权限系统从本地 owner 隔离升级到公网认证可落地的工程边界，同时不破坏当前本地浏览器和客户端 exe MVP。

首轮测试先覆盖 M40-A：认证模型、session 边界、membership-aware 授权、CSRF-ready 入口和审计日志准备。

## 2. TDD 红灯用例

### M40-1：统一 actor 和 session 模型

建议命令：

```powershell
node --test tests\public-auth-model.test.mjs
```

红灯标准：

- 缺少统一 `WorkbenchActor.authMode` 时失败。
- 缺少服务端 session 记录或 session 过期字段时失败。
- 公网模式仍直接信任裸 user id cookie 时失败。
- 本地模式不能继续生成本地 actor 时失败。

### M40-2：项目 membership 授权矩阵

建议命令：

```powershell
node scripts\init-sqlite-schema.mjs; npx vitest run src/server/workbench/__tests__/stage40-public-auth-authorization.test.ts --maxWorkers=1
```

红灯标准：

- owner 可以管理项目和成员。
- editor 可以读写项目内容、确认产物、触发生成，但不能转移 owner 或删除成员。
- viewer 只能读取项目和下载被允许的产物，不能写消息、确认、重做或触发真实生成。
- 非成员不能读取 snapshot、messages、artifacts、generation jobs、PPTX、package、image、video 下载。
- `ownerUserId = null` 的历史本地项目只在 local auth mode 下兼容可见，public auth mode 下必须迁移或拒绝。

### M40-3：CSRF-ready 写保护

建议命令：

```powershell
node --test tests\public-auth-csrf.test.mjs
```

红灯标准：

- public auth mode 下，POST/PUT/PATCH/DELETE 缺 CSRF token 必须 403。
- token 与 session 不匹配必须 403。
- M32 的 Origin/Referer 跨站阻断继续生效。
- local auth mode 的现有浏览器和客户端 exe smoke 不受公网 token 门禁误伤。

### M40-4：审计日志边界

建议命令：

```powershell
node --test tests\public-auth-audit-log.test.mjs
```

红灯标准：

- 登录、退出、项目创建、成员变更、产物确认、真实生成、下载写入 audit log。
- audit log 记录 actor、action、target、时间和安全 metadata。
- audit log 不记录 key、token、私有 endpoint、远程素材 URL、完整 provider 响应或本机绝对私有路径。

## 3. 集中验收

| 命令 | 通过标准 |
| --- | --- |
| `node --test tests\local-session-auth.test.mjs` | 本地 session 不回归 |
| `node --test tests\auth-security-hardening.test.mjs` | M32 同源/安全头不回归 |
| `node --test tests\public-auth-model.test.mjs` | M40 actor/session 模型通过 |
| `node --test tests\public-auth-csrf.test.mjs` | public mode CSRF 门禁通过 |
| `node --test tests\public-auth-audit-log.test.mjs` | 审计日志边界通过 |
| `node scripts\init-sqlite-schema.mjs; npx vitest run src/server/workbench/__tests__/stage40-public-auth-authorization.test.ts --maxWorkers=1` | membership 授权矩阵通过 |
| `npm run test:e2e:stage7` | 双上下文本地隔离不回归 |
| `npm test` | 总测试通过 |
| `npm run build` | 构建通过 |

## 4. 审查项

- 不提交 `.env`、测试数据库、本地 session 数据、真实账号、密码哈希样本或 provider 凭据。
- 不在日志、测试快照或文档里写入 key、token、私有 endpoint、远程素材 URL。
- 不把 local auth mode 描述成公网认证。
- 不让 React 组件直接读取密码哈希、session secret 或 provider secret。
- 不绕过 service/authorization 层读取项目、产物、下载或 generation jobs。
- 不把 admin 做成无审计的超级绕过入口。

## 5. 通过后才能进入的开发事项

- M40-B 密码登录最小闭环。
- M40-C public mode CSRF token 全面接入。
- M40-D 共享协作、管理员和审计 UI。
- M40-E OAuth/SSO adapter readiness。
