# 权威 Agent 设计与 ShanHaiEdu ReAct 适配分析

日期：2026-07-11
范围：只读分析 `ShanHaiEdu-Studio\main`；本文是架构与业务逻辑接入蓝图，不修改项目代码。

## 1. 定案

此前顶层固定状态机方案需要修正。ShanHaiEdu 应采用：

> **Event-driven Controlled ReAct Agent Runtime with Deterministic Workflow Capsules**
> 事件驱动的受控 ReAct 智能体运行时，加确定性工作流胶囊。

不是固定 DAG，也不是无约束裸 ReAct。

```text
Observe
-> private Reason / Decision
-> optional Working Plan
-> Guard / Interrupt
-> Act through ToolRouter
-> commit Artifact + Observation + Event
-> Evaluate / Reflect
-> Continue / Replan / Ask Human / Finish
```

核心边界：模型决定下一步尝试什么；系统决定工具能否执行以及真实发生了什么；教师决定高成本授权、主观选案和最终课堂可用性。

## 2. 是否参考权威设计

是。本定案直接抽取以下官方或原始一手设计，不依赖泛化的“Agent 最佳实践”口号。

| 来源 | 权威机制 | ShanHaiEdu 吸收方式 | 不照搬的部分 |
|---|---|---|---|
| OpenAI Agents SDK | Runner 多轮 Agent loop、tools、handoff、guardrail、HITL、session、trace | 将循环能力放到 `AgentRuntimePort` 后；真实执行仍走 ToolRouter | 不用 SDK RunState 替代业务数据库，不让 SDK guardrail 替代 Artifact Truth |
| OpenAI Responses API | 应用可自管 tool loop 和状态 | 保留当前 Responses Runtime 作为第一阶段和兼容回退 | 不保留“一轮一个工具、失败即终止”的限制 |
| Anthropic | Workflow 与 Agent 分离；orchestrator-workers；evaluator-optimizer；高信号 Tool | 顶层用 Agent，PPT/视频评审用 evaluator-optimizer，独立页面/镜头可 fan-out | 不把每个底层 API 或 Contract 机械包装成 Tool |
| Google ADK | LlmAgent 动态决策；PlanReAct；Event loop；callback/safety | 每次 Tool Result 后 Reflect/Replan；事件先提交再继续 | 不把 Sequential/Loop/Graph workflow 当成智能体自主规划 |
| LangGraph JS | Checkpoint、interrupt、pending writes、durable resume | 抽取 Checkpoint/Interrupt/幂等语义；后续可做隔离试点 | 不让 LangGraph 建第二套 Project/Artifact 真相 |
| Microsoft AutoGen | save/load state、handoff message、异步 HITL | 抽取 HandoffEvent 和“结束本轮后等待教师”的模式 | 不引入共享全上下文的常驻 Team/Swarm，不采用实验性分布式 Runtime |
| Temporal | Event History、deterministic Workflow、Activity、幂等 | 为长期任务预留 `DurableJobCoordinator` 与稳定 invocation key | 当前不引入；LLM/Provider 不能放进可重放的 deterministic Workflow |
| ReAct 原始研究 | 推理与行动交错，通过环境 Observation 更新下一步 | 把每次真实 Tool Result 重新喂给 Agent | 不保存或展示原始思维链 |

## 3. 当前代码到底处于什么阶段

### 3.1 已经具备的正确底座

- 主 Agent 可以自然聊天、追问、规划或选择 capability：`src\server\conversation\model-main-conversation-agent.ts:166`。
- `ContextPackage`、`AgentWorldState` 和 `CapabilityAvailability` 已给模型提供可信世界状态。
- `PlanGuard`、`HumanGate`、ToolRegistry、ToolRouter 与 Adapter 分层已存在。
- Provider / Package Tool 使用服务端解析的已批准 Artifact，而不是相信模型自报的引用。
- `ToolObservation` 已把失败、阻断和重试建议带回后续上下文。
- Project、Conversation、WorkflowNode、Artifact、AgentRun、GenerationJob 已持久化。

这些边界应保留，不需要重写 Agent OS。

### 3.2 为什么当前还不是完整 ReAct

