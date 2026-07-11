# 项目生命周期与工作台反馈体验需求

日期：2026-07-11

状态：approved for planning

关联需求：RQ-014

建议阶段：M71A

## 1. 目标

在保留 ShanHaiEdu 三栏备课工作台结构的前提下，完成三类本地产品验收问题：

1. 反馈选项的默认态、悬停态和选中态区分不清。
2. 轻量问候触发的助手回复过度罗列固定流程，缺少自然对话感。
3. 左侧项目缺少重命名、归档、软删除、回收站和恢复能力。

成功标准是教师能够明确知道自己选中了哪个反馈项，能够自然开始一轮备课对话，并能安全整理项目而不丢失对话、产物和成员关系。

## 2. 范围

### 2.1 纳入

- 反馈类型、快速补充、影响程度的视觉状态与键盘焦点。
- 真实主对话 Agent 的轻量问候回复策略。
- 项目标题编辑：双击标题、hover 铅笔图标、键盘保存与取消。
- 项目操作菜单：重命名、归档、移入回收站。
- 已归档项目列表、恢复能力。
- 回收站列表、恢复能力。
- 项目生命周期字段、Repository、Service、API、权限、审计和客户端合同。
- 桌面与 390px 窄屏验收。

### 2.2 不纳入

- 永久物理删除项目。
- 删除本地 PPTX、图片、视频或材料包文件。
- 自动清空回收站和保留期策略。
- 批量归档、批量删除、拖拽排序和项目文件夹。
- 修改项目 owner、成员关系或业务进度状态。
- 重做侧栏信息架构或三栏工作台视觉方向。

### 2.3 交付拆分

M71A 是用户本地验收后明确插入的产品体验阶段，先于原建议的 M71 视频结构化前置链路执行。阶段内拆成三个职责独立的提交与验收门禁：

1. 反馈控件状态与浏览器视觉验收。
2. 主对话 Agent 轻量问候策略与请求合同测试。
3. 项目生命周期数据、API、权限、侧栏交互和恢复流程。

三部分共享同一需求规格，但不混在一个代码提交中。RQ-014 正式替代旧测试中“回收站保持禁用”的历史断言。

## 3. 交互设计

### 3.1 反馈选项

反馈类型和影响程度使用统一的状态语言：

| 状态 | 边框 | 背景 | 文字与图标 |
|---|---|---|---|
| 默认 | 1px 中性浅灰 | 白色 | 中性文字 |
| Hover | 1px 浅品牌绿 | 极浅绿色 | 深色文字 |
| Focus | 保留状态边框 | 原状态背景 | 2px 可见 focus ring |
| Selected | 2px 品牌绿 | 浅绿色 | 深绿色文字、500 字重、右侧勾选图标、轻外环 |

- 选中态不得只依赖颜色，必须同时提供勾选图标和 `aria-pressed=true`。
- 动画只使用 120–160ms 的颜色、边框和轻外环过渡，不使用发光、弹跳或重阴影。
- 快速补充 chip 点击后继续向描述框追加提示；已使用的 chip 显示选中态，再次点击不重复追加同一内容。
- 可提交时“提交反馈”使用明确的品牌色主按钮；不可提交时保留禁用态。

### 3.2 轻量问候回复

真实主对话 Agent 增加以下回复约束：

- 用户只输入“你好”“在吗”“可以帮我吗”等轻量问候时，回复控制在 1–2 句。
- 先自然回应，再问一个最容易回答的具体问题，例如年级、学科或课题。
- 不主动列出教案、PPT、图片、视频和材料包的完整流水线。
- 不用固定示例限制用户表达，不假设用户已经决定交付物数量或类型。
- 用户给出明确备课任务后，才结合任务范围说明下一步计划和必要确认。
- 轻量问候不得生成 `toolPlan`、`deliveryPlan`、确认动作或产物承诺；快捷建议可以保留，但只用于补充年级、学科或课题。
- 不使用 deterministic greeting 覆盖模型；继续由真实主对话 Agent 生成。
- 自动化门禁验证系统指令和结构化输出合同；真实 Provider smoke 与浏览器验收验证语气和信息密度，不把模型随机措辞写成脆弱字符串断言。

目标示例：

```text
你好，我在。你今天想准备哪一节课？告诉我年级和课题就可以开始。
```

示例只表达语气和信息密度，不作为硬编码回复。

### 3.3 项目重命名

