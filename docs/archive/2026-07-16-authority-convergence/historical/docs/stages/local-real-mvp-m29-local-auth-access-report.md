# Local Real MVP M29 Local Auth Access Report

日期：2026-07-07

## 1. 阶段目标

M29 目标是补齐本地真实 MVP 的账号/权限最小闭环：每个浏览器会话拥有本地用户身份，新建项目归属当前会话用户，项目读写、产物下载、真实生成和材料包导出都经过同一访问判断。

本阶段不做公网注册、密码登录、OAuth、管理员后台、组织/班级、多租户计费或审计日志。

## 2. 本阶段变更

数据模型：

- 新增 `LocalUser` 模型。
- `Project` 新增可空 `ownerUserId`。
- `scripts\init-sqlite-schema.mjs` 支持老 SQLite 库补列，并为 `Project.ownerUserId` 建索引。

本地会话：

- 新增 `src\server\auth\local-session.ts`。
- 无 cookie 请求会生成 `shanhai_local_user` 本地会话。
- 会话 cookie 使用 `HttpOnly`、`SameSite=Lax`、`Path=/` 和 30 天 `Max-Age`。
- 非法 cookie 会被丢弃并重新生成。
- 测试环境使用稳定 `local-test-user`，避免直接调用 route 的历史单元测试因为不回传 cookie 而失效；浏览器环境仍生成随机会话。

访问策略：

- `createWorkbenchService` 支持可选 actor。
- 新建项目自动写入当前 actor 为 owner。
- `listProjects` 按 owner 过滤；`ownerUserId = null` 的历史项目继续兼容本地单人升级场景。
- `getProject`、`getProjectSnapshot`、`getMessages`、`addMessage`、`getArtifacts`、`getArtifact`、`saveArtifact`、`approveArtifact`、`regenerateArtifact`、`getApprovedInputs`、`startAgentRun`、`finishAgentRun` 均先检查项目访问权。

Route 改造：

- 所有 `/api/workbench/projects` 和 `/api/workbench/projects/[projectId]...` route 通过 `withLocalWorkbenchActor` 绑定当前请求 actor。
- PPTX、图片、视频下载 route 已纳入同一权限边界。
- Coze PPT、图片、视频真实生成 route 已纳入同一权限边界。
- 最终材料包 route 读取多个 artifact 时继续复用带 actor 的 service，不绕过项目访问判断。

## 3. 验收记录

| 命令 | 结果 |
| --- | --- |
| `node --test tests\local-session-auth.test.mjs` | 红灯后绿灯；2 tests passed |
| `node scripts\init-sqlite-schema.mjs; npx vitest run src/server/workbench/__tests__/stage29-local-auth-access.test.ts --maxWorkers=1` | 红灯后绿灯；3 tests passed |
| `npm test` | 通过；Node 45 tests passed；Vitest 22 files / 84 tests passed |
| `npm run build` | 通过；仍有 1 条既有 Turbopack output tracing warning |
| `npm run test:e2e:stage7` | 通过；Chromium desktop 1 passed，两个 browser context 刷新后保持各自项目 |
| `node scripts\run-stage27-e2e.mjs` | 通过；Chromium desktop 1 passed，真实生成入口和下载联动不回归 |
| `git diff --check` | 通过；无空白错误 |
| `git check-ignore -v .env .tmp` | 通过；`.env` 与 `.tmp` 均被 `.gitignore` 忽略 |
| 本轮变更严格脱敏扫描 | 通过；未发现真实 key、token、Bearer 值、签名 URL 或任务标识值 |
| 残留进程检查 | 通过；未发现本工作区相关 Vitest/Jest/Playwright/Next dev 残留 Node 进程 |

## 4. 审查结论

M29 已完成本地账号/权限最小闭环：

- 浏览器会话具备本地用户身份。
- 新项目归属当前本地用户。
- 项目列表和项目读写按当前 actor 过滤。
- 跨 actor 不能通过 service 读取 snapshot、消息、产物、确认或重做对方项目。
- 所有项目 API route 已绑定请求 actor。
- 真实素材下载和真实生成 route 没有绕过权限边界。
- 老项目 owner 为空时仍可读取，避免本地升级后历史项目立即丢失。

当前不能表述为：

- 已具备公网账号系统。
- 已具备密码、OAuth、SSO、组织、班级、管理员后台或审计日志。
- 已具备生产级多租户安全。
- 已完成 CSRF 防护策略、登录风控或权限变更审计。

## 5. 剩余风险

- `shanhai_local_user` 是本地 MVP 会话，不是公网登录凭证；公网部署前必须替换或增强为正式认证方案。
- owner 为空的历史项目继续对本地 actor 可见，这是兼容策略，不是生产权限策略。
- 当前只有 owner 访问，没有角色矩阵、共享项目、只读协作者或管理员能力。
- 当前 route 仍保留部分既有测试依赖的内部错误文本；前端会继续用 teacher-facing message 做用户展示。
- M28 的 Turbopack output tracing warning 仍存在，生产部署前还需结合部署方式复查。

## 6. 下一阶段建议

优先进入 M30 长任务队列与状态恢复：

- PPT、图片、视频真实生成不应长期依赖单次 HTTP 请求生命周期。
- 需要保存任务状态、失败原因、重试次数、用户可见进度和刷新恢复。
- M30 应继续覆盖 Coze PPT、图片、视频三个真实生成入口。
