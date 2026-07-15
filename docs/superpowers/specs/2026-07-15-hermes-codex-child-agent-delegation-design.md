# H07 Codex 子智能体耐久委派与父等待恢复设计

- Intake 编号：H07
- 设计版本：0.1.0
- 状态：design_review
- 工作模式：planning_only
- 分支：intake-hermes
- ShanHai 研究基线：main@fd2521f1b558b36f2680a661f9d2eaf34ffa584e
- Hermes 研究基线：NousResearch/hermes-agent@6997dc81cd21dc88c6cb808a1fb3626b6ce71254
- Codex App Server 文档读取日期：2026-07-15
- 日期：2026-07-15

## 1. 决策摘要

ShanHai 第一版 Codex 子智能体采用“依赖式同步委派、耐久等待、事件恢复”模型：

1. ShanHai Business Main Agent 是父智能体和唯一业务总控；
2. 父智能体使用自身 Native Agent Runtime 理解教师意图、维护计划并决定是否委派；
3. 父智能体把一个边界明确的局部任务固化为 DelegatedRun；
4. DelegatedRun 由 Codex App Server Runtime 执行完整的局部 Agent Loop；
5. 父执行在依赖点保存 Checkpoint，进入 awaiting_delegated_result；
6. 等待不占用 Worker，也不阻塞其他项目、用户或系统任务；
7. Codex 完成后先持久化结果和完成事件，再唤醒父执行；
8. 父智能体验证结果合同、Artifact 证据、IntentEpoch 和权限后，决定接纳、返修、重新委派、改计划或询问教师；
9. 第一版每个父执行同时最多拥有一个活动 DelegatedRun，不开放父子在同一业务任务上的并行规划；
10. Codex 不能直接修改 Project、Plan、IntentEpoch、HumanGate、QualityDecision、Artifact Promotion 或项目完成状态。

本设计把 Hermes 的子 Agent 隔离、Codex App Server Adapter、耐久完成投递三个机制重新组合，但不复制 Hermes 的进程内线程执行和摘要即完成语义。

本设计只定义未来目标语义、边界、阶段和验收标准，不修改生产代码、数据库、Prompt、Runtime、ToolRouter、Provider 配置或部署。

## 2. 术语与三层身份

“Turn”在 ShanHai、Agent 和 Codex 协议中容易混淆。H07 使用以下术语：

| 术语 | 含义 | 是否业务权威 |
| --- | --- | --- |
| ParentRun | ShanHai Main Agent 因教师消息或恢复事件触发的一轮父执行 | 是 |
| DelegatedRun | 父智能体创建、交给子智能体完成的耐久局部任务 | 是 |
| Attempt | DelegatedRun 的一次执行尝试 | 是 |
| RuntimeThreadBinding | ShanHai 对外部 Runtime Thread 的可丢弃绑定 | 否 |
| CodexTurn | Codex App Server 内部的一次 turn/start 执行 | 否 |
| RuntimeItem | Codex Turn 内的消息、命令、文件变化或 MCP Tool Call | 否 |
| ChildResultEnvelope | 子智能体提交给父智能体的结构化候选结果 | 是，作为候选事实 |
| AcceptanceDecision | ShanHai 对候选结果的接纳、返修或拒绝决定 | 是 |

关系如下：

~~~mermaid
flowchart TD
    U["Teacher message / resume event"] --> P["ParentRun"]
    P --> D["DelegatedRun"]
    D --> A["Attempt"]
    A --> R["Codex Runtime Adapter"]
    R --> T["RuntimeThreadBinding"]
    T --> C["CodexTurn / RuntimeItems"]
    C --> E["ChildResultEnvelope"]
    E --> P2["Resumed ParentRun"]
    P2 --> V["Validation / AcceptanceDecision"]
~~~

关键不变量：

- ParentRun 不是 Codex Thread；
- DelegatedRun 不是 Codex Turn；
- Codex Thread 丢失不等于 ShanHai 任务丢失；
- Codex turn/completed 不等于 Artifact 合格；
- ChildResultEnvelope 不是最终业务完成声明；
- 只有 ShanHai AcceptanceDecision 可以让候选结果进入后续业务流程。

## 3. 父智能体、Runtime 和子智能体的关系

### 3.1 父智能体

父智能体是 ShanHai Business Main Agent，不是单独一个 Runtime。

它负责：

- 教师意图和 TaskBrief；
- IntentEpoch、Plan Revision 和 GenerationIntensity；
- 当前项目与对话状态；
- 任务分解和委派决策；
- Allowed Tools、预算和资源范围；
- HumanGate 和权限边界；
- Artifact、Validation、QualityDecision 和最终完成判断；
- 子结果的接纳、返修、重新规划和教师沟通。

