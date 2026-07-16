# M67 内测反馈中心测试计划

日期：2026-07-10

状态：自动化与本地浏览器验收已完成；真实服务器重启、release 回滚和备份恢复仍是邀请内测前的发布门禁。结果见 `docs\stages\local-real-mvp-m67-beta-feedback-center-closeout.md`。

## 1. 目标

证明反馈中心不仅能显示表单，而且能安全、幂等地保存分类、描述、上下文和图片；支持剪贴板图片粘贴；管理员可受控查看，普通用户不能读取他人反馈；部署重启后数据仍存在。

## 2. 合同与单元测试

建议测试：

```text
tests\feedback-contract.test.ts
tests\feedback-storage.test.ts
tests\feedback-service.test.ts
tests\feedback-auth.test.ts
tests\feedback-sqlite-upgrade.test.ts
```

覆盖：

- 分类枚举、描述和影响程度校验。
- 每类有 2-3 个可点击提示 chip；点击追加且不重复、不覆盖草稿。
- `idempotencyKey` 必填，唯一约束为 `createdBy + idempotencyKey`，同时保存规范化请求指纹。
- `createdBy` 必须来自认证 actor 且非空；不存在 NULL actor 绕过复合唯一约束的路径。
- PNG、JPEG、WebP 真实解码通过。
- SVG、HTML、脚本、伪扩展名拒绝；第 6 张、单张超过 10 MiB、总计超过 25 MiB、宽高超过 8192 px、解码像素超过 40,000,000 均在边界测试中拒绝。
- `projectId`、`messageId` 必须属于当前 actor 可访问范围；同时传入时 message 必须属于该 project。
- 第 N 张附件写入失败时清理已写附件，不产生成功记录或孤儿文件。
- 相同用户、相同幂等键、相同内容重试只返回同一反馈；同键不同内容返回 409。不同用户可以使用相同客户端幂等键。
- 普通教师读取/导出全部反馈被拒绝。
- 密码认证且 `isAdmin=true` 的管理员可查看列表、详情、附件和脱敏导出。
- 密码认证配置缺失时生产预检失败，不允许静默回退 local。
- 公开自助注册关闭；管理员 bootstrap 与教师 invite 都有审计记录且不回显凭据。
- `scripts\init-sqlite-schema.mjs` 对空库和已有库都创建 FeedbackRecord 及唯一索引，重复执行不重复记录、不删除既有数据。
- 人工构造重复 createdBy + idempotencyKey 的旧数据时，唯一索引升级必须停止并报告冲突，不自动删除或合并反馈。
- CSV 导出对 `= + - @`、制表符、回车开头的单元格做公式中和，并正确处理逗号、双引号和 CRLF；普通文本内容保持可读。

## 3. API 集成测试

覆盖：

- 反馈提交接口要求认证。
- 密码认证写请求要求有效 CSRF token。
- multipart metadata + images 成功提交。
- 提交成功返回安全反馈编号，不返回服务端绝对路径。
- 跨站请求、跨项目伪造、非法附件返回教师可理解错误。
- 服务端已提交但客户端响应超时后，使用同一幂等键重试不重复。
- 关闭公开注册后，非邀请用户不能创建账号；未登录访问受保护 API 返回 401。
- 模拟 staging 写入后、processing 记录后、原子重命名后崩溃，以及清理失败；重启对账后不产生 submitted 假成功和永久孤儿附件。

## 4. 浏览器验收

建议新增：

```text
tests\e2e\beta-feedback-center.spec.ts
```

桌面和窄屏都验证：

1. 全局入口打开统一反馈弹窗。
2. 头像菜单和消息点赞/点踩进入同一表单。
3. 分类切换更新 placeholder 和提示 chip。
4. 点击提示 chip 只追加描述，不自动提交。
5. 选择图片后出现预览和删除按钮。
6. 在弹窗中粘贴剪贴板 PNG/JPEG，立即出现预览。
7. 提交中防重复点击。
8. 提交成功显示反馈编号。
9. 模拟失败时保留文字和图片，重试成功。
10. 页面不显示服务端路径、token、账号和调试信息。

## 5. 持久化与运维复验

- 生产 SQLite 位于 `/opt/shanhai-edu-studio/shared/data/`。
- 附件位于 `/opt/shanhai-edu-studio/shared/artifact-storage/feedback/`。
- 提交测试反馈后重启应用，管理员仍可读取记录和附件。
- 切换 release 或执行回滚后继续读取同一记录。
- 发布前备份数据库和 feedback 附件目录，并记录恢复命令。

## 6. 集中验收命令

实施后按实际测试文件补齐并运行：

```powershell
npx vitest run tests/feedback-contract.test.ts tests/feedback-storage.test.ts tests/feedback-service.test.ts tests/feedback-auth.test.ts tests/feedback-sqlite-upgrade.test.ts --maxWorkers=1
npm run db:init
npm run build
npm run test:e2e -- tests/e2e/beta-feedback-center.spec.ts --project=chromium-desktop
graphify update .
git diff --check
```

## 7. 通过门

- 所有合同、服务、认证和存储测试失败数为 0。
- 浏览器选择图片和真实粘贴图片均通过。
- 管理员与普通用户权限隔离通过。
- 幂等和附件补偿清理通过。
- 生产重启与 release 回滚持久化复验通过。
- 未发现敏感信息或工程路径泄露。
