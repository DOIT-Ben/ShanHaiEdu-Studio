# 06 Workflow Orchestration System 工作流编排系统

## 1. 核心职责

管理多节点、多产物、多工具的业务流程，保证可恢复、可重试、可回退。

## 2. 核心对象

```text
Workflow
WorkflowRun
NodeRun
NodeState
Transition
Checkpoint
RetryPolicy
RollbackPolicy
```

## 3. 设计要点

- Workflow 不等于 prompt 链；它是状态机。
- 每个节点有明确输入、输出、状态和失败策略。
- 失败应局部重试，不默认整条链路重跑。
- 每个 checkpoint 应能恢复 UI 和 Agent 上下文。

## 4. 参考机制

- LangGraph node/edge/checkpoint。
- Temporal / Airflow 的任务编排思想。
- Saga / compensation 回退模式。

## 5. 适配问题

- 哪些业务流程是线性的，哪些是分支的？
- 哪些节点失败后可以重试，哪些必须人工介入？
- 哪些节点产物会成为后续节点输入？
