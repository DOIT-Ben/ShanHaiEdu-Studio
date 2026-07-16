# M67 内测反馈中心工程实现收尾记录

日期：2026-07-10

## 1. 结论

M67 工程实现、自动化测试和本地浏览器验收已完成。系统现已提供真实反馈提交、图片附件、幂等恢复、受控管理导出、邀请制准入和桌面/窄屏反馈流程，可以作为后续多用户管理阶段的认证与审计基础。

本结论不等同于上线门槛已关闭。生产共享卷挂载、真实服务器重启、备份恢复和 release 回滚仍需在实际部署阶段按运维清单执行；在这些证据齐备前不得邀请真实内测用户。

## 2. 已交付能力

- 单例反馈弹窗，覆盖全局入口、头像菜单和消息点赞/点踩入口。
- 七类引导式反馈、预制提示、描述、影响程度、失败保留和安全回执。
- PNG/JPEG/WebP 文件选择与剪贴板粘贴，最多 5 张，具备字节、尺寸、像素、动画、伪装类型和总量门禁。
- `FeedbackRecord` / `FeedbackAttachment` 持久化，认证 actor 非空，`createdBy + idempotencyKey` 唯一，请求指纹阻断同键异内容。
- staging、processing、原子提交、submitted、失败重试、lease/CAS 对账和孤儿附件清理。
- password auth 生产 fail-closed，公开注册关闭，管理员 bootstrap、教师 invite、登录/邀请/反馈限速和脱敏审计。
- 管理员列表、游标分页、详情、受控附件下载、CSV/JSON 全量导出；普通教师读取被拒绝，CSV 公式前缀被中和。
- SQLite 空库、已有库和重复初始化升级；数据库与附件路径必须位于 release 外持久目录。

## 3. 关键实现边界

- 前后端共享 `src\lib\feedback-contracts.ts`，multipart 文件字段固定为 `images`。
- 应用版本由服务端可信配置写入，不采信客户端自报版本。
- 图片使用 Sharp 完整解码并设置解码并发/超时；附件原始文件名只作为受控元数据，不参与路径拼接。
- `submitted` 状态与 `feedback.submitted` 审计在同一数据库事务内完成；维护命令为 `npm run feedback:reconcile`。
- 管理导出使用分页流式遍历，不静默截断 200 条；详情附件只通过反馈 ID 与附件 ID 下载。
- M67 只交付准入基础，不把 bootstrap/invite 误报为完整用户管理后台。

## 4. 集中验收证据

| 命令 | 结果 |
|---|---|
| `npm test` | 通过；Node 197 项、Vitest 405 项，失败数 0。 |
| `npm run test:e2e:m67` | 通过；桌面 4 项、窄屏核心 3 项通过；201 条分页/CSV 专项只在桌面运行，窄屏对应重复项按设计跳过。 |
| `npm run build` | 通过；Prisma Client 生成成功，Next.js 生产构建成功，反馈、管理和邀请 API 均进入路由清单。 |
| `npx prisma validate` | 通过；Prisma schema 有效。 |
| `npx tsc --noEmit` | 通过；无 TypeScript 错误。 |
| `git diff --check` | 通过；无 whitespace error。 |

浏览器验收已覆盖：桌面 `1440x900`、窄屏 `390x844`、全局/头像/消息入口、分类提示、真实与合成剪贴板粘贴、图片删除、失败重试、single-flight、回执、刷新后管理员读取、普通教师 403、管理员详情/附件/CSV、201 条分页与无横向溢出。

## 5. 风险与回退

- 登录、邀请和反馈限速为单进程内存实现，只适用于当前单实例部署；扩展到多实例前必须迁移到共享限速存储。
- 邀请账号当前由管理员提供初始密码并直接创建可登录教师；尚无强制首次改密字段和用户自助激活流程，纳入下一阶段用户管理设计。
- 生产预检会真实查询 SQLite 中的 active password 管理员；正式发布仍需保护 bootstrap 环境变量，并在创建首个管理员时显式设置 `SHANHAI_BOOTSTRAP_ADMIN_CONFIRM=CREATE_ADMIN`。
- 尚未在真实服务器执行共享卷重启、版本回滚和备份恢复演练；这是待关闭的发布门禁。部署时必须先备份 SQLite 与 feedback 附件目录，再运行 `db:init` 和 `feedback:reconcile`。
- `npm audit --omit=dev --audit-level=high` 未发现 High/Critical，但仍报告 5 个 Moderate；自动修复会触发 Prisma/Next 破坏性降级，本阶段不执行 `--force`。
- 数据库升级为加法式。回退旧版本时保留反馈表和附件，不做破坏性降级；代码回退后仍需保留 shared 数据卷。

## 6. 下一阶段

下一阶段优先处理 RQ-012 多用户与用户管理，先于 M68：

1. 明确用户状态、角色、owner/membership、会话撤销和凭据重置合同。
2. 用跨用户越权测试证明项目、对话、产物和反馈隔离。
3. 实现管理员用户列表、邀请、启停、角色管理和安全重置入口。
4. 使用多个真实账号完成桌面和窄屏 E2E。

详细范围、阶段编号、迁移和回退方案在下一阶段规划中定稿。