### 3.2 父智能体使用的 Runtime

ShanHai 当前 Controlled ReAct Loop 可以视为父智能体使用的 Native Agent Runtime。

Runtime 是执行 Agent Loop 的发动机，不是业务身份。未来父智能体可以继续使用 Native Runtime，而不需要把自身替换成 Codex。

### 3.3 Codex 子智能体

Codex 子智能体是一个由 DelegatedRun 定义的局部执行身份，其执行发动机是 Codex App Server Runtime。

Codex 子智能体负责：

- 在 TaskBrief 范围内理解局部目标；
- 制定局部步骤；
- 调用本次允许的工具；
- 观察工具结果并调整；
- 形成候选产物、验证证据和安全摘要；
- 在完成、阻断、中断、失败或结果不确定时返回结构化状态。

Codex 子智能体不负责：

- 改写父计划；
- 扩大自身任务；
- 修改 IntentEpoch；
- 批准 HumanGate；
- 批准 QualityDecision；
- 提升 Artifact 正式版本；
- 宣布项目或交付包完成；
- 再次委派其他子智能体。

第一版 Codex 子智能体固定为 Leaf。

## 4. 为什么第一版采用父等待

第一版的“父等待”不是线程阻塞，而是耐久依赖屏障。

示例：

~~~text
教师：制作《火烧云》课堂 PPT
→ 父智能体创建 ParentRun
→ 父智能体判断必须先完成教材重点分析
→ 创建 DelegatedRun，交给 Codex
→ 保存 ParentRun Checkpoint
→ ParentRun 状态变为 awaiting_delegated_result
→ 当前 Worker 释放
→ Codex 在独立 Worker/Runtime 中执行
→ 结果与完成事件持久化
→ 父执行被恢复
→ 父智能体验证教材分析
→ 继续设计 PPT
~~~

采用父等待的原因：

1. 父智能体的下一步依赖子结果；
2. 避免父子同时修改同一 Artifact 或计划节点；
3. 降低 IntentEpoch 变化后的旧结果污染风险；
4. 简化取消、恢复、去重和副作用对账；
5. 先证明一个子智能体的完整治理边界，再开放并行；
6. 避免第一版同时引入委派、并行、冲突合并和多结果归并四类复杂度。

等待期间：

- 不占用父 Worker；
- 不保持数据库事务；
- 不阻塞其他用户或项目；
- UI 可以继续接收安全进度；
- 用户可以停止、改意图或提交新消息；
- 系统可以处理其他无关任务；
- Codex 完成后通过事件恢复父执行。

## 5. Hermes 源码结论

### 5.1 Hermes 的默认委派

Hermes delegate_task 会创建独立子 AIAgent：

- 新对话，无父消息历史；
- 独立 Session 和终端；
- 只接收 goal、context 和可用工具；
- 独立迭代预算；
- 默认 Leaf，Orchestrator 需显式开启；
- 父中断会向活动子 Agent 传播；
- 父只接收最终摘要和有限轨迹。

值得吸收：

- 新上下文隔离；
- 父子稳定身份；
- 工具能力不能超过父；
- 预算由配置/服务端控制，不由模型扩张；
- 生命周期事件、心跳、定向中断和成本归集；
- 只把有界结果带回父上下文。

### 5.2 Hermes 的 Codex Runtime

Hermes 在 api_mode=codex_app_server 时提前分流，把整个当前 Turn 交给 Codex App Server，不与默认 Agent Loop 共同控制。

Adapter 具备：

- 一 Hermes Session 对应一 Codex Thread；
- App Server 启动、握手和 thread/start；
- turn/start、turn/interrupt 和 thread/compact/start；
- 子进程存活检测；
- Turn timeout；
- Tool 完成后静默 Watchdog；
- Server-initiated approval 桥接；
- OAuth、协议和进程错误分类；
- 不健康 Session 退休；
- Token Usage 和 Compaction 记录；
- Codex Event 到 Hermes 消息的投影。

值得吸收：

- Adapter 隔离外部协议；
- Thread Binding 生命周期；
- Watchdog、退休和错误脱敏；
- 确定性 Tool Call ID；
- item/completed 后才物化事实候选；
- Display Hook 失败不改变控制流。

### 5.3 Hermes 的后台完成投递

Hermes background delegation 会：

- 持久化 dispatch 记录；
- 子任务完成后先保存 completion event；
- 将完成事件投递到共享 fresh-turn queue；
- 使用 delivery claim 防止多个消费者重复接收；
- 成功注入新 Turn 后 ack；
- 注入失败时 release claim；
- 重启后恢复已完成但未投递的事件；
- 进程死亡且子执行尚未完成时标记 unknown。

