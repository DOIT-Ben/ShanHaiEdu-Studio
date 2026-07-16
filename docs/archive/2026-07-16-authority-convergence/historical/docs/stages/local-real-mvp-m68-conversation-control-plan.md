# M68 对话承诺与执行一致性实施计划

日期：2026-07-10

状态：第一档规划；M67 内测反馈中心完成后实施。

测试定义：`docs\stages\local-real-mvp-m68-conversation-control-test-plan.md`。

## 1. 目标

解决助手承诺“回复一句即可继续”但用户自然回复后仍被隐藏 actionId / PlanGuard 阻断的问题，让按钮和自由输入都能安全控制当前任务，同时不降低 HumanGate、预算、审计和质量门禁。

## 2. 权威需求

- `docs\product\conversation-interaction-requirements.md`
- `docs\product\conversation-commitment-execution-consistency-requirements.md`
- `docs\product\current-requirements-baseline.md`

## 3. 范围

### 纳入

- PendingAction 唯一持久化状态源和完整生命周期。
- ActionOffer 教师可见投影。
- ConversationControlDecision 统一 model / fallback 输出。
- 自然语言确认、改道、修订、取消和多分支消歧。
- quick reply 编辑后 actionId 清除回归门禁。
- ToolObservation 和 AgentHarnessBudget 的 plan/action/ExecutionScopeKey 作用域。
- HumanGate 对低副作用与真实 provider 动作的分级确认。

### 不纳入

- 不取消按钮和 quick replies。
- 不让模型创建 actionId 或确认事实。
- 不实现 M66-R native tool loop 主线接入。
- 不实现第二档竞品衍生能力。

## 4. 持久化与仓储

在 `prisma\schema.prisma` 增加 `PendingAction` 模型，至少包含：

```text
id/actionId
projectId
activeProjectKey?
planVersion
capabilityId
expectedArtifactKind
intentFingerprint
requestFingerprint
goalRevisionId
executionScopeKey
sourceMessageId?
sourceArtifactId?
sourceArtifactVersion?
sourceArtifactHash?
status
createdFromAssistantMessageId?
supersededByActionId?
version
legacySourceMessageId?
lastProjectedMetadataHash?
createdAt/updatedAt
```

约束：

- `activeProjectKey` 在 `pending`、`confirmed` 和 `cancel_requested` 时等于 projectId，进入终态后为空，并设唯一约束，保证同一项目最多一个待确认或执行中的 action。
- 状态机固定为 `pending -> confirmed|superseded|cancelled|expired`、`confirmed -> completed|failed|cancel_requested`、`cancel_requested -> cancelled|completed|failed`。
- repository 创建新计划时，在同一数据库事务中 supersede 旧 pending action，再创建新 action；遇到 confirmed action 必须返回项目执行中，不能静默 supersede。
- 每次迁移使用 `projectId + actionId + expectedVersion + expectedStatus` 做条件更新；更新数量不是 1 即视为并发冲突或旧动作。
- provider / Artifact 动作在 CAS 时同时校验 sourceArtifactId、版本/hash、expectedArtifactKind 和 requestFingerprint；素材已变化时旧 action 转 expired 并重新披露。
- provider 动作的 `pending -> confirmed` 与 GenerationJob 创建属于同一事务；执行完成/失败再以 confirmed/cancel_requested 为前置状态进入终态并释放 activeProjectKey。
- `AuditLog` 增加可空唯一 `idempotencyKey`；稳定键固定为 `conversation-control:${teacherMessageId}`，decisionId 由服务端从该键确定性生成。同一教师消息重放必须读取并返回已提交决策，不得重新调用 resolver。
- `ConversationMessage` 增加 `updatedAt` 和可空唯一 `sourceDecisionId`；助手披露消息通过 sourceDecisionId 与稳定决策一对一关联。
- `GenerationJob` 增加可空唯一 `actionExecutionId` 关联统一 checkpoint；providerRequestKey、providerRequestId 和 dispatch 状态只存于 ActionExecution，避免两套执行真源。providerRequestKey 从 actionId 确定性生成。
- 创建/替换 PendingAction、写 ConversationControlDecision AuditLog、创建教师可见 assistant message 及其 `pendingDeliveryPlan` 兼容投影必须在同一仓储事务中完成。
- 事务前由服务端预生成 assistant message ID，再按现有格式派生 actionId，解决 message/action 相互引用；模型不能参与 ID 生成。
- 如果事务已提交但 TurnJob 尚未标记完成，队列重放先按稳定 idempotencyKey 读取原 AuditLog、PendingAction 和 sourceDecisionId 消息，复用原结果并完成 TurnJob，不重新解析或生成第二条回复。
- 每次状态转换都在同一事务中更新 PendingAction 和对应 assistant message 兼容投影。唯一事实源仍是 PendingAction 表，投影只服务前端与旧 release 回退。