- 项目标题双击进入编辑态。
- 项目条目从当前整行 `<button>` 改为非按钮行容器；项目选择、铅笔和菜单是三个独立的可聚焦控件，禁止嵌套交互元素。
- 项目行 hover 或键盘 focus-within 时显示铅笔图标按钮，按钮使用 lucide `Pencil`，tooltip 为“重命名项目”。
- 编辑态使用单行输入框，不使用 `contentEditable`。
- `Enter` 保存，`Escape` 取消，失焦保存。
- `Enter` 保存后随即发生的 blur 不重复提交；`Escape` 取消后随即发生的 blur 不触发保存。
- 保存期间禁用重复提交并显示轻量进行中状态。
- 标题 trim 后不能为空，最大 80 个字符；校验失败时保留编辑态和原标题，不发送请求。
- 保存成功后列表和当前顶部标题同步更新；失败时恢复原标题并给出教师可理解的错误提示。

### 3.4 项目操作菜单

- 项目行 hover 或 focus-within 时显示省略号图标按钮，tooltip 为“项目操作”。
- 菜单顺序：重命名、归档、移入回收站。
- 当前项目归档或移入回收站后，自动选择剩余列表中的第一项；没有项目时进入欢迎空态。
- 归档与移入回收站均需要简短确认，其中删除确认明确说明“项目会进入回收站，可以恢复”。

### 3.5 已归档与回收站

- 侧栏底部固定两个工具入口：已归档在上，回收站在最底部。
- 入口显示图标和文字；窄屏抽屉内保持相同顺序。
- 桌面和窄屏的底部顺序固定为：已归档、回收站、账户菜单；账户菜单仍保持最底部用户区，不与项目列表滚动。
- 点击入口打开独立列表视图，不与活跃项目混排。
- 已归档项目支持“恢复到项目列表”和“移入回收站”。
- 回收站项目只支持“恢复到项目列表”。
- 恢复后项目保留原有对话、产物、成员和业务进度。
- 本阶段不提供永久删除按钮，也不伪装已经清理磁盘文件。

## 4. 数据与状态设计

`Project.status` 继续只表达业务进度：`active | review | blocked | done`，不加入归档或删除值。

项目新增两个可空字段和一个生命周期版本号：

```text
archivedAt DateTime?
deletedAt DateTime?
lifecycleVersion Int @default(0)
```

状态规则：

- 活跃：`archivedAt = null` 且 `deletedAt = null`
- 已归档：`archivedAt != null` 且 `deletedAt = null`
- 回收站：`deletedAt != null`；进入回收站时清空 `archivedAt`
- 恢复：同时清空 `archivedAt` 和 `deletedAt`

允许的状态迁移：

| 当前状态 | rename | archive | trash | restore |
|---|---|---|---|---|
| 活跃 | 允许 | 允许 | 允许 | no-op |
| 已归档 | 拒绝 | no-op | 允许 | 允许 |
| 回收站 | 拒绝 | 拒绝 | no-op | 允许 |

- 非法迁移返回 409，错误码为 `project_lifecycle_conflict`，并使用教师可理解文案。
- no-op 不更新 `updatedAt`，不改变列表顺序，也不重复写审计日志。
- rename、archive、trash、restore 实际发生变化时将 `lifecycleVersion + 1`；其他业务写入不改变该版本号。

不新增 `archivedByUserId` 或 `deletedByUserId` 字段；操作者通过现有脱敏审计日志记录，避免把本阶段扩大为复杂生命周期审计模型。

数据库升级沿用项目现有 SQLite 初始化模式：Prisma schema 与 `init-sqlite-schema.mjs` 同步增加字段，并创建 `(archivedAt, deletedAt, updatedAt)` 复合索引。旧数据库通过幂等 `ensureColumn` 升级；连续运行两次初始化必须保持成功，旧项目默认进入 active 视图且 `lifecycleVersion = 0`。

## 5. API 与数据流

### 5.1 列表

```text
GET /api/workbench/projects?view=active|archived|trash
```

- `view` 默认 `active`。
- 非法值返回 400 和教师可理解错误。
- 每个视图只返回 actor 拥有或以成员身份加入的项目，并按 `updatedAt DESC` 排序。
- 系统 admin 不因角色自动看到全部项目；只有成为 owner 或项目成员后才会出现在列表中。
- 列表中的每个项目固定返回 `lifecycleState`、`lifecycleVersion`、`archivedAt`、`deletedAt`；active 项目的两个时间字段为 `null`。

### 5.2 修改项目

```text
PATCH /api/workbench/projects/{projectId}
```

请求只接受以下互斥动作之一：