值得吸收：

- 完成结果以新恢复边界进入父执行；
- 不在 Tool Result 与 Assistant Message 中间篡改旧历史；
- durable claim/ack；
- 完成事件自带原任务来源和上下文；
- 对无法证明的外部副作用使用 unknown，而不是盲目成功或重试。

### 5.4 Hermes 没有直接完成的组合

Hermes 当前标准配置没有直接形成以下通路：

~~~text
Default Hermes Main Agent
→ delegate_task
→ Codex App Server child
~~~

原因：

- codex_app_server 是整个 Turn 的 Runtime 分流；
- Hermes 的 Codex MCP 工具集不暴露依赖活 AIAgent 上下文的 delegate_task、memory 和 session_search；
- delegation 的配置解析正式支持普通 Provider/API 模式，不直接提供 codex_app_server 子 Runtime 开关；
- Codex Runtime 可以使用 stateless kanban_* 命令，但这与调用父 AIAgent 的 delegate_task 不同。

H07 因此是重新组合成熟边界，而不是复制一个现成 Hermes 配置。

## 6. 方案比较

### 6.1 方案 A：把 Codex 当普通 Tool

~~~text
delegate_to_codex(prompt) → string
~~~

优点：

- 改动最小；
- 容易做演示。

缺点：

- 无独立耐久身份；
- 无权威终态；
- 无事件、恢复和副作用对账；
- 难以绑定工具、预算和 Artifact 证据；
- 父执行崩溃后难以证明发生了什么。

结论：拒绝作为目标架构。

### 6.2 方案 B：Codex 作为耐久 DelegatedRun Runtime

父智能体创建 DelegatedRun，Runtime Kernel 选择 Codex Adapter，Codex 执行完整局部 Loop，父执行在依赖点等待并耐久恢复。

优点：

- 保留 ShanHai 自研 Main Agent；
- Codex 能完整发挥多步工具循环；
- 身份、预算、恢复和证据清晰；
- 与现有 ToolRouter、IntentEpoch、Artifact 和 Quality Gate 兼容；
- 未来可以增加 Native 或专项 Runtime；
- 可逐阶段演进到安全并行。

代价：

- 需要明确 ParentRun、DelegatedRun、Attempt 和 Runtime Binding；
- 需要完成 H02 Runtime Event、H03 Context Lineage、H06 Codex Adapter 前置设计；
- 必须建立完成事件去重与恢复测试。

结论：采用。

### 6.3 方案 C：Codex 替换父 Main Agent Turn

Codex 接管教师消息对应的整个顶层 Turn，接近 Hermes codex_app_server 模式。

优点：

- Codex 自主性最高；
- 集成路径相对直接。

缺点：

- 容易把业务控制面与 Runtime 混在一起；
- 父业务 Agent 的 TaskBrief、PlanGuard 和 HumanGate 价值被削弱；
- 对教育 Artifact、质量和交付状态不够可控；
- 不是用户确认的产品形态。

结论：不作为第一版；未来仅保留为受控实验 Runtime。

## 7. 目标架构

~~~mermaid
flowchart TD
    T["Teacher / API"] --> M["ShanHai Business Main Agent"]
    M --> N["Native Parent Runtime"]
    N --> G["Delegation Guard"]
    G --> D["Durable DelegatedRun"]
    D --> K["Runtime Kernel / Existing TurnJob Infrastructure"]
    K --> C["Codex App Server Adapter"]
    C --> X["Codex Child Agent Loop"]
    X --> P["ShanHai MCP Tool Gateway"]
    P --> R["Existing ToolRouter"]
    R --> A["Provider / Artifact Staging / Validation"]
    X --> E["ChildResultEnvelope"]
    E --> O["Durable Completion Event + Outbox"]
    O --> W["Resume ParentRun"]
    W --> Q["Acceptance / Repair / Replan"]
~~~

## 8. 与 ShanHai 当前主线的结合

### 8.1 复用现有业务控制面

继续复用：

- TaskBrief；
- IntentGrant 和 IntentEpoch；
- Plan Revision；
- GenerationIntensity；
- AgentWorldState；
- ToolObservation；
- ReAct Checkpoint；
- ExecutionEnvelope；
- ToolRegistry 和 ToolRouter；
- ValidationReport、CriticReport 和 QualityDecision；
- Artifact staging、promotion 和 lineage；
- Conversation TurnJob；
- project execution lease、heartbeat 和 fencing；
- Provider taskId、inputHash、幂等和 submission_unknown。

### 8.2 不创建第二套 Lease/Fence

