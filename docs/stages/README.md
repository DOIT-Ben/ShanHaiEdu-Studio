# 当前阶段入口

更新时间：2026-07-17

`docs\stages\`当前唯一活动阶段是 **P0-05A真实Provider连续性与V1-9就绪**。当前子阶段只实施离线readiness：harness合同、证据来源绑定、隔离生命周期、失败关闭和V1-9入口就绪审计。`liveCallsAuthorized=false`，不调用真实Provider，也不签发passed receipt。

## 活动文件

- 机器合同：`active-stage.json`
- 产品规格：`..\product\p0-05a-provider-continuity-readiness-spec.md`
- 实施计划：`p0-05a-provider-continuity-readiness-plan.md`
- 测试计划：`p0-05a-provider-continuity-readiness-test-plan.md`

已完成的项目开发门禁阶段位于`..\archive\2026-07-17-project-development-gates\`，不得恢复为活动阶段。旧Streaming、整改前V1-9和其他历史阶段只作归档证据。

## 当前固定边界

- Main Agent仍是唯一拥有业务Tool选择、下一步、重试、Replan和停止权的组件；harness只提交教师输入并观察事实。
- 离线实现状态必须保持`passed=false / deferred_readiness_implementation`；release不得接受该状态。
- 缺少显式Provider channel、model fingerprint、费用上限、调用次数和授权摘要时，live入口必须在创建客户端和启动服务前失败，Provider请求数为0。
- 不调用真实图片、视频、TTS、PPTX、ZIP或V1-9整包Provider；不创建V1-9 runId，不运行390px真实黑盒。
- fixture只证明contract或executor，不能上推为model orchestration、product E2E、R5或release。
- 真实Provider连续3组需要用户另行授权；失败、候选变化或服务重启后从0重新计数。

未来阶段统一从`..\roadmap\README.md`进入；历史阶段统一从`..\archive\README.md`追溯。二者都不能自动取得执行权。
