# H02 Runtime Event、Thread/Turn 生命周期与中断恢复设计

- Intake 编号：`H02`
- 设计版本：`0.1.0`
- 状态：`design_review`
- 工作模式：`planning_only`
- 分支：`intake-hermes`
- ShanHai 研究基线：`main@fd2521f1b558b36f2680a661f9d2eaf34ffa584e`
- Hermes 研究基线：`NousResearch/hermes-agent@46e87b14fd6c943ef0d6671fb0d74c5dde5d4c6b`
- Codex 源码研究基线：`openai/codex@fca8c00f11bdbfaabed6bae2cb3765fcbd106fe8`
- Codex App Server 文档读取日期：2026-07-15
- 日期：2026-07-15

## 1. 决策摘要

ShanHai 不使用 Hermes、Codex Thread、LangGraph Checkpoint 或 Temporal Workflow 替换自身业务控制面。

H02 选择建设 ShanHai 自己的 **Event-driven Runtime Kernel**：

- Project、Conversation、IntentEpoch、ExecutionEnvelope、Artifact、QualityDecision 和 HumanGate 继续由 ShanHai 掌握；
- Native、Codex 和未来专项子智能体只是可替换 Runtime；
- 每个逻辑 Turn 同时只能有一个有效执行 Attempt；
- Runtime Thread 只是可丢弃、可替换的上下文续接句柄，不是业务事实来源；
- 权威控制事件使用追加式持久化，流式文本 Delta 只作为非权威展示事件；
- 通过 Attempt、Lease、Fencing Token、幂等键和副作用对账实现可恢复执行；
- 不承诺分布式意义上的 `exactly once`，而是保证旧 Worker 不可继续提交、已知副作用不会被盲目重放；
- 只有已持久化的权威终态事件才能结束 Turn；完整文本、UI 展示完成或 Runtime 进程安静都不等于权威完成。

本设计只定义未来目标语义、边界、阶段和验收标准，不修改生产代码、数据库、依赖、Prompt 或部署。

## 2. 为什么 H02 必须独立设计

H00 已确定 ShanHai 可以按 Turn/Node 选择 Native、Codex 或专项子智能体，但如果没有统一 Runtime Kernel，会出现四类结构性问题：

1. 不同 Runtime 对“开始、进行中、完成、失败、中断”的定义不一致；
2. Worker、浏览器或 Runtime 进程崩溃后，系统无法证明副作用是否已经发生；
3. 新用户意图到来时，旧 Runtime 仍可能继续写入 Artifact；
4. Codex Thread、Native Checkpoint 和未来子智能体 Session 会形成多个互不兼容的状态岛。

H02 是 H03 上下文压缩、H04 Provider 归一化、H05 安全并行、H06 Codex Runtime、H07 子智能体和 H08 回放评估的共同前置协议。

## 3. 当前 ShanHai 基线

研究基线中的现状是：

- `AgentRuntime` 只有 `run(input): Promise<AgentRuntimeResult>`；
- `AgentRuntimeKind` 只有 `deterministic | openai`；
- Runtime 结果只有 `succeeded | failed`，没有 Thread、Turn、Attempt 或流式生命周期；
- Runtime Factory 使用一次性超时控制，无法表达取消确认、进程退休或恢复对账；
- Main Agent Controlled ReAct Loop 默认最多三个工具回合；
- 每个回合只接受一个工具调用，`parallelToolCalls: false`；
- Main Agent 已有 IntentEpoch、Plan Revision、授权预算和 ReAct Checkpoint；
- Tool Observation、Artifact Ref 和 Checkpoint Digest 已经具备成为恢复边界的基础；
- ToolRouter、ExecutionEnvelope、Artifact Contract 和 HumanGate 已经承担比通用 Agent Framework 更强的业务治理。

因此，H02 不需要重写 Main Agent，也不需要先引入图框架。它需要把现有一次性 Runtime 调用升级成可观察、可中断、可恢复、可替换的执行协议。

## 4. 外部实现的可借鉴结论

### 4.1 Codex App Server

Codex App Server 明确区分：

- Thread：多 Turn 的对话上下文；
- Turn：一次用户输入到 Agent 结束的执行；
- Item：Turn 内的消息、推理、命令、文件变更或工具调用。

值得吸收：

- `thread/start | resume | fork` 的生命周期区分；
- `turn/start | steer | interrupt` 的显式命令；
- `item/started` 与 `item/completed` 的双阶段事件；
- `turn/completed` 携带 `completed | interrupted | failed` 权威终态；
- `expectedTurnId` 防止 steer 写入错误 Turn；
- 协议 Schema 与 Codex 版本绑定，应由适配器生成和固定；
- 有界队列、过载拒绝和带抖动的指数退避。

不能照搬：

- Codex Thread ID 不能充当 ShanHai Conversation ID；
- Codex `completed` 不能自动代表 Artifact 合格或业务节点完成；
- Codex Session 权限不能替代 ExecutionEnvelope 和 HumanGate；
- Runtime 原生文件、Shell 或网络能力不能绕过 Tool Gateway 修改业务权威状态。

### 4.2 Hermes

Hermes 的 Codex Adapter 采用一个 Hermes Session 对应一个 Codex Thread，并同步轮询 App Server 事件。它具备：

- Turn 超时；
- Tool 完成后的静默 Watchdog；
- 子进程存活检测；
- Interrupt 转译；
- OAuth、协议和进程错误分类；
- 不健康 Session 退休；
- Codex Event 到 Hermes Message 的投影；
- 只在 `item/completed` 时把 Item 物化为消息。

直接吸收：

- Watchdog、进程退休、错误脱敏、事件投影、确定性 Tool Call ID；
- Display Hook 失败不能改变主控制流；
- 适配器应该容忍协议字段的受控版本差异。

改造吸收：

- Hermes 的同步阻塞 `run_turn()` 改为 ShanHai 的异步事件流；
- Hermes 内存里的 Thread ID 改为持久化但非权威的 Thread Binding；
- Hermes 的 `should_retire` 布尔值改为有原因、有事件、有状态的 Session Retirement；
- Hermes 的消息投影改为 Runtime Event、业务 Observation 和 UI Projection 三层分离。

拒绝吸收：

- 未收到 `turn/completed` 时，仅因为出现完整 Assistant Text 就判定成功；
- 用聊天消息序列代替 Tool Result、Artifact 和审批记录；
- 把一个进程内对象的状态作为崩溃恢复依据。

