# 本地真实 MVP M46 真实 LLM 对话编排器规划

日期：2026-07-08

## 目标

把工作台中间对话从“关键词模板判断”升级为服务端真实对话编排器：

```text
教师发消息
-> ConversationOrchestrator 判断聊天/澄清/启动备课生成
-> 普通聊天只回复，不生成产物
-> 明确备课需求才调用 AgentRuntime 生成需求规格
-> 无密钥或模型失败时使用可解释 fallback
```

## 范围

- 新增 OpenAI-compatible provider 配置 helper，复用 `OPENAI_*` 与 `AGENT_BRAIN_*` 环境变量。
- 新增 `ConversationOrchestrator`，只负责对话意图、澄清回复和是否启动需求规格生成。
- 修改消息 API，让真实对话编排器成为生成链路前置门。
- 保留 deterministic fallback，但不能把 fallback 说成真实模型。

## 非目标

- 不在前端直接接 OpenAI SDK。
- 不接入真实 PPTX、图片、视频生成。
- 不展示 provider、base URL、密钥或底层错误给教师。
- 不改变现有项目、消息、产物持久化结构。

## 复用

- `src/server/agent-runtime/openai-runtime.ts` 的 Responses API 调用边界。
- `scripts/openai-smoke.mjs` 的 OpenAI-compatible 环境变量选择规则。
- `src/app/api/workbench/projects/[projectId]/messages/route.ts` 的保存消息与需求规格生成链路。
- `src/server/workbench/__tests__/stage7-mainline-contract.test.ts` 的消息合同保护。

## 设计

- `src/server/openai-compatible-config.ts`
  - 统一选择 `OPENAI_API_KEY` 或 `AGENT_BRAIN_*` 凭证。
  - 返回 credential source、model、baseURL 和 credential。
  - 不打印、不序列化密钥值。

- `src/server/conversation/conversation-orchestrator.ts`
  - 定义 `ConversationDecision`。
  - 构造 OpenAI Responses JSON schema 请求。
  - 解析模型输出并做最小一致性校验。
  - 提供 deterministic fallback：短问候/闲聊只澄清，明确备课信号才启动需求规格。

- `src/server/conversation/factory.ts`
  - 有 OpenAI-compatible 配置时创建真实 orchestrator。
  - 无配置时创建 deterministic orchestrator。
  - 真实模型失败时回落 deterministic，不泄露 provider 细节。

- `messages/route.ts`
  - 保存 teacher message。
  - 调用 orchestrator。
  - `shouldGenerateRequirement=false` 时只保存 assistant message。
  - `shouldGenerateRequirement=true` 时再调用 AgentRuntime 生成 `requirement_spec`。

## 成功标准

- 输入“你好”只得到自然澄清/陪聊回复，不生成 artifact。
- 输入“五年级百分数公开课，生成教案和 PPT 大纲”会进入需求规格生成。
- fake OpenAI client 能证明请求使用 JSON schema 且不包含密钥。
- OpenAI 调用失败时，教师只看到可理解回复。
- `createAgentRuntimeFromEnv` 和 smoke 脚本使用同一套 OpenAI-compatible 配置规则。
- `npm test`、`npm run build` 通过。

## 风险与回退

- 风险：真实模型返回不合 schema。回退：解析失败时 fallback 到 deterministic 判断。
- 风险：环境变量存在但模型网络不可用。回退：不阻断教师消息保存，只返回可继续补充的信息。
- 风险：误触发生成。回退：fallback 保守规则要求备课信号或 artifact 引用。