DelegatedRun Attempt 必须复用或泛化现有执行基础设施：

- 项目级写入权；
- Worker lease；
- heartbeat；
- fencing token；
- old-worker quarantine；
- 幂等键；
- 副作用对账。

H07 不新建一套独立于主线的子智能体锁和 Fence。

### 8.3 Native Parent Runtime 保持不变

现有 runMainAgentControlledReActLoop 继续是父智能体的 Native Runtime。

未来仅在 Tool/Action Policy 中增加受控委派能力：

~~~text
delegate_runtime_task
~~~

它不能直接启动 Codex 进程，而是把服务端已经绑定的 DelegatedTaskBrief 提交给 Delegation Service。

### 8.4 ToolRouter 保持唯一业务工具入口

Codex 通过 MCP Gateway 看到的工具来自 ToolRegistry 投影，但每次执行仍进入现有 ToolRouter。

禁止：

- Codex 直接连接业务数据库；
- Codex 直接写 Artifact 正式版本；
- Codex 直接调用 Provider 主密钥；
- Codex 使用模型参数扩大 Allowed Tools；
- MCP Handler 依赖内存中的父 Agent 对象；
- Codex 内置 Shell 越过隔离 Workspace 修改业务权威状态。

## 9. DelegatedRun 输入合同

目标语义示意：

~~~typescript
type DelegatedTaskBrief = {
  schemaVersion: "delegated-task-brief.v1";
  childRunId: string;
  rootRunId: string;
  parentRunId: string;
  projectId: string;
  conversationId: string;
  sourceMessageId: string;
  intentEpoch: number;
  planRevision: number;
  objective: string;
  taskBriefDigest: string;
  contextSnapshotId: string;
  memoryPackageId?: string;
  inputArtifactRefs: ArtifactRef[];
  allowedTools: string[];
  capabilityGrantId: string;
  resourceScopes: string[];
  resultContract: Record<string, unknown>;
  acceptanceCriteria: Record<string, unknown>;
  budget: RuntimeBudget;
  deadlineAt: string;
  cancellationPolicy: "parent_or_intent_change";
  runtimeKind: "codex_app_server";
};
~~~

服务端权威字段：

- 所有 ID；
- projectId 和 conversationId；
- intentEpoch 和 planRevision；
- allowedTools；
- capabilityGrantId；
- resourceScopes；
- budget；
- deadlineAt；
- cancellationPolicy；
- runtimeKind。

模型只可以建议 objective 分解和局部执行步骤，不能覆盖权威字段。

## 10. Context 与 Memory 边界

Codex 子智能体默认没有父智能体完整历史。

输入分为：

1. Stable Runtime Policy：身份、行为边界、工具规则、结果合同；
2. Project Context：课程、年级、学科和已批准事实；
3. Delegated Task Context：局部目标、资源范围和依赖；
4. Turn Memory Package：H01/H03 选择的有界 Approved Memory；
5. Artifact References：只给引用和必要摘要，按需读取；
6. Latest Observation：当前 Attempt 内最新工具结果。

必须满足：

- ContextSnapshot 不可变并带 Digest；
- Memory Package 只读；
- Codex 不能直接写 Approved Memory；
- 子结果可以产生 Memory Candidate，但由 ShanHai Curator/审批流程处理；
- 压缩不覆盖原始 Event、Tool Result、Artifact 和审批证明；
- 恢复时使用相同 Snapshot，或显式创建新版本并增加 Attempt。

## 11. MCP Tool Gateway

### 11.1 设计原则

MCP 只是协议暴露层，不是第二套业务系统。

~~~text
Codex
→ MCP tools/list
→ MCP tools/call
→ ShanHai MCP Gateway
→ Server-bound Execution Context
→ Existing ToolRouter
~~~

### 11.2 每次调用必须绑定

- projectId；
- parentRunId；
- childRunId；
- attemptId；
- intentEpoch；
- sourceMessageId；
- capabilityGrantId；
- executionEnvelope；
- fencingToken；
- budgetReservationId；
- idempotencyKey；
- resourceScope。

这些字段不能相信 Codex 请求体，应由 Gateway 根据 Runtime Session 服务端绑定。

### 11.3 第一版工具范围

第一版建议按以下顺序开放：

1. 只读 Project Context；
2. 读取已批准 Artifact；
3. 创建非权威结构化候选；
4. 运行确定性校验；
5. 写隔离 staging；
6. 经过后续单独评审后，才开放有限业务 Tool。

第一版不开放：

- Artifact Promotion；
- FinalDeliveryGate；
- HumanGate approval；
- QualityDecision approval；
- 项目权限修改；
- 用户管理；
- 破坏性删除；
- 任意外发；
- 子智能体再次委派；
- Memory Approved 写入。

