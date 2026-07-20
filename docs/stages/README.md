# 当前阶段入口

更新时间：2026-07-20

`docs\stages\`当前唯一活动阶段是 **产品优先深度重构**。目标不是继续增加证明机制，而是删除旧控制面、修复核心合同漏洞、拆分巨型模块，并让教师主链路只依赖一套可维护实现。

当前进度：阶段A、阶段B、阶段C以及阶段D的D1至D17切片已完成离线行为回归；D13完成视频route HTTP边界与执行协调最小拆分、单镜头`shotIds`和GenerationJob `unitId`血缘修复；D14完成Ops环境拼装、container/video/desktop/deploy/auth smoke结构化合同和失效数据源键删除；D15完成M67与V1-9 Runner源码合同迁移；D16增强源码合同检测器并完成11个复杂度登记项的风险复评；D17完成剩余5个测试文件的行为合同迁移，源码合同债务清零。repository、workbench API和workbench service已退出复杂度基线，队列/GenerationJob/VideoShot漏洞已关闭，Artifact重做只走标准Main Agent消息，生产mock、Stage41假交付、孤立runtime PoC和新库staged commit结构已删除。消息与事件合同已拆为独立职责模块，旧导出路径保持兼容。Skill registry、bindings、output contract和Tool Router作为稳定内聚注册表/协议映射/单一校验分发边界保留，Runtime与Tool adapter公开门面保持兼容并已将内部职责迁入独立模块。Provider敏感生产职责模块已进入离线阶段精确白名单，开发态只允许延期且release不接受延期。复杂度债务保持11个登记项，源码合同债务现为0个文件/0次命中。阶段D已完成，下一步进入阶段E最终验证；真实Provider、V1-9、签收和release仍未启动。

## 活动文件

- 机器合同：`active-stage.json`
- 实施计划：`product-first-deep-refactor-plan.md`
- 测试计划：`product-first-deep-refactor-test-plan.md`
- 续作交接：`product-first-deep-refactor-handoff.md`

## 固定边界

- 先修业务合同和生产控制权，再处理一般工程债务。
- 不保留竞争实现；消费者迁移完成后删除旧入口、旧类型和旧测试口径。
- 源码字符串检测器当前既有漏报也有误报；只有全部显性与隐藏源码断言迁移、检测器修正并在增强扫描下报告0，才能清空该债务。
- 复杂度与源码字符串合同门必须保持单调收缩并禁止新增债务；复杂度按`2026-07-20-adr-risk-based-complexity-governance.md`分为应拆、修改时再评估和可保留三类，不再把所有baseline清空作为唯一验收条件。Lint warning和构建动态追踪warning仍必须清零。
- `WorkflowNode`、外层 `toolPlan` / `deliveryPlan` 和生产 deterministic runtime 必须退出 `src`。
- 不调用真实 Provider，不创建 V1-9 runId，不生成图片、视频、PPTX、ZIP，不运行390px真实黑盒。
- release 仍要求新鲜真实 Provider receipt；离线重构延期状态不能上推为 model orchestration、product E2E 或 release 通过。

暂停的 Provider 连续性工作已回到 `..\roadmap\release\provider-continuity-readiness-spec.md`；原活动计划、测试计划和就绪矩阵按原字节归档在 `..\archive\2026-07-19-provider-continuity-paused\`。