1. 主 Agent 每次只返回一个 `toolPlan`。`buildModelToolPlan()` 还会把 `upstreamPlan` 固定为空：`model-main-conversation-agent.ts:304-320`。
2. 完整交付计划来自硬编码 `fullDeliveryStepIds`，再映射成固定线性步骤：`model-main-conversation-agent.ts:31-48`、`:323-342`。
3. `ConversationTurnService` 调一次 Agent，然后执行一次计划工具并返回；工具结果没有在同一 Agent Run 内重新触发主 Agent 判断：`conversation-turn-service.ts:163-190`。
4. `OpenAIMainConversationAgent.respond()` 直接调用一次 Responses Adapter，并没有使用已有的 `runOpenAIToolCallLoop()`：`model-main-conversation-agent.ts:62-69`。现有 Tool Loop 属于下层 Artifact Runtime，不是 Main Agent Loop。
5. 原生工具循环默认最多 1 轮：`openai-tool-loop-runner.ts:45`。
6. 多个 Tool Call 会直接被阻断，并强制 `parallelToolCalls=false`：`openai-tool-loop-runner.ts:68-74`、`:100-107`。
7. Tool 结果只要不是 succeeded 就立即终止，失败 Observation 不回到模型重规划：`openai-tool-loop-runner.ts:82-96`。
8. `native-tool-loop-config.ts` 按任务只暴露一个工具，默认 `maxToolRounds=1`：`:32-48`。
9. `ToolObservation` 目前只表达失败类事件，而且 `artifactCreated` 恒为 false：`tool-observation.ts:3-8`、`:25-40`。
10. `Artifact` 只有整件批准，`GenerationJob` 只有单 source/result，无法表达多个页面/镜头的 fan-out、fan-in 和组件级返工：`prisma\schema.prisma:155-206`。

准确判断：当前是“有 Agent 外形的单步受控工具桥”，离完整智能体只差运行循环、持久检查点、结果回灌和组件级执行账本，但这几个缺口是决定性的。

## 4. 会不会过度约束模型能力

### 4.1 会过度约束的设计

- 所有请求必须先生成完整 PlanGraph。
- `nextOnPass` 被系统当作唯一合法路径。
- Contract 与 Tool 一一对应，模型一次看到 20 多个原子 Tool。
- WorkflowNode 同时承担 UI 里程碑、Agent 思考步骤和执行状态机。
- Tool 失败直接结束 Run，不允许模型换工具、改输入或缩小目标。
- 只允许串行单工具，连只读查询和独立素材也不能并行。
- Rubric 的软偏好被写成硬拒绝条件。

### 4.2 不会过度约束的设计

- Plan 是可选的 Working Plan，模型可改写。
- Contract 只定义可信输入、最小输出、硬禁止项和验收证据。
- 创意策略、叙事、风格、素材选择、行动顺序属于模型。
- Tool 动态暴露，只限制当前不可用或越权动作。
- 失败 Observation 回到模型，由模型决定修输入、换工具、追问或停止。
- 系统硬门只保护权限、成本、事实、安全和最终交付。

建议把 Contract 字段分成三档：

| 档位 | 作用 | 示例 |
|---|---|---|
| MUST | 不可绕过的系统硬门 | 已批准教材证据、真实 PPTX、视频完整解码、授权、项目归属 |
| SHOULD | Rubric 评价目标 | 页面叙事节奏、视觉解释力、镜头动势 |
| MAY | Agent 自主空间 | 创意方向、构图、工具顺序、候选数量、返工策略 |

## 5. 推荐的数据与运行模型

采用“当前业务状态 + 追加式执行账本”，不做纯事件溯源重写。

### AgentExecution

- execution_id / project_id / parent_execution_id
- goal / status / active_capability
- turn_budget / cost_budget / deadline
- latest_checkpoint_id
- completion_evidence_refs

### AgentCheckpoint

- checkpoint_id / execution_id / parent_checkpoint_id
- context_snapshot_ref
- working_plan_revision
- pending_action_refs
- last_committed_event_id
- resume_token / compatibility_version

### WorkingPlan 与 PlanStep