### 4.1 旧 metadata 迁移与再次前滚

上线迁移必须先执行一次幂等回填：

1. 按项目扫描现有 assistant message 的 `pendingDeliveryPlan`。
2. 使用 `legacySourceMessageId` 唯一约束去重；同项目多个旧 pending 只导入最新一个，其余记录为 superseded。
3. 旧 metadata 的 `pending` 映射为新 PendingAction.pending；旧代码只在工具/产物成功后写入的 `confirmed` 映射为新 PendingAction.completed，不占 activeProjectKey。
4. 保留现有 `human:${projectId}:${capabilityId}:${messageId}` actionId 格式；PendingAction.actionId 就是 HumanGate / PlanGuard 已使用的 actionId，数据库 `id` 只是内部主键。
5. 无法可靠重建的历史字段标记为 legacy，不伪造教师确认或决策审计。

新版本每次写 metadata 投影时同时保存 canonical metadata hash 到 `lastProjectedMetadataHash`。若回滚到旧 release，旧代码可能新增 metadata，也可能原地把同一消息从 pending 改为 confirmed；再次升级时迁移器重新计算每条 legacy source message 的 metadata hash：

- hash 等于 lastProjectedMetadataHash：没有旧版本外部变化，保持表状态。
- hash 不同：按 legacy 状态映射做一次 CAS 对账，再更新 hash；即使 legacySourceMessageId 已存在也不能跳过。
- 新增 message 仍用 legacySourceMessageId 唯一约束幂等导入。

迁移器、运行时代码不能长期双读并择优，避免双源分叉。

旧真实生成动作还需要单独回填：

1. 扫描 approved Artifact 的 `routeGenerationActions`，用 artifactId、版本/hash、capability 和 actionId 建立 sourceArtifact 绑定。
2. 无 GenerationJob 的当前可用动作导入为 pending；已有 queued/running Job 导入为 confirmed，并创建/关联 active ActionExecution；succeeded/failed Job 分别导入为 completed/failed，不占活动槽位。
3. ActionExecution 使用可空唯一 `legacyGenerationJobId` 关联原 job id；回滚期间旧 release 新增的无 actionExecutionId Job，再次前滚时也必须扫描和对账。
4. 同一项目发现多个 queued/running legacy Job 或无法唯一关联 sourceArtifact 时停止迁移，进入人工对账，不擅自选择或删除。
5. 后续 Artifact 审批/生成动作投影必须与 PendingAction 在同一事务创建；已完成动作需要重新生成时创建新 planVersion/actionId，不能复用 completed action。

### 4.2 统一 ActionExecution 协调器

新增统一服务：

```text
src\server\workbench\action-execution-coordinator.ts
```

所有确认后的执行入口都必须调用该服务，不能各自执行工具或 provider：

```text
ConversationTurnService.runPlannedArtifact(...)
ConversationTurnService.runToolRouterCapability(...)
ConversationTurnService.runExternalProviderCapability(...)
Coze PPT / image / video HTTP routes
```

