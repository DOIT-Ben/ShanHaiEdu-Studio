# 本地真实 MVP M46 真实 LLM 对话编排器验收报告

日期：2026-07-08

## 目标

把消息链路从关键词模板前置判断升级为服务端 Conversation Orchestrator，使工作台先真实理解教师消息，再决定聊天、澄清或启动需求规格生成。

## 实现内容

- 新增 `src/server/openai-compatible-config.ts`，统一服务端 OpenAI-compatible 配置选择：
  - 优先 `OPENAI_*`。
  - 支持 `AGENT_BRAIN_*` primary、third、fallback channel。
  - 返回配置对象但不打印 credential 或 baseURL。
- 新增 `src/server/conversation/conversation-orchestrator.ts`：
  - `OpenAIConversationOrchestrator` 使用 Responses API JSON schema 判断意图。
  - `DeterministicConversationOrchestrator` 作为无配置或模型失败 fallback。
  - 输出 `chat`、`clarify`、`start_requirement` 三类决策。
- 修改 `messages` API：
  - 保存 teacher message 后先调用 conversation orchestrator。
  - 问候/闲聊/信息不足时只保存 assistant 回复。
  - 明确备课需求才调用 AgentRuntime 生成 `requirement_spec`。
- 修改 `createAgentRuntimeFromEnv`：
  - 复用 OpenAI-compatible 配置。
  - 有真实配置时先调 OpenAI runtime，失败后回落 deterministic runtime，保证本地端到端演示不中断。

## 验证记录

| 验证项 | 结果 |
| --- | --- |
| `npx vitest run tests/conversation-orchestrator.test.ts --maxWorkers=1` | 通过；6 tests passed |
| `npx vitest run src/server/workbench/__tests__/stage7-mainline-contract.test.ts --maxWorkers=1` | 通过；5 tests passed |
| `npx vitest run tests/agent-runtime/openai-runtime.test.ts --maxWorkers=1` | 通过；5 tests passed |
| `npm test` | 通过；Node 98/98，Vitest 25 files / 100 tests |
| `npm run build` | 通过；Next.js 编译与 TypeScript 通过 |
| `node scripts/openai-smoke.mjs` | 通过；`runtimeKind=openai`，`credentialSource=agent_brain_fallback_ledger_env`，`model=gpt-5.5` |
| 本地 HTTP E2E `127.0.0.1:3002` | 通过；问候不生成 artifact，明确备课需求生成需求规格 artifact |

## 本地 HTTP E2E 证据

测试流程：

```text
POST /api/workbench/projects
POST /api/workbench/projects/{projectId}/messages: 你好
POST /api/workbench/projects/{projectId}/messages: 五年级数学百分数公开课，生成教案和 PPT 大纲
GET /api/workbench/projects/{projectId}/snapshot
```

结果摘要：

```json
{
  "helloArtifactCreated": false,
  "lessonArtifactCreated": true,
  "lessonArtifactMode": "deterministic_draft",
  "artifactCount": 1,
  "artifactTitles": "需求规格说明书",
  "messageCount": 4
}
```

解释：

- 对话脑真实接入成功：`你好` 返回自然对话回复，不再触发需求规格生成。
- OpenAI-compatible smoke 成功，证明当前环境存在真实模型通路。
- 本次需求规格产物落到了 deterministic fallback，说明产物生成模型调用在该轮没有返回合格结构；系统没有冒充真实产物，而是以 `deterministic_draft` 明确标记。

## 边界

- M46 解决的是“真实对话理解前置门”和“本地端到端不中断”。
- 产物生成仍允许 deterministic fallback；只有 `generationMode=model_generated` 的 artifact 才能称为真实模型产物。
- 未接入真实 PPTX、图片、视频全链路生产。

## 下一步

进入 M47 前建议优先做：

- 产物 OpenAI runtime 的 schema 兼容性增强，降低真实模型生成失败率。
- 浏览器可见状态中区分“真实模型产物”和“结构草稿”。
- 将端到端演示脚本纳入一键验收，输出可交付证据包。
