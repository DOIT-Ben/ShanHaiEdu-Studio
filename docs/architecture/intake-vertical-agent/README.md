# ShanHai 垂类智能体架构 Intake

- 文档版本：0.2.0
- 状态：已完成首轮设计与双 Intake 对齐，等待项目负责人评审
- 分支：`intake-vertical-agent`
- 当前模式：`planning_only`
- ShanHai 研究基线：`main@fd2521f1b558b36f2680a661f9d2eaf34ffa584e`
- 参考分支：`intake-hermes`
- 日期：2026-07-15

## 1. 目的

本目录沉淀 ShanHaiEdu-Studio 在 V1 主线之外的未来垂类智能体架构规划。它汇总本轮关于五平面、商业十二系统、垂类主智能体、上下文内核、可插拔 Runtime、并发子智能体和 Skill 驱动 Council 的讨论与开源调研。

本分支不是当前 V1/R5 的并行实现分支，不修改 `src/`、数据库、Provider、Prompt 或生产配置，不要求正在开发的 `main` 为未来设计提前改造。

## 2. 已确认的总体决策

1. ShanHai 采用“领域内核自有 + 开源组件联邦”的路线，不从零重造所有基础设施，也不让开源框架成为业务事实源。
2. Project、Intent、Artifact、QualityDecision、HumanGate、费用与交付状态始终由 ShanHai 掌握。
3. 第三系统正式定位为“山海垂类主智能体与上下文内核”。领域状态、上下文策略和最终决策权自研；Agent Loop、事件流、压缩和 Runtime 机制允许复用。
4. 第六系统正式覆盖“Agent Runtime、子智能体委派与并发执行”。
5. 子智能体采用 A+B+C 组合：
   - A：代码控制的业务任务图；
   - B：边界明确的生产型子智能体；
   - C：仅在高创意环节插入受控的多智能体 Council。
6. PPT 与视频可以在共同上游 Artifact 被确认后并发，但必须读取同一不可变输入快照并写入独立 Artifact 命名空间。
7. Council 的创意分类、候选数量、角色数量、讨论轮数、评审方式和输出模板不写死在系统中，全部由版本化 Skill 声明。
8. Skill 定义协作方法；ShanHai 控制面负责权限、预算、持久化、恢复、审计和质量门禁。
9. 同一执行通道和控制作用域只能有一个主 Agent Loop；ParentRun 与独立 DelegatedRun 可以各有一个 Loop，但不得共同推进同一业务任务。
10. 第一版只支持一个父任务耐久等待一个叶子 Codex 子任务；不启用 fan-out、Council 或父子并行推进。
11. Codex 完成只产生 `completed_candidate`；父任务恢复后才作出 AcceptanceDecision。
12. 所有 ToolResult 和 ChildResultEnvelope 必须先持久化，再作为 Observation 返回 Agent。

## 3. 文档索引

- 总体架构与开源吸收：`2026-07-15-vertical-agent-intake-design.md`
- 主智能体与上下文内核：`2026-07-15-main-agent-context-kernel-design.md`
- Skill 驱动子智能体与 Council：`2026-07-15-skill-driven-subagent-council-design.md`
- 分阶段吸收台账：`2026-07-15-vertical-agent-intake-ledger.md`
- 主线隔离与未来规划策略：`2026-07-15-vertical-agent-mainline-planning-policy.md`
- Hermes + 垂类双 Intake 联合合同：`2026-07-15-hermes-vertical-joint-integration-contract.md`

## 4. 与 `intake-hermes` 的关系

`intake-hermes` 研究 Hermes 的 Memory、Session/Compaction、Runtime Event、Attempt、Lease/Fence、恢复、并行和 Codex 接入。本分支研究更上层的 ShanHai 垂类产品架构、Context、委派语义、验收和多智能体协作。

两者关系如下：

```text
intake-vertical-agent
  -> 定义做什么、何时委派、给什么上下文、什么算业务通过

intake-hermes
  -> 定义子任务怎样持久运行、接入 Codex、恢复、重试和审计

main
  -> 当前唯一产品实现与交付主线，始终持有业务事实
```

共同术语为 ParentRun、DelegatedRun、Attempt、RuntimeThreadBinding、CodexTurn、ChildResultEnvelope 和 AcceptanceDecision。两条 Intake 必须复用同一套主线 TurnJob/Lease/Fence/事件机制，不得分别实现两套生命周期。

未来不是把两个分支原样合并到 `main`。正确顺序是：主线稳定、记录新基线、同步两条 Intake、联合 Architecture Drift Review、删除重复或过时设计、形成统一目标架构与开发规划包，再逐项批准最小实施切片。

## 5. 当前停止点

当前停在 `design_review`，仅允许继续研究、评审和修订联合开发规划。首版候选开发切片已经限定为“父任务耐久等待一个叶子 Codex 子任务”，但尚未获准编写生产实施计划。

未经项目负责人在主线稳定、双分支漂移审查和设计批准后再次明确授权，不创建合入 `main` 的 PR，不安装框架，不接入子智能体 Runtime，不启用并发媒体生成。

