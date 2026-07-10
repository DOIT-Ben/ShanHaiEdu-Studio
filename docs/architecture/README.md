# ShanHaiEdu 架构文档入口

更新时间：2026-07-10

本文是架构文档导航。架构文档只记录长期结构、边界、职责和决策，不承载单阶段开发流水账。

## 1. 必读顺序

```text
docs\architecture\2026-07-09-山海智教智能体-统一口径与工作准则.md
docs\architecture\2026-07-09-山海智教智能体-核心设计串联.md
docs\architecture\2026-07-09-山海智教智能体-workbench-five-planes.md
docs\architecture\2026-07-09-山海智教智能体-workbench-twelve-systems.md
docs\architecture\2026-07-09-山海智教智能体-MVP1-上下文契约与门禁规划.md
```

需要通用架构背景时，再读：

```text
docs\architecture\智能体设计架构\README.md
docs\architecture\智能体设计架构\patterns\01-conversation-context-compaction.md
docs\architecture\智能体设计架构\patterns\02-node-contract-control.md
docs\architecture\智能体设计架构\patterns\03-memory-boundaries.md
```

## 2. 架构不变量

- Project 是中心，不是单条消息。
- Agent 是调度者，不是事实源。
- ContextPackage 是模型输入边界，不是完整长对话。
- ToolRouter 是工具执行边界，模型只能表达 tool intent。
- Artifact / Evidence / Quality Gate 决定真实完成状态。
- HumanGate 和 PlanGuard 不能被自然语言、按钮、模型自评或 provider 回包绕过。

## 3. ADR 目录

新的关键架构决策写入：

```text
docs\architecture\decisions\YYYY-MM-DD-adr-主题.md
```

ADR 应包含：背景、决策、取舍、风险、验证方式、回退方式。
