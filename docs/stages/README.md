# 当前阶段入口

更新时间：2026-07-17

`docs\stages\`当前唯一活动阶段是V1.0 Main Agent唯一编排与原子Tool控制面整改。阶段A、B、C、D已达到本地局部Go，阶段E全量回归与真实桌面核验是唯一下一动作；总门状态仍为 **REMEDIATION IN PROGRESS / CONTRACT RED**。

## 活动文件

- `v1-agent-atomic-tool-refactor-plan.md`：唯一问题矩阵、修复顺序和阶段验收标准。
- `v1-agent-atomic-tool-refactor-test-plan.md`：8项P1、7项P2及最终Go/No-Go。

过期的`v1-agent-atomic-tool-refactor-closeout.md`已按原文移入`..\archive\2026-07-17-remediation-baseline\`，不再作为活动依据。旧Streaming阶段和整改前V1-9 plan/test-plan同样只作归档证据。

## 固定边界

- Main Agent是唯一拥有业务Tool选择、下一步、重试、Replan和停止权的组件。
- 工作流、宏节点、Capability计划、Runner、Skill、Director、Critic和assistant-ui不得取得第二编排权。
- 每个缺陷先形成红测试，再做最小实现、定向回归和阶段提交。
- 不调用真实图片、视频、PPTX、ZIP或V1-9整包Provider。
- R5整体尚未关闭但默认不重跑；V1前不运行390px，不创建V1-9 manifest/runId。
- fixture只证明contract或executor，不能上推为model orchestration、product E2E或release。
- 本轮只创建本地整改提交，不push、不部署、不移动标签。

未来阶段统一从`..\roadmap\README.md`进入；历史阶段统一从`..\archive\README.md`追溯。二者都不能覆盖当前plan和test-plan。
