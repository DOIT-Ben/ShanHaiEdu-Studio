# Local Real MVP M3 PPT Outline Report

日期：2026-07-07

## 1. 阶段目标

M3 目标是在已确认教案之后生成 PPT 大纲与逐页脚本文本，并支持查看、复制、确认、重做和刷新恢复。本阶段不生成 PPTX 文件，不生成图片，也不把文本大纲伪装成已完成 PPT 文件。

## 2. 本轮实现

### 2.1 Runtime 与 Workflow key 映射

当前 runtime 任务使用 `ppt_outline`，后端 workflow 仍保留既有 `ppt_draft` 节点。为避免大范围迁移，本阶段采用明确映射：

- runtime task：`ppt_outline`
- workflow node：`ppt_draft`
- 教师可见标题：`PPT 大纲与逐页脚本`

这样既能复用已有后端节点、版本、确认、重做和 stale 传播能力，又不会在教师界面显示“PPT 草稿”或暗示已生成 PPTX 文件。

### 2.2 编排推进

扩展 `src\server\workbench\m2-orchestrator.ts`：

- 确认 `lesson_plan` 后运行 deterministic `ppt_outline`。
- 将产物保存到 `ppt_draft` 节点。
- 产物标题为“PPT 大纲与逐页脚本”，状态为 `needs_review`。
- 保留幂等检查，避免重复确认产生重复草稿。

### 2.3 教师可见标题

更新：

- `src\server\workbench\workflow-defaults.ts`：`ppt_draft` 节点标题改为“PPT 大纲”。
- `src\lib\workbench-mappers.ts`：`ppt_draft` 映射为“PPT 大纲”。
- `src\components\artifacts\ArtifactNodeCard.tsx`：补齐“PPT 大纲”和“PPT 大纲与逐页脚本”的图标映射。

### 2.4 浏览器路径

扩展 `tests\e2e\stage2-deterministic.spec.ts`：

- 在 M1 + M2 路径后确认教案。
- 验证 PPT 大纲与逐页脚本生成。
- 打开详情，验证页面结构和主视觉需求。
- 验证复制、确认、重做和刷新恢复。
- 验证页面不出现“PPTX 文件已生成”。

## 3. 验收记录

| 命令 | 结果 | 关键证据 |
| --- | --- | --- |
| `npx vitest run src/server/workbench/__tests__/stage9-m3-ppt-outline.test.ts --maxWorkers=1` | 红灯后绿灯 | 确认教案后无 PPT 大纲失败，接入 M3 映射后通过 |
| `npm test` | 通过 | Node 9 tests passed；Vitest 13 files / 66 tests passed |
| `npm run build` | 通过 | Prisma Client 生成成功；Next.js 编译、TypeScript、静态页面生成均通过 |
| `npm run test:e2e:stage2` | 通过 | Chromium desktop 1 passed；覆盖 M1 + M2 + M3 浏览器闭环 |
| worker 残留检查 | 通过 | 未发现 Vitest、Jest 或 Playwright 残留 Node 进程 |
| `git diff --check` | 通过 | 无空白错误；仅有工作区换行提示 |
| M3 变更敏感信息扫描 | 通过 | 未命中密钥、token 或私钥文件特征 |

## 4. 风险与边界

- M3 只生成文本大纲与逐页脚本，不生成 PPTX 文件。
- 浏览器验收仍只覆盖 Chromium desktop，窄屏和多浏览器待后续阶段验证。
- 后端 key 仍为 `ppt_draft`，这是兼容既有 workflow 的内部实现；教师界面显示为 PPT 大纲。
- 图片提示词、导入视频方案和最终交付包仍在后续 M4/M5。

## 5. 审查结论

M3 通过。当前主线已经能从一句话需求连续推进到需求规格、教材证据包、公开课教案、PPT 大纲与逐页脚本文本闭环，并支持真实后端保存、查看、复制、确认、重做和刷新恢复。

提交前审查未发现阻塞问题；本阶段仅修改 M3 文档、M3 后端编排测试、PPT 大纲映射、工作流默认标题和 Stage 2 浏览器闭环测试。

下一阶段可进入 M4：导入视频方案文本闭环。
