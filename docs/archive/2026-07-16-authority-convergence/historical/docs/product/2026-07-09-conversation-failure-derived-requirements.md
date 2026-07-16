# 最新对话卡点故障记录与反向需求推导

日期：2026-07-09

状态：故障复盘与需求反推草案，待并入 M61 Agent OS 主线

关联项目记录：本地验收项目 `未命名公开课项目`，用户截图时间段约 15:00-15:16。

## 1. 复盘目的

本文件记录最新本地验收对话中暴露的真实卡点，并从故障现象反推出底层产品与架构需求。目标不是继续补单个按钮或文案，而是把错误沉淀为 M61 Agent OS 的必做需求。

## 2. 关键现象

### 2.1 反复卡在视频资产图

最新对话出现重复失败：

```text
教师：继续下一步
AI：视频资产图需要接入真实图片生成后才能执行，我没有保存占位成果。

教师：生成图片。
AI：视频资产图需要接入真实图片生成后才能执行，我没有保存占位成果。

教师：先生成图片。
AI：视频资产图需要接入真实图片生成后才能执行，我没有保存占位成果。

教师：继续下一步
AI：视频资产图需要接入真实图片生成后才能执行，我没有保存占位成果。
```

### 2.2 PPTX 多次失败但没有转为可用策略

真实 PPTX 生成多次失败，教师界面只能看到：

```text
真实 PPTX 服务暂时没有生成成功，我没有保存占位成果。请稍后重试或检查服务配置。
```

系统没有给出可执行的 fallback，如本地 PPTX、HTML/SVG 转 PPTX、先跳过 PPTX 继续视频或重新生成设计稿。

### 2.3 项目摘要不反映真实进度

侧边栏仍显示 `未命名公开课项目`、阶段停留在较早节点，时间也未准确反映最新对话推进。用户难以判断当前项目真实做到哪里。

## 3. 证据摘要

本地数据库中最新项目存在以下状态：

- 已有多个内容产物：需求规格、教案、PPT 大纲、PPT 设计稿、视频知识锚点、导入创意主题、视频脚本、视频分镜、视频资产说明。
- `asset_image_generate` 被挂为 pending plan 的当前能力。
- `asset_image_generate` 执行层实际被硬拦，返回“需要接入真实图片生成”。
- `pptx` 生成任务多次失败，未产生 `pptx_artifact`。
- pending plan 的 `upstreamAvailable` 中出现了并不存在或未成功的 `pptx_artifact`、`image_prompts`。

## 4. 根因分析

### 4.1 pending plan 死锁

失败后的 pending plan 仍然指向不可执行的 `asset_image_generate`。后续用户输入“继续下一步”“生成图片”“先生成图片”都会被吸入同一个失败工具，而不是触发重新规划。

根因：pending plan 缺少失败态、释放机制和重规划入口。

### 4.2 静态工具表欺骗模型

模型看到 `asset_image_generate` 是可用能力，但执行层实际将其列为不可用/未接入。

根因：能力注册表是静态的，没有暴露运行时健康度、可执行性、输入就绪、最近失败和 fallback。

### 4.3 上下文假记忆

`upstreamAvailable` 通过 deliveryPlan 顺序推导，把前序步骤的 artifact kind 当成已可用输入，没有核验真实 artifact 是否存在、成功、可用或已确认。

根因：上下文编译基于计划而不是事实，计划状态污染模型记忆。

### 4.4 工具失败没有 observation loop

工具失败后直接返回固定教师文案，模型没有拿到结构化失败观察结果，也没有机会选择重试、换路、降级、跳过或追问。

根因：当前是“计划 -> 执行 -> 直接返回”的流程，不是完整 Agent Loop。

### 4.5 图片工具缺少 fallback 路由

系统里存在普通课堂图片工具 `image_asset` 和视频资产图工具 `asset_image_generate`，但二者之间没有桥接逻辑。

根因：工具之间没有 fallback graph，模型也没有看到“视频资产图不可用时，可先用普通图片生成参考图/关键帧草案/资产提示词”。

### 4.6 项目级摘要与事件流缺失

项目标题、更新时间、侧边状态没有跟随消息、artifact、tool failure 更新。

根因：缺少项目事件日志、项目摘要刷新器和当前阶段计算器。

## 5. 从错误反推的新需求

### D1. pending plan 必须有失败态和释放机制

要求：

- pending plan 执行失败后，不能继续保持原样吸收后续输入。
- 应标记为 `failed_retryable`、`failed_blocked` 或 `needs_replan`。
- 后续用户输入应先交给模型判断：重试原工具、切换工具、跳过节点或重新规划。