- Plan 只在复杂任务出现。
- Step 表达目标、依赖、候选 capability、验收条件和状态。
- Agent 通过 `plan_delta` 增删、替换、重排或并行步骤。
- 系统不自动把 PlanStep 映射为固定 Tool。

### AgentEvent

- run_started
- model_decision_recorded
- tool_requested / guard_blocked / interrupt_requested
- tool_started / tool_observed
- artifact_committed / quality_reviewed
- plan_revised / handoff_recorded
- run_paused / run_finished

不记录原始思维链，只记录简短 DecisionSummary 和可验证事件。

### ToolAttempt

- invocation_id / idempotency_key
- tool_id / resource_key / risk_level
- input_hash / provider_job_id
- status / started_at / finished_at
- artifact_refs / observation_id

Provider 任务恢复时先查询已有 attempt 或 provider job，不能因 replay 重复扣费。

### ToolObservation

现有结构应扩展为所有状态都可观察：

- succeeded / needs_input / retryable_failed / failed / blocked
- structured facts 与 measurements
- created_artifact_refs
- truth_gate / quality_gate
- warnings / retry_policy
- teacher_safe_summary / model_actionable_summary

### ArtifactComponent 与 QualityReview

- `component_type=page|asset|shot|caption|audio_track`
- component_key / parent_artifact_id / version / status / approval
- source_refs / lineage / file_ref
- Finding 定位到组件，返工只创建新组件版本。

## 6. Tool 应该怎样封装

答案是“要封装成 Tool”，但不是把所有节点和 API 一比一封装。

### Agent 可见的高层 Tool

每轮从下列集合动态选择 5 至 9 个真正相关的 Tool：

| 类别 | 建议 Tool | 实际落点 |
|---|---|---|
| 观察 | `inspect_project_state`、`query_evidence`、`inspect_artifact` | 只读 Internal Tool |
| 专家 | `design_ppt`、`review_ppt`、`design_video`、`review_video` | agents-as-tools |
| 真实生成 | `generate_pptx`、`generate_visual_asset`、`generate_video_shot` | 现有 Provider Adapter |
| 确定性生产 | `render_pptx_for_review`、`assemble_video_timeline`、`audit_delivery_package` | Workflow Capsule / Package Adapter |
| 返工 | `repair_artifact_component` | 根据 Finding 路由到最小能力 |
| 控制 | `request_human_decision` | HumanGate / PendingAction |

模型不应看到 Provider 密钥、路径、项目 ID、审批状态写入或底层 FFmpeg 参数。服务端从 RunContext 补齐这些权威字段。

### Tool 定义需要增加的控制元数据

- risk_level / side_effect_level
- idempotency_scope
- resource_key_strategy
- concurrency_policy
- approval_policy
- input_guardrails / output_guardrails
- timeout / retry / compensation
- observation_projection

### Manager 与 Handoff

默认采用 Manager + agents-as-tools，因为教师只面对一个主智能体。Handoff 只用于确实需要专家直接接管多轮对话的场景，并必须产生 HandoffEvent、上下文白名单和回收条件。

## 7. 精确插入现有架构的位置

### 7.1 `ConversationTurnService`

当前调用一次 `agent.respond()` 后直接执行一次工具。应把它改成调用一个 `AgentLoopPort.runOrResume()`；Service 只负责开启/恢复 Run、保存教师消息和返回暂停或最终结果，不再自己推进固定下一步骤。

### 7.2 `model-main-conversation-agent.ts`

保留自然理解、范围边界和教师语言规范。移除顶层硬编码 `fullDeliveryStepIds` 的执行权威，将输出改为原生 Tool Call 或 `respond / ask / pause / finish`。完整交付路线由可修改 Working Plan 表达。

### 7.3 `openai-tool-loop-runner.ts`

这是可复用的 ReAct 循环种子，但当前只被下层 `OpenAIRuntime` 使用，不能只改这个文件就宣称 Main Agent 已支持 ReAct。推荐把公共循环语义抽成 `AgentLoopPort`，为主 Agent 新建 `MainAgentLoopRunner`，再复用以下能力：

