# 02 三层架构与受控 ReAct 设计

## 1. 目标

本设计要保留智能体的理解、创造、工具选择和失败后改道能力，同时保证真实 PPT、图片、视频和最终包不会绕过合同、授权、质量证据与持久化。

核心公式：

```text
模型自由度 = 在可信世界状态、可用工具和资源预算内选择“下一步最有价值动作”
系统确定性 = 对输入、输出、授权、成本、真实文件、安全和质量门做不可绕过校验
```

## 2. 三层关系

```text
智能体架构
  Main Agent 选择目标、专家和下一动作
  Director Agent 进行领域规划/返修判断
  ReAct Harness 负责编排、观察、重规划
        │
        ▼
内容生产工艺架构
  PPT Skill / Video Skill / Shared Invariants / Profiles
  决定专业人员“怎样做”
        │
        ▼
交付质量架构
  Node Contract / Validator / Rubric / Critic / Human Approval
  决定“是否可以继续和交付”
        │
        ▼
Tool / Provider / Artifact / Job / Checkpoint
  真实执行、事实保存、恢复与审计
```

三层不是三个独立产品。它们在每个行动中汇合，但职责不可互相替代。

## 3. 受控 ReAct 循环

推荐统一为：

```text
Observe
→ Plan
→ Guard
→ Act
→ Observe
→ Evaluate
→ Replan / Ask / Pause / Finish
```

### Observe

读取经后端编译的可信世界状态，而不是把完整聊天记录当数据库：

- 当前项目目标和教师最新意图
- approved artifacts 与 draft artifacts 的严格区分
- 页/镜头单元状态、失败单元、过期血缘
- Capability/Tool/Provider 可用性
- 最近 ToolObservation、ValidationReport、CriticReport 与 QualityDecision
- PendingAction、ProjectExecutionLease、run/action 预算、外部任务和 checkpoint

### Plan

Main Agent 或 Director 只输出候选动作：

- 调用哪个 Tool
- 使用哪些已批准输入
- 目标 pageId/shotId 或全局工件
- 为什么现在做
- 预期产物和停止条件
- 失败时允许的回退方向

模型不生成项目 ID、Artifact ID、actionId、文件路径、Provider 密钥和数据库状态；这些由后端绑定。

### Guard

依次检查：

1. `PlanGuard`：工具是否存在、输入是否齐全、状态是否允许。
2. `HumanGate`：有成本、外部副作用或教师决策的动作是否已授权。
3. `ContractPreValidator`：输入工件、血缘、版本和硬约束是否满足。
4. `CapabilityAvailability`：Provider/本机工具是否真实可用。
5. `ProjectExecutionLease`：同一 projectId 是否已有生成动作；跨标签请求必须复用、排队或拒绝。
6. `Budget/CircuitBreaker`：run 级总预算与 action/tool/provider 级预算是否允许继续。
7. `FinalDeliveryGate`：只有在尝试打最终包时检查 production path、跨产物质量、陈旧血缘和交付资格。

### Act

只通过 ToolRouter 执行一个可审计动作或一个明确的并行批次。Director/Critic 即使是 Agent，也以 Tool 形式被主 Agent 调用；它们不能绕过 ToolRouter 直接写文件、调用 Provider 或修改状态。

### Observe + Evaluate

工具结果先形成 observation 和 artifact/job 事实，再形成三个彼此不可越权的结果：

- `ValidationReport`：由确定性 Validator 生成，覆盖文件结构、schema、页数、媒体流、血缘、必填字段、可编辑性等硬事实。
- `CriticReport`：由独立 Critic 基于 ValidationReport 和真实 render/media 证据生成，只判断教学、叙事、视觉、连续性、可读性和课堂价值。
- `QualityDecision`：由确定性 Decision Engine 聚合前两份报告与路径政策，计算 `pass | repair | block`。Critic 不能重算或改写硬门。

生成 Agent 的“我检查过了”不能替代任何一份报告。Critic 的“只读”指不修改被审产物、不调用 Provider；Harness 仍可把它返回的 CriticReport 持久化为报告 Artifact。

### Replan

根据 observation 做五选一：

- `continue`：当前单元通过，继续下一个必要动作。
- `repair_unit`：只返修失败 pageId/shotId/track/asset。
- `repair_upstream`：问题根因在上游设计，回到正确责任节点。
- `ask_teacher`：缺少会改变方向的信息或需要教师选择。
- `pause/finish`：等待外部任务、预算熔断，或交付门全部通过。

## 4. 为什么不是裸 ReAct

裸 ReAct 容易出现无限循环、重复付费调用、把模型自评当事实、工具参数污染、错误累积和无法恢复。ShanHaiEdu 的正确形态是“模型负责判断，系统负责边界”：

- 不用一个随意的 `max_turns=10` 作为业务完成条件，但每个 run 必须有总安全兜底：`maxSteps`、`maxToolCalls`、`maxCost`、`maxWallClock`、`maxContext`。
- 在 run 总预算内，再对每种 action/tool/provider 设幂等键、重试上限和熔断原因；模型不能通过轮换 action 绕过总预算。
- 高副作用动作逐次 HumanGate；同一批准可覆盖明确的批次，但不能无限续用。
- 所有观察落库，重启后从 checkpoint 恢复，而不是依赖模型记住。
- Harness 不写 `if PPT then...` 业务分支，业务规则进入 Skill/Contract/Tool/Rubric/Profile。

## 5. 推荐智能体角色

