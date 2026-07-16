# Local Real MVP M4 Intro Video Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

M4 的核心需求是让教师在已确认教案和 PPT 大纲之后，得到可保存、可查看、可复制、可确认、可重做的导入视频方案文本。M4 不生成视频文件，不生成图片，不生成分镜成片，也不把文本策划卡包装成已经完成的视频。

M4 最小闭环为：

```text
确认 PPT 大纲与逐页脚本
-> 生成导入视频方案
-> 查看独立主题、开场钩子、吸睛点、课程锚点、课堂落点问题
-> 复制、确认、重做导入视频方案
-> 刷新后状态恢复
```

导入视频的产品边界是“独立创意 + 最小课程锚点回接”。视频只负责吸引、设问和制造现象，不提前讲授知识点结论；正式知识建构仍由课堂教案承载。

## 2. 可复用方案调研

当前主线已有可复用能力：

- `DeterministicRuntime` 已支持 `intro_video_plan` 模板。
- `task-guidance` 已定义导入视频所需字段和自检清单。
- `DEFAULT_WORKFLOW_NODES` 已定义 `intro_video_plan` 节点，后续图片提示词和视频分镜依赖它。
- `WorkflowRepository` 已支持 artifact 版本、确认、重做、stale 传播和刷新恢复。
- 前端 `ArtifactRail`、`ArtifactSidePanel`、`ArtifactDetailSheet` 已支持查看、复制、确认和重做。
- M3 已打通 `lesson_plan -> ppt_draft` 的文本产物推进，为 M4 提供顺序入口。

不复用外部真实视频 API：

- M4 只做文本方案闭环，不接入视频 provider。
- 不读取私有 API 台账或密钥。
- 不输出视频 URL、视频文件路径或“已生成视频”文案。

## 3. 复用、适配和必要自研

复用：

- 复用 `intro_video_plan` 作为 runtime task 与 workflow node key。
- 复用 M2/M3 的 approve 后推进机制和幂等检查。
- 复用 E2E Stage 2 的真实浏览器路径。

适配：

- 确认 `ppt_draft` 后触发 `intro_video_plan` 生成，保证教师路径仍按主线顺序推进。
- 生成内容只使用已确认教案作为课程锚点来源，避免视频方案变成 PPT 页面的附属说明。
- 补齐 deterministic 模板中的“开场钩子”和“吸睛点”显式字段。
- 教师可见标题保持“导入视频方案”，不显示文件生成或 provider 状态。

必要自研：

- 扩展本地 MVP 编排 helper：确认 `ppt_draft` 后生成 `intro_video_plan`。
- 增加 M4 route/orchestration 测试。
- 扩展浏览器 E2E 到导入视频方案查看、复制、确认、重做和刷新恢复。

## 4. 开发方案、风险和验证标准

执行方案：

1. 写 M4 阶段规划和测试定义。
2. 写失败测试：确认 PPT 大纲后生成 `intro_video_plan`，并包含独立主题、开场钩子、吸睛点、课程锚点、课堂落点问题。
3. 实现 `ppt_draft` approve 后的 `intro_video_plan` 生成。
4. 补齐导入视频 deterministic 文案字段。
5. 扩展 E2E 到导入视频方案查看、复制、确认、重做和刷新恢复。
6. 集中验收：`npm test`、`npm run build`、`npm run test:e2e:stage2`、worker 残留检查。
7. 写 M4 report 并提交。

主要风险：

- 如果确认教案后同时生成 PPT 大纲和导入视频，教师路径会从线性主链路变成并行节点，M4 暂不采用。
- 如果导入视频内容提前讲解知识点结论，会违反“视频吸引、课堂讲授”的产品边界。
- 如果出现视频成片、视频 URL、视频已生成等文案，会违反 M4 非目标。

验证标准：

- 后端确认 `ppt_draft` 后保存 `intro_video_plan` artifact，标题为“导入视频方案”，状态为 `needs_review`。
- 方案 Markdown 包含独立主题、开场钩子、吸睛点、课程锚点、课堂落点问题。
- 方案 Markdown 不包含“视频文件已生成”或“视频成片已生成”。
- 前端可查看、复制、确认、重做导入视频方案。
- 刷新后导入视频方案状态恢复。
