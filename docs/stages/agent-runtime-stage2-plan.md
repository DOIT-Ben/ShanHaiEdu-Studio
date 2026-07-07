# Agent Runtime Stage 2 Plan

日期：2026-07-07

## 1. 第一性原理：本阶段核心需求

Stage 2 的核心是建立 `OpenAIRuntime` 服务端接入边界，而不是把真实模型调用塞进前端或业务状态层。Runtime 接收 Stage 1 已固化的 `AgentRuntimeInput`，通过 Responses API 生成同形态 `AgentRuntimeResult`。无 key 时仍由 deterministic runtime 支撑本地 E2E，不让真实 provider 波动阻塞基础闭环。

成功标准：

- `OpenAIRuntime` 可通过注入 client 测试，不需要真实 key 才能验证 request/parse/error 边界。
- 默认工厂在没有密钥环境变量时返回 `DeterministicRuntime`。
- 有密钥时只在服务端 runtime 里创建 OpenAI SDK client。
- Responses API request 使用结构化输出约束，模型结果必须落回 Stage 1 合同。
- 模型失败时返回教师可理解恢复态，不暴露工程词、密钥、堆栈或本地路径。

## 2. 可复用方案调研

一手来源结论：

- OpenAI Node SDK 的主 API 是 Responses API，示例为 `client.responses.create({ model, instructions, input })` 并读取 `response.output_text`。来源：https://github.com/openai/openai-node
- OpenAI Node SDK 默认从环境变量读取 API key，浏览器支持默认关闭，以避免 secret credentials 暴露。来源：https://github.com/openai/openai-node
- OpenAI Node SDK 失败会抛出 APIError 子类，并提供 retries、timeout、request id 等能力。Stage 2 只消费异常并归一化教师可见恢复，不在 UI 展示底层错误。来源：https://github.com/openai/openai-node
- OpenAI Agents SDK JS 支持 agents、tools、handoffs、guardrails、sessions、tracing，适合后续复杂编排；Stage 2 仍使用 Responses API 直接调用，保持 MVP runtime 轻量。来源：https://github.com/openai/openai-agents-js

## 3. 复用、适配与必要自研

复用：

- 安装并复用官方 `openai` SDK。
- 复用 Stage 1 的 `AgentRuntimeInput` / `AgentRuntimeResult`。
- 复用 deterministic runtime 作为无 key fallback。

适配：

- `OpenAIRuntime` 构造函数接受可注入 responses client，测试不依赖网络。
- request builder 将项目上下文、任务说明、上游 artifact 摘要组合为 Responses API 输入。
- 输出解析只接受 JSON object；解析失败转为失败结果。

必要自研：

- `buildOpenAIResponseRequest`：把 runtime input 映射到 Responses API payload。
- `parseOpenAIArtifactDraft`：把模型 JSON 转为 artifact draft。
- `createAgentRuntimeFromEnv`：按环境变量选择 runtime。
- `toTeacherFacingFailure`：归一化失败恢复。

## 4. 开发方案、风险和验证标准

文件计划：

- 新增：`src\server\agent-runtime\openai-runtime.ts`
- 新增：`src\server\agent-runtime\runtime-factory.ts`
- 修改：`src\server\agent-runtime\index.ts`
- 新增：`tests\agent-runtime\openai-runtime.test.ts`
- 修改：`package.json`
- 修改：`package-lock.json`

风险：

- OpenAI SDK 版本变化导致类型细节变化。控制方式：request payload 使用本地窄类型，只依赖 `responses.create` 最小能力。
- 模型输出不是合法 JSON。控制方式：解析失败返回失败结果，后续可重试，不污染 artifact。
- 无 key 环境误以为 OpenAI 已接通。控制方式：factory 明确返回 deterministic runtime，结果仍标记 `deterministic_draft`。

集中验收：

- Stage 1 + Stage 2 全部测试通过。
- `npm run build` 通过。
- `git diff --check` 通过。
- React 组件和页面没有 `openai` import，也没有密钥环境变量引用。
