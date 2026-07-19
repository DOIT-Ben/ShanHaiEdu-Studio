# 当前阶段入口

更新时间：2026-07-20

`docs\stages\`当前唯一活动阶段是 **产品优先深度重构**。目标不是继续增加证明机制，而是删除旧控制面、修复核心合同漏洞、拆分巨型模块，并让教师主链路只依赖一套可维护实现。

当前进度：阶段A、阶段B、阶段C以及阶段D的D1 workbench repository切片已完成离线行为回归；repository已退出复杂度基线，ConversationTurn幂等与并发claim、GenerationJob状态降级、VideoShot计划与片段血缘漏洞已关闭。阶段D仍在进行，唯一下一切片是D2：删除绕过Main Agent的直接regenerate写入口和生产源码中的mock adapter。整个活动阶段仍未关闭。

## 活动文件

- 机器合同：`active-stage.json`
- 实施计划：`product-first-deep-refactor-plan.md`
- 测试计划：`product-first-deep-refactor-test-plan.md`

## 固定边界

- 先修业务合同和生产控制权，再处理一般工程债务。
- 不保留竞争实现；消费者迁移完成后删除旧入口、旧类型和旧测试口径。
- 源码字符串检测器当前既有漏报也有误报；只有全部显性与隐藏源码断言迁移、检测器修正并在增强扫描下报告0，才能清空该债务。
- 复杂度 baseline、源码字符串合同 baseline、Lint warning 和构建动态追踪 warning 必须在本阶段清零。
- `WorkflowNode`、外层 `toolPlan` / `deliveryPlan` 和生产 deterministic runtime 必须退出 `src`。
- 不调用真实 Provider，不创建 V1-9 runId，不生成图片、视频、PPTX、ZIP，不运行390px真实黑盒。
- release 仍要求新鲜真实 Provider receipt；离线重构延期状态不能上推为 model orchestration、product E2E 或 release 通过。

暂停的 Provider 连续性工作已回到 `..\roadmap\release\provider-continuity-readiness-spec.md`；原活动计划、测试计划和就绪矩阵按原字节归档在 `..\archive\2026-07-19-provider-continuity-paused\`。
