# Agent Runtime Stage 2 Test Plan

日期：2026-07-07

## 1. 测试目标

验证 `OpenAIRuntime` 的服务端边界、Responses API request 映射、结构化输出解析、无 key fallback 和失败恢复。

## 2. 自动化测试

文件：`tests\agent-runtime\openai-runtime.test.ts`

### 2.1 Request Builder

断言：

- 调用 fake `responses.create` 时 payload 包含 `model`、`instructions`、`input`。
- payload 包含 JSON 结构化输出约束。
- 输入内容包含项目年级、学科、课题、任务和上游 artifact 摘要。

### 2.2 Result Parser

fake response 返回 `output_text` JSON：

- `assistantMessage.title`
- `assistantMessage.body`
- `artifactDraft.title`
- `artifactDraft.summary`
- `artifactDraft.markdown`
- `nextSuggestedAction.label`

断言：

- result 为 `status: "succeeded"`。
- `run.runtimeKind` 为 `openai`。
- `artifactDraft.generationMode` 为 `model_generated`。
- `nodeKey` 与当前 task 一致。

### 2.3 Missing Key Fallback

断言：

- `createAgentRuntimeFromEnv({})` 返回 deterministic runtime。
- 运行结果仍是 `deterministic_draft`。

### 2.4 Failure Recovery

fake client 抛错时断言：

- result 为 `status: "failed"`。
- 教师可见文案说明本次生成未完成，并给出重试或调整输入建议。
- 教师可见文案不包含 `provider`、`schema`、`debug`、`stack`、密钥环境变量名、本地路径。

## 3. 集中验收命令

```powershell
$env:VITEST_MAX_WORKERS='2'; npm test -- --maxWorkers=2
npm run build
git diff --check
rg -n "from ['\"]openai['\"]|<redacted key env>|dangerouslyAllowBrowser" src\components src\app
```

预期：

- 测试通过，失败数为 0。
- build exit 0。
- diff check exit 0。
- 前端无 OpenAI SDK 直接引用。
