# M69 内测多用户管理测试计划

日期：2026-07-11

状态：planned

## 1. RED 测试优先级

先写失败测试，再实现：

1. 用户状态与 session：停用用户不可登录；停用、角色变更、重置密码、撤销会话后旧 session 失效。
2. 管理员用户 API：未登录 401、教师 403、缺 CSRF 403、admin 成功；响应不包含密码、hash、session token。
3. 项目成员授权：owner/editor/viewer/non-member 对读、写、生成、产物下载的权限矩阵。
4. 反馈上下文隔离：教师不能读取 admin feedback；伪造他人 project/message 上下文被拒绝。
5. UI smoke：管理员能打开用户管理，项目 owner 能打开协作成员面板；窄屏无明显溢出。

## 2. 单元与 Route 测试

- 新增 `tests\admin-user-management.test.mjs`：覆盖 admin service 的用户列表、状态更新、角色变更、重置密码、撤销 session 与脱敏审计。
- 新增 `tests\admin-user-routes.test.mjs`：覆盖 `/api/admin/users` 与 user detail action routes 的认证、CSRF、权限和响应脱敏。
- 新增 `tests\project-membership-routes.test.mjs`：覆盖项目成员列表、添加、改角色、删除和非 owner/admin 拒绝。
- 扩展 `tests\public-auth-session-gate.test.mjs`：覆盖 disabled user session 不再解析为 actor。
- 扩展 `tests\password-auth.test.mjs`：覆盖 disabled user 登录失败和 lastLoginAt 更新。
- 扩展 `src\server\workbench\__tests__\stage40-public-auth-authorization.test.ts`：覆盖 editor/viewer/non-member 写入、生成和产物读取边界。

## 3. 前端与 E2E

- 扩展或新增 `tests\e2e\stage69-user-management.spec.ts`：
  - admin 登录后可打开用户管理面板。
  - admin 创建教师账号，教师可登录。
  - owner 添加成员后，成员能看到项目；非成员看不到项目。
  - 停用教师后，教师刷新回到登录态或被拒绝访问。
- 窄屏 viewport 检查用户管理和协作面板无文字溢出、关键按钮可点击。

## 4. 回归命令

阶段完成后集中运行：

```text
npm test
npm run build
git diff --check
graphify update .
```

必要时追加：

```text
npx vitest run src/server/workbench/__tests__/stage40-public-auth-authorization.test.ts --maxWorkers=1
node --test tests/admin-user-management.test.mjs tests/admin-user-routes.test.mjs tests/project-membership-routes.test.mjs
```

## 5. 不通过即回退的条件

- 普通教师能调用任意管理员用户接口。
- 停用或重置后旧 session 仍可访问 `/api/auth/me`。
- 非成员能读取项目、消息、产物或反馈上下文。
- API 响应、日志或 UI 回显明文密码、hash、session token、CSRF token 或本地路径。
