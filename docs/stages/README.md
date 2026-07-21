# 当前阶段入口

更新时间：2026-07-21

`docs\stages\`当前唯一活动阶段是 **FrameFlow 风格整图 PPT Tool**。目标是在保留既有 PPT 工作流的同时，新增逐页整图生成、满版组装、可编辑文字叠加和结构审查路径。

当前进度：阶段合同已建立；新 Provider Tool、Package Tool、逐页整图批次、1920×1080 标准化、可编辑文字/数学层、可读性底板和 PPTX 结构审查已实现。既有 Coze PPT 与分层资产 PPT Tool 保持注册和原合同。当前只做独立分支验证，不进入教师签收、课程最终包或 release。

## 活动文件

- 机器合同：`active-stage.json`
- 实施计划：`frameflow-image-slide-ppt-plan.md`
- 测试计划：`frameflow-image-slide-ppt-test-plan.md`
- 上一阶段交接：`product-first-deep-refactor-handoff.md`

## 固定边界

- 两条 PPT 路径并存，由 Main Agent 根据任务选择，不新增第二编排器。
- 新路径只使用统一模型网关图片能力，不恢复旧 Provider 或台账凭据入口。
- 图片只承担整页视觉底图；准确文字、数字和数学内容必须作为独立可编辑对象叠加。
- 真实图片批次和 PPTX 必须验证文件、哈希、尺寸、页数、图片绑定和可编辑层。
- 本阶段测试不创建 V1-9、不执行教师签收、不形成课程最终包，也不上推为 release 通过。

暂停的 Provider 连续性工作已回到 `..\roadmap\release\provider-continuity-readiness-spec.md`；原活动计划、测试计划和就绪矩阵按原字节归档在 `..\archive\2026-07-19-provider-continuity-paused\`。