- 支持多轮 Tool Result 回灌。
- 非致命失败也序列化回模型。
- 按动态 Tool Set 暴露工具。
- 对独立、安全的调用允许受控并行。
- 每轮先提交 Event / Artifact / Checkpoint，再调用模型。
- 达到 max turns、预算或 interrupt 时保存状态并返回暂停。

### 7.4 `native-tool-loop-config.ts`

从 `task -> 一个 tool` 改成 `world state + availability + risk -> 当前 Tool Set`。工具选择仍由模型完成，配置只负责允许列表和权威上下文绑定。

### 7.5 `ToolRouter`

继续保留。增加统一的 beforeTool / afterTool interceptor 链、稳定 invocation ID、idempotency key、resource lock 和结构化 Observation。不要在 Agent Runner 中复制 Adapter 逻辑。

### 7.6 `NodeContractRegistry`

Contract 只参与 Prompt 编译、Tool 输入/输出校验和 Quality Gate。交付包 schema 2.1 已把 `nextOnPass` 改为仅供 Agent 参考的 `recommendedNext`；Capsule 硬转移使用独立 `capsuleTransitions`，二者都不能驱动顶层 Agent。

### 7.7 Prisma / Repository

在现有 Project、Artifact、GenerationJob 旁新增执行账本，而不是替换它们。Session/Checkpoint 是执行连续性；Artifact 仍是交付真相；二者不能混用。

### 7.8 `GenerationJob`

升级为 ToolAttempt 或在其旁新增 ToolAttempt，使同一计划可以按 page_id / shot_id fan-out，全部满足 fan-in 条件后再进入 PPTX 或视频组装。

### 7.9 Provider / Package Adapter

- 图片、视频和 PPTX 的 `passed: true` 必须来自真实检查，不是成功路径常量。
- `package-tool-adapter.ts:47-64` 的 `Buffer.concat(MP4[])` 必须替换为媒体感知的 FFmpeg Capsule。
- Tool Result 必须返回实际测量值和失败证据，供 Agent 选择下一动作。

## 8. 框架选择定案

### 现在做什么

先扩展现有 `Responses API + ToolRouter` 为完整受控 ReAct Loop。OpenAI 官方认可应用自管循环；这条路线对现有 OpenAI-compatible Provider、类型和测试影响最小。

当前 `package.json` 只有 `openai` SDK，没有 `@openai/agents`；因此第一阶段不应把新增 SDK 依赖和主循环语义修正绑在同一次改造里。

### 随后评估什么

在同一个 `AgentLoopPort` 后做 `AgentsSdkRuntime` 隔离试点，验证：

- OpenAI-compatible Provider 行为一致性。
- Tool approval / RunState 的可序列化和版本兼容。
- ToolRouter、ArtifactStore、TraceProcessor 能否保持权威。
- 与自建 Responses Loop 的任务成功率、成本和恢复率对比。

达到契约门后才把 Agents SDK 升为默认 Runner；现有 Responses Runtime 保留回退。

### 现在不引入什么

- 不同时引入 Agents SDK 和 LangGraph，避免双编排内核。
- LangGraph JS 只在自建 Checkpoint/Interrupt 明显变复杂时做纵向试点。
- AutoGen 不引入；只借鉴 handoff 和异步 HITL。
- Google ADK / Claude Agent SDK 不引入，避免 Python/Go 或 Provider 绑定。
- Temporal 当前不引入；等跨进程、多小时任务和生产 Worker 恢复成为真实需求，再实现 `DurableJobCoordinator`。

## 9. 分阶段落地顺序

### P0：纠正 Agent 语义

1. 引入 `AgentLoopPort` 与多轮 Observation 回灌。
2. 取消固定完整交付链的执行权威。
3. 让非致命失败回到模型 Replan。
4. 增加执行事件、Checkpoint、Interrupt 和幂等键。

验收：同一教师请求内至少完成两次 Tool Call；第一次返回可修复失败后，Agent 能改变输入或换路径完成，不需要教师重新发起整条链。

### P1：Tool 与组件粒度

1. 动态 Tool Set。
2. PPT/视频 Director 与 Critic 采用 agents-as-tools。
3. 增加 ArtifactComponent、QualityReview、ToolAttempt。
4. 支持 page/asset/shot 的 fan-out、fan-in 和局部返工。

