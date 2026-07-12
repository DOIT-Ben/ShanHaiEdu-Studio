# 当前 Main Agent 运行时审计

## 1. 审计目标

回答两个问题：

1. 当前 ShanHaiEdu 自研 Main Agent 是否已经具备真正的多步 ReAct、动态改道和持久恢复能力。
2. 哪些能力应继续自研，哪些能力已经进入通用框架的成熟责任范围。

本次只读分析代码，不运行迁移、不修改项目、不调用真实交付 Provider。

## 2. 审计基线

| 项目 | 当前证据 |
|---|---|
| 工程目录 | `E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\main` |
| 分支 | `main` |
| HEAD | `02703d0b96ce2fffecaabda5721c8d79d663b8fa` |
| 与 `origin/main` 比较 | ahead 14 / behind 0 |
| 工作树 | 75 个已修改文件、16 个未跟踪文件，共 91 项 |
| 主要依赖 | Next.js `^16.0.0`、React `^19.0.0`、OpenAI `^6.45.0` |
| Agent 框架依赖 | 未安装 LangGraph、Vercel AI SDK、OpenAI Agents SDK |

由于工作树包含正在开发的未提交内容，HEAD 不能完整代表本次审计对象。关键文件 SHA-256 见 `evidence/2026-07-11-代码快照证据.md`。

## 3. 当前运行链路抽象

```text
API Message Route
-> ConversationTurnService
-> ConversationControlResolver / MainConversationAgent
-> Capability Plan / PlanGuard / Harness Budget
-> CapabilityRunner 或 ToolRouter
-> Internal Capability / Provider Adapter
-> Artifact / GenerationJob / WorkflowNode 持久化
-> 下一轮对话
```

当前不是一个“完全没有架构”的系统。它已经具备清晰的业务骨架：

- Conversation 入口和自然语言控制解析。
- Capability Registry、Planner、Runner。
- ToolRegistry、ToolRouter、Provider Adapter。
- WorkflowNode、Artifact、AgentRun、GenerationJob 数据模型。
- PlanGuard、预算控制、Approved Artifact、失败观察和教师可见反馈。

这些是后续框架化迁移应复用的资产，而不是需要删除的遗留物。

## 4. 已证实的运行时限制

### 4.1 Tool Loop 默认只有一轮

`src/server/gpt-protocol/openai-tool-loop-runner.ts:45` 将缺省 `maxToolRounds` 设置为 1；`src/server/agent-runtime/native-tool-loop-config.ts:47` 同样缺省为 1。

这可以完成“模型选择一次工具、工具返回、模型收尾”的最小循环，但不能自然承载复杂的：

```text
观察质量结果
-> 判断缺陷原因
-> 选择局部修复工具
-> 再观察
-> 必要时再次修复
```

### 4.2 多 Tool Call 被直接阻断

`openai-tool-loop-runner.ts:72-74` 在一次响应包含多个 Function Call 时返回 `multiple_tool_calls_blocked`，不会执行 ToolRouter。

这个限制有安全价值，但也说明当前 Harness 不是成熟的多工具调度运行时。未来是否允许并发或串行多 Tool，应该由图节点、工具副作用等级和业务门禁决定，而不是统一阻断。

### 4.3 Native Tool Loop 仍依赖环境开关

`src/server/agent-runtime/runtime-factory.ts:34-36` 只有在 `SHANHAI_OPENAI_NATIVE_TOOL_LOOP === "1"` 时才创建 Native Tool Loop。

这表明当前主路径仍以结构化单次输出和确定性推进为主，Agent Loop 尚未成为稳定的运行权威源。

### 4.4 完整交付计划仍是固定列表

`src/server/conversation/model-main-conversation-agent.ts:31-48` 固定定义了 16 个完整交付步骤，再根据已有 Artifact Kind 标记完成状态。

固定主干不是错误，教育交付需要可审计工艺；问题是当前还缺少：

- 根据任务范围裁剪图。
- 质量失败后的条件返修边。
- 用户自然语言回跳后的 ChangeSet 和影响分析。
- Provider 运行中的取消、隔离和恢复语义。
- Checkpoint 与图版本兼容策略。

### 4.5 通用控制职责正在集中

关键文件规模：

| 文件 | 行数 |
|---|---:|
| `conversation-turn-service.ts` | 989 |
| `model-main-conversation-agent.ts` | 490 |
| `openai-runtime.ts` | 326 |
| `tool-router.ts` | 299 |
| `agent-harness-budget.ts` | 226 |
| `conversation-control-resolver.ts` | 216 |

这些文件合计 2,546 行；再加 Tool Loop 和配置代码，通用控制链已经超过 2,700 行。继续在这里叠加 Checkpoint、Interrupt、子图、时间旅行和恢复，会显著提高维护风险。

## 5. 客观判断

### 5.1 不成立的判断

“自研 Main Agent 整体不行，所以全部换成开源框架”不成立。

框架不知道什么是：

- 教材证据是否可靠。
- 导入视频是否保持独立创意并回接课程锚点。
- PPT 样张是否达到可继续生产的质量。
- 某次返修应使哪些下游 Artifact 失效。
- 最终交付包是否具备真实文件、页数、时长和血缘。

这些是 ShanHaiEdu 的业务 Main Agent 与交付质量架构，必须自研。

### 5.2 成立的判断

继续自研以下通用运行时能力，投入产出比已经很低：

- 通用 LLM -> Tool -> Observation -> Replan 循环。
- StateGraph、条件边、循环和子图调度。
- Interrupt、Resume、Checkpoint 和 Replay。
- 通用 Agent-as-Tool 生命周期。
- 通用事件流、Tracing、超时和 Max Turns。
- 图级故障恢复和运行状态序列化。

## 6. 审计结论状态

| 结论 | 状态 | 置信度 |
|---|---|---|
| 当前不是完整 durable ReAct Runtime | 代码已证实 | 高 |
| 当前已有可复用的业务 Tool/Artifact/Job 骨架 | 代码已证实 | 高 |
| 通用运行时应框架化 | 架构建议 | 中高 |
| LangGraph 应成为最终选型 | 候选建议，尚未决策 | 中 |
| OpenAI Agents SDK 或 Vercel AI SDK 不应使用 | 不成立；它们仍有适配场景 | 高 |

最终选型必须经过隔离 Spike 和整体架构评审，不能仅凭本次静态审计直接进入主线。