### 4.3 LangGraph

LangGraph 的 Checkpointer、Thread、Interrupt、Replay 和 Fork 证明了持久化执行边界的重要性。

吸收的思想：

- 每个可恢复执行必须有稳定 Thread/Execution 标识；
- 暂停前保存状态；
- 恢复不是继续某一行代码，而是从 Checkpoint 边界重放，并复用已持久化结果；
- Fork 不覆盖原历史，而是建立新的执行分支；
- 有副作用的操作必须封装在可记录结果的任务边界内。

不吸收的部分：

- H02 不引入 LangGraph 依赖；
- 不把 ShanHai 业务流程迁移为第二张 Graph；
- 不把 Graph Checkpoint 当作 Artifact、HumanGate 或项目状态的权威存储。

### 4.4 Temporal

Temporal 的 Event History、Activity、Cancellation、Retry 和 Child Workflow 提供了成熟的耐久执行参照。

吸收的思想：

- 状态由追加式事件重建；
- 外部副作用与纯控制逻辑分离；
- 超时只说明结果未知，不说明副作用一定没发生；
- 取消是请求与确认的过程，而不是一个瞬时布尔值；
- 重试必须从上一个安全边界开始；
- 父子执行需要明确取消传播策略。

不吸收的部分：

- 当前阶段不引入 Temporal 服务或 SDK；
- 不将所有 Agent Tool 包装成通用 Workflow；
- H07 才定义子智能体父子传播策略，H02 只预留关联字段。

## 5. 方案选择

### 5.1 方案 A：一次性 Runtime 外加事件回调

保留 `run()`，只增加 `onEvent`、AbortSignal 和结果元数据。

优点：

- 对当前代码影响小；
- 可以较快获得 UI 进度和基本 Usage。

缺点：

- 进程崩溃后仍缺少持久化恢复语义；
- 无法区分逻辑 Turn 和重试 Attempt；
- 很难阻止旧 Worker 在租约失效后继续写入；
- Codex、Native 和子智能体仍会形成不同的生命周期模型。

结论：不采用为目标架构，可作为未来最早兼容过渡层。

### 5.2 方案 B：ShanHai Event-driven Runtime Kernel

在业务控制面和具体 Runtime 之间建立统一协议：

- Runtime Router 在 Turn 开始前选择唯一执行后端；
- Runtime Kernel 创建 Turn、Attempt、Lease 和 Thread Binding；
- Adapter 把外部事件归一化为 ShanHai Runtime Event；
- Event Store 追加权威事实；
- Projector 生成 UI、审计和恢复视图；
- Reconciler 处理中断、失联、崩溃和结果不确定；
- Tool Gateway 保持业务副作用唯一入口。

优点：

- 不替换 ShanHai 业务内核；
- Native、Codex 和子智能体共用恢复与审计语义；
- 可以逐阶段引入，不要求一次重构全部系统；
- 为安全并行、回放和后台任务建立稳定基础。

代价：

- 必须明确事件顺序、幂等、租约、版本和投影规则；
- 需要专门的恢复测试与协议一致性测试；
- 初期会同时维护旧 `run()` 兼容面和新 Session/Event 面。

结论：采用。

### 5.3 方案 C：由 LangGraph 或 Temporal 接管执行

优点：

- 可直接获得部分持久化、恢复和可观测能力。

缺点：

- 会在现有业务控制面外再形成一套状态与调度中心；
- ShanHai 的 Artifact、IntentEpoch、ExecutionEnvelope 和 HumanGate 需要重新映射；
- 当前 V1 尚未稳定，不适合先承担平台迁移；
- Codex 仍然需要独立 Adapter，框架不能消除协议差异。

结论：不采用。未来如果需要耐久任务基础设施，应把它放在 Runtime Kernel 之下，而不是替代 ShanHai Control Plane。

## 6. 目标架构

~~~mermaid
flowchart TD
    A["ShanHai Business Control Plane"] --> B["Runtime Router"]
    B --> C["Runtime Kernel"]
    C --> D["Native Adapter"]
    C --> E["Codex Adapter"]
    C --> F["Subagent Adapter"]
    C --> G["Event Store / Reconciler"]
    D --> H["Unified Tool Gateway"]
    E --> H
    F --> H
~~~

### 6.1 Business Control Plane

继续负责：

- Project、Conversation 和 IntentEpoch；
- 任务/节点选择、Plan Revision 和完成条件；
- Runtime 选择和 Allowed Tools；
- 预算授权、HumanGate 和 Provider Policy；
- Artifact Draft、Contract Validation、QualityDecision 和 Promotion；
- 用户停止、改意图、删除项目和撤销授权。

### 6.2 Runtime Kernel

只负责：

- 建立逻辑 Turn 与 Attempt；
- 绑定或替换 Runtime Thread；
- 取得执行租约并发放 Fencing Token；
- 接收、归一化、排序和持久化 Runtime Event；
- 驱动中断、超时、Session 退休和恢复对账；
- 产生 Runtime Candidate Result；
- 向 UI、审计、Usage 和恢复投影事件。

Runtime Kernel 不决定 Artifact 是否通过，不修改 IntentEpoch，也不批准 HumanGate。

### 6.3 Runtime Adapter

每个 Adapter 负责：

- 把统一输入转换为具体 Runtime 协议；
- 把具体 Runtime 事件转换为统一 Adapter Event；
- 支持能力探测；
- 在能力存在时实现 Interrupt、Inspect、Resume、Close；
- 标记哪些外部引用可以持久化、恢复或退休；
- 隐藏外部协议字段变更。

Adapter 不直接写业务数据库，不直接 Promotion Artifact。

### 6.4 Event Store 与 Projector

Event Store 保存权威控制事件。Projector 从同一事件序列生成：

- 当前 Turn/Attempt 状态；
- UI 进度；
- Runtime Thread 健康状态；
- Usage/Cost 视图；
- 恢复 Checkpoint；
- 审计和回放输入。

Projector 可以重建；Event Store 中的权威事件不可由 Projector 回写或覆盖。

### 6.5 Reconciler

Reconciler 在以下情况启动：

