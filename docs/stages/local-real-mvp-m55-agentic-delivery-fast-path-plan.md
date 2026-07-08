# M55 Agentic Delivery Fast Path 并发开发总规划

日期：2026-07-08

状态：正式阶段规划。本文用于 M54 之后的“大步开发”阶段，目标是先把一句话驱动完整交付链路跑通，再逐步优化质量。

## 1. 阶段目标

把 ShanHaiEdu 从“能聊天、能生成第一个文本产物”推进到：

```text
教师一句话提出交付需求
-> MainConversationAgent 自然理解
-> CapabilityRegistry 暴露可用业务能力
-> CapabilityPlanner 生成多步工具计划
-> HumanGate 做必要确认
-> CapabilityRunner 串联或并发调用工具
-> 各工具产物真实回写项目
-> 前端对话区和右侧糖葫芦同步展示
-> 最终交付包可查看、可下载或可复制
```

第一版不要求 PPT、图片、视频质量完美，但要求所有节点“真实执行或诚实失败”，并且每个结果都能展示到前端。

## 2. 指挥原则

### 2.1 目的优先

本阶段不追求小步精修，优先让主链路能跑：

- 模型能力先释放，不再用 route 模板限制主 Agent。
- 工具可以先粗糙，但必须以 Capability 形式注册。
- 前端可以先展示草稿，但必须能看见每个工具结果。
- provider 未配置或失败时必须展示可理解失败态，不伪装成功。

### 2.2 并发开发原则

可以同时派 5-6 个实现智能体，但每个智能体必须拥有互不冲突的写入范围。

主 Codex 只做：

- 总架构控制。
- 任务拆分。
- 合同测试维护。
- 集成冲突处理。
- 最终验收和提交。

子智能体只做：

- 单一能力或单一前端区域。
- 明确文件范围内的代码和测试。
- 不改全局架构，不重写其他智能体负责的模块。
- 不回滚他人改动。

### 2.3 评审机制

每个大阶段完成后，开 2-3 个审查智能体并行评审：

1. **规格审查智能体**：检查是否满足本文和对应任务包。
2. **代码质量审查智能体**：检查边界、屎山、类型、错误处理。
3. **产品/浏览器审查智能体**：检查教师端可见体验、工程词、端到端可用性。

评审通过后才进入下一大阶段。

## 3. 当前基线

M54 已形成第一层接线：

- `MainConversationAgent` 能区分闲聊、探索、明确业务需求。
- `CapabilityRegistry / CapabilityPlanner / CapabilityRunner` 已有最小合同。
- `ConversationTurnService` 已接管 `messages` route。
- `/messages` 响应已有 `agentTurn`。
- 前端 `sendMessage` 已能保留后端 quick replies。
- 问候不会触发产物，明确 PPT 需求会给确认建议。
- 确认后可生成并保存 `requirement_spec`。

M55 继续推进，不再把 `requirement_spec` 作为终点。

## 4. M55 大阶段拆分

### M55-A 主 Agent 多步计划释放

目标：主 Agent 能从一句话生成完整交付计划，而不是只返回单个 capability。

期望链路：

```text
帮我做五年级数学百分数公开课 PPT、图片和导入视频
-> 计划：
   1. requirement_spec
   2. lesson_plan
   3. ppt_outline
   4. coze_ppt
   5. image_asset
   6. intro_video
   7. final_package
```

必须输出：

- `agentTurn.toolPlan`
- `agentTurn.deliveryPlan`
- 每步 capability 状态：`pending / awaiting_confirmation / running / succeeded / failed`
- next quick replies：确认执行、补充要求、先只生成文本链路。

建议写入范围：

- `src/server/capabilities/types.ts`
- `src/server/capabilities/capability-planner.ts`
- `src/server/conversation/main-conversation-agent.ts`
- `src/server/conversation/conversation-turn-service.ts`
- `tests/main-conversation-agent.test.ts`
- `tests/capability-planner.test.ts`
- `tests/conversation-turn-service.test.ts`

验收：

```text
npx vitest run tests/main-conversation-agent.test.ts tests/capability-planner.test.ts tests/conversation-turn-service.test.ts --maxWorkers=1
```

### M55-B 文本链路一口气跑通

目标：确认后自动连续生成文本节点：

```text
requirement_spec -> lesson_plan -> ppt_outline -> intro_video_plan -> final_delivery
```

第一版可串行执行，后续再优化并发。

必须做到：

- 每个文本产物保存为 artifact。
- 每个 artifact 有 `capabilityId`、`providerStatus`、`generationMode`。
- 对话区出现简明总结。
- 糖葫芦节点全部更新。
- 任一步失败时保留已完成产物，返回可继续动作。

建议写入范围：