## 12. 状态机

### 12.1 ParentRun 状态

~~~text
running
→ delegating
→ awaiting_delegated_result
→ resuming
→ running
→ completed / blocked / failed / superseded
~~~

规则：

- 进入 awaiting 前必须保存父 Checkpoint；
- awaiting 不持有 Worker；
- 同一等待条件只接受一个有效 completion；
- 用户新意图可以 Supersede 旧 ParentRun；
- 旧结果可以审计保存，但不能自动进入新 IntentEpoch。

### 12.2 DelegatedRun 状态

~~~text
created
→ queued
→ running
→ completed_candidate
  | blocked
  | failed
  | interrupted
  | completion_uncertain
→ accepted
  | repair_requested
  | rejected
  | superseded
~~~

completed_candidate 只表示 Runtime 已形成候选，不表示业务通过。

### 12.3 Attempt 状态

~~~text
created
→ leased
→ running
→ terminal
  | lost
  | reconciliation_required
~~~

同一 DelegatedRun 同时只能有一个有效 Attempt。新 Attempt 必须使旧 Fencing Token 失效。

## 13. ChildResultEnvelope

~~~typescript
type ChildResultEnvelope = {
  schemaVersion: "child-result.v1";
  childRunId: string;
  attemptId: string;
  runtimeKind: "codex_app_server";
  runtimeThreadId?: string;
  runtimeTurnId?: string;
  status:
    | "completed_candidate"
    | "blocked"
    | "failed"
    | "interrupted"
    | "completion_uncertain";
  terminalEventRef?: string;
  contextSnapshotDigest: string;
  candidateArtifactRefs: ArtifactRef[];
  observationRefs: string[];
  validationReportRefs: string[];
  changedResourceScopes: string[];
  toolCallRefs: string[];
  usage: RuntimeUsage;
  safeSummary: string;
  failure?: RuntimeFailure;
};
~~~

完成条件：

- 收到并持久化匹配 Attempt 的 Runtime 权威终态；
- IntentEpoch、Attempt 和 Fencing Token 有效；
- ChildResultEnvelope Schema 通过；
- 候选 Artifact/Observation 引用存在且归属正确；
- Result Contract 最低结构通过；
- 没有未对账的副作用。

以下情况不能标记 completed_candidate：

- 只有 Assistant Text；
- 只有 final summary；
- 达到 max iterations 但没有成功终态；
- 未收到 turn/completed；
- Worker 或 App Server 失联；
- Tool Result 返回 Runtime 前未持久化；
- IntentEpoch 已过期；
- Fencing Token 失效；
- Artifact 引用缺失或归属错误。

## 14. Codex Runtime Thread 生命周期

### 14.1 第一版绑定策略

为降低上下文污染，第一版建议一个 DelegatedRun 对应一个 Codex Thread Binding。

暂不跨不同 DelegatedRun 复用 Thread。

优点：

- 隔离最清晰；
- 容易审计和删除；
- Context Snapshot 与 Thread 一一绑定；
- 降低旧任务污染新任务；
- 简化 IntentEpoch 和权限变化。

未来只有满足以下条件才评估复用：

- 同一租户、项目和对话；
- 同一任务 Lane；
- 相同或兼容 IntentEpoch；
- 相同 Capability Policy；
- 相同 Workspace 和数据边界；
- 前一 Attempt 没有 completion_uncertain；
- Thread 健康且没有退休原因。

### 14.2 Session 退休

出现以下情况必须退休：

- App Server 进程退出；
- JSON-RPC 协议失步；
- turn/start 超时；
- Tool Result 后静默 Watchdog 触发；
- turn/interrupt 无确认；
- OAuth/凭证不可恢复；
- Approval bridge 完整性失败；
- Runtime 越权；
- 缺失 turn/completed；
- completion_uncertain；
- Workspace 或权限边界变化。

## 15. 中断、改意图和恢复

### 15.1 中断来源

- 教师主动停止；
- 新消息提升 IntentEpoch；
- 父 ParentRun 被 Supersede；
- 项目归档、删除或权限撤销；
- Capability Grant 撤销；
- 预算耗尽；
- Deadline 到期；
- Worker 回收；
- Runtime Watchdog；
- 安全策略阻断。

### 15.2 中断流程

~~~text
persist interrupt_requested
→ invalidate or stop renewing lease
→ send Codex turn/interrupt
→ wait bounded acknowledgment
→ persist interrupted / completion_uncertain
→ retire session when needed
→ emit parent resume event
~~~

中断是请求与确认的过程，不是瞬时布尔值。

### 15.3 崩溃恢复

