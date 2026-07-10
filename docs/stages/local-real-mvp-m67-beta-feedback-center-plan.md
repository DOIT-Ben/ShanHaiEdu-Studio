# M67 内测反馈中心阶段规划

日期：2026-07-10

状态：工程实现与本地集中验收已完成；真实服务器重启、回滚和备份恢复门禁待部署阶段关闭。收尾证据见 `docs\stages\local-real-mvp-m67-beta-feedback-center-closeout.md`。

测试定义：`docs\stages\local-real-mvp-m67-beta-feedback-center-test-plan.md`。

## 1. 目标

在邀请内测用户使用前，交付一个简单、真实可保存、支持截图粘贴的反馈中心，让内测用户在当前页面完成问题分类、描述和图片提交。

## 2. 成功标准

- 主要工作台页面有统一反馈入口。
- 反馈采用引导式分类和预制提示，不只提供空白输入框。
- 支持图片文件选择和剪贴板图片粘贴。
- 服务端真实保存反馈元数据和图片，刷新后仍可查证。
- 提交成功返回反馈编号；失败保留草稿并支持重试。
- 不泄露路径、token、账号和内部调试字段。

## 3. 范围

### 纳入

- `FeedbackDialog` / `FeedbackCenter` 统一表单。
- 全局入口、头像菜单入口、消息点赞/点踩入口。
- 分类、预制提示、描述、影响程度、图片预览和删除。
- 文件选择与 `Ctrl+V` / `Cmd+V` 图片粘贴。
- Feedback 数据记录、附件存储抽象、提交接口和反馈编号。
- 受控的内部反馈查看/导出能力；不建设复杂工单后台。
- 公网密码认证、关闭公开注册、管理员 bootstrap 和内测账号 invite 准入门禁。
- 桌面和窄屏浏览器验收。

### 不纳入

- 工单后台、客服流转、邮件通知、评论线程。
- 公开反馈社区。
- 自动整页截图、录屏和完整对话上传。
- MagicSchool / Canva 竞品研究衍生能力。

## 4. 推荐架构

```text
FeedbackDialog
  -> feedback draft state
  -> image file selection / clipboard paste
  -> POST feedback metadata + attachments
  -> FeedbackService
  -> FeedbackRepository + FeedbackStorage
  -> feedback ID / safe receipt

Internal feedback review/export
  -> protected read endpoint
  -> FeedbackRepository
  -> controlled attachment access
```

职责：

- `FeedbackDialog`：引导用户、预览图片、保留失败草稿。
- `FeedbackService`：校验分类、描述、附件和上下文，组织事务结果。
- `FeedbackRepository`：持久化结构化反馈记录。
- `FeedbackStorage`：保存到 `ARTIFACT_STORAGE_ROOT\feedback\...`；生产环境挂载共享持久素材卷，保留对象存储迁移边界。
- API：只返回反馈编号和安全状态，不返回服务端真实路径。

## 5. 数据字段

建议 `FeedbackRecord`：

```text
id
category
description
severity
status
idempotencyKey
requestFingerprint
projectId?
messageId?
pageRoute
appVersion
clientContext
attachmentRefs
createdAt
createdBy
```

`attachmentRefs` 只保存受控对象引用，不保存 base64 和公开路径。`createdBy` 必须来自已认证 actor 且不可为空；不存在匿名提交路径，避免 SQLite 对含 `NULL` 复合唯一键允许重复。

数据库使用当前生产 SQLite；部署时固定到 release 目录外的共享数据卷。附件固定复用 release 目录外的共享 `ARTIFACT_STORAGE_ROOT`。

## 6. 实施切片

### A. 契约和持久化

- Feedback 类型、分类枚举、校验。
- FeedbackRepository。
- FeedbackStorage。
- 提交 API。
- 同步更新 `prisma\schema.prisma` 与生产实际使用的 `scripts\init-sqlite-schema.mjs`；`db:init` 必须支持空库初始化和已有库加法式升级。
- 数据库与附件持久化测试。
- `createdBy + idempotencyKey` 唯一约束、请求指纹和同键不同内容 409。
- staging -> processing record -> 原子重命名 -> submitted 的提交协议。
- 启动/维护对账和附件失败、进程崩溃后的补偿清理。

