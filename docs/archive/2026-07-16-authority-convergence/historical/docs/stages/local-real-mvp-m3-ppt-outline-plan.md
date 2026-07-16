# Local Real MVP M3 PPT Outline Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

M3 的核心需求是让教师在已确认教案之后，得到可保存、可查看、可复制、可确认、可重做的 PPT 大纲与逐页脚本文本。M3 不生成 PPTX 文件，不生成图片，也不把文本大纲包装成已经完成的 PPT 文件。

M3 最小闭环为：

```text
确认公开课教案
-> 生成 PPT 大纲与逐页脚本
-> 查看页面结构、逐页脚本原则、主视觉需求
-> 复制、确认、重做 PPT 大纲
-> 刷新后状态恢复
```

## 2. 可复用方案调研

当前主线已有可复用能力：

- `DeterministicRuntime` 已支持 `ppt_outline` 模板。
- `WorkflowRepository` 已支持节点、artifact 版本、确认、重做和 stale 传播。
- 前端 `ArtifactRail`、`ArtifactSidePanel`、`ArtifactDetailSheet` 已支持查看、复制、确认和重做。
- Stage 3 历史报告已识别 key 映射缺口：runtime 使用 `ppt_outline`，后端 workflow 使用 `ppt_draft`。

## 3. 复用、适配和必要自研

复用：

- 复用 deterministic runtime 的 `ppt_outline` 文本模板。
- 复用后端 `ppt_draft` 节点作为持久化节点，避免大范围迁移已有 workflow key。
- 复用 M2 的 approve 后推进机制和 E2E 真实浏览器路径。

适配：

- 服务端增加明确映射：runtime task `ppt_outline` 保存到 workflow node `ppt_draft`。
- 教师可见标题统一为“PPT 大纲与逐页脚本”，不显示“PPT 草稿”。
- `ppt_draft` 节点标题改为“PPT 大纲”，但保留 key 兼容既有后端合同。
- E2E 增加 PPT 大纲节点查看、复制、确认、重做和刷新恢复。

必要自研：

- 扩展本地 MVP 编排 helper：确认 `lesson_plan` 后生成 `ppt_outline` 内容并保存到 `ppt_draft` 节点。
- 增加 M3 route/orchestration 测试。
- 扩展浏览器 E2E。

## 4. 开发方案、风险和验证标准

执行方案：

1. 写 M3 阶段规划和测试定义。
2. 写失败测试：确认教案后生成 `ppt_draft` 节点上的“PPT 大纲与逐页脚本”。
3. 实现 runtime task 到 workflow node 的 M3 映射。
4. 更新教师可见标题映射，避免出现“PPT 草稿”。
5. 扩展 E2E 到 PPT 大纲查看、复制、确认、重做和刷新恢复。
6. 集中验收：`npm test`、`npm run build`、`npm run test:e2e:stage2`、worker 残留检查。
7. 写 M3 report 并提交。

主要风险：

- 如果直接改 backend key 为 `ppt_outline`，会牵动既有 workflow tests 和后续图片/最终交付依赖，M3 暂不采用。
- 如果教师界面仍显示“PPT 草稿”，会误导用户以为生成了 PPT 文件。
- 如果 deterministic 文案出现 PPTX 已完成表述，会违反 M3 非目标。

验证标准：

- 后端确认教案后保存 `ppt_draft` artifact，标题为“PPT 大纲与逐页脚本”，状态为 `needs_review`。
- 前端显示“PPT 大纲与逐页脚本”，不显示“PPT 草稿”。
- PPT 大纲可查看、复制、确认、重做。
- 刷新后 PPT 大纲状态恢复。
- 用户可见文本不出现“PPTX 已生成”或类似已完成文件表述。
