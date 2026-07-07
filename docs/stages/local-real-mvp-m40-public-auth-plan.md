# Local Real MVP M40 Public Auth Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

M40 的核心需求不是再增强本地临时 cookie，而是把 ShanHaiEdu 从“本机单人/少量本地会话隔离”推进到“具备公网认证和权限系统落地能力”的工程边界。

公网认证最小闭环必须回答四个问题：

1. 这个请求是谁发起的。
2. 这个人是否登录且会话仍有效。
3. 这个人对项目、产物、生成任务和管理入口有什么权限。
4. 关键写操作是否能被审计、追踪和回滚。

当前 M29/M32 已经具备本地 actor、项目 owner、同源写保护、HTTPS Secure cookie 和基础安全头，但它不是公网正式认证。M40 要在不推翻现有本地 MVP 的前提下，增加可公网化认证模型，并保留客户端 exe、本地浏览器和测试环境的低摩擦入口。

本阶段不做远端部署、不接真实企业 SSO、不上线公网域名、不引入收费外部身份服务，也不把本地 `shanhai_local_user` cookie 继续包装成公网登录态。

## 2. 可复用方案调研

项目内可复用：

- `src\server\auth\local-session.ts` 已集中生成本地 actor 和 cookie。
- `src\server\auth\workbench-route.ts` 已是 workbench API 的统一 actor 包装入口。
- `src\server\workbench\service.ts` 已通过 actor 保护项目读取、消息、产物、确认、重做和 generation jobs。
- `prisma\schema.prisma` 已有 `LocalUser`、`Project.ownerUserId` 和最小角色字段。
- `tests\local-session-auth.test.mjs`、`tests\auth-security-hardening.test.mjs`、`stage29-local-auth-access.test.ts` 已覆盖本地账号隔离和安全边界。

官方/一手依据：

- Next.js 官方 Authentication Guide 将认证拆为身份验证、会话管理和授权，适合本阶段把当前本地 actor 拆成可替换的 auth provider 与 authorization 层：https://nextjs.org/docs/app/guides/authentication
- Next.js 官方 cookies API 支持 Route Handler 中读写 cookie，是当前项目继续封装 session cookie 的基础：https://nextjs.org/docs/app/api-reference/functions/cookies
- OWASP Authentication Cheat Sheet 强调密码认证、错误响应、登录节流和会话安全不能泄露账户状态：https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- OWASP Session Management Cheat Sheet 强调 session id 必须足够随机、不可预测、并有过期与生命周期管理：https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- OWASP Authorization Cheat Sheet 强调 deny by default、least privilege，并在每次请求处做授权检查：https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- OWASP CSRF Prevention Cheat Sheet 建议 SameSite cookie、Origin/Referer 校验和同步/双提交 token 等纵深防御：https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- OWASP Password Storage Cheat Sheet 推荐 Argon2id 或 bcrypt 等强哈希方案，并避免明文或可逆加密保存密码：https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- Auth.js 提供成熟 Next.js 认证方案，可作为后续 OAuth/OIDC/SSO 适配参考，但 M40 首切片不强制引入，避免在本地 MVP 中一次性扩大依赖面：https://authjs.dev/

## 3. 复用、适配和必要自研

推荐方向：

优先采用“项目内 Auth Boundary + 可迁移数据模型”的渐进方案，而不是立即引入完整第三方 auth 框架。

理由：

- 当前所有 workbench route 已经经过 `withLocalWorkbenchActor`，只要把它升级为 `withWorkbenchActor`，即可复用大部分权限保护。
- 本地 exe 和浏览器 MVP 仍需要无外部账号的低摩擦本地模式；直接引入 OAuth-only 会破坏当前验收链路。
- 公网正式认证需要先把 session、user、membership、role、audit log 和 CSRF token 的数据结构固定下来，再决定是否接 Auth.js、OIDC 或企业 SSO。

适配策略：

- 把 `LocalUser` 演进为可兼容本地用户和正式用户的 `User` 概念，保留本地 actor 作为 `authMode=local`。
- 增加 `AuthSession`，让公网 session 不再只是裸 user id cookie。
- 增加 `ProjectMembership`，从单 owner 扩展到 owner/editor/viewer/admin 权限模型。
- 增加 `AuditLog`，记录登录、退出、项目创建、项目共享、产物确认、真实生成、下载和管理操作。
- 增加 `CsrfToken` 或等价 signed token 机制，用于公网写操作；M32 的 Origin/Referer 校验继续保留为第一层防护。
- 增加 `AuthConfig` 或环境门禁，明确 `local`、`password`、`oauth`、`sso` 的启用状态，避免测试、本地 exe 和公网部署互相污染。

必要自研：

