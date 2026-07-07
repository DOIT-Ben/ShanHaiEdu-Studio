# Local Real MVP M29 Local Auth Access Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

M29 的核心需求是把当前“只靠 projectId 访问项目”的本地 MVP，推进到“每个浏览器会话有本地用户身份，项目读写和素材下载都经过同一访问判断”的账号/权限最小闭环。

本阶段不是公网账号系统，不做注册、密码、OAuth、短信、邮箱验证、后台管理或多租户计费。当前最小成功标准是：

- 浏览器首次访问 API 时获得一个本地会话身份。
- 新建项目记录本地会话用户为项目所有者。
- 项目列表只返回当前会话可访问项目。
- 项目 snapshot、消息、产物、确认、重做、真实生成和下载 route 都必须先确认当前会话有项目访问权。
- 不属于当前会话的项目返回 404 或教师可理解错误，不泄露项目是否存在、owner id 或内部权限字段。
- 老数据 `ownerUserId = null` 继续兼容本地单人使用，避免升级后历史 dev 项目不可见。
- 前端教师界面不出现工程词或本地权限字段。

## 2. 可复用方案调研

项目内可复用资产：

- `src\server\workbench\service.ts`：当前所有项目、消息、产物和 snapshot 的业务入口。
- `src\server\workbench\repository.ts`：当前 Prisma 数据访问边界。
- `src\app\api\workbench\projects\...\route.ts`：所有浏览器 API route 已集中在 App Router。
- `tests\e2e\stage7-local-concurrency.spec.ts` 和 `tests\e2e\stage27-real-generation-linkage.spec.ts`：可继续验证不同浏览器 context 隔离和真实生成联动。

成熟做法参考：

- Next.js 官方 `cookies()` / Route Handler 能读写请求 Cookie，适合本地 MVP 的 httpOnly 会话标识：https://nextjs.org/docs/app/api-reference/functions/cookies
- Next.js 官方 Authentication Guide 将认证拆为身份、会话和授权三件事：https://nextjs.org/docs/app/guides/authentication
- OWASP Session Management Cheat Sheet 强调 session 标识应唯一且难预测，并应有超时：https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- OWASP Authorization Cheat Sheet 强调授权逻辑应贴合业务上下文并可维护：https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html

## 3. 复用、适配和必要自研

复用：

- 继续使用 Next.js Route Handler 和 `NextResponse` 设置 httpOnly cookie。
- 继续使用 Prisma/SQLite，不引入 Auth.js、OAuth provider 或密码库。
- 继续沿用后端 service/repository 分层，不把权限逻辑放进 React。

适配：

- 新增本地用户表 `LocalUser`，用于记录本地会话身份。
- `Project` 增加可空 `ownerUserId`，新建项目写入当前本地用户。
- `createWorkbenchService` 增加可选 actor，上层 route 按请求创建带 actor 的 service。
- service 层统一判断 actor 是否可访问项目；无 actor 的测试和内部调用保持兼容。
- route 层通过共享 helper 解析/设置本地会话 cookie，避免每个 route 手写 cookie 逻辑。

必要自研：

- 本地会话 cookie 解析、生成和设置 helper。
- 最小项目访问策略：`ownerUserId` 为空视为历史本地项目可见；非空时必须等于当前 actor。
- 权限失败统一为 404，避免跨会话探测项目存在性。

## 4. 开发方案、风险和验证标准

执行方案：

1. 写 M29 阶段规划和测试定义。
2. 写红灯测试：带 actor 的 service 创建项目会写 owner；另一个 actor 不能读 snapshot、消息、产物和确认；列表只显示可访问项目。
3. 写红灯 route/helper 测试：无 cookie 会生成本地 actor 并在响应设置 httpOnly cookie；已有 cookie 会复用 actor。
4. 修改 Prisma schema 和 SQLite 初始化脚本，支持 `LocalUser` 和 `Project.ownerUserId`。
5. 实现 `src\server\auth\local-session.ts`。
6. 改造 service 层访问策略。
7. 改造全部 workbench project route 绑定 actor。
8. 跑集中验收、更新报告和当前状态审计。
9. 提交 M29，不 push。

主要风险：

- 修改 schema 会影响 Prisma generated client，必须跑 `prisma generate`、`npm test` 和构建。
- 若只在部分 route 加权限，会形成下载或真实生成绕过；必须覆盖所有 `/api/workbench/projects/[projectId]` 下的 route。
- 老项目 owner 为空需要兼容，否则本地历史数据会突然不可见。
- 本阶段只做本地会话，不具备公网账号安全强度；部署前还需要密码/SSO/OAuth、CSRF 策略、审计日志和管理员能力。

验证标准：

- `node --test tests\local-session-auth.test.mjs` 通过。
- `node scripts\init-sqlite-schema.mjs; npx vitest run src/server/workbench/__tests__/stage29-local-auth-access.test.ts --maxWorkers=1` 通过。
- `npm test` 通过。
- `npm run build` 通过。
- `npm run test:e2e:stage7` 通过，确认不同浏览器 context 隔离不回归。
- `node scripts\run-stage27-e2e.mjs` 通过，确认真实生成和下载 route 权限改造后不回归。
- `git diff --check`、`.env/.tmp` ignore 检查、敏感扫描和残留进程检查通过。
