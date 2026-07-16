# 当前阶段入口

更新时间：2026-07-16

`docs\stages\`当前唯一活动阶段：V1.0 Main Agent唯一编排与工作流原子Tool化重构的教师协作与步骤投影修正。后继V1-9仍未启动。

## 活动文件

- `v1-agent-atomic-tool-refactor-plan.md`
- `v1-agent-atomic-tool-refactor-test-plan.md`
- `v1-agent-atomic-tool-refactor-closeout.md`

当前门状态：**REOPENED / IMPLEMENTATION IN PROGRESS**。

旧Streaming阶段的成果作为前置能力保留，其plan/test-plan已经按原文归档。重构前V1-9 plan/test-plan也已归档；用户验收V1.0后必须根据最新合同重新生成V1-9计划，不能恢复旧文件。

## 固定边界

- Main Agent是唯一拥有业务Tool选择、下一步、重试、Replan和停止权的组件。
- 工作流、宏节点、Capability计划、Runner、Skill、Director、Critic和assistant-ui不得取得第二编排权。
- 每个缺陷先形成红测试，再做最小实现和定向回归；不按固定Tool顺序写断言。
- 不调用真实图片、视频、PPTX、ZIP或V1-9整包Provider。
- R5不重跑，V1前不运行390px，不创建manifest/runId。
- fixture只证明contract或executor，不能上推为model orchestration、product E2E或release。
- 未经用户另行要求不commit、不push、不部署、不移动标签。

未来阶段统一从 `..\roadmap\README.md` 进入；历史阶段统一从 `..\archive\README.md` 追溯。两者都不能覆盖当前plan和test-plan。
