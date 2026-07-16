# Local Real MVP M11 PPTX 最小下载闭环报告

日期：2026-07-07

## 1. 阶段目标

M11 目标是把 M3 的“PPT 大纲与逐页脚本”从文本预览推进到真实 `.pptx` 最小文件下载：

```text
打开 PPT 大纲详情
-> 点击下载 PPTX
-> 后端读取当前 artifact
-> 生成标准 OOXML PPTX
-> 浏览器捕获真实下载文件
```

本阶段只保证文件可下载、可识别、内容来自当前 artifact；不声明图片文件、视频成片、动画或精修视觉设计已经完成。

## 2. 红灯记录

M11 先补测试定义，再实现下载能力：

- 新增 `tests\artifact-pptx-download.test.mjs` 后，初始缺少 `src\server\pptx\artifact-pptx.ts` 时应失败。
- 扩展 `tests\e2e\stage2-deterministic.spec.ts`，要求 PPT 大纲详情页出现“下载 PPTX”，并捕获真实 Playwright download 事件。

本轮接手时实现已进入工作区，专项测试和浏览器测试均重新跑过并通过。

## 3. 实现内容

代码改动：

- `package.json` / `package-lock.json`
  - 新增 `pptxgenjs@4.0.1`，作为服务端 PPTX 生成库。
- `src\server\pptx\artifact-pptx.ts`
  - 新增 `buildArtifactPptxDownload()`，只允许 `ppt_draft` artifact 导出。
  - 生成标题页、文件说明页、关键字段页、正文页和交付边界页。
  - 返回安全 `.pptx` 文件名和二进制 Buffer。
- `src\app\api\workbench\projects\[projectId]\artifacts\[artifactId]\pptx\route.ts`
  - 新增后端下载路由。
  - 通过 `service.getArtifact(projectId, artifactId)` 读取真实持久化产物。
  - 返回 PPTX MIME 类型和附件下载头。
- `src\hooks\useArtifactPptxDownload.ts`
  - 新增浏览器下载 hook。
  - 仅对 `ppt_draft` 且具备 `artifactId` 的产物启用。
- `src\components\artifacts\ArtifactDetailSheet.tsx`
  - 在产物详情动作区增加“下载 PPTX”按钮。
- `src\components\layout\MediaWorkbench.tsx`
  - 向产物详情传入当前 `projectId`。
- `tests\e2e\stage2-deterministic.spec.ts`
  - 增加真实 `.pptx` download 事件断言和文件头 `PK` 校验。

文档改动：

- 新增 `docs\stages\local-real-mvp-m11-pptx-download-plan.md`。
- 新增 `docs\stages\local-real-mvp-m11-pptx-download-test-plan.md`。
- 新增本报告。
- 更新 `docs\stages\local-real-mvp-current-state-audit.md`。

## 4. 验收记录

| 命令 | 结果 |
| --- | --- |
| `node --test tests\artifact-pptx-download.test.mjs` | 通过；2 tests passed，生成物为 ZIP/OOXML，非 PPT artifact 被拒绝 |
| `node --test tests\artifact-markdown-download.test.mjs` | 通过；1 test passed |
| `npm test` | 通过；Node 13 tests passed；Vitest 15 files / 68 tests passed |
| `npm run build` | 通过；Next.js 编译、TypeScript、静态页面生成均通过，新增 `/pptx` 动态路由 |
| `npm run test:e2e:stage2` | 通过；Chromium desktop 2 passed，含 PPTX 下载文件头校验 |
| `npm run test:e2e:stage8` | 通过；Chromium narrow + Firefox desktop 共 4 passed，含 PPTX 下载路径 |
| `npm run test:e2e:stage7` | 通过；双 browser context 隔离 1 passed |

## 5. 审查结论

M11 已完成“PPT 大纲到真实 `.pptx` 最小下载”的本地闭环。下载内容来自后端持久化 artifact，浏览器验收证明文件是 PPTX ZIP 包，不是改后缀文本。

本阶段没有把 OpenAI live smoke、图片文件、视频成片或精修视觉设计标记为完成。M6 live OpenAI smoke 仍因缺少真实凭据未通过。

## 6. 后续建议

下一阶段建议继续在真实文件能力中选择最小闭环：要么补“PPTX 文件质量/可读性增强”，要么进入“图片资产最小生成或占位替换合同”。若要宣称真实模型路径可用，仍需先配置凭据并通过 M6 live OpenAI smoke。
