# E2E Verification Stage 3 Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

Stage 3 的目标是验证多节点文本链路，而不是重复 Stage 2 的需求规格最小闭环。可通过路径必须证明同一项目内至少能按顺序生成并保存：

```text
需求规格
-> 教材证据
-> 教案
-> PPT 大纲
-> 导入视频方案
-> 图片/分镜提示
-> 最终交付清单
```

每个节点都必须具备：

- 后端可识别的任务或节点 key。
- Runtime 可生成对应 Markdown artifact。
- API 能保存 artifact，并在 snapshot 中返回。
- 前端右侧节点能显示、打开详情、确认或重做。
- 刷新后节点状态和 artifact 不丢。

Stage 3 不以“写一个更长的 deterministic 文本”作为通过标准；必须是多节点状态链路。

## 2. 可复用方案调研

可复用：

- Stage 2 的 API-backed Playwright 运行器：`scripts\run-stage2-e2e.mjs` 的独立 SQLite 测试库模式。
- Stage 2 的红线扫描：`tests\e2e\support\redline.ts`。
- Agent Runtime Adapter 已有任务：`requirement_spec`、`textbook_evidence`、`lesson_plan`、`ppt_outline`、`intro_video_plan`、`final_delivery_checklist`。
- Backend Workflow Lite 已有节点：`requirement_spec`、`textbook_evidence`、`lesson_plan`、`ppt_draft`、`intro_video_plan`、`image_prompts`、`video_storyboard`、`final_delivery`。

当前差异：

- Runtime 的 `ppt_outline` / `final_delivery_checklist` 与后端节点 `ppt_draft` / `final_delivery` 尚未有明确映射。
- Stage 2 消息 API 只硬编码生成 `requirement_spec`，没有根据已确认上游推进到下一个节点。
- 当前没有多节点浏览器 E2E；直接写浏览器用例会先撞上业务链路缺口。

## 3. 复用、适配和必要自研

复用 Stage 2 的运行器和红线扫描，但 Stage 3 先新增独立 preflight：

- `scripts\e2e-stage3-preflight.mjs`：只读检查多节点链路前置条件。
- `test:e2e:stage3:preflight`：输出 JSON，列出缺失能力、归属主线和是否可由 E2E 主线绕过。

必要时再新增 browser E2E：

- 只有 preflight 通过，才新增 `tests\e2e\stage3-multinode.spec.ts`。
- 若 preflight 不通过，写 blocker report，不用 Stage 2 单节点测试冒充 Stage 3。

## 4. 开发方案、风险和验证标准

阶段步骤：

1. 写 Stage 3 规划文档和测试计划。
2. 新增 Stage 3 preflight 脚本与 npm 命令。
3. 运行 `npm run test:e2e:stage3:preflight`。
4. 若通过，写多节点 browser E2E 并集中运行 `npm run build`、`npm run test:e2e:stage3`。
5. 若失败，写 Stage 3 blocker report，归因到 Backend Workflow Lite、Agent Runtime Adapter、Frontend API-backed Workbench 或 E2E Verification。

风险：

- 跨主线缺口不能由 E2E 主线越界重写，否则会把验收主线变成业务实现主线。
- Runtime task key 与 workflow node key 不一致时，E2E 必须先记录合同需求。
- deterministic 输出只能证明稳定链路，不代表真实 OpenAI 质量。

Stage 3 通过标准：

- `npm run test:e2e:stage3:preflight` exit 0。
- `npm run test:e2e:stage3` 覆盖至少 5 个文本节点的生成、显示、详情、确认、刷新恢复。
- 教师可见文本不命中工程词。
- 失败时保留 Playwright trace/screenshot 或 JSON blocker，能定位归属主线。

当前建议：先执行 preflight；若发现跨主线缺口，形成真实阻塞而不是伪造多节点通过。