- `src/server/capabilities/capability-runner.ts`
- `src/server/conversation/conversation-turn-service.ts`
- `src/server/workflow-checkpoints/*`
- `src/server/agent-runtime/*` 如需补 runtime task 映射
- `tests/capability-runner.test.ts`
- `tests/conversation-turn-service.test.ts`
- `tests/stage41` 或新增 `tests/agentic-delivery-flow.test.ts`

验收：

```text
npx vitest run tests/capability-runner.test.ts tests/conversation-turn-service.test.ts tests/agentic-delivery-flow.test.ts --maxWorkers=1
```

### M55-C Coze PPT 能力接入

目标：把 `coze_ppt` 注册为真实外部能力，并在已有 PPT 大纲后生成 PPTX artifact。

必须做到：

- 未配置 Coze 时返回 `failed`，不伪装成功。
- 配置齐全时调用现有 Coze PPT API 封装。
- 成功后 artifact 带下载信息。
- 前端在 PPT 节点上显示“可下载 PPTX”。
- 失败时前端显示“PPTX 生成暂时不可用，可以先查看 PPT 大纲”。

建议写入范围：

- `src/server/capabilities/adapters/coze-ppt-adapter.ts`
- `src/server/capabilities/capability-runner.ts`
- `src/server/coze-ppt/*`
- `src/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/coze-ppt/route.ts`
- `tests/coze-ppt*.test.mjs`
- `tests/capability-runner.test.ts`

验收：

```text
node --test tests/coze-ppt*.test.mjs
npx vitest run tests/capability-runner.test.ts --maxWorkers=1
```

### M55-D 图片资产能力

目标：生成课堂图片素材，并把图片 artifact 展示到前端。

必须做到：

- `image_asset` 能基于 PPT 大纲或导入视频分镜生成图片提示词。
- provider 可用时保存真实图片。
- provider 不可用时保存失败状态和可重试信息。
- 图片节点展示缩略图或下载/查看入口。

建议写入范围：

- `src/server/capabilities/adapters/image-asset-adapter.ts`
- `src/server/image-generation/*`
- `src/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/image/route.ts`
- `src/components/artifacts/*` 图片展示相关组件
- `tests/image*.test.mjs`
- `tests/capability-runner.test.ts`

验收：

```text
node --test tests/image*.test.mjs
npx vitest run tests/capability-runner.test.ts --maxWorkers=1
```

### M55-E 视频工作流能力

目标：把导入视频链路拆成“方案 -> 分镜 -> 图片资产 -> 视频片段 -> 最终视频引用”，先跑通再优化质量。

第一版允许：

- 视频 provider 未配置时保存可读失败态。
- 只生成单段视频或占位结果，但必须诚实标记。
- 如果有真实 provider，则保存真实任务状态和结果 URL/文件引用。

必须做到：

- `intro_video` 不只是一段文案，而是能形成视频工作流状态。
- 分镜提示词可展示。
- 图片资产和视频任务能关联。
- 前端视频节点能展示分镜、任务状态、结果或失败原因。

建议写入范围：

- `src/server/capabilities/adapters/intro-video-adapter.ts`
- `src/server/video-generation/*`
- `src/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/video/route.ts`
- `src/components/artifacts/*` 视频展示相关组件
- `tests/video*.test.mjs`
- `tests/capability-runner.test.ts`

验收：

```text
node --test tests/video*.test.mjs
npx vitest run tests/capability-runner.test.ts --maxWorkers=1
```

### M55-F 前端执行态与全结果展示

目标：对话区和糖葫芦产物轨能展示所有工具执行结果。

必须做到：

- 对话中显示“执行计划卡”：每一步状态、成功/失败、可展开详情。
- 每个 assistant 回复保留后端 quick replies。
- 糖葫芦节点不消失，能显示 PPT、图片、视频、最终交付。
- 产物详情支持 Markdown、图片、视频/PPT 下载引用。
- 工程词不出现在教师可见 UI。

建议写入范围：

- `src/lib/types.ts`
- `src/lib/workbench-api.ts`
- `src/lib/workbench-mappers.ts`
- `src/components/conversation/ChatTranscript.tsx`
- `src/components/conversation/messages/*`
- `src/components/artifacts/*`
- `tests/m54a-frontend-workbench-contract.test.ts`
- `tests/m49-chat-scroll-and-delight.test.mjs`
- `tests/m52-semi-auto-conversation-gate.test.mjs`

验收：

```text
node --test tests/m49-chat-scroll-and-delight.test.mjs tests/m52-semi-auto-conversation-gate.test.mjs
npx vitest run tests/m54a-frontend-workbench-contract.test.ts --maxWorkers=1
```

## 5. 并发子智能体分配

### Worker 1：主 Agent 与多步计划

职责：

- 扩展 `CapabilityToolPlan` 为多步 `DeliveryPlan`。
- 让明确复合需求返回完整交付计划。
- 不执行 provider。

