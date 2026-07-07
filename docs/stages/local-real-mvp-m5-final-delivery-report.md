# Local Real MVP M5 Final Delivery Report

日期：2026-07-07

## 1. 阶段目标

M5 目标是在已确认导入视频方案之后生成最终交付包 Markdown，并支持查看、复制、确认、重做和刷新恢复。本阶段不生成 PPTX 文件、图片文件或视频成片，也不把未完成文件能力包装成已完成。

## 2. 本轮实现

### 2.1 Runtime 与 Workflow key 映射

当前 runtime 任务使用 `final_delivery_checklist`，后端 workflow 保留既有 `final_delivery` 节点。本阶段采用明确映射：

- runtime task：`final_delivery_checklist`
- workflow node：`final_delivery`
- 教师可见标题：`最终交付清单`

这样既复用最终交付节点，又避免新增 workflow key 迁移。

### 2.2 编排推进

扩展 `src\server\workbench\m2-orchestrator.ts`：

- 确认 `intro_video_plan` 后读取 `final_delivery` 的已确认上游输入。
- 需要 `requirement_spec`、`lesson_plan`、`ppt_draft`、`intro_video_plan` 均已确认。
- 运行 deterministic `final_delivery_checklist`。
- 将产物保存到 `final_delivery` 节点。
- 保留幂等检查，避免重复确认产生重复最终交付清单。

### 2.3 上游输入

更新 `src\server\workbench\workflow-defaults.ts`：

- `final_delivery` 上游从 `lesson_plan`、`ppt_draft`、`intro_video_plan` 扩展为 `requirement_spec`、`lesson_plan`、`ppt_draft`、`intro_video_plan`。
- 这样最终交付清单能明确汇总需求规格、教案、PPT 大纲与导入视频方案。

### 2.4 浏览器路径

扩展 `tests\e2e\stage2-deterministic.spec.ts`：

- 在 M1 + M2 + M3 + M4 路径后确认导入视频方案。
- 验证最终交付清单生成。
- 打开详情，验证已形成材料、待确认事项和未生成文件能力标记。
- 验证复制、确认、重做和刷新恢复。
- 验证页面不出现“PPTX 文件已生成”“图片文件已生成”“视频成片已生成”。

## 3. TDD 与调试记录

新增 `src\server\workbench\__tests__\stage11-m5-final-delivery.test.ts`。

红灯：

- 初始化 `.tmp\test-workbench.db` 后运行目标测试，测试因 `final_delivery` 为 `undefined` 失败，证明确认导入视频方案后尚未生成最终交付清单。

绿灯：

- 接入 `intro_video_plan -> final_delivery_checklist -> final_delivery` 编排后，目标测试通过。

E2E 调试：

- 首次 M5 E2E 失败原因是同一句 Markdown 同时出现在预览和详情中，Playwright 严格模式匹配到两个元素。
- 修复方式是将该断言收窄为 `.first()`，不改业务代码。
- 重跑同一 E2E 后通过。

## 4. 验收记录

| 命令 | 结果 | 关键证据 |
| --- | --- | --- |
| `npx vitest run src/server/workbench/__tests__/stage11-m5-final-delivery.test.ts --maxWorkers=1` | 红灯后绿灯 | 初始化测试库后因未生成 `final_delivery` 失败；接入 M5 编排后通过 |
| `npm test` | 通过 | Node 9 tests passed；Vitest 15 files / 68 tests passed |
| `npm run build` | 通过 | Prisma Client 生成成功；Next.js 编译、TypeScript、静态页面生成均通过 |
| `npm run test:e2e:stage2` | 通过 | Chromium desktop 1 passed；覆盖 M1 + M2 + M3 + M4 + M5 浏览器闭环 |
| worker 残留检查 | 通过 | 未发现 Vitest、Jest 或 Playwright 残留 Node 进程 |
| `git diff --check` | 通过 | 无空白错误；仅有工作区换行提示 |
| M5 变更敏感信息扫描 | 通过 | 未命中密钥、token 或私钥文件特征 |

## 5. 风险与边界

- M5 只生成最终交付包 Markdown，不生成 PPTX、图片文件、视频成片或下载文件。
- 本阶段以复制 Markdown 满足“下载或复制 Markdown”的最小要求。
- 浏览器验收仍只覆盖 Chromium desktop，窄屏和多浏览器待后续阶段验证。
- 真实 OpenAI/provider smoke、多人并发验证仍在 M6/M7。

## 6. 审查结论

M5 通过。当前主线已经能从一句话需求连续推进到需求规格、教材证据包、公开课教案、PPT 大纲与逐页脚本、导入视频方案、最终交付清单 Markdown，并支持真实后端保存、查看、复制、确认、重做和刷新恢复。

提交前审查范围仅包含 M5 文档、M5 后端编排测试、final delivery 映射、最终交付上游配置和 Stage 2 浏览器闭环测试。

下一阶段可进入 M6：真实 OpenAI smoke。
