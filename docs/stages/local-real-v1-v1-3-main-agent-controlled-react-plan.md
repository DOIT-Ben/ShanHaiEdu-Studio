# ShanHaiEdu V1-3 Main Agent受控ReAct计划

更新时间：2026-07-13

状态：`done`（见同名closeout）

关联主线：`docs\stages\local-real-v1-mainline-adjustment-plan.md`

## 1. 目标

在不削弱HumanGate、PlanGuard、Quality Gate、项目租约、IntentEpoch和Artifact真实性边界的前提下，让产品内部Main Agent在一次教师消息处理中：

```text
读取WorldState
-> 选择只读Agent Tool
-> 获得结构化Observation
-> 同轮重新判断
-> 选择业务Tool、请求教师确认、改道或暂停
```

V1-3只完成共享编排运行时，不宣称PPT或视频领域闭环已经完成。课程锚点的完整生产Critic持久化和成片复核仍在V1-7纵向验收。

## 2. 当前基线

- Main Agent当前通过结构化JSON返回一个`CapabilityToolPlan`。
- 业务Tool由`conversation-turn-service.ts`在HumanGate、PlanGuard、预算与ToolRouter之后执行。
- Tool成功后，`advanceDeliveryPlan()`按固定步骤选择下一能力；失败Observation写入消息后立即结束本轮。
- 现有`OpenAIRuntime`有Responses原生`function_call`循环，但只服务产物Runtime的单个内部Tool，不是主Main Agent编排。
- V1-2已经封板三个Agent Tool的Registry、Schema、调用信封、Router、默认授权和课程锚点合同；三个Tool仍为`executorReady=false`、`mainAgentExecutable=false`。
- 队列Worker已经持有真实actor/session快照、项目写租约和fencing token，但这些执行事实尚未传入Main Agent Agent Tool调用信封。

## 3. 核心设计

### 3.1 双层受控循环

| 层 | 能调用什么 | 是否允许业务副作用 | 决策主体 |
|---|---|---|---|
| Main Agent内层 | PPT Director、Video Director、Delivery Critic | 否；只返回Report/Observation | Main Agent同轮自主选择和Replan |
| 业务执行外层 | PPT资产、组装、视频镜头、最终包等高层Tool | 是；必须经过服务端Guard | Main Agent提出，真实HumanGate与服务端决定是否执行 |

内层Agent Tool调用不得创建产品Artifact、批准HumanGate、推进QualityDecision或直接调用媒体Provider。业务Tool不得在模型内部循环中绕过服务端确认直接执行。

### 3.2 统一Dispatcher

新增统一Main Agent Tool Dispatcher，按Registry解析Tool：

- Agent Tool：由服务端构造签名调用信封，进入`routeAgentToolCall()`。
- 业务Tool：仍进入现有`routeToolCall()`，但只有外层执行路径且HumanGate/PlanGuard已通过时才允许。
- 未知、非白名单、未实现、缺执行身份或缺可信Executor时fail-closed并形成类型化Observation。

模型只能提供专业语义参数。actor、projectId、sourceMessageId、IntentEpoch、Artifact版本/digest、批准输入、review target和Rubric绑定由服务端从当前状态构造或复核。

### 3.3 可信Agent Tool Executor

- 新建OpenAI Responses Agent Tool Executor，直接使用每个Agent Tool的严格输出Schema。
- Executor按`agentProfileId`使用独立职责提示词，读取服务端加载的当前项目可信Artifact摘要和待审目标。
- 没有真实模型配置、模型调用失败或输出不合同时返回失败Observation；禁止回退到deterministic专业结论。
- 注入Executor只保留在测试依赖中，不进入生产工厂。

### 3.4 同轮Observation/Replan

- Main Agent Responses请求允许调用只读Agent Tool；function output返回结构化结果和策略结论，不返回内部密钥、路径或未授权原始响应。
- 每次Agent Tool调用都写入当前教师消息的内部Report/AgentObservation元数据，重启后可进入下一轮WorldState。
- Agent Tool返回后，模型在同一Responses循环中继续判断，最终返回聊天、追问、暂停或业务`toolPlan`。
- 业务Tool成功、失败或质量不通过后，OpenAI Main Agent模式不再调用`advanceDeliveryPlan()`决定下一步；服务端刷新WorldState并再次调用Main Agent形成下一项计划。
- 下一业务Tool需要HumanGate时只创建新的pending action，本轮不得连锁执行第二个有副作用Tool。

