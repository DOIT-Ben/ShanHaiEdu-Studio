# Local Real MVP M4 Intro Video Report

日期：2026-07-07

## 1. 阶段目标

M4 目标是在已确认 PPT 大纲与逐页脚本之后生成导入视频方案文本，并支持查看、复制、确认、重做和刷新恢复。本阶段不生成视频文件、不生成图片、不生成分镜成片，也不把文本策划卡伪装成已完成视频。

## 2. 本轮实现

### 2.1 编排推进

扩展 `src\server\workbench\m2-orchestrator.ts`：

- 确认 `ppt_draft` 后读取 `intro_video_plan` 的已确认上游输入。
- 确认存在已确认 `lesson_plan` 后运行 deterministic `intro_video_plan`。
- 将产物保存到 `intro_video_plan` 节点。
- 保留幂等检查，避免重复确认产生重复方案。

本轮把 `ppt_draft` 确认作为顺序触发点，但导入视频方案内容仍以已确认教案作为课程锚点来源，避免视频方案变成 PPT 页面附属说明。

### 2.2 导入视频文本字段

更新 `src\server\agent-runtime\deterministic-runtime.ts`：

- 保留“独立主题”和“课程锚点”。
- 补齐“开场钩子与吸睛点”显式章节。
- 强化“第一句话只提出问题，不解释知识点定义、公式或解题步骤”的边界。

### 2.3 浏览器路径

扩展 `tests\e2e\stage2-deterministic.spec.ts`：

- 在 M1 + M2 + M3 路径后确认 PPT 大纲。
- 验证导入视频方案生成。
- 打开详情，验证独立主题、开场钩子与吸睛点、课程锚点、课堂落点问题。
- 验证复制、确认、重做和刷新恢复。
- 验证页面不出现“视频文件已生成”或“视频成片已生成”。

## 3. TDD 记录

新增 `src\server\workbench\__tests__\stage10-m4-intro-video-plan.test.ts`。

红灯：

- 初次直接跑目标测试时，失败原因是测试库未初始化，属于无效红灯。
- 初始化 `.tmp\test-workbench.db` 后重跑，测试因 `intro_video_plan` 为 `undefined` 失败，证明确认 PPT 大纲后尚未生成导入视频方案。

绿灯：

- 接入 `ppt_draft -> intro_video_plan` 编排后，目标测试通过。

## 4. 验收记录

| 命令 | 结果 | 关键证据 |
| --- | --- | --- |
| `npx vitest run src/server/workbench/__tests__/stage10-m4-intro-video-plan.test.ts --maxWorkers=1` | 红灯后绿灯 | 初始化测试库后因未生成 `intro_video_plan` 失败；接入 M4 编排后通过 |
| `npm test` | 通过 | Node 9 tests passed；Vitest 14 files / 67 tests passed |
| `npm run build` | 通过 | Prisma Client 生成成功；Next.js 编译、TypeScript、静态页面生成均通过 |
| `npm run test:e2e:stage2` | 通过 | Chromium desktop 1 passed；覆盖 M1 + M2 + M3 + M4 浏览器闭环 |
| worker 残留检查 | 通过 | 未发现 Vitest、Jest 或 Playwright 残留 Node 进程 |
| `git diff --check` | 通过 | 无空白错误；仅有工作区换行提示 |
| M4 变更敏感信息扫描 | 通过 | 未命中密钥、token 或私钥文件特征 |

## 5. 风险与边界

- M4 只生成文本导入视频方案，不生成视频文件、图片、分镜成片或视频 URL。
- 浏览器验收仍只覆盖 Chromium desktop，窄屏和多浏览器待后续阶段验证。
- 导入视频方案的唯一课程连接是课程锚点；不得把视频写成知识点前置讲解。
- 图片提示词、视频分镜和最终交付包仍在后续阶段。

## 6. 审查结论

M4 通过。当前主线已经能从一句话需求连续推进到需求规格、教材证据包、公开课教案、PPT 大纲与逐页脚本、导入视频方案文本闭环，并支持真实后端保存、查看、复制、确认、重做和刷新恢复。

提交前审查范围仅包含 M4 文档、M4 后端编排测试、deterministic 导入视频模板、M4 编排和 Stage 2 浏览器闭环测试。

下一阶段可进入 M5：最终交付包 Markdown。