| 角色 | 负责 | 不负责 | 暴露方式 |
|---|---|---|---|
| Main Agent | 理解教师、选择路径、调用专家/工具、综合 observation、Replan | 背完整手册、直接执行 Provider、判定真实交付 | 产品主智能体 |
| PPT Director | 叙事结构、视觉系统、逐页设计、样张/资产返修计划 | 直接生图、写 PPTX、最终自审通过 | Agent-as-Tool |
| Video Director | 创意、节拍、分镜、参考资产、镜头返修策略 | 直接提交 API、拼接成片、最终自审通过 | Agent-as-Tool |
| Delivery Critic | 消费 ValidationReport 和真实 render/clip，按 rubric 生成语义 CriticReport | 重判硬门、修改被审产物、调用 Provider、批准教师决策 | 独立只读 Agent-as-Tool |

不要为“大纲 Agent、设计稿 Agent、样张 Agent、底图 Agent、字幕 Agent”各建一个聊天角色。专业阶段可以是 Director 内部模式或 Tool，不需要形成多方闲聊。

## 6. Agent-as-Tool 与普通 Tool

### Agent-as-Tool

适合需要领域推理、比较和返修定位的任务：

- `ppt_director.plan_or_repair`
- `video_director.plan_or_repair`
- `delivery_critic.review`

输入必须是受控 ContextPackage、目标阶段、artifact refs 和版本；输出是结构化建议/报告，不直接产生外部副作用。当前 internal capability 只支持固定 Markdown Artifact，正式接入前必须新增通用 `AgentToolExecutor + runtime profile + output contract + report artifact` 协议，不能只给 ToolDefinition 加几个字段。

### 普通 Tool

适合边界明确、结果可验证的执行：

- 生图、PPTX 组装、渲染、contact sheet
- 视频提交/查询/下载、TTS、字幕/叠字
- ffprobe、转码归一化、FFmpeg 合成
- 文件校验、打包、存储

普通 Tool 的 schema 不携带整本方法论，Director 负责给它准备合格输入。

## 7. 避免模型被过度约束

每条规则必须标记类型：

| 类型 | 示例 | 能否覆盖 |
|---|---|---|
| invariant | 教材事实不得编造；真实文件不得伪装；儿童安全 | 不可覆盖 |
| contract | 每个 shot 有稳定 ID；PPT 精确信息保持可编辑；缺必需输入不得继续 | 只能升级版本，运行中不可绕过 |
| method default | 先做代表样张；镜头通常只承担一个功能 | 可由 Director 给出理由后调整 |
| style profile | 立体生图、clean family、照片型、板书型 | 教师或 Agent 可选择 |
| provider profile | 模型、时长上下限、参考图数量、分辨率、成本 | 由运行时按可用性解析 |
| user preference | 简洁、活泼、页数偏好 | 只在不冲突时生效 |

关键做法：

- 主 Agent 只看到 Skill 摘要和工具目录。
- Director 每次只加载当前阶段的 Skill 章节。
- 硬规则只保留一份权威源，由 Prompt Compiler 引用，不复制到五个 prompt。
- 软策略带 `applicability`、`default`、`overrideConditions` 和 `reasonRequired`。
- 质量报告定位到具体 pageId/shotId，避免“整套重做”。

## 8. 持久化与恢复模型

当前 Artifact/GenerationJob/AgentRun 可继续复用，但目标状态需增加以下语义：

| 事实 | 最小字段 |
|---|---|
| Agent run | runId、goal、currentPlanVersion、status、maxSteps/toolCalls/cost/wallClock/context、contract/skill/rubric version |
| Action event | sequence、decisionSummary、toolId、boundInputRefs、status、observationRef、timestamp |
| Checkpoint | worldStateVersion、pendingActions、completedUnits、failedUnits、externalJobs |
| Unit | pageId/shotId、ordinal、stage、version、validationStatus、selectedArtifactId、humanDecisionRef |
| Generation job | unitId、providerTaskId、inputHash、attempt、poll state、resultArtifactId |
| Validation report | domain、stage、target locator、validator bindings、hard results、evidence refs |
| Critic report | rubric version、semantic findings、scores、target locators、responsible stage |
| Quality decision | validationReportRef、criticReportRef、productionPath、deliveryEligibility、decision |
| Human decision | actionId、action、targetVersion、inputHash、gateScope、decision、actor、expiresAt |
| Project lease | projectId、leaseId、ownerRunId、lockedUntil、heartbeatAt、status |

恢复时由系统重建 WorldState，再让 Agent Replan；不要恢复隐藏思维文本，也不要把旧 prompt 原样重放当作 checkpoint。

## 9. 对 SDK 的最终判断

| 方案 | 可借鉴能力 | 当前建议 |
|---|---|---|
| 当前 OpenAI SDK + 自有 ToolRouter | 已适配业务状态、Artifact、HumanGate，迁移成本最低 | 继续作为近期主线 |
| Vercel AI SDK | ToolLoopAgent、流式 UI、工具调用和 Next.js 生态 | 可做后续 Runtime Adapter 选项，不作为质量改造前置 |
| Vercel Workflows | 持久执行、等待和恢复 | 若未来部署环境与产品约束适配，再独立评估 |
| OpenAI Agents SDK | runner、handoff、guardrail、session、trace | 借鉴概念；是否替换运行时另做 ADR |
| LangGraph | state/node/edge/checkpoint、条件分支、人工中断 | 适合复杂可恢复图；当前先吸收数据/检查点思想，不急于换栈 |

最终原则：框架负责 agent loop 的通用机制，ShanHaiEdu 自己必须拥有教育领域合同、Artifact 事实、质量量表和教师决策。