### 3.5 预算、停止与降级

- 每轮最多3次只读Agent Tool调用；并行调用关闭。
- 同一Tool与同一参数摘要连续重复时阻塞原样调用，形成Observation并暂停或要求教师决定。
- 继续复用AgentHarnessBudget和RunCheckpoint；预算耗尽不能写成功态。
- 固定DeliveryPlan仅在明确的deterministic降级模式使用，并写入`fixed_delivery_plan_fallback`证据；不得计入Main Agent自主编排。

### 3.6 租约与二次复核

- Queue Worker把真实ExecutionIdentity和ProjectExecutionFence传入ConversationTurnService。
- Agent Tool执行前复核actor、project、IntentEpoch、sourceMessage和Artifact版本/digest。
- Agent Tool结果写入Observation前再次确认当前IntentEpoch与执行租约仍有效；失效结果保留审计但不得成为当前计划依据。
- V1-3不新增数据库表；先复用消息metadata保存只读Agent Tool Report与Observation。若真实性能证明需要独立表，再另立迁移阶段。

## 4. 实施切片

1. 建立Main Agent Agent Tool loop协议、统一Dispatcher和安全function output序列化。
2. 建立无deterministic fallback的OpenAI Agent Tool Executor与生产工厂。
3. 从Queue传递ExecutionIdentity/Fence，在ConversationTurnService构造服务端权威调用信封。
4. 将只读Agent Tool loop接入OpenAI Main Agent请求，持久化Report/Observation。
5. 将OpenAI模式业务Tool成功/失败后的固定续步改为刷新WorldState后Main Agent Replan；deterministic模式保留并显式标记降级。
6. 关闭重复调用、预算、租约失效、未知Tool和注入Executor进入生产等失败路径。
7. 完成专项、全量、构建、SQLite和人工diff审查后形成V1-3 closeout。

## 5. 非目标

- 不调用真实PPT、图片或视频Provider。
- 不实现V1-4自然语言打断全矩阵、V1-5强度UI、V1-6 PPT纵向闭环或V1-7视频纵向闭环。
- 不把Agent Tool Report保存成教师可见产品Artifact。
- 不允许模型直接设置Artifact状态、QualityDecision、HumanGate批准或`final_eligible`。
- 不迁移LangGraph、Vercel AI SDK或其他框架。

## 6. 风险与回退

| 风险 | 控制 |
|---|---|
| Agent Tool内循环绕过HumanGate调用媒体 | 内层白名单只包含`adapterKind=agent`且`sideEffectLevel=none`的Tool |
| 模型伪造项目或Artifact绑定 | 调用信封由服务端构造；Router和默认数据库授权二次复核 |
| Agent Tool失败后无限循环 | 轮数、重复签名、AgentHarnessBudget和RunCheckpoint共同限制 |
| 模型模式改变旧确定性测试 | 仅OpenAI运行态启用同轮Replan；deterministic路径保留且明确标记fallback |
| 专业Executor失败后出现弱草稿 | fail-closed，不接DeterministicRuntime |
| V1-3被误报为视频锚点闭环 | closeout明确只完成共享运行时；V1-7另做真实Critic与成片审查证据 |

回退方式：关闭Main Agent只读Agent Tool loop工厂接线，保留V1-2合同和新增测试；业务Tool继续走原HumanGate/ToolRouter路径。不得回退V1-2 Router权威边界。

## 7. 退出标准

- OpenAI Main Agent在同一教师消息内调用至少一个只读Agent Tool，消费function output后选择不同下一动作。
- Agent Tool调用与结果形成持久化Report/Observation，下一次构建WorldState可恢复。
- 业务Tool成功或失败后，OpenAI模式下一步来自Main Agent Replan，不来自`advanceDeliveryPlan()`。
- 第二个有副作用业务Tool只形成pending HumanGate，不在同轮自动执行。
- 缺模型、缺身份、租约/IntentEpoch失效、未知Tool、重复调用和预算耗尽稳定fail-closed。
- 注入Executor、deterministic专业结论和固定DeliveryPlan均不能作为生产自主编排证据。
- 专项、全量测试、生产构建、SQLite连续初始化和`git diff --check`全部通过。