```json
{ "action": "rename", "title": "新的项目名称", "expectedLifecycleVersion": 3 }
{ "action": "archive", "expectedLifecycleVersion": 3 }
{ "action": "trash", "expectedLifecycleVersion": 3 }
{ "action": "restore", "expectedLifecycleVersion": 3 }
```

- rename：只允许活跃项目，校验 trim 后 1–80 字符；与当前规范化标题相同时为 no-op。
- archive：只允许活跃项目；设置 `archivedAt`，清空 `deletedAt`。
- trash：允许活跃或已归档项目；设置 `deletedAt`，清空 `archivedAt`。
- restore：允许已归档或回收站项目；同时清空两个字段。
- 重复 rename、archive、trash、restore 遵守状态迁移矩阵中的 no-op 规则。
- `expectedLifecycleVersion` 必填；与当前版本不一致时返回 409 `project_version_conflict` 和当前项目生命周期摘要，客户端刷新后由用户重新确认，不自动重放旧动作。
- 不新增项目 `DELETE` 路由，避免把软删除和永久删除混淆。

成功响应固定为：

```json
{
  "changed": true,
  "project": {
    "id": "project-id",
    "title": "项目名称",
    "lifecycleState": "active",
    "lifecycleVersion": 4,
    "archivedAt": null,
    "deletedAt": null,
    "updatedAt": "ISO-8601"
  }
}
```

- no-op 返回 `changed: false` 和未变化的项目摘要。
- project detail 与 snapshot 中的 project 使用同一生命周期字段合同。
- controller 发现 snapshot 的 `lifecycleState != active` 时立即退出当前项目，刷新 active 列表并选择第一项；跨标签页 archive 和 trash 使用同一处理路径。

### 5.3 忙碌项目与写入门禁

- 生命周期操作前先运行项目任务对账：ConversationTurnJob queued/running 超过 30 分钟未更新且没有未过期 lease 时直接标记 failed，不重新排队；GenerationJob queued/running 超过 30 分钟未更新、AgentRun running 超过 30 分钟未结束时同样标记 failed，并记录教师可理解的恢复原因。阈值由服务端常量统一定义，本阶段不开放前端配置。
- 对账后仍存在 queued/running 的对话任务、生成任务或 agent run 时，archive 和 trash 返回 409，提示等待当前生成结束；本阶段不实现任务取消。
- 生命周期变更必须在一个 SQLite `BEGIN IMMEDIATE` 或等价串行写事务内完成：检查 `expectedLifecycleVersion`、对账 stale jobs、检查 pending jobs、更新项目、递增版本和写审计。任一步失败全部回滚。
- 所有项目业务写入口必须把 active lifecycle guard、实际业务写入和对应审计放入同一个串行写事务，包括消息与任务入队、成员变更、产物确认/重做、agent run、任务 finish/fail 和 PPTX/图片/视频/最终包结果保存。禁止“先检查 active、事务外再写入”。
- 已归档和回收站项目保持可读取；除 restore 或 archived→trash 外，其他业务写入均返回 409。
- 外部 Provider 调用开始后，项目对应任务保持 running，因此正常时 archive/trash 会被拒绝；若任务被 stale 对账后 Provider 才返回，结果保存事务会因 active/job guard 失败而拒绝落库并记录失败，不会复活项目或产物。

客户端 `WorkbenchDataSource` 增加按视图列项目和项目生命周期修改方法；controller 负责成功后的列表刷新、当前项目切换和教师可见提示。

## 6. 权限与安全

新增统一的项目生命周期管理权限：

- 允许：项目 `ownerUserId` 对应用户、成员角色 `owner`。
- 拒绝：成员角色 `editor`、`viewer`、非成员用户，以及未加入该项目的系统 admin。
- local 模式延续现有本地 actor 兼容规则。
- editor/viewer 这类已知成员但权限不足返回 403；非成员统一返回 404，避免泄露项目存在性。
- ownerless 旧项目只在 local 模式下允许本地 actor 管理，password/oauth/sso 模式不放宽。
- 保留现有系统 admin 按已知项目 ID 读取 snapshot 的受控运维能力，但该能力不授予列表可见性、业务写入或生命周期写入权限。
- 所有 PATCH 请求继续经过登录、同源和 password 模式 CSRF 门禁。
- 审计动作至少包含：`project.renamed`、`project.archived`、`project.trashed`、`project.restored`。
- 审计 metadata 只记录项目 ID、动作和标题长度，不复制完整对话、产物内容或敏感信息。
- no-op 不重复写审计；实际状态或标题发生变化时才写一条审计并更新 `updatedAt`。

## 7. 错误与恢复