- Attempt Lease 过期；
- Worker 重启；
- Runtime 进程退出；
- Interrupt 未确认；
- 收到完整文本但没有权威终态；
- Tool 请求已发出但结果未知；
- Runtime Thread 无法 Resume；
- IntentEpoch 已变化但旧 Attempt 仍有事件到达。

它只能依据持久化事件、Tool Result、Runtime Inspect 和业务状态作出决定，不能依据 UI 是否还在转圈判断。

## 7. 统一名词与标识

### 7.1 业务标识

| 标识 | 含义 | 权威来源 |
| --- | --- | --- |
| `projectId` | 教学项目 | ShanHai |
| `conversationId` | 教师与主智能体的业务对话 | ShanHai |
| `intentEpoch` | 当前用户意图代次 | ShanHai |
| `taskId/nodeKey` | 当前业务任务或生产节点 | ShanHai |
| `planRevision` | 当前计划版本 | ShanHai |

### 7.2 Runtime 标识

| 标识 | 含义 | 生命周期 |
| --- | --- | --- |
| `turnId` | ShanHai 逻辑 Turn，跨恢复 Attempt 保持稳定 | 一次意图绑定的逻辑执行 |
| `rootTurnId` | 一条父子执行链的根 Turn；普通 Turn 等于自身 `turnId` | 整条委派链 |
| `parentTurnId` | 未来 Child Turn 的直接父 Turn；普通 Turn 为空 | 单次父子关系 |
| `attemptId` | 一次具体 Runtime 执行尝试 | 每次启动、恢复或切换 Runtime 都新建 |
| `threadBindingId` | ShanHai 保存的 Runtime Thread 绑定记录 | 可被替换、退休或重建 |
| `bindingGeneration` | Thread Binding 代次 | 每次替换递增 |
| `runtimeSessionId` | 当前 Runtime 进程/连接会话 | 进程或连接生命周期 |
| `externalThreadId` | Codex 等外部 Runtime 的 Thread ID | 外部 Runtime 决定 |
| `externalTurnId` | 外部 Runtime 的 Turn ID | 外部 Runtime 决定 |
| `itemId/callId` | Turn 内工作项或工具调用 | 在 Turn 内稳定 |
| `leaseId` | Attempt 执行租约 | Attempt 活跃期 |
| `fencingToken` | 防止旧 Worker 提交的单调递增令牌 | 每次取得新租约递增 |

### 7.3 关键区分

- `conversationId != externalThreadId`；
- `turnId != externalTurnId`；
- 重试不复用 `attemptId`；
- 替换 Thread 不改变业务 Conversation；
- Runtime Turn 完成不等于 Artifact Promotion；
- UI 完成动画不等于 Runtime Turn 完成。

## 8. Thread Binding 设计

### 8.1 绑定范围

Thread Binding 至少绑定：

- tenant/user scope；
- projectId；
- conversationId；
- runtimeKind；
- laneKey；
- bindingGeneration；
- runtime 配置指纹；
- Context/Memory Policy 版本指纹；
- sandbox/workspace 指纹；
- createdAt、lastHealthyAt、retiredAt；
- status 和 retirementReason。

`laneKey` 用于区分主对话、独立业务线路和未来子智能体线路。H07 定义具体子智能体规则，H02 只保证不同 Lane 不误用同一活跃 Thread。

### 8.2 绑定状态

Binding 的规范状态为：`unbound | starting | ready | busy | unhealthy | replacing | retiring | retired`。

~~~text
unbound -> starting -> ready -> busy -> ready
                    \-> unhealthy -> retiring -> retired
ready/busy -> replacing -> retired + new generation
~~~

### 8.3 Thread 复用条件

只有同时满足下列条件才允许 Resume：

1. 租户、用户、项目、Conversation 和 Lane 一致；
2. Binding 未退休且没有未决不确定 Attempt；
3. Runtime 配置、Tool Schema、安全策略和 Workspace 指纹兼容；
4. IntentEpoch 允许续接；
5. Adapter 能确认 Thread 可读、可恢复且没有活跃冲突 Turn；
6. Checkpoint 与已持久化 Tool Result 可以对齐；
7. Runtime 没有越权、协议失步或不可恢复凭证错误。

任一条件不满足时创建新的 Binding Generation。旧 Binding 保留审计记录，但不能再次成为 Active。

### 8.4 Native Runtime

Native Runtime 也使用 Thread Binding 语义，但其 `externalThreadId` 可以为空。这样 Native 与 Codex 共享 Turn、Attempt、Lease 和恢复协议，而不伪造外部 Thread。

## 9. Turn 与 Attempt 状态机

### 9.1 Turn 状态

~~~text
requested -> queued -> running -> completed
                      |       \-> failed
                      |       \-> interrupted
                      |       \-> superseded
                      \-> reconciling -> running / completed / failed / interrupted / superseded
running -> cancel_requested -> reconciling
~~~

含义：

- `requested`：业务控制面已请求执行，但尚未接受；
- `queued`：输入、预算和授权已固定，等待执行能力；
- `running`：存在一个有效 Active Attempt；
- `cancel_requested`：已持久化取消请求，等待 Runtime 确认或强制退休；
- `reconciling`：事实不完整，禁止启动盲目重试；
- `completed`：Runtime Candidate Result 和权威终态已持久化；
- `failed`：已确认不可重试，或受控恢复/重试策略已经耗尽；只要系统仍计划创建新 Attempt，Turn 就不能提前写入该终态；
- `interrupted`：取消已确认或 Runtime 已被安全终止；
- `superseded`：IntentEpoch、Plan Revision 或任务选择变化，旧 Turn 永久失去业务写入资格。

终态为：`completed | failed | interrupted | superseded`。一个 Turn 只能持久化一个终态。

### 9.2 Attempt 状态

~~~text
created -> starting -> active -> succeeded
                         |    \-> failed
                         |    \-> interrupted
                         |    \-> uncertain
                         \-> cancel_requested -> interrupted / uncertain
uncertain -> reconciled / abandoned
~~~

含义：

- `uncertain` 表示外部结果或副作用状态无法立即证明；
- `reconciled` 表示通过外部查询、Tool Result、幂等记录或终态事件补齐事实；
- `abandoned` 表示该 Attempt 不再执行，但其副作用仍必须按记录处理；
- 新 Attempt 只能在旧 Attempt 已终止、被 Fence 或进入不会继续写入的状态后创建。

### 9.3 单方向盘约束

同一 Turn：

