# Agent Control Plane 智能体控制平面

## 1. 定义

智能体控制平面负责决定“下一步该做什么”。它把用户自然语言、项目状态、节点契约、记忆、证据和工具能力编排成可执行计划。

## 2. 负责什么

- 意图理解：聊天、补充需求、确认、修改、生成、重试。
- 上下文编排：构建 ContextPackage，而不是直接拼接完整历史。
- 能力选择：选择可执行 capability。
- 契约加载：读取当前 published Node Contract。
- Prompt 编译：把契约、上下文、记忆、证据、上游产物转成模型输入。
- 计划校验前置：通过 PlanGuard 判断模型计划是否可执行。
- 人工确认前置：通过 HumanGate 判断是否需要用户授权。
- 工作流推进：成功、失败、重试、回退、改路。

## 3. 不负责什么

- 不直接生成真实文件。
- 不绕过 Provider Adapter 调外部服务。
- 不替代质量门禁判断完成。
- 不把长期记忆写入当成模型自由行为。

## 4. 关键组件

```text
MainConversationAgent
ConversationContextBuilder
ContextBudgetManager
SessionCompactor
CapabilityRegistry
NodeContractRegistry
PromptCompiler
PlanGuard
HumanGate
WorkflowOrchestrator
ToolObservationLoop
```

## 5. 设计做法

每轮主 Agent 处理不应是：

```text
全部历史消息 + 当前问题 -> 模型
```

而应是：

```text
Project State
+ Workflow State
+ active SessionContextSnapshot
+ scoped Memory
+ relevant Evidence
+ relevant Artifact summaries
+ recent messages
+ current user input
+ Runtime Guardrails
-> ContextPackage
-> MainConversationAgent
```

Agent 输出也不应直接执行，而应输出结构化计划：

```text
intent
nextCapability
toolPlan
requiredConfirmations
missingInputs
riskLevel
userVisibleReply
```

## 6. 参考机制

- LangGraph：state、node、edge、checkpoint。
- OpenCode：agent 配置、tool permission、compaction。
- Hermes：session summary 和 skills as procedural memory。
- 工作流引擎：状态机、幂等推进、断点恢复。

## 7. 验收问题

- Agent 是否只提出计划，而不是绕过门禁执行？
- 上下文是否由 ContextPackage 统一构建？
- 长对话是否能通过摘要恢复？
- 工具失败是否能回到 Agent 重新规划？
