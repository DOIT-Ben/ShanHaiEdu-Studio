# ShanHaiEdu 架构文档入口

更新时间：2026-07-14

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

已接受的关键决策：

```text
docs\architecture\decisions\2026-07-13-adr-当前成果工作区替代常驻糖葫芦.md
docs\architecture\decisions\2026-07-14-adr-v1-1采用assistant-ui与AG-UI兼容事件层.md
```

## 4. V1 Agent 与交付质量专题

PPT、视频、受控 ReAct、节点合同、质量量表、提示词、框架审计和真实 API 实验统一从以下入口读取：

```text
docs\architecture\2026-07-11-v1-agent-delivery-quality\README.md
```

该专题属于候选设计与证据包，不覆盖产品需求基线或已接受 ADR。实施时必须先核对 `docs\mainlines\current-mainline-status.md` 的最新代码事实。

## 5. V1 后 Runtime 候选

以下文件只保存 V1 完成后的复审候选，不改变当前 Runtime、Main Agent、ToolRouter、HumanGate 或 V1 执行顺序：

```text
docs\architecture\用Codex-SDK加强shanhai-studio-V1.md
```

该候选原由两条同提交的远端讨论分支保存；项目主线收敛后以本文件为唯一仓内副本，未来实施前必须重新核对届时代码与官方能力。