父执行崩溃：

- Parent Checkpoint 已保存；
- DelegatedRun 独立继续或进入恢复；
- 完成事件持久化后可重新唤醒父执行。

子 Worker 崩溃：

- 旧 Lease 到期；
- 新 Worker 获取新 Fencing Token；
- 先检查 Runtime Thread、外部副作用和持久化 Tool Result；
- 能证明安全时恢复；
- 无法证明时进入 completion_uncertain 或 reconciliation_required；
- 不自动重放付费或有副作用工具。

完成后、父接收前崩溃：

- Completion Event 已在 Outbox；
- 消费者 claim；
- 注入父恢复成功后 ack；
- 注入失败 release；
- 重启后重新投递；
- 同一 ChildRun Completion 最多被业务接受一次。

## 16. 父智能体恢复后的决策

父智能体恢复后必须先执行确定性检查，再把安全摘要和 Observation 提供给模型。

可能决策：

- accept_candidate：候选满足合同，进入后续质量/业务流程；
- repair_same_child：生成新的 DelegatedRun 或 Attempt 修复明确问题；
- replan_parent：结果改变总体路线；
- ask_teacher：存在不可推断选择；
- reject_candidate：候选不符合任务或安全边界；
- stop：Intent 已撤销或任务不再需要。

父模型不能绕过确定性检查直接 accept。

## 17. 第一版并发边界

第一版：

- 每个 ParentRun 同时最多一个活动 DelegatedRun；
- 父进入 awaiting_delegated_result；
- Codex 子智能体固定 Leaf；
- 不开放 Child Batch；
- 不开放父子共同修改同一 Artifact；
- 不开放多个 Codex 子智能体并行；
- 不开放后台完成后自行推进项目；
- 完成后必须恢复父智能体再决定下一步。

系统整体仍可并发处理：

- 其他用户；
- 其他项目；
- 其他无依赖后台任务；
- UI 事件投影；
- 监控和审计。

未来 H05/H07 后续版本才评估：

- 多个资源范围不冲突的 DelegatedRun；
- 父智能体继续推进非依赖分支；
- Fan-out/Fan-in；
- Sibling Artifact 冲突检测；
- 分支预算和成本汇总。

## 18. 事件与投影

H07 依赖 H02 统一 Runtime Event，但要求至少区分三类：

### 18.1 Runtime Control Event

- delegated_run.created；
- attempt.leased；
- runtime.thread_bound；
- runtime.turn_started；
- runtime.item_completed；
- runtime.turn_completed；
- runtime.interrupt_requested；
- runtime.interrupted；
- runtime.retired；
- delegated_run.completion_uncertain。

### 18.2 Business Observation

- Tool Observation；
- Artifact staging ref；
- Validation Report；
- Budget Event；
- Provider side-effect ref；
- AcceptanceDecision。

### 18.3 UI Projection

- 正在分析；
- 正在读取材料；
- 正在生成候选；
- 正在校验；
- 已暂停；
- 需要教师输入；
- 已完成阶段结果。

UI Projection 不是业务真值，不显示内部推理，不直接暴露 Runtime 错误原文。

## 19. 安全与凭证

- Codex Runtime Home 按受控 Worker/Profile 隔离；
- 禁止共享个人 CODEX_HOME 和个人登录状态承载多租户业务；
- Workspace 只能访问本 DelegatedRun 的隔离目录；
- MCP Gateway 使用短期、最小权限、服务端绑定凭证；
- Provider 主密钥不进入 Codex Prompt、环境或工具参数；
- Tool Result 和错误在持久化、投影和显示前脱敏；
- Approval 请求必须映射到 ShanHai Policy/HumanGate，未知请求失败关闭；
- Shell/File 只能操作隔离 Workspace；
- Artifact 正式存储和数据库不直接挂载给 Codex。

## 20. 失败关闭规则

| 场景 | 第一版处理 |
| --- | --- |
| Codex 返回文本但无 turn/completed | completion_uncertain，退休 Thread |
| Codex 达到迭代上限但有摘要 | blocked/failed，不是 completed |
| Codex Tool Call 重复 | 由幂等键和 ToolRouter 阻断 |
| 父 IntentEpoch 变化 | 中断子执行，旧结果只审计 |
| 子 Worker 失联 | Lease 到期，副作用对账 |
| Completion 重复投递 | Claim/幂等接受一次 |
| MCP 请求缺少/伪造上下文 | 使用服务端绑定并拒绝不匹配 |
| Artifact Contract 失败 | repair_requested 或 rejected |
| 付费 Provider 状态未知 | reconciliation_required，不自动重试 |
| Runtime 越权 | 立即中断、退休和安全事件 |
| UI 投影失败 | 不改变主控制流 |