验收：单页或单镜头失败不重做已通过组件。

### P2：确定性 Capsule 与效果真值

1. PPTX 真实渲染审查 Capsule。
2. FFmpeg 视频组装与技术审查 Capsule。
3. 最终真实目录反向审计 Capsule。
4. 将硬编码 QualityGate 替换为真实测量。

验收：模型无法用文字宣称覆盖文件、渲染、音视频或清单失败。

### P3：运行时 A/B

用同一固定任务集对比 ResponsesLoopRuntime 与 AgentsSdkRuntime；只有在成功率、恢复、成本和可观测性至少一项有明确净收益且无真相层回归时，才切默认。

## 10. 关键风险与防线

| 风险 | 防线 |
|---|---|
| ReAct 无限循环 | max turns、成本/时长预算、重复调用检测、人工升级 |
| 动态计划失控 | Tool 动态允许列表、PlanGuard、MUST Contract、项目权限 |
| Provider 重复扣费 | invocation ID、idempotency key、provider job 查询、事件先提交 |
| 多 Agent 上下文污染 | 主 Agent 单入口、专家最小上下文、默认 agents-as-tools |
| Checkpoint 与业务真相混淆 | RunState 只管恢复，Artifact Ledger 决定交付事实 |
| Rubric 变成创意枷锁 | MUST/SHOULD/MAY 分层，硬门只保护真值与安全 |
| 两套编排框架叠加 | 同一阶段只允许一个 Runner，全部通过 AgentLoopPort |

## 11. 最终判断

现有 ShanHaiEdu 架构不需要推翻，也不该继续用固定状态机包裹。最正确的插入方式是：

```text
在 Main Agent 与 ToolRouter 之间补真正的 Agent Loop；
在 ToolRouter 前后补事件、检查点、输入输出 Guard；
把 PPT/视频专家封装为 Agent Tools；
把渲染、合成、校验、打包封装为确定性 Workflow Capsule Tools；
把 Node Contract 从“路线控制器”还原为“工具和产物契约”。
```

这会扩大而不是缩小模型的有效能力：模型可以动态规划、换工具、并行、局部返工和恢复；系统只保留不可被模型伪造或越过的边界。

## 12. 官方来源

- [OpenAI: Agents SDK vs. Responses API](https://developers.openai.com/api/docs/guides/agents#agents-sdk-vs-responses-api)
- [OpenAI Agents SDK: Running agents](https://openai.github.io/openai-agents-js/guides/running-agents/)
- [OpenAI Agents SDK: Multi-agent orchestration](https://openai.github.io/openai-agents-js/guides/multi-agent/)
- [OpenAI Agents SDK: Tools](https://openai.github.io/openai-agents-js/guides/tools/)
- [OpenAI Agents SDK: Guardrails](https://openai.github.io/openai-agents-js/guides/guardrails/)
- [OpenAI Agents SDK: Human in the loop](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/)
- [OpenAI Agents SDK: Handoffs](https://openai.github.io/openai-agents-js/guides/handoffs/)
- [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- [Anthropic: Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
- [Anthropic Agent SDK: Agent loop](https://code.claude.com/docs/en/agent-sdk/agent-loop)
- [Google ADK: LLM agents and PlanReActPlanner](https://adk.dev/agents/llm-agents/)
- [Google ADK: Runtime event loop](https://adk.dev/runtime/event-loop/)
- [Google ADK: Workflow agents](https://adk.dev/agents/workflow-agents/)
- [LangGraph JS: Checkpointers](https://docs.langchain.com/oss/javascript/langgraph/checkpointers)
- [LangGraph JS: Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)
- [LangChain JS: Multi-agent handoffs](https://docs.langchain.com/oss/javascript/langchain/multi-agent/handoffs)
- [Microsoft AutoGen: Managing state](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/state.html)
- [Microsoft AutoGen: Human in the loop](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/human-in-the-loop.html)
- [Temporal: Workflow definition and deterministic replay](https://docs.temporal.io/workflow-definition)
- [Temporal: Activity definition and idempotency](https://docs.temporal.io/activity-definition)
- [ReAct: Synergizing Reasoning and Acting in Language Models](https://react-lm.github.io/)
