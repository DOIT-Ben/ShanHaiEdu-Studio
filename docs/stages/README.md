# 当前阶段入口

更新时间：2026-07-17

`docs\stages\`当前唯一活动阶段是 **项目开发门禁制度化**。该阶段只把已知防复发约束转成可执行政策、测试、CI和验证manifest，不重开无边界代码审查，不调用真实媒体Provider，也不宣称R5、V1-9或release关闭。

## 活动文件

- 机器合同：`active-stage.json`
- 实施计划：`project-development-gates-plan.md`
- 测试计划：`project-development-gates-test-plan.md`

已完成整改入口：`..\archive\2026-07-17-agent-atomic-tool-remediation\README.md`。过期closeout仍位于`..\archive\2026-07-17-remediation-baseline\`，不得恢复为活动依据。旧Streaming阶段和整改前V1-9 plan/test-plan同样只作归档证据。

## 固定边界

- Main Agent是唯一拥有业务Tool选择、下一步、重试、Replan和停止权的组件。
- 工作流、宏节点、Capability计划、Runner、Skill、Director、Critic和assistant-ui不得取得第二编排权。
- 每个缺陷先形成红测试，再做最小实现、定向回归和阶段提交。
- 不调用真实图片、视频、PPTX、ZIP或V1-9整包Provider。
- R5整体尚未关闭但默认不重跑；V1前不运行390px，不创建V1-9 manifest/runId。
- fixture只证明contract或executor，不能上推为model orchestration、product E2E或release。
- 本阶段不push、不部署、不移动标签；是否提交按用户当次授权执行。

未来阶段统一从`..\roadmap\README.md`进入；历史阶段统一从`..\archive\README.md`追溯。二者都不能自动创建活动阶段或覆盖当前产品基线。
