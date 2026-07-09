# 03 Main Conversation Agent System 主对话智能体系统

## 1. 核心职责

把自然语言转换成结构化意图、计划、确认动作和工作流推进建议。

## 2. 核心对象

```text
MainConversationAgent
ConversationTurn
Intent
ContextPackage
ToolPlan
PendingAction
AgentObservation
```

## 3. 设计要点

- 主 Agent 不直接吞完整历史，而读取 ContextPackage。
- 主 Agent 不直接执行高风险工具，只提出计划。
- 工具失败要回到 Agent 形成 observation，再重新规划。
- deterministic 逻辑只能是 fallback 或测试替身，不能伪装智能主脑。

## 4. 参考机制

- OpenCode agents 和 compaction。
- LangGraph stateful agent。
- Hermes session summary。

## 5. 适配问题

- 业务里有哪些常见 intent？
- 哪些 intent 可以直接答复，哪些必须进入工作流？
- Agent 输出需要哪些结构化字段才能被系统安全执行？