- 同时最多一个 Active Attempt；
- 同时最多一个主 Runtime Loop；
- Native 调用 Codex 作为整个 Turn 的替代 Runtime 时，Native Loop 必须先结束控制权；
- Codex 不能回调 Native Main Agent 形成第二个同时规划的 Loop；
- 未来子智能体拥有独立 Child Turn，不与 Parent Turn 共享 Active Attempt。

## 10. Lease 与 Fencing

### 10.1 Lease

Worker 启动 Attempt 前必须取得 Lease。Lease 包含：

- `leaseId`；
- `turnId`、`attemptId`；
- `ownerWorkerId`；
- `fencingToken`；
- `acquiredAt`、`expiresAt`；
- `lastHeartbeatAt`。

### 10.2 Fencing Token

每次重新取得执行权时，`fencingToken` 单调递增。

以下写入必须校验 Token：

- Attempt 状态变化；
- Runtime 权威事件；
- Tool Call 请求；
- Tool Result 关联；
- Candidate Result；
- Turn 终态；
- Thread Binding 激活或替换。

旧 Worker 即使网络恢复，也不能使用旧 Token 写入新的业务状态。

### 10.3 Heartbeat

Heartbeat 用于判断 Worker 是否仍持有执行能力，不作为业务进度证明。Heartbeat 可以合并更新，不要求每次都形成完整审计事件，但 Lease 过期、重新取得和 Fence 必须形成权威事件。

## 11. 事件模型

### 11.1 Command 与 Event 分离

- Command 表示“请求做什么”，例如 `StartTurn`、`RequestCancel`；
- Event 表示“已经发生什么”，例如 `turn.started`、`turn.interrupted`；
- Command 可以被拒绝、去重或延迟；
- 只有已持久化 Event 可以改变权威状态。

### 11.2 Event Envelope

目标语义：

~~~typescript
type RuntimeEventEnvelope<T> = {
  schemaVersion: "runtime-event.v1";
  eventId: string;
  eventType: string;
  occurredAt: string;
  recordedAt: string;
  sequence: number;
  projectId: string;
  conversationId: string;
  intentEpoch: number;
  turnId: string;
  rootTurnId: string;
  parentTurnId?: string;
  attemptId?: string;
  runtimeKind?: string;
  threadBindingId?: string;
  bindingGeneration?: number;
  externalRefs?: {
    threadId?: string;
    turnId?: string;
    itemId?: string;
  };
  correlationId: string;
  causationEventId?: string;
  actor: {
    type: "user" | "service" | "worker" | "runtime" | "system";
    id: string;
  };
  visibility: "control" | "audit" | "projection_only";
  payload: T;
};
~~~

约束：

- `eventId` 全局唯一；
- `sequence` 由 Event Store 在事务内分配，并在 Turn 内单调递增；外部时间戳和到达先后不能代替该顺序；
- 同一外部事件必须可确定性去重；
- Payload 不保存密钥、原始授权头或未脱敏 Provider 错误；
- 模型私有推理不进入长期业务事件；
- 大文本、文件和媒体使用内容引用、Digest 或 Artifact Ref，不内联到控制事件。

### 11.3 两级事件

#### 权威控制事件

必须持久化、排序、去重：

- Turn/Attempt 生命周期；
- Lease/Fence；
- Thread Binding 和 Session Retirement；
- Tool Call 请求、Tool Result 已持久化；
- Approval 请求和决议；
- Usage 累计快照；
- Context Compaction 边界；
- Interrupt、Failure、Reconciliation；
- Candidate Result 和 Turn 终态。

#### 非权威展示事件

允许合并、抽样或丢弃：

- Assistant Text Delta；
- Token Delta；
- Spinner、阶段文案和细粒度进度；
- 高频 Shell Output Delta；
- UI 动画状态。

展示事件不能被用于：

- 判断 Turn 成功；
- Promotion Artifact；
- 判断 Tool 副作用未发生；
- 恢复时跳过工作；
- 计算最终 Usage 账单。

### 11.4 最小权威事件集合

| 事件 | 说明 |
| --- | --- |
| `turn.requested` | 业务请求已固定 |
| `turn.queued` | 已进入执行队列 |
| `turn.started` | Active Attempt 已获得执行权 |
| `attempt.started` | 具体 Runtime Attempt 启动 |
| `thread.bound` | 外部 Thread 已绑定 |
| `item.started` | 可审计工作项开始 |
| `item.completed` | 工作项权威结束 |
| `tool.call_requested` | Tool Gateway 接受调用请求 |
| `tool.result_persisted` | Tool Result 已先持久化 |
| `approval.requested` | 请求审批 |
| `approval.resolved` | 审批已决议 |
| `usage.updated` | 累计 Usage 快照 |
| `turn.cancel_requested` | 已请求取消 |
| `attempt.uncertain` | Attempt 结果不确定 |
| `turn.reconciling` | Turn 进入事实对账 |
| `runtime.retire_requested` | Runtime 必须退休 |
| `runtime.retired` | Runtime 已不可复用 |
| `turn.completed` | Candidate Result 与权威终态已保存 |
| `turn.failed` | 确认失败 |
| `turn.interrupted` | 确认中断 |
| `turn.superseded` | 被新意图或计划代次取代 |

H03、H04、H05、H06 和 H08 可以扩展 Payload，但不得改变上述终态和顺序不变量。

## 12. 事件写入与投影顺序

### 12.1 权威写入顺序

关键事件遵循：

~~~text
接收外部事实
-> 校验 IntentEpoch / Lease / Fence / 去重键
-> 追加权威事件并更新派生状态
-> 写入 Outbox
-> Commit
-> 投影到 UI、审计、通知和后续 Runtime
~~~

### 12.2 Tool Result 顺序

必须遵循：

~~~text
Tool 执行完成
-> 持久化 Tool Result / Observation / Artifact Ref
-> 记录 tool.result_persisted
-> Commit
-> 才允许返回 Native/Codex/Subagent Runtime
~~~

如果 Tool 已执行但持久化失败，Attempt 进入 `uncertain`，不能直接重跑 Tool。

### 12.3 Terminal 顺序

`turn.completed` 只有在以下内容同一权威边界内可引用时才能写入：

- Candidate Result Ref；
- 最终 Usage 快照或 Usage 状态；
- 当前 IntentEpoch；
- Active Attempt 和 Fencing Token；
- 最终外部 Runtime 状态；
- 已持久化 Tool Result 引用；
- 终止原因。

