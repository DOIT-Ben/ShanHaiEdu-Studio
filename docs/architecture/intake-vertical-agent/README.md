# ShanHai 垂类智能体架构 Intake

- 状态：已完成首轮设计，等待项目负责人评审
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
9. 同一个 Turn/Node 只能有一个主 Agent Loop；Native、Codex、OpenAI Agents SDK 或其他 Runtime 不得在同一控制范围内争夺方向盘。
10. 所有 ToolResult 必须先持久化，再作为 Observation 返回 Agent。

## 3. 文档索引

- 总体架构与开源吸收：`2026-07-15-vertical-agent-intake-design.md`
- 主智能体与上下文内核：`2026-07-15-main-agent-context-kernel-design.md`
- Skill 驱动子智能体与 Council：`2026-07-15-skill-driven-subagent-council-design.md`
- 分阶段吸收台账：`2026-07-15-vertical-agent-intake-ledger.md`
- 主线隔离与未来规划策略：`2026-07-15-vertical-agent-mainline-planning-policy.md`

## 4. 与 `intake-hermes` 的关系

`intake-hermes` 研究 Hermes 的 Runtime、Memory、事件、中断恢复和 Codex 接入。本分支研究更上层的 ShanHai 垂类产品架构与多智能体协作。

两者关系如下：

```text
intake-hermes
  -> 提供 Runtime、Memory、Event、Recovery 等运行机制候选

intake-vertical-agent
  -> 定义 ShanHai 领域主智能体、上下文、子智能体、Council 与商业系统边界

main
  -> 当前唯一产品实现与交付主线
```

未来实施前必须对两个 Intake 与届时 `main` 进行 Architecture Drift Review，不能直接把规划文档当作现成变更清单。

## 5. 当前停止点

当前仅允许继续研究、评审和修订设计。未经项目负责人再次明确授权，不编写生产实施计划，不创建合入 `main` 的 PR，不安装框架，不接入子智能体 Runtime，不启用并发媒体生成。

