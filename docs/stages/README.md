# 当前阶段入口

更新时间：2026-07-17

`docs\stages\`当前没有活动阶段。V1.0 Main Agent唯一编排与原子Tool控制面整改已于2026-07-17达到 **REMEDIATION VERIFIED / CONTRACT GO**，完成计划、测试计划和证据已归档。

## 活动文件

- 无。新阶段必须先由未完成需求总账进入并建立唯一plan/test-plan。

已完成整改入口：`..\archive\2026-07-17-agent-atomic-tool-remediation\README.md`。过期closeout仍位于`..\archive\2026-07-17-remediation-baseline\`，不得恢复为活动依据。旧Streaming阶段和整改前V1-9 plan/test-plan同样只作归档证据。

## 固定边界

- Main Agent是唯一拥有业务Tool选择、下一步、重试、Replan和停止权的组件。
- 工作流、宏节点、Capability计划、Runner、Skill、Director、Critic和assistant-ui不得取得第二编排权。
- 每个缺陷先形成红测试，再做最小实现、定向回归和阶段提交。
- 不调用真实图片、视频、PPTX、ZIP或V1-9整包Provider。
- R5整体尚未关闭但默认不重跑；V1前不运行390px，不创建V1-9 manifest/runId。
- fixture只证明contract或executor，不能上推为model orchestration、product E2E或release。
- 本轮只创建本地整改提交，不push、不部署、不移动标签。

未来阶段统一从`..\roadmap\README.md`进入；历史阶段统一从`..\archive\README.md`追溯。二者都不能自动创建活动阶段或覆盖当前产品基线。