新增 `ActionExecution` 持久化 checkpoint，至少包含：

```text
id
pendingActionId @unique
executionKey @unique
sideEffectClass
status: prepared | running | succeeded | failed | cancelled | reconciliation_required
leaseOwner?/leaseExpiresAt?
attemptCount
resultArtifactId?
providerRequestKey?
providerRequestId?
legacyGenerationJobId? @unique
createdAt/updatedAt
```

同时：

- Artifact 增加可空唯一 `sourceExecutionId`，执行结果保存与 ActionExecution/PendingAction 进入终态在同一事务中完成。
- ConversationMessage 增加可空唯一 `sourceExecutionId`，同一执行只生成一条完成/失败回复。
- 确认事务创建 `ActionExecution.prepared`；执行器 CAS 领取为 running，不能只凭内存状态调用能力。
- TurnJob 重放先读取 ActionExecution：succeeded/failed 返回既有结果；prepared 继续执行；running 仅按 lease 和 sideEffectClass 进入受控恢复。
- `internal_idempotent` 能力可用同一 executionKey 重跑，Artifact/消息唯一键防止重复保存；重跑仍计入原 ExecutionScopeKey 预算。
- provider 能力按下述 providerRequestKey / 对账策略处理，不能按普通内部能力盲目重跑。

#### 4.2.1 Provider route 与幂等执行

以下真实生成 route 必须统一调用 ActionExecutionCoordinator 的 `confirmAndPrepareExecution(...)`；其 provider 分支再通过 repository 的单事务 `confirmAndCreateGenerationJob(...)` 创建 ActionExecution 与 Job，不能各自先验 actionId 再单独建 Job：

```text
src\app\api\workbench\projects\[projectId]\artifacts\[artifactId]\coze-ppt\route.ts
src\app\api\workbench\projects\[projectId]\artifacts\[artifactId]\image\route.ts
src\app\api\workbench\projects\[projectId]\artifacts\[artifactId]\video\route.ts
```

动作卡展示前必须已有 PendingAction；三个 route 和 ConversationTurnService provider 路径使用同一 actionId / requestFingerprint 做 CAS，并与 ActionExecution、GenerationJob 一对一关联。外部调用规则：

- ActionExecution 先持久化 `status=prepared` 和稳定 providerRequestKey，再 CAS 转为 running 后调用 provider。
- provider 支持幂等键时传入 providerRequestKey，重试复用同一键。
- provider 不支持幂等键时，进程在 running 阶段崩溃且远端结果不明时转为 `reconciliation_required`，记录 `provider_dispatch_unknown` 原因，禁止自动重复提交。
- 不能宣称跨外部 provider 的严格 exactly-once；验收目标是本地单次 CAS、可审计 dispatch 和不自动重复调用。

#### 4.2.2 对账与取消退出路径

建议新增：

```text
src\server\workbench\generation-reconciliation-service.ts
src\app\api\admin\generation-reconciliation\route.ts
src\app\api\admin\generation-reconciliation\[executionId]\resolve\route.ts
```

- 启动时和固定间隔扫描 lease 过期的 ActionExecution.running/reconciliation_required，以及关联 PendingAction.cancel_requested。
- provider 有查询接口时使用 providerRequestId/providerRequestKey 查询，按真实结果转 completed/failed/cancelled。
- provider 支持取消时，confirmed -> cancel_requested 后由 worker 调用取消并持续查询；不支持取消时不得进入 cancel_requested，只能提示当前任务无法安全取消。
- provider 状态不明且不支持幂等/查询时保持 reconciliation_required，禁止自动重复提交；同时进入管理员对账列表并触发告警。
- 提供受管理员权限保护的对账详情与 resolve 接口。管理员必须填写 provider 侧证据/备注后才能裁决 completed、failed 或 cancelled，所有裁决写 AuditLog。
- 教师界面显示“生成状态待核对”，不能永久静默卡住；管理员完成裁决后释放 activeProjectKey，教师才能继续或重试。