## 21. 分阶段路线

H07 仍遵守 intake-hermes planning_only，当前只完成 H07-0 设计。

| 阶段 | 交付物 | 入口条件 | 退出条件 |
| --- | --- | --- | --- |
| H07-0 | 本设计 | H00/H01/H02 设计存在 | 设计评审通过 |
| H07-1 | ParentRun/DelegatedRun/Result Contract 计划 | 主线稳定、Drift Review、明确授权 | 计划和合同测试获批 |
| H07-2 | Fake Runtime 父等待与耐久恢复 | H07-1 通过 | 无 Codex 依赖也能验证状态机、Outbox、去重 |
| H07-3 | Codex Runtime 绑定 | H06 Adapter 与 H02 Event 可用 | Codex 通过同一 DelegatedRun Contract |
| H07-4 | 只读 MCP Gateway | H07-3 通过 | Server Context、工具白名单和越权测试通过 |
| H07-5 | Staging 写入与 Result Contract | H07-4 通过 | 候选、验证、IntentEpoch 和 Fence 测试通过 |
| H07-6 | 故障恢复与副作用对账 | H07-5 通过 | 崩溃、超时、重复投递、未知结果测试通过 |
| H07-7 | 安全并行候选 | H05 与 H07-6 通过 | 单独设计并再次批准，不属于第一版 |

不得直接从 H07-0 跳到 Codex 生产接入。

## 22. 测试矩阵

### 22.1 父等待

- 委派前父 Checkpoint 必须落库；
- 父进入 awaiting 后 Worker 可释放；
- 子完成前父不能推进依赖步骤；
- 子完成后父从正确 Checkpoint 恢复；
- 恢复事件不能插入旧 Tool/Assistant 消息中间；
- 父只接收安全摘要和证据引用。

### 22.2 完成判定

- 有 final text、无 turn/completed：不能完成；
- 有 summary、max_iterations：不能完成；
- completed 但 Result Contract 失败：不能接受；
- completed 且 Artifact ref 缺失：不能接受；
- completed 且 IntentEpoch 过期：只能审计；
- completed 且 Fence 失效：拒绝提交；
- completed_candidate 经验证后才能进入 AcceptanceDecision。

### 22.3 中断与恢复

- 用户停止传播到 Codex；
- 新 IntentEpoch 中断旧子执行；
- 父进程重启后继续等待；
- 子完成、父接收前重启：重新投递一次；
- Completion 多消费者竞争：只有一个 claim 成功；
- 注入失败后 release，可重试；
- 子 Worker 崩溃：旧 Fence 不能继续写；
- Provider 状态未知：不重复付费调用。

### 22.4 工具与权限

- 未经 Gateway/ToolRouter 的业务 Tool Call 数为 0；
- 模型不能扩大 allowedTools；
- 模型不能伪造 projectId/intentEpoch/fence；
- Codex 不能访问其他项目 Artifact；
- Codex 不能直接 Promotion；
- 未知 Approval 请求失败关闭；
- Tool Result 返回 Runtime 前已经持久化；
- 每个 Tool Call 有 childRunId、attemptId、callId 和审计身份。

### 22.5 Runtime

- App Server 启动失败；
- initialize 失败；
- thread/start 失败；
- turn/start 失败；
- 子进程中途退出；
- post-tool watchdog；
- turn timeout；
- interrupt 无响应；
- OAuth 失效；
- Session retirement；
- Event 重复和乱序；
- Schema 版本不兼容。

## 23. 第一版验收标准

硬性不变量：

- 同一 ParentRun 活动 DelegatedRun 数量不超过 1；
- 等待期间持有父 Worker 数量为 0；
- 无父 Checkpoint 的 DelegatedRun 数量为 0；
- 无权威 Runtime 终态却标 completed_candidate 的数量为 0；
- 过期 IntentEpoch 结果进入 Artifact 的数量为 0；
- 旧 Fencing Token 成功写入的数量为 0；
- 未经 ToolRouter 的业务 Tool Call 数量为 0；
- 崩溃恢复导致的重复付费 Provider 调用数量为 0；
- Runtime 直接批准 HumanGate、QualityDecision 或 Promotion 的数量为 0；
- Completion Event 被业务接受两次的数量为 0；
- Codex 子智能体再次委派的数量为 0。

质量指标：

- ParentRun 恢复成功率；
- Completion 投递成功率；
- 中断确认率；
- completion_uncertain 分类准确率；
- Result Contract 通过率；
- Artifact Validation 通过率；
- 工具重复调用率；
- P50/P95 子任务耗时；
- Token 和成本；
- 教师干预率；
- 父智能体返修和重新委派率。

