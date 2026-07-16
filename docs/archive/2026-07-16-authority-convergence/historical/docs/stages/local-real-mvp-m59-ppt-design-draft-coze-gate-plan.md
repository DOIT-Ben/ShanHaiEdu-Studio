# M59 PPT 四层设计稿与 Coze 输入门禁计划

## 1. 核心需求

当前 PPT 链路把 `ppt_draft` 同时当作 PPT 大纲、Coze 输入和 PPTX 结果说明，导致语义混乱：上游只解决“分几页、每页讲什么”，却直接交给 Coze 生成可编辑 PPTX。用户明确要求 Coze 的角色只能是“按 PPT 设计稿生成 PPTX”，不能让 Coze 从教案、大纲或模板片段自行理解并设计课件。

M59 的核心需求是把 PPT 链路拆成可验证的三层：

```text
ppt_outline：PPT 页面任务规划，回答分几页、每页教学任务是什么
ppt_design：逐页四层 PPT 设计稿，回答每页怎么画、放什么、写什么、怎么排
coze_ppt：只按逐页四层设计稿生成可编辑 PPTX 文件
```

成功标准：完整交付流程必须在 `coze_ppt` 前生成 `ppt_design_draft`；Coze PPTX 节点只接受 `ppt_design_draft`，且请求正文必须包含逐页 `底图` / `元素` / `文字` / `排版` 四层设计；没有设计稿时必须失败并提示先生成 PPT 设计稿，不能保存轻量 PPTX 或 placeholder 成功产物。

## 2. 可复用方案调研

本项目已有可复用实现：

- `capability-registry.ts` 已定义能力、上游依赖、artifact kind、fallback policy，可新增 `ppt_design` 并调整 `coze_ppt` 上游。
- `capability-planner.ts` 已有完整交付顺序，可插入 `ppt_design`，并用现有 completed artifact kind 机制推进计划。
- `capability-runner.ts`、`AgentRuntime`、`deterministic-runtime.ts`、`openai-runtime.ts` 已支持把 capability 映射为 runtime task 并保存 artifact draft，可扩展一个 `ppt_design` 任务。
- `coze-ppt-run.ts` 已封装 Coze 请求、下载和真实 PPTX 存储，可保留 provider 适配层，只收窄输入源和 prompt 结构。
- `image-generation` / `video-generation` 已有真实 provider adapter 和 artifact 下载模块，可在不改存储结构的情况下增强文件真实性校验。
- M57 已接入 Evolink Grok Imagine 视频 API，API 台账使用 `EVOLINK_VIDEO_*` 命名，本阶段只做兼容读取，不新增密钥文档。

成熟方法复用：采用流水线工件类型隔离和 provider adapter 门禁，避免把同一种 artifact 复用成多个语义；外部 provider 失败时返回失败，不走 placeholder fallback。

## 3. 复用、适配与必要自研

复用：继续沿用现有 `ppt_draft` 保存 PPT 页面任务规划，沿用 Coze PPTX provider、图片 provider、视频 provider、最终包下载与浏览器验收方式。

适配：新增 `ppt_design` capability、`ppt_design_draft` workflow node / artifact kind；完整交付顺序从 `ppt_outline -> coze_ppt` 调整为 `ppt_outline -> ppt_design -> coze_ppt`。`coze_ppt` 的上游能力从 `ppt_outline` 改为 `ppt_design`，输入 schema 从 `ppt_outline` 改为 `ppt_design_draft`。

必要自研：新增 PPT 四层设计稿 runtime guidance 和最小 deterministic draft 模板，用于本地测试和草稿状态；新增 Coze 输入校验函数，拒绝非 `ppt_design_draft`；增强图片/视频真实性校验，至少覆盖 magic bytes、最小体积、可识别基础结构，避免薄文件被当作真实成果。

## 4. 落地方案、风险与验证

落地方案：

- 先写 M59 红灯测试，覆盖能力注册、完整交付顺序、PPT 设计稿 runtime 输出、Coze 输入门禁、Evolink 台账 env 兼容、图片/视频薄文件拒绝。
- 修改 `src/server/workbench/types.ts`、`src/lib/types.ts`，新增 `ppt_design_draft` 类型。
- 修改 `workflow-defaults.ts`、`workbench-mappers.ts`，新增教师可见 PPT 设计稿节点和映射。
- 修改 `capability-registry.ts`、`capability-planner.ts`、`capability-runner.ts`，接入 `ppt_design`。
- 修改 `agent-runtime` 相关文件，让 OpenAI 和 deterministic runtime 都能产出逐页四层设计稿。
- 修改 `conversation-turn-service.ts` 与 Coze route，只从 `ppt_design_draft` 取输入，并把 PPTX 文件保存为清晰的 PPTX 成果语义，不再把普通 PPT 大纲当作 Coze 输入。
- 修改 `coze-ppt-run.ts`，请求正文明确传入逐页四层设计稿。
- 修改图片/视频 artifact 校验与 Evolink env 兼容读取。

风险：

- 本阶段会触及能力编排、runtime、Coze provider 和 artifact 类型，属于跨模块改动，必须用测试锁住行为。
- 现有历史数据里只有 `ppt_draft`，新增 `ppt_design_draft` 后旧项目可能需要重新生成设计稿才能生成 PPTX。
- 图片/视频真实性校验增强后，部分旧薄文件可能从“可下载”变成失败，这是符合产品红线的行为。
- Coze provider 真实 API 仍可能因为外部服务波动失败；失败必须暴露为失败，不允许本地伪造成功 PPTX。

验证标准：

- `node --test "tests/m59-ppt-design-coze-gate.test.mjs"` 通过。
- `node --test "tests/video-smoke-script.test.mjs"` 通过。
- `npm test` 通过。
- `npm run build` exit 0。
- `git diff --check` 无空白错误。
- `graphify update .` 完成。
- 浏览器打开最新服务，完整交付计划可看到 PPT 设计稿步骤；Coze PPTX 生成前可确认存在逐页四层设计稿；下载入口仍可用。
