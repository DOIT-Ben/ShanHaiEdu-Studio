# Hermes Agent 架构吸收设计

- 状态：已批准进入分析分支，尚未批准生产实现
- 分支：\`intake-hermes\`
- ShanHai 基线：\`main@fd2521f1b558b36f2680a661f9d2eaf34ffa584e\`
- Hermes 研究基线：\`NousResearch/hermes-agent@46e87b14fd6c943ef0d6671fb0d74c5dde5d4c6b\`
- 日期：2026-07-15

## 1. 决策摘要

ShanHaiEdu-Studio 不以 Hermes 替换现有 Main Agent、ToolRouter、HumanGate、Quality Gate、Artifact Storage 或项目状态模型。

本设计吸收 Hermes 的运行机制，将 ShanHai 演进为“业务控制面 + 可插拔 Agent 执行面 + 统一工具治理面 + 上下文状态面 + 评估观测面”。Codex App Server、现有 OpenAI Controlled ReAct Runtime 和未来专项子智能体都是可选择的执行后端；每个 turn 或 node 只能有一个主 Agent Loop。

核心原则：

1. ShanHai 决定做什么、谁能做、预算多少、什么算通过。
2. Runtime 决定在受限任务内如何执行，但不能修改业务权威状态。
3. ToolRouter 仍是业务工具的唯一执行入口。
4. Codex Thread、模型消息历史和压缩摘要都不是 Project 的事实来源。
5. 吸收 Hermes 的韧性、可观测性和运行时切换，不复制其集中式通用 Agent 内核。

## 2. 当前 ShanHai 基线

当前系统已经具备比 Hermes 更强的业务治理边界：

- \`runMainAgentControlledReActLoop\` 负责 Main Agent 的受控工具循环。
- 每轮只允许一个工具调用，默认最多三个工具回合。
- 重复成功调用和重复失败会被阻断。
- 每轮形成显式 ReAct Checkpoint。
- \`MainAgentToolDispatcher\` 区分 Agent Tool、Business Tool 和策略阻断。
- Business Tool 必须携带有效 \`ExecutionEnvelope\`。
- \`ToolRouter\` 负责前置条件、Provider/Package/Internal Capability 分发、结果验证和 Quality State。
- \`AgentRuntime\` 当前是一次性 \`run(input)\` 接口，支持 \`deterministic | openai\`。
- Project、Conversation、IntentEpoch、Artifact、QualityDecision 和 HumanGate 保存在 ShanHai 业务系统中。

当前主要缺口不是“缺少一个新的总控 Agent”，而是运行时接口仍偏一次性调用，尚未统一表达：

- Thread/Turn 生命周期；
- 流式 Runtime Event；
- 中断、恢复和运行时崩溃；
- Runtime 级工具进度；
- Token、成本和上下文压缩事件；
- 安全工具并行；
- Native、Codex 和子智能体之间的运行时选择。

## 3. Hermes 的可复用设计

Hermes 的默认核心是手写的 Python 命令式 Agent Loop：

1. 构造 turn context 和系统提示；
2. 解析 Provider/API Mode；
3. 调用模型；
4. 将不同 Provider 响应归一化；
5. 有工具调用则执行并追加 Tool Result；
6. 没有工具调用则持久化并结束；
7. 在整个过程中处理预算、中断、压缩、重试、故障切换和回调。

当 \`api_mode == codex_app_server\` 时，Hermes 在进入默认循环前直接分流，把整个 turn 交给 \`CodexAppServerSession\`。Codex 事件再被投影回 Hermes 消息、进度、审批、Usage 和 Session 体系。两套 Agent Loop 不会同时控制同一 turn。

Hermes 通过 MCP 向 Codex 暴露经过筛选的无状态工具。依赖当前 AIAgent 内部状态的 \`delegate_task\`、memory、session_search 和 todo 不直接暴露，说明“任意现有工具都能无成本转成 MCP”这一假设不成立。

## 4. 吸收分类

### 4.1 可以直接吸收的机制

| 机制 | ShanHai 目标 |
| --- | --- |
| Turn/Node 级 Runtime 切换 | 引入 Runtime Router，每个 turn/node 选择一个主执行循环 |
| Provider 响应归一化 | 统一 Runtime Event、Usage、Failure、Tool Call 和 Completion |
| 可中断模型调用 | 用户停止、IntentEpoch 变化或任务取消后立即终止或丢弃结果 |
| 生命周期事件 | 统一 turn、tool、approval、usage、compaction、failure 事件 |
| 运行时崩溃退休 | 超时、进程退出或协议失步后销毁会话，禁止继续复用 |
| Session/Thread 续接 | 保存 Runtime Thread 映射，同时保持 Project/Conversation 权威性 |
| 迭代预算 | 父 Agent、Runtime 和子智能体共享次数、Token、时间和费用预算 |
| 工具可用性门控 | 根据项目阶段、权限、配置、Provider 和预算动态生成工具集合 |
| 工具 Schema 单一来源 | ToolRegistry 投影为 Native Function Schema、MCP Schema 和测试 Schema |
| Prompt 稳定分层 | 稳定身份和工具规则与动态项目上下文分离 |
| 轨迹与回放 | 保存脱敏执行轨迹，用于回归、质量和成本分析 |
| 平台无关核心 | UI、API、后台任务和未来定时任务共用同一控制面 |

### 4.2 必须经过 ShanHai 约束后吸收

| Hermes 机制 | ShanHai 改造要求 |
| --- | --- |
| 多工具并行 | 仅允许无依赖、资源范围不冲突、具备幂等键且不需要 HumanGate 的工具并行 |
| 消息历史压缩 | 压缩模型上下文，不覆盖原始事件、Artifact、审批证明和业务状态 |
| 整个 turn 交给 Codex | ShanHai 先绑定任务、工具白名单、预算和验收；Codex 只控制本 turn 内部执行 |
| Subagent delegation | 必须使用 TaskBrief、AllowedTools、Budget、ArtifactRefs 和 AcceptanceCriteria |
| Profile isolation | 转换为租户、项目、Worker、凭证和 Runtime Home 隔离 |
| Plugin/Hook | Hook 不得修改权威状态；失败不得改变主控制流；副作用必须审计 |
| Memory/Skill review | 允许提出候选记忆或 Skill 修订，不允许模型自动发布生产版本 |
| Provider failover | 只有语义、工具能力和数据边界兼容时才能自动切换 |

### 4.3 不吸收的部分

以下设计不进入 ShanHai 产品架构：

- 不复制一个同时承担 Prompt、Provider、Tool、Memory、Session 和重试的巨型 \`AIAgent\`。
- 不把聊天消息历史或 Codex Thread 当作业务事实来源。
- 不让 Runtime 直接批准 Artifact、HumanGate 或整个项目完成。
- 不允许 Codex 直接访问业务数据库、Provider 主密钥或未筛选内部工具。
- 不默认开放任意 Shell、宿主文件系统和网络能力。
- 不使用共享的个人 \`CODEX_HOME\` 或个人登录状态承载多租户任务。
- 不允许 Agent 自动修改并立即启用生产 Skill。
- 不在缺少幂等、资源锁和审计的情况下并行付费 Provider 调用。
- 不把依赖当前进程内部状态的工具伪装成无状态 MCP 工具。
- 不把 Runtime 错误文本直接显示给教师，必须经过安全摘要和错误分类。

## 5. 目标产品架构

~~~mermaid
flowchart TD
    A["Teacher / API / Background Job"] --> B["ShanHai Business Control Plane"]
    B --> C["Turn / Node Runtime Router"]
    C --> D["Native Controlled Runtime"]
    C --> E["Codex App Server Runtime"]
    C --> F["Specialized Subagent Runtime"]
    D --> G["Unified Tool Gateway"]
    E --> G
    F --> G
    G --> H["Policy / Provider / Quality / Artifact"]
~~~

### 5.1 业务控制面

继续负责：

- Project、Conversation、Node 和 IntentEpoch；
- PlanGuard、ExecutionEnvelope 和 HumanGate；
- 预算授权和 Provider 使用政策；
- Artifact 版本、QualityDecision 和 Promotion；
- Runtime 选择、任务取消和最终完成判断。

### 5.2 Agent 执行面

包含三个可插拔执行后端：

- \`controlled_native\`：现有受控 ReAct Loop，适合稳定业务工具和强约束流程；
- \`codex_app_server\`：适合复杂多步文件操作、局部规划和错误恢复；
- \`specialized_subagent\`：适合有清晰输入输出契约的专项任务。

每个 turn/node 只能选择一个主执行后端。禁止 Native Loop 调用 Codex Loop 后又允许 Codex 回调 Native Main Agent 继续规划。

### 5.3 工具治理面

ToolRegistry 是 Schema 的唯一来源；Unified Tool Gateway 是所有业务工具的唯一入口。Gateway 负责：

- Runtime 身份和 Server Context 绑定；
- AllowedTools 白名单；
- ExecutionEnvelope 和 IntentEpoch 校验；
- 幂等键、资源范围和并发策略；
- HumanGate 与 Provider 费用授权；
- Tool Result 先持久化、后返回 Runtime；
- 结果 Contract Validation 和安全摘要；
- Observation、Usage 和 Artifact 引用生成。

Codex 自带的 Shell/File 工具只能在隔离 Workspace 中工作，不能越过 Gateway 写业务权威状态。

### 5.4 上下文状态面

模型上下文分为四层：

1. 稳定层：身份、业务原则、工具规则和输出契约；
2. 项目层：Project Context、当前 IntentEpoch、已批准 Artifact 引用；
3. 执行层：本 turn 的 TaskBrief、预算、允许工具和 Checkpoint；
4. 临时层：最新 Tool Observation、进度和用户 steer。

上下文压缩只生成可重建的 Runtime Context Snapshot。原始 Event、Tool Result、Artifact 和审批证明继续永久保留。

### 5.5 评估观测面

统一记录：

- Runtime、Thread、Turn、Tool Call 和 Observation ID；
- Provider、模型、Token、缓存命中、费用和延迟；
- 工具重复率、阻断率、重试率和失败分类；
- Artifact 校验结果和教师采纳结果；
- 中断、恢复、压缩和 Runtime 退休；
- 脱敏轨迹和可重复回放输入。

## 6. 建议的核心契约

以下是目标语义，不代表本分析分支立即修改生产代码。

~~~typescript
type AgentRuntimeKind =
  | "deterministic"
  | "openai"
  | "codex_app_server"
  | "specialized_subagent";

type RuntimeEvent =
  | { type: "turn.started"; threadId: string; turnId: string }
  | { type: "tool.started"; turnId: string; callId: string; toolName: string }
  | { type: "tool.completed"; turnId: string; callId: string; observationId: string }
  | { type: "approval.requested"; turnId: string; approvalId: string }
  | { type: "usage.updated"; turnId: string; usage: RuntimeUsage }
  | { type: "context.compacted"; threadId: string; snapshotId: string }
  | { type: "turn.completed"; turnId: string }
  | { type: "turn.interrupted"; turnId: string; reason: string }
  | { type: "turn.failed"; turnId: string; failure: RuntimeFailure };

interface AgentRuntimeSession {
  startTurn(input: RuntimeTurnInput): AsyncIterable<RuntimeEvent>;
  interrupt(turnId: string, reason: string): Promise<void>;
  close(reason: string): Promise<void>;
}
~~~

Runtime Router 的输入必须来自服务端绑定状态，至少包括：

- projectId、conversationId、sourceMessageId；
- intentEpoch、planRevision；
- runtimeKind；
- TaskBrief 和输出 Contract；
- allowedTools；
- 预算和截止时间；
- approvedArtifactRefs；
- ExecutionEnvelope 或对应授权证明。

模型输出不得覆盖这些字段。

## 7. 安全并行模型

工具定义增加并发策略概念：

~~~typescript
type ToolConcurrencyPolicy = {
  mode: "sequential" | "parallel_safe";
  resourceScopes: string[];
  idempotent: boolean;
  requiresHumanGate: boolean;
  paidProvider: boolean;
};
~~~

只有同时满足下列条件才可以并行：

1. 所有工具声明 \`parallel_safe\`；
2. \`resourceScopes\` 不重叠；
3. 已生成并持久化幂等键；
4. 不需要 HumanGate；
5. 不依赖另一调用的 Artifact 或 Observation；
6. 付费 Provider 已完成预算预留；
7. 任一失败不会导致另一结果失去业务语义。

结果必须按照原始 Tool Call 顺序投影给模型，同时按真实完成时间保存事件。

## 8. 中断、恢复和失败关闭

### 中断

以下事件触发中断：

- 用户主动停止；
- 新消息提升 IntentEpoch；
- 项目或任务被删除；
- HumanGate 被撤销；
- Runtime 超时；
- Worker 即将回收。

中断后，尚未完成的 Runtime 输出不能写入 Artifact。已经完成的 Tool Result可以保存，但必须标记为旧 IntentEpoch，不能自动进入后续节点。

### 恢复

恢复优先级：

1. 从 ShanHai Checkpoint 和持久化 Tool Result 重建；
2. Runtime Thread 健康时续接；
3. Runtime Thread 不健康时创建新 Thread，并注入压缩后的执行快照；
4. 无法证明幂等安全时失败关闭，要求重新授权或人工确认。

### Runtime 退休

出现以下情况必须关闭并退休 Runtime Session：

- App Server 进程退出；
- JSON-RPC 协议失步；
- turn 超时且中断无响应；
- OAuth/凭证状态不可恢复；
- Tool Result 回调完整性无法确认；
- Runtime 尝试突破权限或资源边界。

## 9. 子智能体模型

Codex 可以作为执行型子智能体，但委派必须使用显式契约：

~~~typescript
type DelegatedTaskBrief = {
  taskId: string;
  parentTurnId: string;
  objective: string;
  allowedTools: string[];
  inputArtifactRefs: string[];
  budget: RuntimeBudget;
  outputContract: Record<string, unknown>;
  acceptanceCriteria: Record<string, unknown>;
  deadlineAt: string;
};
~~~

子智能体只能返回：

- 候选输出；
- Tool Observation 引用；
- Artifact Draft 引用；
- Usage；
- Runtime Failure；
- 对下一步的非权威建议。

子智能体不能自行修改 Project、IntentEpoch、Plan、HumanGate、QualityDecision 或 Artifact Promotion。

## 10. 分阶段吸收路线

### 阶段 0：架构 Intake

交付本设计、吸收矩阵、风险边界和验收标准。生产行为不变。

### 阶段 1：归一化契约

在不改变现有 Runtime 行为的前提下，引入 Runtime Event、Failure、Usage 和 Thread/Turn 标识；现有 OpenAI Runtime 通过适配器发出这些事件。

### 阶段 2：中断与可观测性

实现可中断 turn、运行时退休、事件持久化、成本统计和恢复测试。保持工具串行。

### 阶段 3：安全工具并行

只对明确标记为 \`parallel_safe\` 的低风险内部工具开放并行。付费 Provider、Artifact Promotion 和 HumanGate 保持串行。

### 阶段 4：Codex App Server 受限 PoC

只开放以下低风险能力：

- 读取课程上下文；
- 生成 PPT 大纲候选；
- 校验 PPT 大纲；
- 在隔离临时目录中进行非权威文件操作。

PoC 不开放付费媒体生成、最终 Artifact Promotion、业务数据库访问和任意网络出口。

### 阶段 5：受控灰度

按项目或用户显式开关选择 Runtime。Native Runtime 永远保留为对照组和回退路径。Codex 不作为默认硬依赖。

### 阶段 6：专项子智能体与后台入口

在统一事件、预算和工具治理稳定后，再增加专项子智能体、后台任务和定时执行入口。

## 11. 验收标准

### 硬性安全不变量

- 未经 ToolRouter/Gateway 的业务工具调用数量为 0。
- IntentEpoch 不匹配时进入 Artifact 的结果数量为 0。
- 崩溃恢复导致的重复付费 Provider 调用数量为 0。
- Runtime 直接批准 HumanGate、QualityDecision 或 Artifact Promotion 的数量为 0。
- 返回 Runtime 前未持久化的业务 Tool Result 数量为 0。
- 所有 Tool Call 都具备 projectId、turnId、callId 和审计身份。
- 未声明 \`parallel_safe\` 的并行工具调用数量为 0。

### PoC 比较指标

使用不少于 30 个固定课程任务，对 Native 和 Codex Runtime 进行同输入比较：

- 任务完成率；
- Artifact Contract 通过率；
- 工具重复调用率；
- 重复失败率；
- 人工干预率；
- P50/P95 延迟；
- Token 和 Provider 成本；
- 中断成功率；
- 崩溃恢复成功率；
- Runtime Event 完整率。

Codex 只有在硬性安全不变量全部满足，并且 Artifact Contract 通过率不低于 Native 基线时，才允许进入灰度阶段。

## 12. 风险与控制

| 风险 | 控制 |
| --- | --- |
| 两套 Agent Loop 套娃 | Runtime Router 在 turn/node 开始前单选主循环 |
| Codex 绕过业务权限 | MCP/Gateway 白名单、Server Context 绑定、ToolRouter 唯一入口 |
| 并行导致重复付费 | 幂等键、预算预留、资源锁、付费工具默认串行 |
| 压缩丢失权威信息 | 原始事件永久保留，摘要只用于 Runtime Context |
| App Server 状态污染 | 每租户/项目/Worker 隔离 Runtime Home 和临时目录 |
| Runtime Thread 损坏 | 健康检查、超时退休、Checkpoint 重建 |
| Skill 自我修改失控 | 只生成候选版本，必须评审、测试和显式发布 |
| Provider 自动切换改变语义 | 仅在输出 Contract、工具能力和数据边界兼容时切换 |
| 事件投影不完整 | Event Schema 版本化、持久化先行、回放测试 |
| 产品被 Codex 锁定 | 保留 Native Runtime，ToolRegistry 和业务状态不依赖 Codex |

## 13. 对现有代码的预期影响

后续实现预计围绕以下现有边界演进，不重写业务核心：

- \`src/server/agent-runtime/types.ts\`：扩展 Runtime Kind、Session 和 Event 契约；
- \`src/server/agent-runtime/runtime-factory.ts\`：演进为 Runtime Router/Factory；
- \`src/server/conversation/main-agent-controlled-react-loop.ts\`：保留 Native Runtime，增加外层运行时选择，禁止循环嵌套；
- \`src/server/conversation/main-agent-react-checkpoint.ts\`：增加 Runtime Thread/Turn 和恢复快照引用；
- \`src/server/tools/tool-registry.ts\`：增加 MCP 投影和并发策略元数据；
- \`src/server/tools/main-agent-tool-dispatcher.ts\`：复用 Server Context 和 ExecutionEnvelope 边界；
- \`src/server/tools/tool-router.ts\`：继续作为业务工具唯一入口，增加幂等和资源并发治理；
- 新增独立的 Codex App Server Adapter、Event Projector 和 MCP Gateway 模块，避免把协议细节写进 Main Agent Loop。

这些只是后续计划的边界，本分析分支不修改上述生产文件。

## 14. 明确非目标

本次 Intake 不做以下工作：

- 不安装 LangGraph；
- 不替换现有 Main Agent；
- 不修改生产 Runtime；
- 不启用工具并行；
- 不接入 Codex App Server；
- 不迁移 Session 或 Artifact 数据；
- 不改变 Provider 配置；
- 不增加新的教师可见功能；
- 不创建部署资源或密钥。

## 15. 结论

Hermes 最值得吸收的不是某个具体框架，而是四个成熟思想：

1. 用清晰的 Agent Loop 驱动“模型—工具—结果—继续”；
2. 将 Provider 差异归一化到统一内部协议；
3. 把 Codex App Server 作为整个 turn 的可替换 Runtime，而不是嵌套工具；
4. 把中断、恢复、压缩、预算、事件、成本和故障切换作为一等运行时能力。

ShanHai 应在这些思想之上保留并强化自身优势：业务状态权威、ExecutionEnvelope、HumanGate、Artifact Contract、Quality Gate 和教师控制。最终产品不是“Hermes 的教育版”，而是一个具备 Hermes 级运行韧性、同时拥有教育生产治理能力的 Agent Control Plane。

## 16. 参考源码

- Hermes Architecture：<https://github.com/NousResearch/hermes-agent/blob/46e87b14fd6c943ef0d6671fb0d74c5dde5d4c6b/website/docs/developer-guide/architecture.md>
- Hermes Agent Loop：<https://github.com/NousResearch/hermes-agent/blob/46e87b14fd6c943ef0d6671fb0d74c5dde5d4c6b/agent/conversation_loop.py>
- Hermes Codex Runtime：<https://github.com/NousResearch/hermes-agent/blob/46e87b14fd6c943ef0d6671fb0d74c5dde5d4c6b/agent/codex_runtime.py>
- Hermes Codex Session Adapter：<https://github.com/NousResearch/hermes-agent/blob/46e87b14fd6c943ef0d6671fb0d74c5dde5d4c6b/agent/transports/codex_app_server_session.py>
- Hermes Tools MCP Server：<https://github.com/NousResearch/hermes-agent/blob/46e87b14fd6c943ef0d6671fb0d74c5dde5d4c6b/agent/transports/hermes_tools_mcp_server.py>
- ShanHai Agent Runtime Types：<https://github.com/DOIT-Ben/ShanHaiEdu-Studio/blob/main/src/server/agent-runtime/types.ts>
- ShanHai Controlled ReAct Loop：<https://github.com/DOIT-Ben/ShanHaiEdu-Studio/blob/main/src/server/conversation/main-agent-controlled-react-loop.ts>
- ShanHai Main Agent Tool Dispatcher：<https://github.com/DOIT-Ben/ShanHaiEdu-Studio/blob/main/src/server/tools/main-agent-tool-dispatcher.ts>
- ShanHai Tool Router：<https://github.com/DOIT-Ben/ShanHaiEdu-Studio/blob/main/src/server/tools/tool-router.ts>
