# Hermes Intake 主线隔离与未来规划策略

- 策略版本：0.1.0
- 模式：\`planning_only\`
- 分支：\`intake-hermes\`
- 研究基线：\`main@fd2521f1b558b36f2680a661f9d2eaf34ffa584e\`
- 生效日期：2026-07-15

## 1. 目的

\`intake-hermes\` 是 ShanHaiEdu-Studio 的未来架构规划分支，不是当前产品主线的并行实现分支。

当前 \`main\` 继续完成既定 V1/R5 工作。Hermes Intake 只沉淀可供未来审核、更新和实施的研究结论，不反向要求主线为未来设计提前改造。

## 2. 当前允许的工作

在 \`planning_only\` 模式下，只允许：

- 阅读 ShanHai 当前源码和权威文档；
- 阅读 Hermes、Codex 和相关开源项目源码；
- 记录研究基线 Commit；
- 编写能力 Intake、目标架构和协议草案；
- 划分直接吸收、改造吸收和拒绝吸收；
- 设计阶段路线、入口条件和退出条件；
- 设计安全不变量、测试矩阵和验收指标；
- 维护 Intake Ledger 和设计版本；
- 在主线阶段节点执行 Architecture Drift Review。

## 3. 当前禁止的工作

未经新的明确授权，不允许：

- 修改 \`src/\`、\`prisma/\`、生产配置或 Prompt；
- 安装 LangGraph、Codex SDK、Memory Provider 或其他依赖；
- 修改 AgentRuntime、Main Agent Loop、ToolRouter 或 Artifact 流程；
- 创建数据库迁移；
- 接入外部 Memory 服务；
- 启用工具并行；
- 启动 Codex App Server PoC；
- 调整 Provider 密钥、部署资源或网络权限；
- 创建合入 \`main\` 的 PR；
- 以未来规划为理由阻塞当前主线交付。

## 4. 基线规则

每份 Intake 设计必须记录：

- ShanHai 研究基线 Commit；
- 外部项目研究基线 Commit 或文档版本；
- 当时存在的关键接口和状态边界；
- 哪些结论与具体文件结构相关；
- 哪些结论是独立于实现的长期不变量。

设计中的文件路径和接口只是基于研究基线的影响预测，不是未来实施时可以直接照抄的变更清单。

## 5. 主线同步时机

不持续追逐 \`main\` 的每个小提交。只有出现以下节点之一时才同步评估：

- 当前 V1/R5 阶段正式收口；
- Main Agent、Runtime、ToolRouter、Context 或 Artifact 边界发生明确重构；
- 项目负责人指定一个新的规划基线；
- 准备为某个 Intake 编写实施计划。

同步步骤：

~~~text
记录旧基线
→ 获取最新 main
→ 将 main 同步到 intake-hermes
→ 列出影响该 Intake 的文件和接口变化
→ 执行 Architecture Drift Review
→ 更新设计版本
→ 重新确认阶段入口
~~~

## 6. Architecture Drift Review

漂移审查至少检查：

- Main Agent 和 Runtime 的职责是否变化；
- ToolRegistry/ToolRouter 是否仍是唯一业务工具入口；
- ContextPackage、Checkpoint 和 IntentEpoch 是否变化；
- Conversation、Artifact 和 QualityDecision 数据结构是否变化；
- 新增设计是否已由主线自行实现；
- Intake 是否与主线产生第二控制面；
- 原计划文件路径和测试入口是否仍存在；
- 安全不变量是否仍适用；
- 是否应删除、合并或延后某个 Intake 阶段。

审查结果分为：

- \`no_drift\`：设计仍可直接进入下一规划阶段；
- \`compatible_drift\`：更新影响映射和接口草案；
- \`breaking_drift\`：重新设计并重新评审；
- \`absorbed_by_main\`：主线已实现，转为验证而不是重复开发；
- \`obsolete\`：设计不再需要，记录原因后停止。

## 7. 实施解锁条件

即使某份设计已经 \`design_approved\`，也不自动进入实施。

实施计划只有同时满足以下条件才能编写：

1. 项目负责人指定主线阶段已经稳定；
2. \`intake-hermes\` 已同步到指定最新基线；
3. 对该 Intake 完成 Architecture Drift Review；
4. 设计根据漂移结果更新并再次确认；
5. 项目负责人明确授权编写实施计划。

生产代码只有在实施计划再次获得明确批准后才能开始。

## 8. 分支与提交纪律

- 所有未来规划继续提交到 \`intake-hermes\`；
- 每个 Intake 使用独立设计文件和独立 Commit；
- 总览文档不承载全部细节；
- 不强推或重写已经评审的提交；
- 不将主线正在开发的功能复制到 Intake 分支；
- 主线同步使用可审计提交；
- 规划提交和未来实现提交严格分开；
- 未经明确授权，不合并到 \`main\`。

## 9. 当前停止点

当前允许继续编写 H02–H09 的未来设计，但不编写 HM-1 或其他生产实施计划。

H01 记忆系统即使通过设计评审，也只进入 \`design_approved\` 状态。它将在主线阶段稳定后重新进行 Architecture Drift Review，再决定是否编写 HM-1 实施计划。