验收：

- 同一不可用工具失败一次后，用户说“生成图片”不能再次无脑触发原工具。
- UI 应显示“当前卡在视频资产图，可重试、改用普通图片、跳过或重新规划”。

### D2. 工具必须暴露动态健康状态

要求：

每个工具向模型暴露：

```json
{
  "toolId": "asset_image_generate",
  "declared": true,
  "runtimeAvailable": false,
  "blockedReason": "real_image_provider_not_connected",
  "lastFailure": "unsupported_capability",
  "retryable": false,
  "fallbacks": ["image_asset", "asset_brief_generate", "skip_asset_image_generate"]
}
```

验收：

- 模型不能再把不可用工具当成可直接执行工具。
- 工具列表必须区分“已注册”和“当前可执行”。

### D3. 上下文必须从真实 artifact 反推，而不是从计划推断

要求：

- `upstreamAvailable` 只能来自真实存在且状态可用的 artifact。
- deliveryPlan 中 pending 的 artifact kind 不能出现在 `upstreamAvailable`。
- 失败的 `pptx_artifact` 不能被当作上游可用。

验收：

- 若没有真实 `pptx_artifact`，模型上下文中不得写 `pptx_artifact` 已可用。
- 若没有真实 `image_prompts`，视频链路不得声称图片素材已可用。

### D4. 工具失败必须进入模型 observation loop

要求：

工具失败后形成结构化 observation：

```json
{
  "toolId": "coze_ppt",
  "status": "failed",
  "errorType": "external_service_failed",
  "teacherSafeMessage": "真实 PPTX 服务暂时没有生成成功",
  "retryable": true,
  "fallbackOptions": ["local_pptxgen", "html_to_pptx", "regenerate_ppt_design", "skip_pptx_continue_video"]
}
```

然后模型必须再做一次决策。

验收：

- 工具失败后下一条 AI 回复不能只是固定报错，应至少给出重试、fallback 或跳过选项。

### D5. 图片链路需要 fallback graph

要求：

为图片相关能力建立 fallback graph：

```text
asset_image_generate
-> image_asset
-> asset_brief_generate only
-> prompt-only reference pack
-> skip with risk note
```

验收：

- 视频资产图不可用时，系统可建议用普通图片生成参考图，或先生成资产提示词包。
- 用户说“生成图片”时，模型应能澄清是课堂图片还是视频资产图。

### D6. 项目级事件日志和摘要必须更新

要求：

- 每次消息、artifact、tool call、tool failure、pending plan 状态变化都写入项目事件。
- 项目摘要应能显示当前真实阶段、最近失败、下一步建议。
- 侧边栏时间应反映最新活动，而不是仅项目创建时间。

验收：

- 项目侧边栏显示当前卡点，例如“视频资产图失败，可重规划”。
- 项目标题应能从教师需求或已确认规格中自动命名。

### D7. 连续失败应触发卡点检测

要求：

同一工具、同一 pending plan 或同一错误文案连续出现时，系统应触发 `stuck_detector`。

验收：

- 连续两次 `asset_image_generate` unsupported 后，系统不再继续尝试原工具，而是要求重规划或 fallback。

## 6. 推荐纳入 M61 的优先级

| 优先级 | 需求 | 原因 |
| --- | --- | --- |
| P0 | D1 pending plan 失败释放 | 直接解决死循环 |
| P0 | D2 动态工具健康状态 | 防止模型调用不可用工具 |
| P0 | D3 事实型上下文编译 | 防止假记忆 |
| P1 | D4 observation loop | 工具失败后可自修复 |
| P1 | D5 图片 fallback graph | 解决视频资产图卡点 |
| P1 | D7 卡点检测 | 防止重复撞墙 |
| P2 | D6 项目事件日志和摘要 | 改善可理解性和回退基础 |

## 7. 不建议继续的补丁方向

- 不建议继续为 `asset_image_generate` 增加更多固定文案。
- 不建议把用户“生成图片”强行映射到某一个图片工具。
- 不建议继续用 deliveryPlan 顺序推断上游可用产物。
- 不建议失败后保持 pending plan 不变。
- 不建议在没有工具健康状态的情况下继续把所有能力暴露给模型。

## 8. 一句话总结

本次卡点的本质是：系统把不可用工具暴露给模型，失败后不释放 pending plan，又把不存在的上游产物写进上下文，最终导致用户无论如何表达，都会反复撞同一个硬门禁。

因此，M61 必须优先解决：事实型上下文、动态工具健康、pending plan 失败释放、工具 observation loop 和 fallback graph。
