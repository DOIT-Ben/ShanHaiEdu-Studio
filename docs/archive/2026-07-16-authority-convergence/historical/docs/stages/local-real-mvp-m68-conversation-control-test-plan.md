# M68 对话承诺与执行一致性测试计划

日期：2026-07-10

状态：第一档正式测试定义；开发前先落红灯测试。

## 1. 目标

证明助手承诺、自然语言控制、PendingAction、ActionOffer、ConversationControlDecision、HumanGate 和 PlanGuard 使用同一执行事实，不依赖魔法短语，不让模型或旧 actionId 绕过门禁。

## 2. 合同测试

建议新增：

```text
tests\conversation-control-decision.test.ts
tests\pending-action-lifecycle.test.ts
tests\pending-action-repository.test.ts
tests\pending-action-migration.test.ts
tests\action-offer.test.ts
tests\action-offer-presenter.test.ts
tests\generation-action-idempotency.test.ts
tests\action-execution-coordinator.test.ts
tests\generation-entrypoints.test.ts
tests\generation-reconciliation.test.ts
tests\sqlite-schema-upgrade.test.ts
```

覆盖：

- PendingAction 是唯一持久化状态源；ActionOffer 只由 PendingAction 和受控能力可用性投影生成。
- ConversationControlDecision 是 model 与 deterministic fallback 的唯一 resolver 输出。
- `confirm_active_offer` 必须包含服务端生成的 decisionId、teacherMessageId、pendingActionId、匹配计划版本、意图指纹、resolver 来源/版本和 reasonCode。
- `switch_to_capability` 只能重新规划，不能直接执行工具或 provider。
- 模型输出中的 actionId、planVersion、fingerprint 和确认字段全部忽略。
- PendingAction repository 使用 `activeProjectKey` 唯一约束和 expectedVersion 条件更新，不依赖进程内锁。
- CAS 条件必须包含 projectId、actionId、expectedVersion 和 expectedStatus。
- ConversationControlDecision 使用唯一 decisionId / AuditLog.idempotencyKey 只写一份结构化审计，messageId 可回溯原教师消息。
- PendingAction、决策 AuditLog、教师可见 assistant message 和 metadata 投影在同一事务中提交或回滚。
- 同一 teacherMessageId 的 TurnJob 在事务提交后、job 完成前崩溃并重放时，复用 `conversation-control:${teacherMessageId}`，返回原决策和 sourceDecisionId 对应消息，不重复建 action、审计或回复。
- ConversationTurnService 的 runPlannedArtifact、runToolRouterCapability、runExternalProviderCapability 与三个真实生成 route 都只能通过 ActionExecutionCoordinator 执行。
- PendingAction 对 Artifact 派生动作绑定 sourceArtifactId、版本/hash、expectedArtifactKind 和 requestFingerprint；任一不匹配时旧 action 过期且不执行。
- ActionOfferPresenter 只从当前 PendingAction/planVersion 生成投影；模型无匹配 offer 时不能输出“回复 X 就执行”的承诺。
- message metadata、Workbench API、workbench-mappers 和 QuickReply/发送 API 完整传递 actionOffers/selectedOfferId；switch/cancel 不伪装 confirmedActionId。

## 3. 生命周期与并发

- 同一项目同一时刻最多一个状态为 `pending`、`confirmed` 或 `cancel_requested` 的 active PendingAction。
- 新计划创建时，旧 pending action 原子转为 `superseded` 并记录 `supersededByActionId`。
- 状态只允许 `pending -> confirmed|superseded|cancelled|expired`、`confirmed -> completed|failed|cancel_requested`、`cancel_requested -> cancelled|completed|failed`；ActionExecution 对应支持 prepared/running/succeeded/failed/cancelled/reconciliation_required。
- confirmed action 执行中不能创建新 pending；必须等待完成/失败，或经过能力支持的取消流程。
- `cancelled`、`completed`、`failed`、`expired` 和 `superseded` 不能再次被确认。
- 两个标签页并发确认同一 action 时只有一个成功，另一个得到教师可理解的已处理/已变化提示。
- 确认与改道并发时只能有一个 CAS 成功，不得同时留下 confirmed 旧动作和 pending 新动作。
- provider 确认与 GenerationJob 创建同事务；确认后进程崩溃从 confirmed action + job 恢复，不自动重复调用；不支持幂等键且 dispatch 状态不明时进入对账。
- 确认事务提交后、内部工具调用前崩溃：重放领取同一 prepared ActionExecution 并完成一次执行。
- 内部工具返回后、结果事务前崩溃：按同一 executionKey 受控重跑，预算继续累计；Artifact.sourceExecutionId 确保只保存一个结果。
- Artifact 与完成回复已事务提交、TurnJob 未完成时崩溃：重放直接返回已有 Artifact/消息，不再次调用工具。
- 旧 actionId、错误项目 actionId、错误计划版本和错误意图指纹全部拒绝。

