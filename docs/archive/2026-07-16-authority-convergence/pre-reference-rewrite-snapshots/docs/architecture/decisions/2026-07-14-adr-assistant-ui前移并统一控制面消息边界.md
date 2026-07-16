# ADR：assistant-ui 前移并统一控制面消息边界

日期：2026-07-14

状态：Accepted / current V1 refactor authority

## 1. 背景

R5 接管审计确认，当前问题不只是 Provider 健康。六个控制面 P1 是：控制判定晚于可执行 Agent、TaskBrief 由关键词正则单独决定、ExecutionEnvelope 可选、Artifact 与 Observation 非原子提交、三条编排路径并存、跨轮上下文静默丢失。消息仍以正文和松散 metadata 为主，旧 `ChatTranscript` 又同时承担正文、计划、成果、快捷回复和运行状态，因此必须与六个 P1 一起收敛，不能只换 UI 外壳。

原 ADR 将 assistant-ui 排在 V1 发布之后。用户已明确否决该时序，要求 assistant-ui 立即成为本次控制面重构的前端 Runtime。该变更只前移对话 Runtime 和消息结构，不提前实施反馈闭环、搜索、互动课件 Runtime、完整成果编辑器、全阶段 QA、多 Critic 或 50 用户基础设施。

## 2. 决策

当前 V1 重构采用以下唯一链路：

```text
TurnIntakeControlService
-> 结构化 TaskProposal 验证与 TaskAggregate
-> OrchestratorRuntime（唯一 Tool 选择者）
-> ToolExecutionGateway（强制 ExecutionEnvelope）
-> Observation / Validation / Artifact / Event 原子提交
-> 项目自有 MessagePart 与 AgentEventEnvelope
-> assistant-ui ExternalStoreRuntime
-> 教师消息、活动、计划、成果、HumanGate 与错误恢复展示
```

- `assistant-ui` 是当前教师对话区的唯一目标 UI Runtime，不再等待 V1-10。
- 数据库和 API 持久化项目自有、可版本化的 `MessagePart` 与 `AgentEventEnvelope`，不持久化 assistant-ui 私有类型。
- assistant-ui 只负责线程、消息和交互呈现；Artifact、HumanGate、QualityDecision、权限、费用和副作用仍由服务端业务层权威管理。
- 旧 `ChatTranscript` 只作为受控回退入口，迁移期不得双写业务状态；桌面验收通过并完成回退演练后才能另行删除。
- AG-UI 仅保留事件命名、序列和恢复兼容子集，不引入第二个业务状态机。
- 当前 Responses Runtime 与 OpenAI Agents SDK 都必须实现同一个 `OrchestratorRuntime` 边界；SDK 不得直连数据库、Artifact 或 Provider 密钥。
- 所有可执行 Tool 都必须绑定同一任务级 ExecutionEnvelope 事实。只读 Agent Tool 可以使用独立运输信封，但必须等价绑定 actor、project、task、TaskBrief digest、IntentEpoch、plan revision、强度、授权和幂等键，不得以“只读”为由绕过任务版本校验。

## 3. 验收分层

所有计划、测试和 closeout 必须分别标记以下证据，不得跨层推断：

| 层 | 证明内容 |
|---|---|
| `contract` | 类型、Schema、Guard、幂等和纯函数规则正确 |
| `executor` | 真实仓储、事务、身份、租约、Tool Gateway 和恢复正确 |
| `model orchestration` | 真实模型自主选择 Tool、读取 Observation 并 Replan |
| `product E2E` | 教师从消息到可信成果的真实桌面路径可用 |
| `release` | 候选环境、教师签收、切流、回滚和发布后验证通过 |

缺少任一层时必须写 `not verified`，不得使用“封板”“整体通过”替代。

## 4. 不采用

- 不继续扩展自研 `ChatTranscript` 成为第二套长期 Runtime。
- 不只换 UI 外壳而保留正文猜状态、Snapshot 伪活动和旧编排权。
- 不让客户端重放有费用或副作用的历史消息。
- 不在本阶段实现反馈工单、搜索、BlockNote、互动课件 Runtime 或容量扩张。

## 5. 风险与回退

- assistant-ui 采用锁定版本和项目 Adapter；关闭功能开关即可回到旧 UI，业务数据不回滚。
- MessagePart、事件表和上下文快照采用加法迁移；旧 `content` 与 metadata 在回退门关闭前继续可读。
- 新旧 Runtime 不得同时执行 Tool，不得双写 Artifact、Observation 或费用事件。
- 出现暂停后仍执行、旧 IntentEpoch 提升、重复 Tool/扣费、Artifact 无 Observation、跨用户事件或重启不可恢复时立即回退。

## 6. 验证

实施和验收以以下文档为准：

```text
docs\stages\local-real-v1-control-plane-assistant-ui-refactor-plan.md
docs\stages\local-real-v1-control-plane-assistant-ui-refactor-test-plan.md
```

V1 发布前真实浏览器只运行桌面视口；390px 保留已有合同和历史证据，不运行新的真实黑盒。
