# M55 并发子智能体派发单

日期：2026-07-08

上游规划：

- `docs/stages/local-real-mvp-m55-agentic-delivery-fast-path-plan.md`

## 派发总原则

- 所有 worker 都在 `E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\main` 工作。
- 不要回滚他人改动。
- 不要删除旧文件。
- 不要改自己职责外的模块。
- 每个 worker 完成后必须报告：改动文件、测试命令、通过/失败、剩余风险。
- 主 Codex 负责最终集成、冲突处理、全量验收和提交。

## Worker 1：主 Agent 多步计划

任务：

- 给 `MainAgentTurn` 增加多步 `deliveryPlan` 合同。
- 让复合需求能规划：`requirement_spec -> lesson_plan -> ppt_outline -> coze_ppt -> image_asset -> intro_video -> final_package`。
- 普通聊天和探索仍不得触发工具。

写入范围：

- `src/server/capabilities/types.ts`
- `src/server/capabilities/capability-planner.ts`
- `src/server/conversation/main-conversation-agent.ts`
- `tests/main-conversation-agent.test.ts`
- `tests/capability-planner.test.ts`

验证：

```text
npx vitest run tests/main-conversation-agent.test.ts tests/capability-planner.test.ts --maxWorkers=1
```

## Worker 2：文本链路自动执行

任务：

- 确认后自动执行文本链：`requirement_spec -> lesson_plan -> ppt_outline -> intro_video_plan -> final_delivery`。
- 每步保存 artifact。
- 失败保留已完成产物并返回可继续状态。

写入范围：

- `src/server/conversation/conversation-turn-service.ts`
- `src/server/capabilities/capability-runner.ts`
- `src/server/workflow-checkpoints/*`
- `tests/conversation-turn-service.test.ts`
- `tests/capability-runner.test.ts`
- `tests/agentic-delivery-flow.test.ts`

验证：

```text
npx vitest run tests/conversation-turn-service.test.ts tests/capability-runner.test.ts tests/agentic-delivery-flow.test.ts --maxWorkers=1
```

## Worker 3：Coze PPT adapter

任务：

- 新增或完善 `coze_ppt` adapter。
- 有 PPT 大纲时调用 Coze PPT 路径。
- 未配置 provider 时返回 failed/retryable。
- 成功时保存 PPTX 下载引用。

写入范围：

- `src/server/capabilities/adapters/coze-ppt-adapter.ts`
- `src/server/capabilities/capability-runner.ts` 中仅限 adapter 注册点
- `src/server/coze-ppt/*`
- `tests/coze-ppt*.test.mjs`
- `tests/capability-runner.test.ts` 中仅限 Coze 用例

验证：

```text
node --test tests/coze-ppt*.test.mjs
npx vitest run tests/capability-runner.test.ts --maxWorkers=1
```

## Worker 4：图片资产 adapter

任务：

- 新增 `image_asset` adapter。
- 基于 PPT 大纲或视频分镜生成图片提示词。
- provider 可用时保存真实图片引用。
- provider 不可用时保存 failed/retryable。

写入范围：

- `src/server/capabilities/adapters/image-asset-adapter.ts`
- `src/server/capabilities/capability-runner.ts` 中仅限 adapter 注册点
- `src/server/image-generation/*`
- `tests/image*.test.mjs`
- `tests/capability-runner.test.ts` 中仅限图片用例

验证：

```text
node --test tests/image*.test.mjs
npx vitest run tests/capability-runner.test.ts --maxWorkers=1
```

## Worker 5：视频工作流 adapter

任务：

- 新增 `intro_video` adapter。
- 支持导入视频方案、分镜提示词、视频任务状态和结果引用。
- 图片资产依赖先用 artifact 引用或提示词引用，不强耦合 Worker 4。
- provider 不可用时保存 failed/retryable。

写入范围：

- `src/server/capabilities/adapters/intro-video-adapter.ts`
- `src/server/capabilities/capability-runner.ts` 中仅限 adapter 注册点
- `src/server/video-generation/*`
- `tests/video*.test.mjs`
- `tests/capability-runner.test.ts` 中仅限视频用例

验证：

```text
node --test tests/video*.test.mjs
npx vitest run tests/capability-runner.test.ts --maxWorkers=1
```

## Worker 6：前端多结果展示

任务：

- 展示后端 `deliveryPlan`。
- 对话区展示执行计划卡和每步结果。
- 糖葫芦产物轨展示 PPT、图片、视频、最终交付。
- 保留 quick replies 填入不自动发送。
- 教师端不得出现工程词。

写入范围：

- `src/lib/types.ts`
- `src/lib/workbench-api.ts`
- `src/lib/workbench-mappers.ts`
- `src/components/conversation/ChatTranscript.tsx`
- `src/components/conversation/messages/*`
- `src/components/artifacts/*`
- `tests/m54a-frontend-workbench-contract.test.ts`
- `tests/m49-chat-scroll-and-delight.test.mjs`
- `tests/m52-semi-auto-conversation-gate.test.mjs`

验证：

```text
node --test tests/m49-chat-scroll-and-delight.test.mjs tests/m52-semi-auto-conversation-gate.test.mjs
npx vitest run tests/m54a-frontend-workbench-contract.test.ts --maxWorkers=1
```

## Reviewer A：规格审查

输入：

- M55 总规划。
- 当前 diff。
- worker final reports。

检查：

- 是否满足“一句话 -> 多步计划 -> 多产物展示”。
- 是否有 provider 失败伪成功。
- 是否有普通聊天误触发。

## Reviewer B：代码质量审查

检查：

- route 是否保持薄入口。
- capability/adapter/runner 边界是否清楚。
- 是否有大文件继续膨胀。
- 是否引入 React 直接调 SDK。

## Reviewer C：产品体验审查

检查：

- 浏览器端到端可用。
- 教师界面是否自然。
- 糖葫芦是否保留。
- 执行计划和失败态是否能看懂。
- 是否暴露工程词。