### 3.1 迁移与回退兼容

- 首次升级从最新 legacy `pendingDeliveryPlan` 幂等导入 PendingAction，保持原 `human:` actionId。
- legacy pending 映射为新 pending；legacy confirmed 映射为新 completed，不占 activeProjectKey。
- 同项目多个旧 pending 只保留最新 active，其余导入为 superseded。
- 相同 legacySourceMessageId 重跑迁移不重复创建。
- 新版本每次状态迁移同步 metadata 投影。
- 回滚到旧 release 新增 metadata 后再次前滚，能导入新 legacy 记录且不覆盖更新的表状态。
- 回滚后旧 release 原地把同一 message metadata 从 pending 改为 confirmed 时，即使 legacySourceMessageId 已存在，也能通过 metadata hash 差异对账为 completed。
- 无法重建的旧记录不能伪造教师确认或 ConversationControlDecision。
- approved Artifact 的 legacy routeGenerationActions 能按 artifact 版本/hash 导入 PendingAction。
- legacy queued/running GenerationJob 导入 confirmed active action + ActionExecution；succeeded/failed Job 导入对应终态。
- 回滚期间新增且无 actionExecutionId 的 GenerationJob 再次前滚可按 legacyGenerationJobId 幂等对账。
- 同项目多个 legacy queued/running Job 或 sourceArtifact 关联冲突时迁移停止并进入人工对账。

## 4. 语义控制

- 唯一低副作用、无需 HumanGate 的可执行 offer 下，“我让你接着做啊”“按刚才的继续”“就做前面那个”映射到 confirm。
- 唯一真实 provider offer 下，模糊“接着做”只选择方向并展示明确动作，不能生成 HumanGate 确认；只有明确复述动作或绑定 actionId 的确认按钮才能确认。
- 视频与 PPT 两个候选且无唯一选择时，“接着做”返回 clarify，只问“继续视频还是改做 PPT”。
- “改做 PPT”在当前视频 action 为 pending 时 supersede 并返回 switch_to_capability；当前 action 已 confirmed/cancel_requested 时提示执行中或先取消，不直接执行 PPT 工具。
- “先别做了”对 pending action 返回 cancelled；对 confirmed action 只在能力支持时进入 cancel_requested，等待 provider 取消结果。
- “继续视频，但改成卡通风格”返回 revise，生成新计划和新 action，不复用旧确认。
- 模型不可用时 deterministic fallback 也输出相同合同，而不是只返回布尔短语命中。

## 5. 前端 actionId 回归门禁

- 点击 quick reply 后未编辑，发送时可携带对应 actionId。
- 任何输入编辑都会同时清除旧 actionId 和 selectedOfferId；actionId 清除是当前已有行为，selectedOfferId 清除是 M68 新增门禁。
- 编辑后语义仍等价时，由后端重新解析为 confirm，不由前端恢复旧 actionId。
- 编辑后改道或补充约束时，不得执行旧动作。
- 扩展 `tests\m47-composer-api-wiring.test.mjs`，直接断言 `updateInput(...)` 同时清除 pending actionId 和 selectedOfferId。
- 新增 `tests\e2e\m68-conversation-control.spec.ts`，浏览器验证点击 confirm/switch/cancel 推荐、编辑、发送后请求不携带旧 actionId 或 selectedOfferId。
- 异步队列完成、页面刷新和第二标签页重新加载后仍显示同一有效 offer；superseded/terminal offer 消失且提交被拒绝。

## 6. 失败状态与预算隔离

- 历史 ToolObservation 和 budget event 始终保留审计。
- ToolObservation 和 budget event 包含 pendingActionId、planVersion 和 executionScopeKey。
- active context 只注入当前 plan/action/capability 相关 observation。
- 视频计划 superseded 后，旧视频失败不阻断新 PPT 计划。
- 同一 `ExecutionScopeKey` 的换句话重试和重新规划继续计入原预算，不能通过新 actionId 或新 planVersion 重置。
- `ExecutionScopeKey` 只由 capabilityId、expectedArtifactKind、goalRevisionId 和已确认上游产物版本 hash 组成。
- capability、已确认上游版本或经后端接受的 goalRevision 改变时才进入新预算作用域；模型文案和 planVersion 不决定重置。
- 可唯一归属的 legacy observation / budget 能按 sourceMessageId 和 capability 回填作用域。
- 无法归属的 legacy observation 标记 `legacy_unscoped` 且不进入 active model context。
- 无法归属的 legacy budget 进入项目+能力+产物类型的保守 reserve，升级后预算不清零。

