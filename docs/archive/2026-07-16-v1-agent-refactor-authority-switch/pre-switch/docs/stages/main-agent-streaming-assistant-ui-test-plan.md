# Main Agent 流式响应与 assistant-ui 测试计划

日期：2026-07-16

## Contract

- `stream: true`、`prompt_cache_key`、`previous_response_id` 映射正确。
- 文本 delta 先于终态到达；function-call 参数 delta 不成为教师文本。
- cache read/write、首事件、首文本、chunks、bytes、duration 可验证。
- structured JSON 只增量投影 `assistantMessage.body`。
- task intake 以 `submit_task_brief` function call 提交结构化任务；普通对话和原生 ReAct 终态不带 JSON schema，直接流自然文本。

## Executor

- Tool 开始与 Observation 使用同一活动 ID，失败保留具体步骤、Observation 和 reasonCode。
- 内部 telemetry 不进入教师 SSE；跨项目、重复 sequence 和重连仍失败关闭。
- 流式投影异常不改变 Provider 结果或 Main Agent 控制流。
- 最终 assistant 消息只持久化一次。
- 同一 turn 的多个 Tool 合并为单一有序轨迹，Observation 失败位置和 Artifact 入口保持可见。
- 进程内事件提交即时唤醒 SSE，通知只作运输提示；刷新通过最近64条有界回放恢复在途轮，数据库仍是唯一真值。

## 验证命令

```powershell
$env:VITEST_MAX_WORKERS='2'
npx vitest run tests/gpt-protocol-adapter.test.ts tests/main-agent-stream-projection.test.ts tests/assistant-ui-agent-events.test.ts tests/agent-runtime/main-agent-controlled-react-loop.test.ts tests/openai-tool-loop-runner.test.ts tests/model-main-conversation-agent.test.ts --maxWorkers=2

$env:DATABASE_URL='file:./.tmp/streaming-control-plane-<run>.db'
$env:SHANHAI_DB_INIT_SKIP_DOTENV='1'
node scripts/init-sqlite-schema.mjs
npx vitest run tests/conversation-streaming-progress.test.ts tests/conversation-turn-service.test.ts tests/conversation-terminal-events.test.ts --maxWorkers=1

npx tsc --noEmit
npm run build
git diff --check
```

真实 Provider 与桌面交互不在仓内测试中冒充通过。V1 前不运行390px。
