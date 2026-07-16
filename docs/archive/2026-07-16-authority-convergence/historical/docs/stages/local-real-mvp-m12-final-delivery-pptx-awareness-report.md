# Local Real MVP M12 最终交付清单识别 PPTX 下载能力报告

日期：2026-07-07

## 1. 阶段目标

M12 目标是统一 M11 后的产品口径：最终交付清单应知道“PPT 大纲可下载最小 PPTX 文件”，同时继续明确图片文件、视频成片、动画和视觉精修仍未完成。

本阶段不新增文件下载入口、不改变 workflow 节点、不生成图片或视频。

## 2. 红灯记录

先更新测试再实现：

- `src\server\workbench\__tests__\stage11-m5-final-delivery.test.ts`
  - 新增断言：最终交付 Markdown 必须包含“PPT 大纲可下载最小 PPTX 文件”。
  - 新增断言：必须包含“图片文件、视频成片、动画和视觉精修仍待生成或完善”。
- `tests\artifact-markdown-download.test.mjs`
  - 下载样例更新为 M12 口径。
- `tests\e2e\stage2-deterministic.spec.ts`
  - 最终交付详情页和 Markdown 下载都检查 M12 口径。

红灯记录：

- 第一次直接跑 Vitest 目标用例失败于测试库未初始化，属于前置环境缺失。
- 初始化 `.tmp\test-workbench.db` 后重跑，目标红灯命中旧 runtime 文案：缺少“PPT 大纲可下载最小 PPTX 文件”。

## 3. 实现内容

代码改动：

- `src\server\agent-runtime\deterministic-runtime.ts`
  - 最终交付“已形成材料”新增“PPT 大纲可下载最小 PPTX 文件”。
  - “待确认事项”改为说明当前 PPTX 只是根据文本大纲生成的最小可读文件。
  - 明确图片文件、视频成片、动画和视觉精修仍待生成或完善。
  - 课堂检查项增加下载 PPTX 后核对页面顺序、文字完整性和授课节奏。
- `src\server\agent-runtime\task-guidance.ts`
  - 最终交付 required fields 增加 `PPTX 最小下载`。
  - 自检项要求说明最小 PPTX 能力，并继续防止图片、视频、动画和视觉精修被误标完成。

文档改动：

- 新增 `docs\stages\local-real-mvp-m12-final-delivery-pptx-awareness-plan.md`。
- 新增 `docs\stages\local-real-mvp-m12-final-delivery-pptx-awareness-test-plan.md`。
- 新增本报告。
- 更新 `docs\stages\local-real-mvp-current-state-audit.md`。

## 4. 验收记录

| 命令 | 结果 |
| --- | --- |
| `npx vitest run src/server/workbench/__tests__/stage11-m5-final-delivery.test.ts --maxWorkers=1` | 红灯后绿灯；1 test passed |
| `node --test tests\artifact-markdown-download.test.mjs` | 通过；1 test passed |
| `npm run test:e2e:stage2` | 通过；Chromium desktop 2 passed，详情页和 Markdown 下载均验证 M12 口径 |
| `npm test` | 通过；Node 13 tests passed；Vitest 15 files / 68 tests passed |
| `npm run build` | 通过；Next.js 编译、TypeScript、静态页面生成均通过 |
| `npm run test:e2e:stage8` | 通过；Chromium narrow + Firefox desktop 共 4 passed |
| `npm run test:e2e:stage7` | 通过；双 browser context 隔离 1 passed |

## 5. 审查结论

M12 已完成最终交付清单对 M11 PPTX 最小下载能力的口径同步。教师在最终交付详情页和 Markdown 下载文件里会看到一致描述：PPT 大纲可下载最小 PPTX 文件，但图片、视频、动画和视觉精修仍待生成或完善。

本阶段没有把 OpenAI live smoke、图片文件、视频成片或完整视觉精修标记为完成。M6 live OpenAI smoke 仍因缺少真实凭据未通过。

## 6. 后续建议

下一阶段可以继续沿真实交付文件方向推进：要么做最终材料包 ZIP，聚合 Markdown 和 PPTX；要么先增强 PPTX 可读性与页面结构质量。若要宣称真实模型生成可用，仍需先完成 M6 live OpenAI smoke。