### B. 表单和图片粘贴

- 分类和预制提示。
- 描述与影响程度。
- 图片选择、`paste` 事件、预览、删除和大小/数量限制。
- 提交状态与失败重试。

### C. 入口统一

- 全局反馈入口。
- 头像菜单。
- 消息点赞/点踩。
- 自动附带页面/项目/消息上下文。

### D. 内测认证与管理入口

- 服务端和客户端固定 password auth，禁止缺配置回退 local。
- 关闭公开自助注册；提供受控管理员 bootstrap 和内测账号 invite 流程。
- 管理员查看列表、详情、附件和脱敏导出。
- CSV 使用结构化 writer 做 RFC 4180 转义；用户可控单元格去除非法控制字符，并在首个有效字符为 `= + - @`、制表符或回车时前置单引号，防止 Excel 公式注入。
- 登录、邀请和反馈提交速率限制与审计日志。

### E. 上线前验收

- 浏览器真实粘贴截图。
- 提交后查数据库和持久化附件。
- 刷新后记录仍存在。
- 失败重试不丢输入。
- 安全与工程词扫描。
- 维护者受控查看/导出；普通用户不能访问他人反馈。
- 图片真实解码、PNG/JPEG/WebP 白名单、SVG 拒绝、像素/字节/数量限制。
- 认证、CSRF、管理员权限和跨项目上下文伪造测试。
- 网络超时重试幂等、同键不同内容冲突、附件部分失败和分阶段崩溃恢复测试。

## 7. 风险

| 风险 | 控制 |
|---|---|
| 图片太大、过多或伪装类型 | 服务端真实解码，PNG/JPEG/WebP 白名单，像素、单张大小、总量和数量双重限制；拒绝 SVG |
| 部署重启丢附件 | 数据库和附件只写 release 外 shared 持久卷，不写临时目录 |
| Prisma schema 与生产 SQLite 不一致 | schema 和 `init-sqlite-schema.mjs` 同步修改；空库、已有库、重复初始化三类测试同时通过 |
| CSV 打开时执行用户输入公式 | 结构化 CSV writer + 危险前缀中和 + 控制字符测试，导出不包含可执行公式单元格 |
| 截图含敏感内容 | 提交前提示用户检查；访问受控，不放 public |
| 重复点击产生多条 | 提交中禁用 + 服务端幂等键 |
| 存储目标后续变化 | 使用 `FeedbackStorage` 抽象和配置化根路径 |

## 8. 已确定的上线存储与权限

- 数据库：生产 SQLite，通过 `DATABASE_URL` 指向 `/opt/shanhai-edu-studio/shared/data/` 下的数据库文件。
- 图片：通过 `ARTIFACT_STORAGE_ROOT` 指向 `/opt/shanhai-edu-studio/shared/artifact-storage/`，反馈附件写入 `feedback` 子目录。
- release 更新和回滚不得覆盖 shared 数据目录。
- 全量查看/导出：只允许密码认证且 `actor.isAdmin === true` 的管理员。
- 普通教师和 local actor 只能提交，不能读取他人反馈。
- 业务代码只读取环境变量和逻辑 key，不硬编码个人电脑路径或凭据。
- 公网内测固定密码认证并关闭公开自助注册；内测教师账号和首个管理员由受控 bootstrap/invite 流程创建。
- 图片硬限制：最多 5 张、单张 10 MiB、总计 25 MiB、宽高不超过 8192 px、单张不超过 40,000,000 解码像素。

## 9. 测试计划要求

正式开发前新增独立测试计划：

```text
docs\stages\local-real-mvp-m67-beta-feedback-center-test-plan.md
```

至少覆盖：正常提交、图片粘贴、非法图片、SVG、所有硬限制边界、`projectId + messageId` 跨项目组合、普通用户读取拒绝、管理员列表/详情/附件/导出、CSRF、公开注册关闭、幂等重试、同键不同内容 409、附件部分失败、各提交阶段崩溃和启动对账、进程重启后持久化复验。
