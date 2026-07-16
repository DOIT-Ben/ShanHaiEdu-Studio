# M69 内测多用户管理阶段收尾

日期：2026-07-11

状态：工程完成；真实用户开放门禁未关闭

## 1. 完成内容

- `LocalUser` 增加账号停用、停用原因、最后登录和密码重置时间字段；本地 SQLite 初始化脚本支持增量补列。
- 密码认证拒绝停用账号登录，停用账号既有 session 不再解析为有效 actor；登录成功记录最后登录时间。
- 管理员用户管理服务与 API 已完成：列表/搜索、邀请、停用/启用、角色调整、重置密码、撤销会话。
- 管理员敏感操作会撤销目标用户现有 session，并消费未使用 CSRF token；响应不回显明文密码、hash、session token 或 csrf。
- 项目成员服务与 API 已完成：成员列表、添加成员、调整 `editor/viewer`、移除成员，并保护项目 owner 不被移除为无 owner 状态。
- 前端新增用户管理弹窗和项目成员弹窗；账户菜单显示管理员入口，顶部“协作”入口在存在项目时打开成员管理。
- `/api/auth/me` 现在返回运行时认证模式；客户端不再只依赖构建期 `NEXT_PUBLIC_SHANHAI_AUTH_MODE`，避免 production 构建漏配公开变量时绕过登录门禁。
- 运行时 password auth 会同步启用 workbench 写请求 CSRF；缺少构建期公开变量时，新建项目、发送消息等写操作不会因漏带 CSRF 被拒绝。
- 管理员不能停用或降级当前登录的自己；项目 owner 不能通过成员添加/更新/删除路径被降级或移除。
- 管理员凭据表单成功后清空一次性密码字段；非 owner/admin 的成员弹窗只展示只读成员列表。

## 2. 关键边界

- 公开注册继续关闭；本阶段只支持管理员分配账号和密码登录。
- 本阶段不做学校/组织多租户、SSO/OAuth、自助找回密码、邮件发送邀请、计费或复杂 RBAC。
- `local` auth 仍不是安全多用户边界；真实内测必须使用 `SHANHAI_AUTH_MODE=password`。
- 真实用户开放仍等待 M67 生产实机门禁、真实外部 provider smoke 和一条真实教师任务端到端验收。

## 3. 验证证据

```text
node --test tests/admin-user-management.test.mjs tests/admin-user-routes.test.mjs tests/project-member-management.test.mjs tests/project-member-routes.test.mjs tests/password-auth.test.mjs tests/public-auth-session-gate.test.mjs
  13 tests passed / 0 failed

node --test tests/password-auth-client.test.mjs tests/password-auth-routes.test.mjs tests/password-auth.test.mjs tests/public-auth-session-gate.test.mjs tests/admin-user-routes.test.mjs tests/admin-user-management.test.mjs tests/project-member-routes.test.mjs tests/project-member-management.test.mjs
  20 tests passed / 0 failed

npm test
  Node: 210 passed / 0 failed
  Vitest: 459 passed / 0 failed

npm run build
  Prisma Client generated
  Next.js production build exit 0

Playwright production smoke at http://127.0.0.1:3020
  Password auth runtime mode shows login gate even without NEXT_PUBLIC_SHANHAI_AUTH_MODE at build time
  Admin login succeeds against a temporary SQLite DB
  Creating a project succeeds, confirming runtime CSRF is applied to workbench writes
  Account menu shows user management entry
  User management dialog loads list and core controls on desktop
  390px viewport shows member-management entry and opens the members dialog
```

## 4. 未包含范围

- 未做真实外部 PPTX、图片、视频 provider 网络 smoke。
- 未关闭目标服务器共享卷重启、release 回滚和备份恢复门禁。
- 未实现 MCP Client Adapter。
- 未把 provider/package 工具暴露给 OpenAI native tool loop。

## 5. 下一步

进入 M70 前端功能需求收口：对齐前端优先级需求和 M54-A 未完成项，补齐欢迎态、附件/截图、文件状态、模型/工具菜单、输出提示和窄屏体验；完成后提交不推送。
