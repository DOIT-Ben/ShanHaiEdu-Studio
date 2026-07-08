# M53 教师视角备课确认与成果阅读验收报告

日期：2026-07-08 14:35

## 范围

- 明确备课需求后先展示“备课任务确认”，不直接生成需求规格。
- 教师回复“确认开始”等确认信号后，才调用运行时生成 `requirement_spec`。
- 对话内嵌成果卡改为教师可读成果卡，支持展开阅读。
- 成果侧栏和详情抽屉改为“备课成果 / 成果阅读”语言。
- 普通成果阅读界面移除后台字段标题和占位功能：`Markdown`、`状态`、`关键字段`、`上游来源`、`产物链`、`产物预览`、`生成来源`、`页面脚本`、`提示词`。

## 实现摘要

- `messages/route.ts` 增加 `isTeacherConfirmation` 和 `formatRequirementConfirmation`，将“识别到备课需求”和“开始生成”拆成两步。
- `ChatTranscript` 用 `TeacherArtifactCard` 替换旧内嵌产物卡，显示标题、摘要、可读字段和正文片段，不再展示后台来源。
- `MarkdownPreview` 保留 Markdown 标题、列表、段落渲染，但去掉后台分区标题。
- `ArtifactSidePanel` / `ArtifactDetailSheet` 收敛为成果阅读面板，删除假缩略图和伪 tab。
- `workbench-mappers` 将正文映射为 `正文`，fallback label 改为 `内容`。
- M2-M5/M13 阶段测试补充“确认开始”，对齐新的半自动确认流程。

## 验收记录

| 命令或流程 | 结果 |
| --- | --- |
| `node --test tests\m53-teacher-facing-confirmation-and-reading.test.mjs` | 通过，5/5 |
| `node --test tests\m53-teacher-facing-confirmation-and-reading.test.mjs tests\m52-semi-auto-conversation-gate.test.mjs tests\m50-artifact-rail-markdown-preview.test.mjs` | 通过，14/14 |
| `node --test tests\workbench-api.test.mjs` | 通过，13/13 |
| `$env:DATABASE_URL='file:./.tmp/test-workbench.db'; node scripts/init-sqlite-schema.mjs; npx vitest run src\server\workbench\__tests__\stage7-mainline-contract.test.ts --maxWorkers=1` | 通过，5/5 |
| `$env:DATABASE_URL='file:./.tmp/test-workbench.db'; node scripts/init-sqlite-schema.mjs; npx vitest run src\server\workbench\__tests__\stage8-m2-lesson-text-loop.test.ts src\server\workbench\__tests__\stage9-m3-ppt-outline.test.ts src\server\workbench\__tests__\stage10-m4-intro-video-plan.test.ts src\server\workbench\__tests__\stage11-m5-final-delivery.test.ts src\server\workbench\__tests__\stage13-material-package.test.ts --maxWorkers=1` | 通过，5/5 |
| `npm test` | 通过，Node 128/128；Vitest 25 files / 100 tests |
| `npm run build` | 通过，Next.js production build 成功 |
| `git diff --check` | 通过；仅 Windows 换行提示 |

## 浏览器验收

临时 production 服务：`http://127.0.0.1:3003`，验收后已停止；用户原有 `http://127.0.0.1:3002` 服务未改动。

流程：

```text
新建项目
-> 输入“我要做苏教版小学六年级的百分数这个知识点的备课课件。”
-> 页面出现“备课任务确认”
-> 未出现“需求规格说明书已生成”或成果卡
-> 输入“确认开始”
-> 页面出现 1 张教师成果卡
-> 展开成果卡成功
-> 红线词 0 命中
```

浏览器脚本结果：

```json
{
  "ok": true,
  "requestHasGenerated": false,
  "cardCount": 1,
  "expanded": 1,
  "forbiddenHits": [],
  "containsConfirmation": true,
  "containsGeneratedResult": true
}
```

## 风险与后续

- 当前 `.env` 存在真实 provider 配置时，确认生成会先尝试真实 provider；若 provider 慢或不可用，会等待超时后 fallback。上线演示前应增加 provider health gate 或显式本地演示模式开关，避免教师看到长时间“正在整理回复”。
- 本阶段只收口需求确认和成果阅读表达，不新增真实 PPTX、图片、视频生成能力。
- M54 建议进入“本地一键端到端交付演示”的稳定化：把确认、审批链、最终交付包生成封装成可重复脚本和浏览器报告。

