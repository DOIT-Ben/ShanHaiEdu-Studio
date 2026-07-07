# Local Real MVP M5 Final Delivery Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

M5 的核心需求是把教师已确认的文本产物汇总为一个可保存、可查看、可复制、可确认、可重做的最终交付包 Markdown。M5 不生成 PPTX 文件、图片文件或视频成片，也不把未完成文件能力包装成已完成。

M5 最小闭环为：

```text
确认导入视频方案
-> 生成最终交付清单
-> 汇总需求规格、教案、PPT 大纲、导入视频方案
-> 标记未真实生成的 PPTX、图片、视频能力
-> 复制、确认、重做最终交付清单
-> 刷新后状态恢复
```

本阶段以“复制 Markdown”满足主线中的“支持下载或复制 Markdown”。不新增下载按钮，避免在最终交付包内容尚未稳定时扩大前端交互面。

## 2. 可复用方案调研

当前主线已有可复用能力：

- `DeterministicRuntime` 已支持 `final_delivery_checklist` 模板。
- `task-guidance` 已定义最终交付清单所需字段和自检清单。
- `DEFAULT_WORKFLOW_NODES` 已定义 `final_delivery` 节点。
- `WorkflowRepository` 已支持 artifact 版本、确认、重做和刷新恢复。
- 前端详情面板已有复制 Markdown 能力。
- E2E Stage 2 已覆盖 M1-M4 的真实浏览器路径，可继续扩展到 M5。

需要适配的缺口：

- Runtime task 使用 `final_delivery_checklist`，workflow node 使用 `final_delivery`。
- `final_delivery` 上游需要包含已确认需求规格、教案、PPT 大纲和导入视频方案。
- 当前 approve 编排尚未在确认导入视频方案后生成最终交付清单。

## 3. 复用、适配和必要自研

复用：

- 复用 `final_delivery_checklist` deterministic 模板。
- 复用 `final_delivery` workflow node，避免迁移既有后端合同。
- 复用 M2-M4 的 approve 后推进机制和幂等检查。
- 复用详情面板复制能力，不新增下载 UI。

适配：

- 增加明确映射：runtime task `final_delivery_checklist` 保存到 workflow node `final_delivery`。
- 确认 `intro_video_plan` 后触发最终交付清单生成。
- `final_delivery` 上游显式包含 `requirement_spec`、`lesson_plan`、`ppt_draft`、`intro_video_plan`。
- 最终交付清单必须明确标记 PPTX、图片文件、视频成片未真实生成时为待生成。

必要自研：

- 扩展本地 MVP 编排 helper：确认导入视频方案后生成最终交付清单。
- 增加 M5 route/orchestration 测试。
- 扩展浏览器 E2E 到最终交付清单查看、复制、确认、重做和刷新恢复。

## 4. 开发方案、风险和验证标准

执行方案：

1. 写 M5 阶段规划和测试定义。
2. 写失败测试：确认导入视频方案后生成 `final_delivery` 节点上的“最终交付清单”。
3. 实现 `final_delivery_checklist -> final_delivery` 映射。
4. 实现 `intro_video_plan` approve 后的最终交付生成。
5. 调整 `final_delivery` 上游输入，确保可汇总需求规格、教案、PPT 大纲、导入视频方案。
6. 扩展 E2E 到最终交付查看、复制、确认、重做和刷新恢复。
7. 集中验收：`npm test`、`npm run build`、`npm run test:e2e:stage2`、worker 残留检查。
8. 写 M5 report 并提交。

主要风险：

- 如果没有 `final_delivery_checklist -> final_delivery` 映射，会重复出现历史 Stage 3 的 runtime/workflow key 缺口。
- 如果最终交付文案说“PPTX/图片/视频已完成”，会违反 MVP 边界。
- 如果为了下载能力新增 UI，可能扩大阶段范围并影响前端稳定性，M5 暂不采用。

验证标准：

- 后端确认 `intro_video_plan` 后保存 `final_delivery` artifact，标题为“最终交付清单”，状态为 `needs_review`。
- 最终交付 Markdown 包含需求规格、公开课教案、PPT 大纲与逐页脚本、导入视频方案。
- 最终交付 Markdown 明确标记 PPTX、图片文件、视频成片未真实生成时为待生成。
- 前端可查看、复制、确认、重做最终交付清单。
- 刷新后最终交付清单状态恢复。
