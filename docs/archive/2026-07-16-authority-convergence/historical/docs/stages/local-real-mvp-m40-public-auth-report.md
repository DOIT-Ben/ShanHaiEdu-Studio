# Local Real MVP M40 Public Auth Report

日期：2026-07-07

## 1. 阶段目标

M40-A 目标是在 M29 本地 actor/owner 隔离和 M32 安全加固基础上，补齐公网正式认证前的服务端底座：统一 actor 模型、public session cookie 边界、membership-aware 授权、CSRF-ready helper、审计日志脱敏 helper，以及可迁移的 Prisma/SQLite schema。

本阶段不做密码登录 UI、不接 OAuth/SSO、不上线公网，不把本地 `shanhai_local_user` cookie 描述为公网登录凭证。

## 2. 本阶段变更

- 新增 `src\server\auth\actor.ts`，定义 `AuthMode`、`WorkbenchActor`、管理员标识和项目成员角色。
- 新增 `src\server\auth\authorization.ts`，集中处理项目读取、内容写入、真实生成和成员管理权限。
- 新增 `src\server\auth\session.ts`，区分本地 `shanhai_local_user` 和公网 session cookie `shanhai_session`。
- 新增 `src\server\auth\csrf.ts`，提供 session-bound CSRF token hash 与 public auth write gate 判断。
- 新增 `src\server\auth\audit-log.ts`，提供审计日志 entry 构造和敏感 metadata 脱敏。
- `src\server\workbench\service.ts` 从 owner-only 判断升级为 read/write/generate 三类访问判断。
- `LocalUser` 增加 `authMode`、`email`、`passwordHash`；新增 `AuthSession`、`ProjectMembership`、`AuditLog`、`CsrfToken`。
- `scripts\init-sqlite-schema.mjs` 同步创建新表、索引和旧库补列。

## 3. 验收记录

| 命令 | 结果 |
| --- | --- |
| `node --test tests\public-auth-model.test.mjs tests\public-auth-csrf.test.mjs tests\public-auth-audit-log.test.mjs` | 通过；5 tests passed |
| `node --test tests\auth-security-hardening.test.mjs` | 通过；5 tests passed |
| `node --test tests\local-session-auth.test.mjs` | 通过；2 tests passed |
| `node scripts\init-sqlite-schema.mjs; npx vitest run src/server/workbench/__tests__/stage40-public-auth-authorization.test.ts --maxWorkers=1` | 通过；3 tests passed |
| `npm test` | 通过；Node 79 tests passed；Vitest 24 files / 91 tests passed |
| `npm run build` | 通过；exit 0 |
| `npm run test:e2e:stage7` | 通过；Chromium desktop 1 passed |

## 4. 审查结论

M40-A 已完成公网正式认证的服务端地基，但还不是完整公网账号系统。

当前可以表述为：

- 项目已具备 local/password/oauth/sso 四类 auth mode 的 actor 表达。
- 公网 session cookie 已与本地 user cookie 分离。
- 服务端 schema 已具备 session、membership、CSRF token 和 audit log 数据结构。
- workbench service 已支持 owner/editor/viewer/admin 的基础授权差异。
- public auth write gate 和审计脱敏已有可测试 helper。

当前仍不能表述为：

- 密码登录已完成。
- OAuth/SSO 已完成。
- CSRF token 已在所有 public write route 完整接入并落库校验。
- 管理员 UI、共享协作 UI 或审计查询 UI 已完成。
- 公网生产登录风控或部署已完成。

## 5. 下一阶段建议

优先进入 M40-B：密码登录最小闭环。

建议只做服务端 API 与测试，不急着做复杂 UI：

1. 注册/登录/退出/当前用户 API。
2. 密码强哈希存储。
3. 登录失败不泄露账户是否存在。
4. 服务端 session 记录、过期和撤销。
5. public auth mode 下未登录 workbench API 返回 401。