## 24. 对现有代码的预期影响

以下只是研究基线上的影响预测，不是当前实施清单：

- src/server/agent-runtime/types.ts：未来增加 Runtime Session/Event/DelegatedRun 目标语义；
- src/server/agent-runtime/runtime-factory.ts：未来演进为 Runtime Router；
- src/server/conversation/main-agent-controlled-react-loop.ts：保留父 Native Runtime，增加受控委派动作；
- src/server/conversation/main-agent-react-checkpoint.ts：未来增加 awaiting dependency 和 child result ref；
- 现有 Conversation TurnJob：未来承载父等待与恢复；
- 现有 execution lease/fence：未来泛化给 DelegatedRun Attempt；
- src/server/tools/tool-registry.ts：未来生成 MCP Schema 和 Capability Policy；
- src/server/tools/main-agent-tool-dispatcher.ts：未来提交服务端绑定 DelegatedTaskBrief；
- src/server/tools/tool-router.ts：继续作为唯一业务工具入口；
- 新增 Codex Adapter、Delegation Service、Completion Outbox 和 MCP Gateway 的独立模块。

实施前必须重新同步 main 并执行 Architecture Drift Review，文件路径和接口不得按本设计直接照抄。

## 25. 非目标

本设计不批准：

- 修改 main；
- 修改生产 AgentRuntime；
- 安装 Codex SDK 或 LangGraph；
- 启动 Codex App Server PoC；
- 创建数据库迁移；
- 暴露 MCP；
- 启用父子并行；
- 启用多子智能体；
- 启用嵌套委派；
- 修改 Memory；
- 修改 Provider 配置；
- 调整部署或密钥；
- 创建合入 main 的 PR。

## 26. 设计自审

- 无 TBD、TODO 或未选择的第一版控制模式；
- ParentRun、DelegatedRun、Attempt、Runtime Thread 和 Codex Turn 已分开；
- 父等待明确为耐久状态，不是线程阻塞；
- 第一版明确只有一个活动子执行；
- Runtime 完成与业务接纳已分开；
- 与 H01 Memory、H02 Runtime Event、H03 Context Lineage、H05 并行、H06 Codex Adapter 的边界已明确；
- 未创建第二套 Lease/Fence；
- 未把本设计写成当前主线实施计划；
- 与 intake-hermes planning_only 策略一致。

## 27. 参考源码与文档

- Hermes Agent Loop：
  https://github.com/NousResearch/hermes-agent/blob/6997dc81cd21dc88c6cb808a1fb3626b6ce71254/website/docs/developer-guide/agent-loop.md
- Hermes Delegation：
  https://github.com/NousResearch/hermes-agent/blob/6997dc81cd21dc88c6cb808a1fb3626b6ce71254/tools/delegate_tool.py
- Hermes Async Delegation：
  https://github.com/NousResearch/hermes-agent/blob/6997dc81cd21dc88c6cb808a1fb3626b6ce71254/tools/async_delegation.py
- Hermes Codex Runtime：
  https://github.com/NousResearch/hermes-agent/blob/6997dc81cd21dc88c6cb808a1fb3626b6ce71254/agent/codex_runtime.py
- Hermes Codex App Server Session：
  https://github.com/NousResearch/hermes-agent/blob/6997dc81cd21dc88c6cb808a1fb3626b6ce71254/agent/transports/codex_app_server_session.py
- Hermes Codex Event Projector：
  https://github.com/NousResearch/hermes-agent/blob/6997dc81cd21dc88c6cb808a1fb3626b6ce71254/agent/transports/codex_event_projector.py
- Hermes Tools MCP Server：
  https://github.com/NousResearch/hermes-agent/blob/6997dc81cd21dc88c6cb808a1fb3626b6ce71254/agent/transports/hermes_tools_mcp_server.py
- Codex App Server：
  https://developers.openai.com/codex/app-server
- ShanHai Runtime Types：
  https://github.com/DOIT-Ben/ShanHaiEdu-Studio/blob/main/src/server/agent-runtime/types.ts
- ShanHai Controlled ReAct Loop：
  https://github.com/DOIT-Ben/ShanHaiEdu-Studio/blob/main/src/server/conversation/main-agent-controlled-react-loop.ts
- ShanHai ReAct Checkpoint：
  https://github.com/DOIT-Ben/ShanHaiEdu-Studio/blob/main/src/server/conversation/main-agent-react-checkpoint.ts
- ShanHai ToolRouter：
  https://github.com/DOIT-Ben/ShanHaiEdu-Studio/blob/main/src/server/tools/tool-router.ts