`turn.completed` 只表示 Runtime 候选结果完整，不表示 Artifact 已通过业务 Validator 或教师审核。

## 13. 中断、取消与 Supersede

### 13.1 触发来源

- 教师主动停止；
- 新消息提升 IntentEpoch；
- Plan Revision 使当前任务失效；
- 项目或任务被删除；
- HumanGate 或授权被撤销；
- 预算、截止时间或策略超限；
- Worker 即将回收；
- Runtime Watchdog 触发；
- 安全边界被突破。

### 13.2 取消协议

~~~text
持久化 turn.cancel_requested
-> Adapter 发送 interrupt/cancel
-> 等待有限确认窗口
-> 收到权威终态：turn.interrupted
-> 未确认：attempt.uncertain + turn.reconciling
-> 必要时 retire Runtime Session
~~~

取消请求必须幂等。重复点击停止不能创建多个互相冲突的取消流程。

### 13.3 IntentEpoch 变化

新 IntentEpoch 到来时：

1. 旧 Turn 立即失去新的业务写入资格；
2. 写入 `turn.superseded` 或先请求取消再 Supersede；
3. 旧 Runtime 的迟到事件只进入审计/隔离区；
4. 已完成 Tool Result 可以保留，但标记旧 IntentEpoch；
5. 旧结果不得自动进入 Artifact Promotion；
6. 新 Turn 使用新的 Context Package 和授权快照。

### 13.4 `turn/steer` 策略

第一阶段默认不使用 Runtime 原生 `turn/steer`。

未来只有同时满足以下条件才允许：

- 用户输入被确定为同一 IntentEpoch 的补充，而不是方向变化；
- `expectedTurnId` 与当前 Active Turn 一致；
- 不改变 Allowed Tools、预算、安全策略和输出 Contract；
- Steer 请求与接受均形成权威事件；
- Adapter 声明支持且通过一致性测试。

不满足条件时，中断旧 Turn 并创建新 Turn。

## 14. HumanGate 与 Runtime Approval

必须区分：

- Runtime Approval：命令、文件、网络或临时权限请求；
- ShanHai HumanGate：业务计划、费用、Artifact 或发布决策。

规则：

- Runtime Approval 必须绑定 `threadId + turnId + itemId`；
- 决议必须持久化后再回复 Runtime；
- Runtime Approval 只能授予请求中的最小权限；
- 未经业务策略明确允许，不使用永久或 Session 级自动批准；
- Runtime Approval 等待时间有上限，超时进入取消或对账；
- ShanHai HumanGate 不长期占用一个 Codex 活跃 Turn；
- 业务阶段遇到 HumanGate 时，保存业务状态并结束/暂停该阶段，批准后以新 Turn 恢复。

## 15. 失败与退休分类

### 15.1 H02 生命周期失败分类

| 类别 | 示例 | 默认处理 |
| --- | --- | --- |
| `runtime_transport` | 连接断开、JSON-RPC I/O 失败 | 对账，必要时退休 |
| `runtime_process` | 子进程退出、Worker 崩溃 | 退休并从 Checkpoint 恢复 |
| `runtime_protocol` | Schema 不兼容、事件失序 | 失败关闭并退休 |
| `runtime_timeout` | Turn 总超时、静默 Watchdog | Interrupt、对账、退休 |
| `provider_surface` | Provider 失败被 Runtime 上报 | 交 H04 细分，再决定重试 |
| `tool_uncertain` | Tool 已请求但结果未知 | 按幂等键对账，禁止盲目重试 |
| `policy` | 权限、预算、工具白名单阻断 | 不自动重试 |
| `stale_intent` | IntentEpoch 不匹配 | Supersede，隔离结果 |
| `contract` | Candidate Result 不满足 Runtime 输出契约 | 失败或受控修复 Turn |
| `unknown` | 无法安全分类 | 失败关闭，人工/规则对账 |

H04 可以扩展 Provider 细类，但不得把生命周期不确定性误分类为普通可重试 Provider 错误。

### 15.2 必须退休 Runtime Session 的情况

- 进程退出或连接协议失步；
- Interrupt 超时且无法确认 Active Turn 已结束；
- Runtime 返回互相矛盾的终态；
- Thread Resume/Read 无法证明历史完整；
- Tool Result 回调完整性无法确认；
- 凭证刷新进入不可恢复状态；
- Runtime 尝试突破 Workspace、网络或 Tool 权限；
- 同一 Session 发生不可解释的跨租户/跨项目事件；
- 适配器 Schema 与实际协议不兼容。

退休后：

- Session 不能重新进入 Ready；
- Thread Binding 增加代次后才能继续；
- 旧 Session 的迟到事件受 Fencing Token 阻断；
- 新 Session 从 ShanHai Checkpoint 和已持久化事实重建。

## 16. 恢复与对账

### 16.1 恢复原则

1. 先恢复 ShanHai 权威状态，再考虑续接 Runtime Thread；
2. 先对账外部副作用，再决定是否重试；
3. 新 Worker 必须取得更高 Fencing Token；
4. 已持久化 Tool Result 通过 Observation 重放，不重新调用 Tool；
5. 流式文本只作为候选草稿，不能单独结束 Turn；
6. 无法证明安全时失败关闭，而不是追求“看起来继续了”。

### 16.2 启动扫描

Worker/服务启动后扫描：

- Lease 已过期但 Turn 非终态；
- `cancel_requested` 超过确认窗口；
- Attempt 为 `uncertain`；
- Thread Binding 为 Busy 但无有效 Owner；
- 有 `tool.call_requested` 但没有 `tool.result_persisted`；
- 有 Candidate Text 但没有 Turn 终态；
- Outbox 未投影事件。

扫描只创建 Reconciliation 工作，不直接重跑外部副作用。

### 16.3 恢复矩阵