禁止：

- 不改前端。
- 不接 Coze/图片/视频 provider。

### Worker 2：文本链路 runner

职责：

- 让确认后可跑 `requirement_spec -> lesson_plan -> ppt_outline -> intro_video_plan -> final_delivery`。
- 保存每个 artifact。
- 写最小 checkpoint。

禁止：

- 不改 provider。
- 不改 UI 视觉。

### Worker 3：Coze PPT

职责：

- 接 `coze_ppt` adapter。
- 验证未配置失败、配置成功、artifact 下载信息。

禁止：

- 不改主 Agent。
- 不改图片/视频。

### Worker 4：图片资产

职责：

- 接 `image_asset` adapter。
- 生成图片提示词、调用图片 provider、保存图片 artifact 或失败态。

禁止：

- 不改视频 provider。
- 不改主 Agent。

### Worker 5：视频工作流

职责：

- 接 `intro_video` adapter。
- 建立视频方案、分镜、图片依赖、视频任务状态。

禁止：

- 不改 Coze PPT。
- 不改通用前端布局。

### Worker 6：前端结果展示

职责：

- 展示执行计划卡。
- 展示每个工具结果。
- 展示图片/PPT/video 引用和失败态。
- 保持糖葫芦和对话区同步。

禁止：

- 不改后端 provider。
- 不改后端工具调度。

## 6. 审查智能体分配

每个大阶段完成后并行开：

### Reviewer A：规格审查

检查：

- 是否满足 M55 对应阶段目标。
- 是否把失败伪装成功。
- 是否误触发 provider。
- 是否遗漏测试。

### Reviewer B：代码质量审查

检查：

- route 是否重新变成业务大脑。
- React 是否直接调模型 SDK。
- 文件是否过度膨胀。
- capability 边界是否清楚。

### Reviewer C：产品体验审查

检查：

- 教师端是否看得懂。
- 是否暴露工程词。
- 对话是否像模型聊天。
- 右侧糖葫芦是否一直可用。
- 浏览器端到端是否能跑。

## 7. 主线验收

M55 阶段集中验收命令：

```text
npm test
npm run build
git diff --check
npm run test:e2e:stage2:preflight
```

浏览器验收：

```text
http://127.0.0.1:3002
```

必须手动或自动验证：

1. 无项目时输入一句话，会自动建项目并发送。
2. “你好”只聊天，不生成 artifact。
3. “帮我做五年级数学百分数 PPT、图片和导入视频”返回完整执行计划。
4. 点击“确认开始”后，文本链路产物全部出现。
5. PPTX provider 未配置时显示失败态；配置时生成下载引用。
6. 图片 provider 未配置时显示失败态；配置时图片可预览或下载。
7. 视频 provider 未配置时显示失败态；配置时视频任务/结果可展示。
8. 最终交付包可查看、复制或下载。
9. 刷新后项目、消息、产物状态不丢。

## 8. Commit 分组

建议分组：

1. `规划: M55 智能体交付快路径并发开发计划 | 2026-07-08 HH:mm`
2. `开发: 释放主 Agent 多步交付计划 | 2026-07-08 HH:mm`
3. `开发: 跑通文本产物交付链路 | 2026-07-08 HH:mm`
4. `开发: 接入 PPT 图片视频能力适配器 | 2026-07-08 HH:mm`
5. `开发: 展示执行计划与多模态产物 | 2026-07-08 HH:mm`
6. `验收: 补齐端到端交付验证与上线准备记录 | 2026-07-08 HH:mm`

## 9. 风险与回退

| 风险 | 表现 | 回退 |
| --- | --- | --- |
| 并发开发冲突 | 多个 worker 改同一文件 | 主 Codex 分配互斥写入范围，冲突由主线统一集成 |
| 主 Agent 过度自动执行 | 用户闲聊也跑工具 | evalset 和 route 测试阻断，普通聊天 tool plan 必须为空 |
| provider 未配置 | PPT/图片/视频失败 | 保存 failed/retryable 状态，不伪装成功 |
| 前端展示过载 | 对话区堆大量工程信息 | 执行计划卡只展示教师可读步骤，详情再展开 |
| 端到端链路太长 | 一次确认耗时过长 | 先串行文本链路，真实外部 provider 分阶段确认或后台任务 |

## 10. 下一步执行门

Stage: `products-writing-plans`

Recommendation: `go`

Gate: `continue`

下一步进入并发执行：

1. 主 Codex 先完成 M55-A/M55-B 的合同测试骨架。
2. 同时派 Worker 3/4/5 探查并接入 Coze、图片、视频 adapter。
3. 派 Worker 6 做前端执行计划和多结果展示。
4. 主 Codex 集成后跑全量验收。
5. 开 2-3 个 reviewer 做规格、代码、产品审查。