## 7. HumanGate 与 provider

- 自然语言决策不能直接调用工具。
- 只有服务端持久化的 confirm 决策与当前 PendingAction 完整匹配后，才能向 HumanGate 提供确认输入。
- 真实 PPTX、图片、视频和其他 provider 动作仍经过 HumanGate、PlanGuard、CapabilityAvailability 和 Quality Gate。
- 多分支模糊语义不得自动选择高成本 provider。
- Coze PPT、图片、视频三个 route 都必须通过 ActionExecutionCoordinator 的 `confirmAndPrepareExecution(...)`，provider 分支再进入同一个 `confirmAndCreateGenerationJob(...)` CAS 事务；PendingAction、ActionExecution 与 GenerationJob 一对一关联。
- ConversationTurnService 的 ToolRouter Coze PPT 和 external provider 路径也使用同一 ActionExecution/GenerationJob 入口，不能绕过 route 级门禁。
- providerRequestKey 从 actionId 稳定生成；支持幂等键的 provider 重试复用该键。
- 不支持幂等键的 provider 在 ActionExecution.running 崩溃且远端结果不明时进入 reconciliation_required，不自动重复调用。
- lease 扫描器可通过 provider 查询把 ActionExecution.running/reconciliation_required 和关联 PendingAction.cancel_requested 转入真实终态。
- provider 不支持取消时不进入 cancel_requested；支持取消时查询结果可落到 cancelled/completed/failed。
- 管理员对账接口要求权限、证据备注和 AuditLog；裁决后释放 activeProjectKey，普通教师不可调用。
- completed/failed/cancelled 时，PendingAction、ActionExecution、GenerationJob、Artifact/消息投影和 activeProjectKey 在同一事务进入一致终态；注入任一中途失败都整体回滚。

## 7.1 生产 SQLite 升级

- `node scripts\init-sqlite-schema.mjs` 对空库创建 Feedback、PendingAction 和新增审计/Job 字段及索引。
- 对既有库做加法式升级并保留全部项目、消息、产物和任务数据。
- 唯一索引存在冲突时停止升级并报告，不自动删除数据。
- 连续执行两次 `npm run db:init` 结果一致且不重复回填。
- 用旧 schema fixture 升级后，执行旧 release 等价的 ConversationMessage/GenerationJob INSERT 与 metadata UPDATE 仍成功；再次前滚能导入这些旧写入。
- metadata 无 projectionOwnerVersion 的 legacy confirmed 映射 completed；带 m68 标记的 active 状态按 m68Status 对账，不误映射 completed。
- 存在 active PendingAction 或 prepared/running/reconciliation_required ActionExecution 时，production preflight/rollback check 必须阻止回滚；全部进入终态后才放行。

## 8. 教师可见文案

- 不出现“没有有效确认”“actionId”“planVersion”“fingerprint”等内部词。
- 多分支时显示具体选择题。
- 前置不足时说明缺少的教师材料。
- action 过期或被替换时说明“计划已更新”，并展示当前选项。

## 9. 集中验收

实施后至少运行：

```powershell
npx vitest run tests/conversation-control-decision.test.ts tests/pending-action-lifecycle.test.ts tests/pending-action-repository.test.ts tests/pending-action-migration.test.ts tests/action-offer.test.ts tests/action-offer-presenter.test.ts tests/generation-action-idempotency.test.ts tests/action-execution-coordinator.test.ts tests/generation-entrypoints.test.ts tests/generation-reconciliation.test.ts tests/sqlite-schema-upgrade.test.ts tests/main-conversation-agent.test.ts tests/model-main-conversation-agent.test.ts tests/conversation-turn-service.test.ts tests/plan-guard.test.ts --maxWorkers=1
node --test tests/m47-composer-api-wiring.test.mjs
npx tsc --noEmit
npm run build
npm run db:init
npm run preflight:production
node scripts/check-m68-rollback-readiness.mjs
npm run test:e2e -- tests/e2e/m68-conversation-control.spec.ts --project=chromium-desktop
graphify update .
git diff --check
```

浏览器专项覆盖截图场景、quick reply 编辑、并发确认和多分支消歧。