| 崩溃点 | 已知事实 | 处理 |
| --- | --- | --- |
| Runtime 启动前 | 无外部 Thread/Turn | 新 Attempt 安全启动 |
| `turn/start` 请求超时 | 外部 Turn 是否创建未知 | Inspect/Read；不能直接再 Start |
| 模型生成中、无 Tool | 只有非权威 Delta | 丢弃 Delta，恢复新 Attempt |
| Tool Call 尚未交 Gateway | 无副作用 | 新 Attempt 可重新规划 |
| Gateway 已接收、Tool 未确认 | 副作用未知 | 使用 callId/幂等键对账 |
| Tool Result 已持久化 | Observation 已知 | 重放 Observation，不重跑 Tool |
| Agent Text 完整、无终态 | 完成不确定 | Inspect；无法证明则保存草稿并恢复/失败 |
| Turn 终态已持久化、UI 未更新 | 权威结果已知 | 只重放 Projector/Outbox |
| IntentEpoch 已变化 | 旧结果失效 | Supersede 并隔离迟到事件 |
| Thread 损坏或不可 Resume | ShanHai Checkpoint 完整 | 退休旧 Binding，新 Thread 重建 |

### 16.4 `completion_uncertain`

`completion_uncertain` 是 Attempt 的事实，不是 Turn 的成功状态。

触发示例：

- 已收到 Agent Final Text，但没有 `turn.completed`；
- Runtime 静默且无法读取 Active Turn；
- Interrupt 返回成功，但没有终态事件；
- Runtime 进程退出前最后一个 Item 已完成；
- Tool Result 返回 Runtime 后连接中断。

处理：

1. 保存候选文本和已知 Item 引用；
2. 写入 `attempt.uncertain`；
3. Turn 进入 `reconciling`；
4. 查询 Runtime Thread/Turn 和 Tool 幂等记录；
5. 能证明终态则补齐归一化终态；
6. 不能证明则退休 Session，并从最近安全 Checkpoint 创建新 Attempt；
7. 不把候选文本直接 Promotion 为 Artifact。

## 17. 幂等、去重与副作用

### 17.1 幂等键

所有业务 Tool Call 至少使用：

~~~text
projectId + intentEpoch + turnId + callId + toolName + normalizedInputDigest
~~~

付费 Provider、文件生成、媒体生成和 Artifact 写入还必须包含资源/版本范围。

### 17.2 事件去重

优先使用外部稳定 Event/Item ID。外部没有稳定 ID 时，Adapter 使用：

- externalThreadId；
- externalTurnId；
- method/eventType；
- itemId/callId；
- normalized payload digest；
- bindingGeneration。

生成确定性 Dedup Key。

### 17.3 不承诺 Exactly Once

网络与进程崩溃可能发生在“外部副作用已经完成、内部确认尚未持久化”之间，因此系统不宣称绝对 Exactly Once。

H02 的保证是：

- 不会让两个有效 Attempt 同时持有方向盘；
- 旧 Worker 无法越过 Fence；
- 不会在副作用未知时盲目自动重试；
- 已持久化结果不会重复执行；
- 每次恢复决策可审计；
- 无法证明安全时停止并要求对账或重新授权。

## 18. Runtime Adapter 目标契约

以下是目标语义，不是当前实现计划：

~~~typescript
type RuntimeCapability =
  | "stream_events"
  | "interrupt"
  | "inspect_turn"
  | "resume_thread"
  | "fork_thread"
  | "steer_turn"
  | "retire_session";

interface AgentRuntimeAdapter {
  readonly kind: string;
  capabilities(): Promise<RuntimeCapability[]>;
  openSession(input: RuntimeSessionInput): Promise<AgentRuntimeSession>;
}

interface AgentRuntimeSession {
  startTurn(input: RuntimeTurnInput): AsyncIterable<RuntimeAdapterEvent>;
  interrupt(input: RuntimeInterruptInput): Promise<RuntimeInterruptAck>;
  inspect(input: RuntimeInspectInput): Promise<RuntimeInspection>;
  close(reason: RuntimeRetirementReason): Promise<void>;
}
~~~

规则：

- 不支持某项能力的 Adapter 必须显式声明，不能假装成功；
- Adapter Event 进入 Event Store 前必须经过归一化、脱敏、去重和 Fence 校验；
- `startTurn` 返回事件流，不直接把外部 Runtime 结果写入 Artifact；
- `close` 是幂等操作；
- Inspect 只能用于事实对账，不能隐式修改 Runtime；
- 外部协议的实验字段不能成为 ShanHai 核心契约必需项。

## 19. Backpressure 与流式展示

### 19.1 原则

- 权威事件队列不能静默丢弃；
- 非权威 Delta 队列必须有界；
- UI 消费慢不能阻塞 Runtime 控制事件持久化；
- 高频 Output Delta 按时间窗或字节数合并；
- 过载时优先丢弃/合并展示 Delta，再拒绝新 Turn；
- 拒绝必须形成可重试分类和退避建议。

### 19.2 UI 重连

UI 重连时：

1. 读取 Turn 当前权威投影；
2. 获取最后一个可用的文本/进度快照；
3. 从 Projection Cursor 续接新事件；
4. 不要求重放所有 Token Delta；
5. UI 不通过本地 Spinner 推断 Turn 状态。

## 20. 与 H01–H09 的边界

| Intake | H02 提供 | 对方负责 |
| --- | --- | --- |
| H01 Memory | Turn/Attempt/Checkpoint 标识 | Memory Package、批准与检索 |
| H03 Context/Session | Compaction 边界事件、Thread Binding | 压缩内容、Session 谱系和重建快照 |
| H04 Provider | 生命周期 Failure 外壳 | Provider 响应、Usage、Failover 细类 |
| H05 Parallel Tools | Item/Tool 事件和 Lease/Fence | 依赖图、资源锁、预算预留和并发策略 |
| H06 Codex Runtime | Adapter 契约、Thread/Turn、退休与恢复 | App Server 启动、MCP、Schema 版本和隔离 PoC |
| H07 Subagent | Parent/Child 关联字段和 Child Turn 基础 | TaskBrief、子智能体选择、并发与结果契约 |
| H08 Replay/Eval | 可持久化 Event 和确定性标识 | 脱敏轨迹、回放器、评估指标和查询 |
| H09 Background | 可恢复 Turn 和租约语义 | 队列、定时、Gateway 身份和后台调度 |

## 21. 分阶段吸收路线

这些阶段是未来能力边界，不是当前实施计划。

### RT-0：H02 设计与基线固定

交付本设计、外部基线、状态机、不变量和验收矩阵。生产行为不变。

### RT-1：被动事件归一化

未来在不改变现有执行结果的前提下，为 Native Runtime 投影 Turn、Attempt、Usage 和终态事件。旧 `run()` 仍通过兼容适配器工作。

