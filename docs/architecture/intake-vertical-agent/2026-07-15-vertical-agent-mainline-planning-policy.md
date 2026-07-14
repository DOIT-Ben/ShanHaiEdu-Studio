# 垂类智能体 Intake 主线隔离与未来规划策略

- 策略版本：0.1.0
- 模式：`planning_only`
- 分支：`intake-vertical-agent`
- 研究基线：`main@fd2521f1b558b36f2680a661f9d2eaf34ffa584e`
- 参考分支：`intake-hermes`
- 生效日期：2026-07-15

## 1. 目的

`intake-vertical-agent` 是 ShanHaiEdu-Studio 的未来架构规划分支，不是当前产品主线的并行开发分支。

当前 `main` 继续完成既定 V1/R5 工作。本分支只保存可供未来审核、更新和实施的设计，不反向要求主线提前为子智能体、Council、LangGraph、Codex 或商用基础设施改造。

## 2. 允许的工作

在 `planning_only` 模式下，只允许：

- 阅读 ShanHai 当前源码、需求和架构文档；
- 阅读权威官方文档、论文和开源源码；
- 记录研究基线；
- 编写领域架构、协议草案、吸收矩阵和风险边界；
- 设计阶段顺序、入口条件、退出条件和验收指标；
- 维护 Intake Ledger；
- 在主线稳定节点执行 Architecture Drift Review；
- 根据项目负责人反馈修订设计。

## 3. 禁止的工作

未经新的明确授权，不允许：

- 修改 `src/`、`prisma/`、生产 Prompt、配置或 Provider；
- 安装 LangGraph、OpenAI Agents SDK、Kimi SDK、Codex SDK 或其他依赖；
- 修改 Main Agent、AgentRuntime、ToolRouter、Workflow 或 Artifact 流程；
- 创建数据库迁移、Redis、队列、对象存储或部署资源；
- 启用 PPT/视频并发、子智能体或 Council；
- 修改现有 `shanhai-*` Skill；
- 固化创意分类、候选数量、角色和评审流程；
- 创建合入 `main` 的 PR；
- 以未来规划阻塞当前 V1 交付。

## 4. 文档边界

本分支新增设计统一放入：

```text
docs/architecture/intake-vertical-agent/
```

不修改当前权威五平面、十二系统和产品基线文件。未来只有在设计批准、主线稳定并完成漂移审查后，才决定是否将结论转写到长期权威架构文档。

## 5. 主线同步时机

不追逐 `main` 的每个小提交。只有以下情况才同步：

- 当前 V1/R5 阶段正式关闭；
- Main Agent、Runtime、Context、Skill、ToolRouter、Workflow 或 Artifact 边界发生重构；
- 项目负责人指定新的规划基线；
- 准备为某个 Intake 编写实施计划；
- `intake-hermes` 完成与本分支直接相关的 H01/H02/H05/H07 设计。

## 6. Architecture Drift Review

漂移审查至少检查：

- TaskBrief、IntentGrant 和 IntentEpoch 是否变化；
- Main Agent 是否仍是唯一业务协调者；
- ContextPackage、Checkpoint 和 Memory 边界是否变化；
- Runtime Event 和 Turn/Run 生命周期是否已由主线实现；
- ToolRegistry/ToolRouter 是否仍是唯一业务工具入口；
- Skill Registry、版本和加载机制是否变化；
- Artifact、GenerationJob、QualityDecision 和成本模型是否变化；
- 子智能体或并发机制是否已被主线以其他方式吸收；
- 规划是否会引入第二业务控制面；
- 当前开源项目接口和成熟度是否发生变化；
- 是否应合并、删除、推迟或拒绝某个 Intake。

审查结果：

- `no_drift`：设计仍适用；
- `compatible_drift`：更新接口映射和基线；
- `breaking_drift`：重新设计并再次评审；
- `absorbed_by_main`：转为验证，不重复实现；
- `absorbed_by_hermes_intake`：复用 Hermes Intake 结果；
- `obsolete`：记录原因后停止。

## 7. 实施解锁条件

设计进入 `design_approved` 仍不代表可以实现。实施计划必须同时满足：

1. 项目负责人指定当前主线阶段稳定；
2. 本分支同步到指定新基线；
3. 完成 Architecture Drift Review；
4. 与 `intake-hermes` 的重叠机制完成合并审查；
5. 设计根据漂移结果修订并再次批准；
6. 项目负责人明确授权编写某一 Intake 的实施计划。

生产实现只有在实施计划再次批准后才能开始。

## 8. 分支与提交纪律

- `main` 保持不变；
- 每个 Intake 使用独立设计文件和独立提交；
- 总览不承载全部专项细节；
- 不强推或重写已评审历史；
- 不混入其他功能分支改动；
- 主线同步必须留下可审计提交；
- 未经明确授权不创建合入 `main` 的 PR；
- 不自动删除本分支；
- 规划提交和未来实现提交严格分离。

## 9. 当前停止点

当前完成首轮设计沉淀和远程分支建立。后续等待项目负责人评审；不进入生产实现。