- `src\server\auth\actor.ts`：统一 actor 类型，包含 `userId`、`role`、`authMode`、`membershipRole`、`isAdmin`。
- `src\server\auth\session.ts`：统一 session 解析、创建、过期和 cookie 设置。
- `src\server\auth\authorization.ts`：项目级权限判断，默认拒绝，显式允许。
- `src\server\auth\csrf.ts`：写接口 CSRF token 生成与验证。
- `src\server\auth\audit-log.ts`：统一审计事件写入 helper。
- 认证 API route：登录、退出、当前用户、CSRF token、项目成员管理。

暂不自研：

- 不自研 OAuth/OIDC 协议栈；后续若接入，优先复用 Auth.js 或标准 OIDC client。
- 不在 M40 首切片做复杂组织/班级管理 UI。
- 不把 SQLite 包装为公网生产数据库；M40 只保证 schema 与服务边界可迁移。

## 4. 开发方案、风险和验证标准

### 4.1 阶段拆分

M40-A：认证与权限模型基线

- 扩展 Prisma schema：`User`/`AuthSession`/`ProjectMembership`/`AuditLog`/`CsrfToken`。
- 保留本地模式兼容：无公网 auth 配置时继续生成本地 actor。
- 所有 workbench route 通过新 `withWorkbenchActor`。
- 项目访问从 owner-only 迁移到 membership-aware，owner 仍是默认最高权限。

M40-B：密码登录最小闭环

- 增加注册/登录/退出/当前用户 API。
- 密码只存强哈希，不保存明文。
- 登录失败不泄露账户是否存在。
- session cookie 使用 httpOnly、SameSite、Secure、过期时间和服务端 session 记录。

M40-C：CSRF 与写操作保护

- 保留 M32 Origin/Referer 校验。
- 为公网 auth mode 增加 CSRF token，所有 POST/PUT/PATCH/DELETE workbench route 必须验证。
- 本地 exe 和测试模式可通过明确 auth mode 使用低摩擦策略，但不能影响公网模式。

M40-D：共享协作、管理员和审计

- 增加项目成员角色：owner、editor、viewer。
- 产物确认、重做、真实生成、下载、成员变更写入 audit log。
- 管理员只能查看必要元数据，不直接绕过产物内容权限，除非显式审计。

M40-E：OAuth/SSO readiness

- 不在首轮接真实 provider，但固定 provider account 数据结构和配置开关。
- 为后续 Auth.js/OIDC 接入留出 adapter 层。
- 文档明确如何从 password/local 迁移到 OAuth/SSO。

### 4.2 风险

- 权限改造容易产生“某些下载 route 绕过 service”的漏洞，所有 artifact/package/video/image/PPTX 下载 route 必须重新做跨用户测试。
- 本地 exe 需要继续支持离线/本地模式，不能因为公网 auth 改造导致本地客户端首次打开需要外部登录。
- SQLite 对本地 MVP 可接受，但公网多人协作应记录迁移 PostgreSQL 条件。
- 密码登录属于高风险安全面，若 M40-B 无法完整验证强哈希、节流、错误不泄露和 session 过期，不得宣称公网认证完成。
- OAuth/SSO 如果后续接入，必须只走成熟库和官方 provider 配置，不手写协议细节。

### 4.3 验证标准

- 新增 auth 模型测试：session 过期、非法 session、不同 auth mode、cookie 安全属性。
- 新增 authorization 测试：owner/editor/viewer/admin 对项目、消息、产物、下载、真实生成、成员管理的允许/拒绝矩阵。
- 新增 CSRF 测试：公网写请求缺 token、错 token、跨站来源均拒绝；合法 token 通过。
- 新增 audit log 测试：登录、退出、项目创建、成员变更、确认产物、触发生成和下载能写入审计事件，且不记录密钥、token、远程素材 URL。
- 浏览器 E2E：本地模式不回归；公网 auth mode 下未登录不能进入工作台，登录后可创建项目，另一个用户不能读取。
- 回归命令：
  - `node --test tests\local-session-auth.test.mjs`
  - `node --test tests\auth-security-hardening.test.mjs`
  - 新增 M40 auth/authorization/CSRF/audit tests
  - `npm run test:e2e:stage7`
  - `npm test`
  - `npm run build`

## 5. M40 首切片建议

首切片建议只做 M40-A，不直接做密码登录 UI：

```text
LocalUser/owner-only
-> User/AuthSession/ProjectMembership/AuditLog/CSRF-ready schema
-> withWorkbenchActor 统一入口
-> membership-aware authorization
-> local mode 兼容不回归
```

这样可以先把所有 API route 的权限地基打牢，再进入密码登录、OAuth/SSO、管理员和共享协作。