退出条件：同一固定任务的旧结果与新投影结果一致，且事件缺失可被检测。

### RT-2：持久化生命周期与 Fence

未来引入权威 Event、Lease、Fencing Token、唯一终态和 Outbox。

退出条件：旧 Worker、重复消息和 UI 重连不能制造第二终态或重复业务写入。

### RT-3：中断与 Runtime 退休

未来支持用户停止、IntentEpoch Supersede、超时 Watchdog、Interrupt Ack 和 Session Retirement。

退出条件：所有取消路径都有权威结果；不健康 Session 不被复用。

### RT-4：崩溃恢复与对账

未来支持 Lease 扫描、Tool 幂等对账、`completion_uncertain` 和 Checkpoint 重建。

退出条件：故障注入后不重复付费调用，不接受无终态 Candidate Result。

### RT-5：多 Adapter 一致性

未来在 H06 入口条件满足后，让 Native 与 Codex 通过同一契约测试。

退出条件：相同生命周期场景产生语义等价事件，Codex 不能绕过 Tool Gateway。

### RT-6：高级能力解锁

H03–H09 根据稳定的 H02 契约分别解锁压缩、并行、子智能体、回放和后台任务。H02 本身不实现这些能力。

## 22. 验收不变量

### 22.1 权威状态

- 每个 Turn 的权威终态数量必须为 1；
- 每个 Turn 同时有效的 Active Attempt 数量不得超过 1；
- 旧 Fencing Token 成功写入业务状态的数量必须为 0；
- IntentEpoch 不匹配的结果进入 Artifact Promotion 的数量必须为 0；
- 没有持久化终态的 Turn 被标记成功的数量必须为 0；
- Runtime Thread 直接修改业务权威状态的数量必须为 0。

### 22.2 Tool 与副作用

- 返回 Runtime 前未持久化的业务 Tool Result 数量必须为 0；
- 恢复导致的重复付费 Provider 调用数量必须为 0；
- 副作用未知时自动盲目重试的数量必须为 0；
- 所有 Tool Call 都能关联 projectId、intentEpoch、turnId、attemptId、callId 和审计身份；
- 重复外部 Item/Event 形成重复 Tool Result 的数量必须为 0。

### 22.3 中断与恢复

- 用户停止后旧 Attempt 获得新 Tool 授权的数量必须为 0；
- Interrupt 无确认时复用原 Session 的数量必须为 0；
- App Server/Worker 崩溃后旧 Worker 越过 Fence 的数量必须为 0；
- 完整文本但无 `turn.completed` 被直接接受为成功的数量必须为 0；
- UI 重连改变 Runtime 权威状态的数量必须为 0。

### 22.4 隔离与安全

- 跨租户复用 Runtime Thread 的数量必须为 0；
- 跨项目误投 Runtime Event 的数量必须为 0；
- Event Payload 中出现原始密钥或授权头的数量必须为 0；
- Runtime Approval 替代 ShanHai HumanGate 的数量必须为 0；
- Runtime 直接 Promotion Artifact 的数量必须为 0。

## 23. 未来测试矩阵

| 场景 | 预期 |
| --- | --- |
| 重复 `turn.start` Command | 只创建一个逻辑 Turn 或返回原结果 |
| 重复外部 `item.completed` | 去重，不生成第二 Observation |
| Worker 在模型调用中崩溃 | Lease 过期，进入 Reconciliation |
| Worker 在 Tool 请求后崩溃 | 按幂等键查询，不盲目重跑 |
| Tool 完成、事件持久化前崩溃 | 标记 uncertain，外部对账 |
| Tool Result 已持久化后崩溃 | 新 Attempt 重放 Observation |
| Assistant Text 完成但无终态 | completion_uncertain，不 Promotion |
| Interrupt RPC 超时 | 退休 Session，对账 Thread |
| IntentEpoch 在运行中变化 | 旧 Turn Supersede，迟到事件隔离 |
| UI 断开再连接 | 从 Projection 恢复，不影响 Runtime |
| Runtime 进程退出 | Session 退休，新 Binding Generation |
| Thread Resume 返回历史缺失 | 失败关闭，新 Thread 重建 |
| 两个 Worker 争抢同一 Turn | 只有最高 Fence 可写 |
| Event Store 暂时不可写 | 停止权威推进，不靠内存假完成 |
| Outbox 投影失败 | 重试投影，不重复执行 Runtime/Tool |
| Runtime 发出未知事件 | 脱敏保存兼容记录，不改变核心状态 |
| Adapter Schema 版本不匹配 | 启动失败关闭，不进入 Turn |

未来实现时，至少对 Native 和 Codex Adapter 运行同一套 Contract Test，并增加进程 Kill、网络断开、事件重复、事件乱序和数据库写入失败的故障注入。

## 24. 观测指标

H08 将实现完整观测，本设计先规定最小指标：

- Turn 完成率、失败率、中断率和 Supersede 率；
- Attempt/Turn 比例；
- Reconciliation 触发率和成功率；
- Session Retirement 原因分布；
- Missing Terminal Event 数量；
- Duplicate Event 去重数量；
- Stale Fence 拒绝数量；
- Tool Uncertain 数量和平均对账时间；
- Interrupt 请求到权威终态的 P50/P95；
- Worker 崩溃到恢复决定的 P50/P95；
- UI Delta 丢弃/合并率；
- Runtime、模型、Token、成本和延迟。

## 25. Schema 与兼容策略

- Runtime Event Envelope 使用显式版本；
- 新字段优先追加为可选字段；
- 不删除仍有在途 Turn 依赖的字段；
- Adapter 固定其支持的外部协议版本和 Capability；
- Codex Schema 应从实际部署版本生成并验证，不手写猜测；
- 破坏性迁移必须先排空、退休或迁移在途 Turn；
- Projector 必须能读取至少一个受支持的旧事件版本；
- 未识别事件不能自动提升为权威终态；
- Architecture Drift Review 必须检查主线是否已经改变 Runtime、Checkpoint 或 IntentEpoch 边界。

## 26. 风险与控制

