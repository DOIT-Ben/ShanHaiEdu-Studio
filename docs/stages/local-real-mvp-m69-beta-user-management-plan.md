# M69 内测多用户管理阶段计划

日期：2026-07-11

状态：planned

## 1. 目标

把 M67 已有的密码认证、管理员邀请和项目成员底座扩展为可用于内测的多用户管理能力：公开注册继续关闭，账号由管理员分配；多个教师能安全登录；项目、对话、产物和反馈按 owner / membership 隔离；管理员能日常管理账号并撤销风险会话。

## 2. 范围

本阶段纳入：

- 用户状态：为 `LocalUser` 增加停用、停用原因、最后登录和凭据重置时间等最小字段。
- 认证门禁：停用账号不能登录；停用、角色变更、重置凭据和手动撤销会使既有 session 与 CSRF 失效。
- 管理员用户 API：列表/搜索、邀请、停用、启用、角色调整、重置初始密码、撤销会话。
- 项目成员 API：项目 owner 或 admin 可添加成员、调整 `editor/viewer`、移除成员；owner 不可被移除为无 owner 状态。
- 前端入口：管理员在账户菜单进入用户管理面板；项目顶部“协作”入口从禁用改为受控成员管理。
- 授权回归：workbench 项目、消息、产物、生成任务和反馈上下文继续按 owner / membership 做服务端校验。
- 审计：账号停启用、角色变更、凭据重置、会话撤销、项目成员变更写入脱敏 `AuditLog`。

## 3. 不纳入

- 公开注册、自助找回密码、邮箱发送邀请、学校/组织多租户、SSO、OAuth、计费、复杂 RBAC。
- 让 local auth 成为安全多用户边界；真实内测仍要求 `SHANHAI_AUTH_MODE=password`。
- 大规模重构 workbench service；只做与 M69 权限闭环直接相关的收口。

## 4. 现有复用

- 复用 `LocalUser`、`AuthSession`、`ProjectMembership`、`AuditLog`、`CsrfToken`。
- 复用 `resolveWorkbenchSession`、`createWorkbenchActor`、`canReadProject`、`canWriteProjectContent`。
- 复用 `provisionPasswordUser` 作为管理员创建账号底层能力。
- 复用 `ProfileMenu`、`WorkbenchTopbar`、现有 `Dialog/Sheet/Button/Input` 风格构建轻量管理 UI。

## 5. 实现设计

### 5.1 数据与认证

- `LocalUser` 增加 `disabledAt`、`disabledReason`、`lastLoginAt`、`passwordResetAt`。
- `loginPasswordUser` 和 `resolveWorkbenchSession` 遇到 `disabledAt != null` 时拒绝认证。
- 登录成功更新 `lastLoginAt`。
- 新增 auth admin service，集中实现 `listUsers`、`updateUserStatus`、`updateUserRole`、`resetUserPassword`、`revokeUserSessions`。
- session 撤销同时消费未使用 CSRF token。

### 5.2 用户管理 API

- `GET /api/admin/users`：仅 password admin，可搜索邮箱/名称，返回脱敏用户摘要和 active/disabled 状态。
- `POST /api/admin/users/invite`：保留现有路径，允许受控创建 teacher/admin；默认 teacher，非 admin 不可调用。
- `PATCH /api/admin/users/[userId]`：停用/启用/角色调整；禁止管理员停用或降级自己。
- `POST /api/admin/users/[userId]/reset-password`：设置新初始密码并撤销该用户旧会话，响应不回显明文密码。
- `POST /api/admin/users/[userId]/sessions/revoke`：撤销目标用户所有当前 session。

### 5.3 项目成员 API

- `GET /api/workbench/projects/[projectId]/members`：项目成员可读，普通非成员拒绝。
- `POST /api/workbench/projects/[projectId]/members`：owner/admin 添加成员，角色仅 `editor/viewer`。
- `PATCH /api/workbench/projects/[projectId]/members/[userId]`：owner/admin 修改成员角色。
- `DELETE /api/workbench/projects/[projectId]/members/[userId]`：owner/admin 移除成员；不能移除项目 owner 的 owner 身份。

### 5.4 前端

- 管理员账户菜单增加“用户管理”，打开管理面板。
- 用户管理面板支持搜索、邀请账号、停用/启用、角色调整、重置密码和撤销会话，所有密码输入只作为一次性表单字段，不回显。
- 顶部“协作”按钮改为在有项目时可用，打开成员面板；owner/admin 可管理成员，viewer/editor 只看成员列表。
- 所有可见文案使用教师/管理员能理解的语言，不展示 schema、provider、token、内部路径等工程词。

## 6. 风险与约束

- schema 变更需要 `prisma generate` 与测试库同步；本项目当前无 migration 目录，按既有 `db:push`/测试初始化方式处理。
- API 与 UI 一起做会触碰面较广，优先保证服务端权限和测试，UI 保持简单可用。
- 当前 local auth cookie 可伪造，本阶段不把 local 模式承诺为安全多用户；内测门禁仍是 password auth。

## 7. 验收标准

- 公开注册默认关闭，管理员邀请是创建内测账号的受控入口。
- 管理员可列表/搜索/邀请/停启用/调角色/重置密码/撤销会话；普通教师全部拒绝。
- 停用、角色变更、重置密码和撤销会话后，旧 cookie 不能继续通过 `/api/auth/me` 或 workbench 写接口。
- owner/editor/viewer/non-member 的项目读写矩阵正确；跨用户伪造 `projectId`、`artifactId`、`messageId` 被拒绝。
- 管理员和项目 owner 能通过 UI 完成核心管理动作，桌面和窄屏不溢出。
- `npm test`、`npm run build`、`git diff --check`、`graphify update .` 通过。
