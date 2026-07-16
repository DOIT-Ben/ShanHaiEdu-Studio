# Local Real MVP M2 Lesson Text Loop Report

日期：2026-07-07

## 1. 阶段目标

M2 目标是把 M1 的需求规格闭环推进到教材说明和教案文本闭环。教师在确认需求规格后，可以继续得到教材证据包；确认教材证据包后，可以得到公开课教案 Markdown，并支持查看、复制、确认、重做和刷新恢复。

本阶段仍使用 deterministic runtime，不声明真实教材解析、真实模型、真实 PPTX、图片或视频能力已完成。

## 2. 本轮实现

### 2.1 M2 下游编排

新增 `src\server\workbench\m2-orchestrator.ts`：

- 确认 `requirement_spec` 后，若没有已存在的教材证据草稿/确认版/需重审版，则生成 `textbook_evidence`。
- 确认 `textbook_evidence` 后，确认需求规格和教材证据均存在时生成 `lesson_plan`。
- 编排只调用服务端 deterministic runtime 和后端持久化层，不绕过 repository。
- 对已有下游做幂等保护，避免重复确认产生重复草稿。

### 2.2 approve route 接入 M2 推进

更新 `src\app\api\workbench\projects\[projectId]\artifacts\[artifactId]\approve\route.ts`：

- 先确认当前 artifact。
- 再调用 M2 编排生成下一节点。
- API client 仍通过确认后刷新 snapshot 取得最新节点状态。

### 2.3 前端重做接入真实 regenerate route

更新 `src\lib\workbench-api.ts`：

- `regenerateArtifact()` 不再返回 501 占位。
- 改为调用后端 regenerate route，并刷新项目 snapshot。
- 重做会生成非空 Markdown 草稿，旧版本保留，新版本等待确认。

### 2.4 浏览器路径扩展

更新 `tests\e2e\stage2-deterministic.spec.ts`：

- M1 路径之后继续确认教材证据包。
- 验证公开课教案生成。
- 打开教案详情，验证教学目标内容。
- 验证复制、确认、重做和刷新恢复。
- 保留用户可见工程词红线扫描。

## 3. 验收记录

| 命令 | 结果 | 关键证据 |
| --- | --- | --- |
| `node --test tests/workbench-api.test.mjs` | 红灯后绿灯 | regenerate 测试从 501 占位失败，接入真实 route 后 9 tests passed |
| `npx vitest run src/server/workbench/__tests__/stage8-m2-lesson-text-loop.test.ts --maxWorkers=1` | 红灯后绿灯 | 确认需求后无教材证据失败，接入 M2 编排后通过 |
| `npm test` | 通过 | Node 9 tests passed；Vitest 12 files / 65 tests passed |
| `npm run build` | 通过 | Prisma Client 生成成功；Next.js 编译、TypeScript、静态页面生成均通过 |
| `npm run test:e2e:stage2` | 通过 | Chromium desktop 1 passed；覆盖 M1 + M2 浏览器闭环 |
| 测试 worker 残留检查 | 通过 | 未发现匹配 Vitest/Jest/Playwright 的残留 Node 进程 |

成功截图：

- `test-results\e2e\stage2-deterministic-E2E-S-17c74--and-restores-after-refresh-chromium-desktop\stage2-requirement-approved-restored.png`

## 4. 风险与边界

- M2 只覆盖 deterministic 文本闭环，不代表真实教材 OCR 或真实模型已接入。
- 当前浏览器验收只覆盖 Chromium desktop，窄屏和多浏览器仍未验收。
- 前端重做当前生成通用重做草稿，后续 M3/M6 可接入更细的 runtime regenerate payload。
- 教案上游变更后的 stale 传播由既有 Stage 4 服务层测试覆盖；本阶段未新增单独浏览器 stale 流。

## 5. 审查结论

M2 通过。当前主线已经能在本地浏览器中从一句话需求推进到需求规格、教材证据包和公开课教案文本闭环，并保持真实后端保存、确认、重做和刷新恢复。

下一阶段可进入 M3：PPT 大纲与逐页脚本。