| 风险 | 控制 |
| --- | --- |
| 事件系统演变为第二业务控制面 | Event 只记录 Runtime 事实，业务完成仍由 ShanHai 决定 |
| 保存每个 Delta 导致事件膨胀 | 权威事件与展示 Delta 分层，Delta 合并/丢弃 |
| 双 Worker 同时恢复 | Lease + 单调 Fencing Token |
| Missing Terminal 被误判成功 | completion_uncertain + Inspect/Reconcile |
| Thread 状态污染新意图 | IntentEpoch Guard + Binding Generation |
| 恢复重复付费 | Tool 幂等键、结果先持久化、未知副作用先对账 |
| Codex 协议快速变化 | Adapter 隔离、版本固定、生成 Schema、Contract Test |
| HumanGate 长期占用 Runtime | 业务 Gate 与 Runtime Approval 分离 |
| Event Store 故障拖垮响应 | 关键事件失败关闭；展示事件降级不影响权威事实 |
| 日志泄密 | Payload 最小化、引用化、脱敏和访问控制 |
| 规划过度设计 | 分 RT-0 至 RT-6，先被动事件，再逐步解锁恢复能力 |

## 27. 对现有代码的未来影响预测

以下只是基于研究基线的影响区域，不是实施文件清单：

- `src/server/agent-runtime/types.ts`：未来从一次性 `run()` 语义演进到 Adapter/Session/Event；
- `src/server/agent-runtime/runtime-factory.ts`：未来演进为 Runtime Router 和 Capability-aware Factory；
- `src/server/conversation/main-agent-controlled-react-loop.ts`：继续作为 Native Runtime，不被删除；
- `src/server/conversation/main-agent-react-checkpoint.ts`：未来关联 turnId、attemptId、事件位置和恢复边界；
- `src/server/tools/main-agent-tool-dispatcher.ts`：继续绑定 Server Context、ExecutionEnvelope 和 IntentEpoch；
- `src/server/tools/tool-router.ts`：继续作为业务工具唯一入口，未来增加幂等与 Fence 校验；
- Conversation/Execution 持久化边界：未来保存 Turn、Attempt、Binding、Event 和 Outbox；
- UI Streaming 边界：未来从权威 Projection 和非权威 Delta 双通道消费。

在任何未来实施前，必须同步最新 main 并重新执行 Architecture Drift Review。文件路径变化不影响本设计的长期不变量。

## 28. 明确非目标

本次 H02 不做：

- 不修改生产 Runtime；
- 不安装 LangGraph、Temporal 或 Codex SDK；
- 不创建数据库表或迁移；
- 不启动 Codex App Server；
- 不启用工具并行；
- 不实现上下文压缩；
- 不实现 Provider Failover；
- 不实现子智能体调度；
- 不实现后台任务或定时任务；
- 不创建合入 main 的 PR；
- 不编写 RT-1 或其他实施计划。

## 29. H02 评审检查表

评审只需确认以下架构决策：

1. 是否认可 ShanHai Business Control Plane 继续掌握业务权威；
2. 是否认可 Event-driven Runtime Kernel，而不是 LangGraph/Temporal 接管；
3. 是否认可 `turnId + attemptId + threadBindingId` 的分层；
4. 是否认可权威事件和展示 Delta 分层；
5. 是否认可 Lease + Fencing Token；
6. 是否认可 Missing Terminal 必须进入 `completion_uncertain`；
7. 是否认可默认禁用 `turn/steer`；
8. 是否认可 Runtime Approval 与 HumanGate 分离；
9. 是否认可 Thread 可重建且不作为业务事实来源；
10. 是否认可后续只按 RT 阶段逐步实施。

设计通过评审后，H02 只进入 `design_approved`。在主线稳定、同步基线、完成 Architecture Drift Review 且项目负责人再次授权之前，不编写实施计划。

## 30. 参考资料

- Codex App Server 官方文档：<https://developers.openai.com/codex/app-server>
- Codex App Server README：<https://github.com/openai/codex/blob/fca8c00f11bdbfaabed6bae2cb3765fcbd106fe8/codex-rs/app-server/README.md>
- Hermes Codex Session Adapter：<https://github.com/NousResearch/hermes-agent/blob/46e87b14fd6c943ef0d6671fb0d74c5dde5d4c6b/agent/transports/codex_app_server_session.py>
- Hermes Codex Event Projector：<https://github.com/NousResearch/hermes-agent/blob/46e87b14fd6c943ef0d6671fb0d74c5dde5d4c6b/agent/transports/codex_event_projector.py>
- Hermes Codex Runtime：<https://github.com/NousResearch/hermes-agent/blob/46e87b14fd6c943ef0d6671fb0d74c5dde5d4c6b/agent/codex_runtime.py>
- Hermes Turn Finalizer：<https://github.com/NousResearch/hermes-agent/blob/46e87b14fd6c943ef0d6671fb0d74c5dde5d4c6b/agent/turn_finalizer.py>
- LangGraph Persistence：<https://docs.langchain.com/oss/javascript/langgraph/persistence>
- LangGraph Interrupts：<https://docs.langchain.com/oss/javascript/langgraph/interrupts>
- LangGraph Time Travel：<https://docs.langchain.com/oss/javascript/langgraph/use-time-travel>
- Temporal Event History：<https://docs.temporal.io/workflow-execution/event>
- Temporal Activity Execution：<https://docs.temporal.io/activity-execution>
- Temporal Child Workflows：<https://docs.temporal.io/child-workflows>
- CloudEvents：<https://cloudevents.io/>
- ShanHai Agent Runtime Types：<https://github.com/DOIT-Ben/ShanHaiEdu-Studio/blob/fd2521f1b558b36f2680a661f9d2eaf34ffa584e/src/server/agent-runtime/types.ts>
- ShanHai Runtime Factory：<https://github.com/DOIT-Ben/ShanHaiEdu-Studio/blob/fd2521f1b558b36f2680a661f9d2eaf34ffa584e/src/server/agent-runtime/runtime-factory.ts>
- ShanHai Main Agent Controlled ReAct Loop：<https://github.com/DOIT-Ben/ShanHaiEdu-Studio/blob/fd2521f1b558b36f2680a661f9d2eaf34ffa584e/src/server/conversation/main-agent-controlled-react-loop.ts>
- ShanHai Main Agent ReAct Checkpoint：<https://github.com/DOIT-Ben/ShanHaiEdu-Studio/blob/fd2521f1b558b36f2680a661f9d2eaf34ffa584e/src/server/conversation/main-agent-react-checkpoint.ts>