#### 4.2.3 三对象原子状态映射

```text
PendingAction.pending          -> 无 ActionExecution / GenerationJob
PendingAction.confirmed        -> ActionExecution.prepared|running|reconciliation_required；provider 可有 Job.queued|running
PendingAction.cancel_requested -> ActionExecution.running|reconciliation_required；provider Job.running
PendingAction.completed        -> ActionExecution.succeeded；provider Job.succeeded
PendingAction.failed           -> ActionExecution.failed；provider Job.failed
PendingAction.cancelled        -> 无执行记录，或 ActionExecution.cancelled；provider Job.cancelled
```

同一次完成、失败或取消必须在单个数据库事务中更新 PendingAction、ActionExecution、GenerationJob、Artifact/assistant message 投影和 activeProjectKey；不允许只更新其中一个对象。

### 4.3 生产 SQLite 升级

M68 必须同时更新：

```text
prisma\schema.prisma
scripts\init-sqlite-schema.mjs
scripts\production-preflight.mjs
scripts\check-m68-rollback-readiness.mjs
docs\runbooks\local-real-mvp-production-readiness.md
```

`db:init` 对空库和已有库都执行幂等、加法式建表/加列/建索引；升级前备份数据库。任何唯一索引创建前先跑冲突检测和 legacy 回填，发现冲突立即停止并给出恢复说明，不自动删除数据。

新增字段必须可空或有数据库默认值，保证旧 release 使用旧 SQL 写 ConversationMessage / GenerationJob 时仍可运行。验收必须使用旧 schema fixture 和旧版等价 INSERT/UPDATE 做回滚兼容测试。

## 5. Resolver

新增：

```text
src\server\conversation\conversation-control-resolver.ts
```

输入：教师消息、当前 PendingAction、ActionOffer、CapabilityAvailability、AgentWorldState。

输出：唯一 `ConversationControlDecision`。

规则：

- 模型主路径与 deterministic fallback 使用同一输出合同。
- 模型只提供语义候选；服务端注入 actionId、计划版本、指纹和审计字段。
- 多分支模糊时返回 clarify，不调用工具。
- switch / revise 只重新规划并创建新 PendingAction，不执行 provider。
- 模糊“继续”只可确认低副作用动作；真实 provider 需要已披露动作后的显式 HumanGate。

### 5.1 ActionOffer presenter 与前端投影

新增：

```text
src\server\conversation\action-offer-presenter.ts
src\server\conversation\action-commitment-guard.ts
```

规则：

- ActionOfferPresenter 只读取当前 PendingAction、planVersion、CapabilityAvailability 和允许的受控转换，生成 ActionOffer；ActionOffer 不建第二张状态表。
- 创建助手消息时，在同一事务把 ActionOffer 投影写入 message metadata 的 `actionOffers`；每次 PendingAction 状态转换同步更新该投影。
- actionOffers 至少包含 offerId、sourcePendingActionId、sourcePlanVersion、kind、targetCapabilityId?、label、teacherPrompt、requiresHumanGate，以及 confirm 类型才有的 actionId。
- Workbench API 原样返回结构化 actionOffers；`workbench-mappers.ts` 从该字段生成 quick replies/recommended options，不再只能从单个 pending plan 合成确认按钮。
- QuickReply / 发送 API 增加 `selectedOfferId?`；confirm offer 同时携带 actionId，switch/cancel offer 只携带 offerId。服务端必须重新校验 offer 对应的当前 PendingAction 和 planVersion。
- Main Agent 的自由文本只负责解释，不负责创造执行承诺。所有“回复 X 就执行”、分支选择、取消和确认提示由 presenter 模板生成；ActionCommitmentGuard 拒绝或替换没有匹配 ActionOffer 的模型承诺句。
- 异步队列完成后、刷新后和跨标签页读取时都使用持久化投影；stale/superseded/terminal offer 不再渲染，也不能提交。