- 重命名失败：保留原标题和编辑输入，允许重试。
- 归档、删除或恢复失败：项目保持原列表位置，显示错误提示。
- 当前项目被其他标签页归档或移入回收站：下一次 snapshot 或列表刷新后退出当前项目并选择可用项目。
- API 不返回内部数据库错误、绝对路径、权限实现细节或堆栈。
- 不存在项目和非成员项目统一返回相同的 404 状态与响应正文；403 只用于已确认成员但角色不足的情况。
- 已删除项目的消息、成员、产物、agent run、任务和生成接口必须拒绝继续写入；已归档项目保持只读查看，恢复后才能继续生成。

## 8. 测试与验收

### 8.1 合同与服务

- fresh database 和旧数据库升级后 schema 一致；连续两次初始化成功；三个字段和复合索引存在。
- 旧项目默认进入 active 视图，对话、产物、成员关系和本地产物引用保持不变；部分升级失败后可安全重试。
- active、archived、trash 三类列表过滤正确且继续按成员关系隔离。
- 状态迁移矩阵逐项通过；no-op 不更新 `updatedAt`、不改变排序、不重复审计。
- lifecycleVersion 条件更新阻止 rename/archive/trash/restore 的跨标签页 ABA 重放；冲突返回当前生命周期摘要。
- editor、viewer、非成员、未加入项目的 admin 和非 local ownerless 项目生命周期写入被拒绝，并区分 403/404。
- 新鲜 queued/running 项目不能归档或移入回收站；过期 ConversationTurnJob、GenerationJob 和 AgentRun 可被对账为 failed，之后允许操作。
- 使用并发屏障验证 active guard、业务写入、生命周期更新和审计原子化，不存在检查后写入的竞争窗口。
- 已删除和已归档项目不能继续写消息、成员、产物、agent run、任务或生成结果。
- 客户端请求路径、请求体和响应映射正确。
- PATCH 的 401、403、404、409、同源和 password 模式 CSRF 路由矩阵通过。
- admin 权限测试固定覆盖：普通项目列表不展示未加入项目；已知 ID 的 snapshot 可受控读取；未加入项目的生命周期 PATCH 返回与非成员一致正文的 404。

### 8.2 前端交互

- 反馈控件 selected/hover/focus/disabled 状态清晰，`aria-pressed` 与视觉一致。
- 快速补充不会重复追加同一内容。
- 双击和铅笔图标均可进入项目编辑态。
- Enter、失焦、Escape、空标题、超长标题和请求失败均有确定行为。
- 项目菜单可完成归档和移入回收站。
- 已归档和回收站入口固定在侧栏底部，恢复后列表同步。
- 轻量问候请求不产生 toolPlan、deliveryPlan、确认动作或产物承诺；真实 Provider smoke 不再默认输出完整生产链路。

### 8.3 浏览器验收

- 1366px 桌面：项目 hover 操作、双击重命名、归档、回收站、恢复完整可用。
- 390px 窄屏：侧栏抽屉内可完成相同流程，菜单和确认弹窗不越界。
- 键盘：Tab 可到达编辑和菜单按钮，Enter/Space 激活，focus ring 可见。
- 反馈弹窗：默认、hover、selected、focus、disabled 和提交成功/失败状态均检查。

## 9. 发布与回退

- 新增字段为可空列，默认值不改变现有项目可见性。
- 不允许直接回退到不认识生命周期字段的旧版本，否则归档和回收站项目会重新出现在普通列表并恢复可写。
- 回退前必须先导出生命周期清单，再运行受控恢复脚本清空 `archivedAt`、`deletedAt`，确认所有项目回到 active 后才能部署旧版本；或者回退到保留列表过滤和写门禁的兼容版本。
- 阶段必须交付 `scripts/m71a-project-lifecycle-rollback.mjs`：默认 dry-run；支持导出只含项目 ID、生命周期状态和版本的 JSON 清单；执行恢复必须同时提供 `--apply`、固定确认短语和“已完成数据库备份”环境确认；重复执行幂等且不删除项目、关系或本地产物。
- 回退验收必须覆盖 dry-run、清单导出、缺少确认时拒绝、应用恢复、幂等复跑，以及恢复后旧版本 active 列表可见性和写入行为。
- 正式回退必须在停服维护窗口执行；恢复、确认 active 数量和旧版本切换之间不得接受新的项目生命周期写入，恢复步骤在单事务中完成。
- 不执行物理删除，因此阶段回退不会造成项目数据或本地产物不可恢复。
- 上线前仍需执行现有生产数据库备份和恢复门禁；本阶段完成不代表真实用户开放门禁已关闭。
