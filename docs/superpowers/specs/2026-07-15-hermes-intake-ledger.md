# Hermes Intake 分阶段吸收台账

- 台账版本：0.1.0
- 分支：\`intake-hermes\`
- 当前模式：\`planning_only\`
- 基线：\`main@fd2521f1b558b36f2680a661f9d2eaf34ffa584e\`
- 状态：仅设计与研究；生产实现尚未授权
- 日期：2026-07-15

## 1. 台账目的

本台账保证 Hermes 能力按独立能力、独立规格、独立计划、独立实现和独立验收逐步吸收。任何能力不得因为“最终都要做”而绕过前一阶段验收或混入同一大型提交。

## 2. 统一状态

每个 Intake 只能处于以下状态之一：

| 状态 | 含义 |
| --- | --- |
| \`researching\` | 正在阅读源码和验证事实 |
| \`design_review\` | 设计已经提交，等待项目负责人评审 |
| \`design_approved\` | 设计获得明确批准，可以编写实施计划 |
| \`planned\` | 逐文件、逐测试实施计划已经批准 |
| \`implementing\` | 仅在对应阶段边界内实现 |
| \`verifying\` | 执行测试、回放、安全和性能验收 |
| \`accepted\` | 本阶段满足全部入口/退出条件 |
| \`blocked\` | 存在明确阻断，停止后续工作 |
| \`rejected\` | 决定不吸收该能力 |

## 3. Intake 顺序

| 编号 | 能力 | 当前状态 | 当前设计版本 | 依赖 | 下一入口条件 |
| --- | --- | --- | --- | --- | --- |
| H00 | Hermes 总体架构 Intake | \`design_review\` | 0.1.0 | 无 | 项目负责人评审总体设计 |
| H01 | 记忆系统 | \`design_review\` | 0.1.0 | H00 | 评审记忆分类、权限、数据模型和 HM 路线 |
| H02 | Runtime Event 与 Turn 生命周期 | \`researching\` | 尚未建立设计版本 | H00 | 完成 Codex/Hermes Event 映射源码分析 |
| H03 | 上下文压缩与 Session 谱系 | \`researching\` | 尚未建立设计版本 | H01、H02 | 明确压缩前 Memory Commit 和恢复不变量 |
| H04 | Provider 响应归一化与 Failover | \`researching\` | 尚未建立设计版本 | H02 | 定义统一 Response、Usage、Failure |
| H05 | 安全多工具并行 | \`researching\` | 尚未建立设计版本 | H02、H04 | 完成幂等、资源范围和预算预留设计 |
| H06 | Codex App Server Runtime | \`researching\` | 尚未建立设计版本 | H01、H02、H04 | Native 基线、事件协议和 Memory Package 可用 |
| H07 | 专项子智能体委派 | \`researching\` | 尚未建立设计版本 | H01、H02、H06 | TaskBrief、预算和结果契约稳定 |
| H08 | 轨迹、回放与评估 | \`researching\` | 尚未建立设计版本 | H02 | 统一 Event 可持久化和脱敏 |
| H09 | Gateway、后台任务与定时执行 | \`researching\` | 尚未建立设计版本 | H02、H07 | 多入口身份和 Session 隔离完成 |

表中的 \`researching\` 表示已纳入研究队列，不表示已经批准实现。

## 4. H01 记忆系统子阶段

| 阶段 | 交付物 | 入口条件 | 退出条件 |
| --- | --- | --- | --- |
| HM-0 | 记忆系统吸收设计 | H00 总览存在 | 设计通过评审 |
| HM-1 | 规范 Memory Repository | HM-0 通过 | 版本、Scope、Status、SourceRef 测试通过 |
| HM-2 | 显式 Memory 管理 | HM-1 通过 | 添加、审批、拒绝、撤销、忘记可审计 |
| HM-3 | Turn Memory Package | HM-2 通过 | Scope 过滤、预算和 Checkpoint 绑定通过 |
| HM-4 | Curator Candidate Pipeline | HM-3 通过 | 后台提取不阻塞、不污染、不直接生效 |
| HM-5 | 本地混合检索与压缩前提取 | HM-4 通过 | 检索、冲突、Outbox 和压缩恢复通过 |
| HM-6 | Codex 只读接入 | H06 PoC 与 HM-5 通过 | Codex 使用同一 Package，不能直接写 Approved |
| HM-7 | 受控自动批准 | HM-6 通过 | 仅规则可验证低敏感事实可自动批准 |
| HM-8 | 外部 Provider 评估 | HM-7 通过 | 可重建、可删除、无数据越界且不低于本地基线 |

不得把 HM-1 至 HM-8 合成一个实现版本。

## 5. 每个阶段的提交序列

每个阶段按以下顺序提交：

1. \`docs(<scope>): add <stage> design\`
2. \`docs(<scope>): address <stage> design review\`，仅在评审要求修改时产生
3. \`docs(<scope>): add <stage> implementation plan\`
4. \`test(<scope>): add <stage> contract tests\`
5. \`feat(<scope>): implement <stage>\`
6. \`fix(<scope>): address <stage> verification findings\`，仅在发现问题时产生
7. \`docs(<scope>): record <stage> acceptance evidence\`

规则：

- 规格提交不包含生产代码；
- 测试提交明确证明当前行为缺口；
- 实现提交只满足本阶段测试；
- 验收证据记录命令、结果、指标和已知限制；
- 阶段未 Accepted 前不开始下一阶段生产实现；
- 不使用强推改写已评审提交；
- 不把多个 Intake 的实现混在同一提交；
- 所有提交保持在 \`intake-hermes\`，直到项目负责人决定集成策略。

## 6. 当前提交记录

| Commit | 内容 | 类型 |
| --- | --- | --- |
| \`e90088385a9c0dbc99dd816df5ccdc4fa0071b6e\` | Hermes 总体架构吸收设计 | H00 规格 |
| \`ed0a7b923c75303468b2fb74a1fa5a725f74e119\` | H00 文档格式修正 | H00 评审前修正 |
| \`b569024fd51a3ac38b9f7306e99437f4242a4bc3\` | Hermes 记忆系统吸收设计 | H01/HM-0 规格 |

本台账自身的版本由该文件 Git 历史跟踪，不在正文中自引用当前 Commit SHA。

## 7. 分支纪律

- \`main\` 保持不变；
- 所有 Hermes Intake 设计、计划、测试、实现和验收只进入 \`intake-hermes\`；
- 不从其他功能分支混入无关改动；
- 每次开始新 Intake 前先更新本台账；
- 每次完成一个阶段后记录 Commit、状态、验收证据和下一入口条件；
- 发生主线更新时只做可审计的 merge/rebase，并重新运行受影响阶段验证；
- 未经项目负责人明确批准，不创建合并到 \`main\` 的 PR；
- 不自动删除 \`intake-hermes\`；
- 合入前默认保留阶段提交历史，不执行 squash。

## 8. 设计文档索引

- H00：\`docs/superpowers/specs/2026-07-15-hermes-intake-design.md\`
- H01：\`docs/superpowers/specs/2026-07-15-hermes-memory-intake-design.md\`
- Intake Ledger：\`docs/superpowers/specs/2026-07-15-hermes-intake-ledger.md\`
- 主线隔离策略：\`docs/superpowers/specs/2026-07-15-hermes-mainline-planning-policy.md\`

后续 H02–H09 每项使用独立设计文件，不追加成单个超大总览文档。

## 9. 当前停止点

当前只完成 H00 与 H01/HM-0 的设计提交。未修改生产代码、数据库、Prompt、Runtime、ToolRouter 或 Provider 配置。

当前分支锁定为 \`planning_only\`。H01 即使通过设计评审，也只进入 \`design_approved\`，不立即编写 HM-1 实施计划。允许继续逐项编写 H02–H09 的未来设计；任何实施计划必须等待主线阶段稳定、同步新基线、完成 Architecture Drift Review，并再次获得项目负责人明确授权。
