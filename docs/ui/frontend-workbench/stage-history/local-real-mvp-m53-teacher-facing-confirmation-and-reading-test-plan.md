# M53 教师视角备课确认与成果阅读测试定义

日期：2026-07-08

## 测试目标

用红灯测试锁住 M53 的两条主线：

1. 明确备课需求必须先确认，不能直接生成需求规格 artifact。
2. 用户态成果阅读不能暴露后台字段和工程标题。

## 自动化测试

新增 `tests/m53-teacher-facing-confirmation-and-reading.test.mjs`。

覆盖点：

- `messages/route.ts` 存在确认门；未确认需求返回“备课任务确认”，不调用 `runtime.run` / `saveArtifact`。
- 确认信号存在后才允许进入 `runtime.run`。
- `ChatTranscript` 使用教师成果卡，不出现“生成内容已进入产物链”“上游来源”和 `line-clamp-4`。
- `MarkdownPreview` 仍保留 markdown block 渲染能力，但不显示“关键字段”“正文预览”“上游来源”。
- `ArtifactDetailSheet` 不显示“生成来源”“页面脚本”“提示词”“缩略预览”等后台/占位标题。
- `ArtifactSidePanel` 使用“备课成果”或“成果阅读”，不再写“产物预览”。
- `workbench-mappers.ts` 不再输出可见 `Markdown` key，也不再 fallback 到 `状态` label。

## 回归测试

集中验收时运行：

```powershell
node --test tests\m53-teacher-facing-confirmation-and-reading.test.mjs tests\m52-semi-auto-conversation-gate.test.mjs tests\m50-artifact-rail-markdown-preview.test.mjs
node --test tests\workbench-api.test.mjs
$env:DATABASE_URL='file:./.tmp/test-workbench.db'; node scripts/init-sqlite-schema.mjs; npx vitest run src\server\workbench\__tests__\stage7-mainline-contract.test.ts --maxWorkers=1
npm test
npm run build
git diff --check
```

## 浏览器验收

本地打开当前 dev server：

- 输入“你好”：普通回复，不出现成果卡。
- 输入“我要做苏教版小学六年级的百分数这个知识点的备课课件。”：出现“备课任务确认”，不出现需求规格说明书 artifact。
- 点击或输入“确认开始”：生成需求规格，出现可展开成果卡。
- 展开成果卡、打开右侧面板和详情面板：普通区域不出现红线词。
- Enter 发送、Shift+Enter 换行、quick reply 只填充输入框仍可用。

## 通过标准

- 自动化测试全绿。
- 构建通过。
- 工作树只包含 M53 范围改动和既有无关桌面端改动。
- 收尾报告记录测试命令、结果、剩余风险和后续任务。