## 6. Observation 与预算作用域

为 ToolObservation 和 AgentHarnessBudgetEvent 增加：

```text
pendingActionId
planVersion
executionScopeKey
```

`ExecutionScopeKey` 由服务端生成：

```text
capabilityId + expectedArtifactKind + goalRevisionId + approvedUpstreamArtifactVersionHash
```

规则：

- planVersion、actionId、用户原始措辞不决定预算重置。
- superseded 分支 observation 保留审计，但不进入新 active context。
- 同一执行作用域换句话或重新规划仍沿用原预算。
- 只有 capability、已确认上游版本或经后端接受的 goalRevision 变化才产生新预算作用域。

### 6.1 历史 Observation / Budget 兼容

- 迁移时优先使用 sourceMessageId、capabilityId、expectedArtifactKind 和相邻 legacy pendingDeliveryPlan 回填 pendingActionId 与 executionScopeKey。
- 无法唯一归属的旧 ToolObservation 标记 `legacy_unscoped`，保留审计但不注入新的 active model context。
- 无法唯一归属的旧 budget event 进入同项目、同 capability、同 expectedArtifactKind 的保守 legacy reserve；它继续计数，避免升级后预算被清零，但不向模型注入旧失败原因。
- 只有经过上述回填或产生于 M68 后的新事件，才能按 ExecutionScopeKey 进入活动上下文和精确预算桶。

## 7. 前端

- quick reply 未编辑时可提交其 actionId。
- `updateInput(...)` 在任何编辑时同时清除旧 actionId 和 selectedOfferId；前者是现有安全行为，后者是 M68 新增对称门禁。
- 编辑后由后端重新解析，不由前端恢复 actionId。
- 多分支 clarify 使用具体选项；教师界面不显示 actionId、planVersion、fingerprint 或“没有有效确认”。

## 8. 回退方式

- 数据库变更只新增表和字段，不删除旧 message metadata。
- 新代码继续写兼容 `pendingDeliveryPlan` 投影；回滚到旧 release 时仍可读取最近投影；再次前滚按 legacySourceMessageId 幂等导入回滚期间的新 metadata。
- M68 投影增加 `projectionOwnerVersion=m68` 和 `m68Status`。无该标记的 legacy confirmed 才映射为 completed；M68 active confirmed/cancel_requested/reconciliation 为防旧版重复执行，对旧 `status` 字段投影为 confirmed，同时由 m68Status 保留真实新状态。
- 支持的回滚前置条件是不存在 pending/confirmed/cancel_requested PendingAction，也不存在 prepared/running/reconciliation_required ActionExecution。生产 preflight 与回滚脚本必须查询并阻止带活动任务回滚，要求先完成、取消或管理员对账。
- 紧急情况下不得绕过该门禁直接启动旧 release；先备份数据库和素材，再按 runbook 完成活动任务裁决。旧 release 无法安全表达 M68 执行中状态，这是明确限制。
- 功能开关关闭 conversation-control resolver 后，回到既有按钮确认路径；不得删除 PendingAction / AuditLog 记录。
- 如迁移或 CAS 门禁失败，阻止执行并返回教师可理解的“计划已更新，请重新确认”，不能降级为绕过门禁。

## 9. 集中验收

按 `docs\stages\local-real-mvp-m68-conversation-control-test-plan.md` 执行，至少覆盖：

- 截图中的“我让你接着做啊”。
- 多分支消歧。
- quick reply 编辑清 actionId。
- 旧/过期 actionId。
- 并发唯一 pending 与单次确认。
- superseded observation 隔离。
- 稳定预算键不可通过换句话或新 planVersion 重置。
- 真实 provider 仍经过 HumanGate、PlanGuard 和 Quality Gate。

阶段完成后新增：

```text
docs\stages\local-real-mvp-m68-conversation-control-closeout.md
```
