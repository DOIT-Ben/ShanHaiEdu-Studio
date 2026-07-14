# ShanHai 垂类智能体 Intake 分阶段台账

- 台账版本：0.1.0
- 分支：`intake-vertical-agent`
- 当前模式：`planning_only`
- 基线：`main@fd2521f1b558b36f2680a661f9d2eaf34ffa584e`
- 状态：只做未来设计与研究，生产实现尚未授权
- 日期：2026-07-15

## 1. 台账目的

本台账保证垂类主智能体、上下文、子智能体和 Council 不以一次大重构方式进入主线。每项能力必须独立研究、独立设计、独立评审、独立计划、独立测试和独立验收。

## 2. 状态定义

| 状态 | 含义 |
| --- | --- |
| `researching` | 阅读官方文档、源码和当前 ShanHai 证据 |
| `design_review` | 设计已提交，等待项目负责人评审 |
| `design_approved` | 设计明确批准，但尚未获准实施 |
| `planned` | 实施计划已经评审批准 |
| `implementing` | 在批准边界内实现 |
| `verifying` | 执行合同、恢复、安全、质量和性能验收 |
| `accepted` | 满足阶段全部退出条件 |
| `blocked` | 存在明确阻断，停止推进 |
| `rejected` | 决定不吸收该能力 |

## 3. Intake 总表

| 编号 | 能力 | 当前状态 | 依赖 | 下一入口条件 |
| --- | --- | --- | --- | --- |
| VA00 | 总体架构与开源吸收 | `design_review` | 无 | 评审领域内核与开源边界 |
| VA01 | 五平面与商业十二系统校准 | `design_review` | VA00 | 确认系统3、6、8、11、12的新边界 |
| VA02 | 垂类主智能体与上下文内核 | `design_review` | VA00 | 评审 TaskBrief、WorldState、ContextPackage 与 Router |
| VA03 | 生产型子智能体与并发 | `design_review` | VA02、Hermes H02 | 评审委派合同、生命周期、预算和 fan-out/fan-in |
| VA04 | Skill 驱动 Council | `design_review` | VA03、Skill Registry | 评审 Skill/架构边界与 CouncilPlan |
| VA05 | Runtime Event、恢复与统一 Adapter | `researching` | Hermes H02、VA03 | 与 `intake-hermes` 合并事实，避免重复设计 |
| VA06 | 记忆、反馈与教师风格 | `researching` | Hermes H01、VA02 | 明确 FeedbackEvent 和 Memory Proposal 边界 |
| VA07 | 多Agent质量评测与成本基线 | `researching` | VA03、VA04 | 固定课程集、指标和对照组完成设计 |
| VA08 | 商用队列、Worker 与分布式并发 | `researching` | VA03、系统8/11 | 主线拓扑稳定并完成容量目标复核 |

`design_review` 不等于批准实现；`researching` 不表示已经选择某个框架。

## 4. 建议实施顺序

```text
VA02 合同稳定
-> VA05 Runtime Event / Recovery 稳定
-> VA03 单一受限 Worker
-> VA03 固定 fan-out/fan-in
-> VA04 Skill -> CouncilPlan 编译
-> VA04 离线 Council PoC
-> VA07 质量成本评测
-> VA08 商用灰度
```

不得跳过 Runtime Event、持久化、幂等和恢复，直接实现生产多Agent并发。

## 5. 分阶段提交序列

未来每个 Intake 按以下提交序列推进：

1. `docs: 增加 <编号> 设计 | <版本> | <时间>`
2. `docs: 修订 <编号> 评审意见 | <版本> | <时间>`
3. `docs: 增加 <编号> 实施计划 | <版本> | <时间>`
4. `test: 增加 <编号> 合同测试 | <版本> | <时间>`
5. `feat: 实现 <编号> | <版本> | <时间>`
6. `fix: 修正 <编号> 验收问题 | <版本> | <时间>`
7. `docs: 记录 <编号> 验收证据 | <版本> | <时间>`

每一步都要求单独评审；设计提交不得混入生产代码。

## 6. 与 `intake-hermes` 的依赖

| 本分支能力 | Hermes Intake 依赖 |
| --- | --- |
| VA02 Context Kernel | H01 Memory、H02 Runtime Event |
| VA03 子智能体生命周期 | H02 Turn/Run Lifecycle、H04 Failure、H08 Trace |
| VA04 Council | H02 Event、H05 Safe Parallel、H07 Delegation |
| VA05 Runtime Adapter | H02、H04、H06 Codex Runtime |
| VA06 记忆反馈 | H01 Memory Intake |

若两个分支对同一机制定义冲突，先执行联合 Architecture Drift Review，不在两个分支各自实现一套。

## 7. 当前设计文件

- VA00/VA01：`2026-07-15-vertical-agent-intake-design.md`
- VA02：`2026-07-15-main-agent-context-kernel-design.md`
- VA03/VA04：`2026-07-15-skill-driven-subagent-council-design.md`
- Ledger：`2026-07-15-vertical-agent-intake-ledger.md`
- Planning Policy：`2026-07-15-vertical-agent-mainline-planning-policy.md`

## 8. 当前停止点

本分支已完成首轮架构文档，不修改生产代码。下一动作只能是项目负责人评审、提出修订意见或批准某一设计进入 `design_approved`。未经新的明确授权，不编写实施计划。

