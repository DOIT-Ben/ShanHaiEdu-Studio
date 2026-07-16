# Agent Runtime Stage 1 Test Plan

日期：2026-07-07

## 1. 测试目标

验证 Stage 1 是否建立了可替换 Runtime 合同，并证明无 key 情况下 deterministic runtime 能稳定生成完整文本链路 artifact draft。

## 2. 测试范围

覆盖：

- `AgentRuntime` 输入输出合同字段。
- `DeterministicRuntime` 对所有 MVP 文本节点的输出。
- artifact draft 的 Markdown-first 结构。
- deterministic provenance 标记。
- teacher-facing 文案不暴露工程词。

不覆盖：

- 数据库保存。
- API route。
- React UI。
- 真实 OpenAI 调用。
- PPTX、图片、视频文件生成。

## 3. 自动化测试

### 3.1 Runtime Contract

文件：`tests\agent-runtime\runtime-contract.test.ts`

断言：

- 每次 `run` 返回 `status: "succeeded"` 或 `status: "failed"`，不返回悬空中间态。
- 成功结果必须有 `assistantMessage`、`artifactDraft`、`nextSuggestedAction`。
- artifact draft 必须包含 `nodeKey`、`kind`、`title`、`summary`、`markdown`、`contentType: "text/markdown"`。
- runtime metadata 必须包含 `runtimeKind`，用于后端保存，不展示给教师。

### 3.2 Deterministic Golden

文件：`tests\agent-runtime\deterministic-runtime.test.ts`

节点覆盖：

- `requirement_spec`
- `textbook_evidence`
- `lesson_plan`
- `ppt_outline`
- `intro_video_plan`
- `final_delivery_checklist`

断言：

- 相同输入两次输出完全一致。
- 每个节点输出 Markdown 且至少包含 3 个二级标题。
- 输出 summary 与 title 非空。
- deterministic artifact 明确标记 `generationMode: "deterministic_draft"`。
- 视频方案包含“课程锚点”，且不提前讲授知识结论。

### 3.3 Teacher-facing Redline

断言：

- `assistantMessage.title`、`assistantMessage.body`、`artifactDraft.summary`、`artifactDraft.markdown` 不包含：
  - `provider`
  - `schema`
  - `debug`
  - `stack`
  - `OPENAI_API_KEY`
  - `local path`
  - `node_id`

## 4. 集中验收命令

资源安全策略：Vitest 使用 worker cap，避免 Windows 本机高核并发。

```powershell
$env:VITEST_MAX_WORKERS='2'; npm test -- --maxWorkers=2
npm run build
git diff --check
rg -n "from ['\"]openai['\"]|OPENAI_API_KEY|dangerouslyAllowBrowser" src\components src\app
```

预期：

- 测试通过，失败数为 0。
- build exit 0。
- diff check exit 0。
- React 组件和 App Router 页面无 OpenAI SDK 直接引用。
