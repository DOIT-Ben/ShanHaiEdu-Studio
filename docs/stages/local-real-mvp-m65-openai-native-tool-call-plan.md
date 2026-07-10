# M65 OpenAI Responses 原生 tool_call 闭环实施计划

> 日期：2026-07-10  
> 基线：M64 Tool Registry / ToolRouter 已完成，最新本地提交 `ad73fdb`。  
> 目标：在不绕过 ShanHaiEdu 后端门禁与 ToolRouter 的前提下，把 OpenAI Responses 原生 `function_call -> function_call_output -> continuation` 闭环纳入 GPT 协议层。

## 1. 背景与结论

M64 已完成工具注册、内部工具适配器、Provider 适配器、ToolRouter Core，以及 `ConversationTurnService` 对第一批工具执行路径的接入。当前系统已经具备“后端受控执行工具”的工程边界，但 GPT 协议层仍主要是文本/结构化输出模式：

- `src/server/gpt-protocol/types.ts` 仅有 `instructions`、`input`、`text` 与 `assistantText`。
- `src/server/gpt-protocol/openai-responses-adapter.ts` 只把 `responses.create(...)` 的 `output_text` 作为最终文本读取。
- `outputItemsSummary` 只做摘要，不解析 `function_call` 的 `call_id/name/arguments` 用于后端执行。
- `OpenAIRuntime` 仍把模型输出作为 JSON 结构化产物解析，不做原生工具调用回灌。

**推荐方向：M65 先做“协议层最小闭环”，再决定是否接入 `ConversationTurnService` 主链路。** 也就是：

1. 先在 `gpt-protocol` 层支持 OpenAI Responses function tools 的 request / response / tool output 表达。
2. 再新增一个受控 loop runner，把模型产生的 `function_call` 交给 M64 `ToolRouter` 执行。
3. 最后再决定是否让 `OpenAIRuntime` 或主对话智能体使用该 loop。

## 2. 官方口径查证

来源：OpenAI 官方 Function Calling 文档（`https://developers.openai.com/api/docs/guides/function-calling` / `https://platform.openai.com/docs/guides/function-calling`，2026-07-10 访问）。

已确认要点：

1. Function calling / tool calling 是模型请求应用侧功能的机制；模型只产生 tool call，真实执行由应用代码完成。
2. Responses API 的工具调用流是多步：
   - 请求模型并提供 `tools`；
   - 接收 `function_call`；
   - 应用侧执行工具；
   - 追加 `function_call_output`，再次请求模型；
   - 获得最终文本响应或更多工具调用。
3. Responses 的 `response.output` 中会出现 `type: "function_call"` 的条目，包含 `call_id`、`name`、JSON 字符串 `arguments`。
4. 回灌时需要追加：
   - `{ type: "function_call_output", call_id, output }`
5. 对 reasoning 模型，如果响应中有 reasoning items，也需要随 tool call output 一并传回。
6. strict function schema 要求：
   - 每个 object 都要 `additionalProperties: false`；
   - `properties` 里的所有字段都要进入 `required`；
   - 可选字段用 `type: ["string", "null"]` 等 nullable 方式表达。
7. 最好假设一次响应可能有多个 tool calls；M65 MVP 可先强制 `parallel_tool_calls: false` 做单工具受控闭环，再在后续版本扩展并行。

这些口径与 M64 当前结论一致：**OpenAI SDK 管模型，ToolRouter 管真实工具执行；模型的 function_call 不能直接产生 side effect。**

## 3. 当前代码现状

### 3.1 已可复用能力

- `src/server/tools/tool-registry.ts`
  - 已有 `ToolDefinition` 列表。
  - 可通过 `toolDefinitionToOpenAiFunctionTool(...)` 导出 OpenAI strict schema。
- `src/server/tools/tool-router.ts`
  - 已能按 `toolName` / `capabilityId` 路由到 internal / provider adapter。
  - 对 blocked / unsupported / missing artifact 有安全失败输出。
- `src/server/tools/internal-capability-tool-adapter.ts`
  - internal 工具执行结果已统一为 `ToolExecutionResult`。
- `src/server/tools/provider-tool-adapter.ts`
  - `coze_ppt` provider 结果已有 artifactTruth / qualityGate。
- `src/server/conversation/conversation-turn-service.ts`
  - 已作为唯一 workbench artifact 持久化方。
  - 已在 gate 后接入 `ToolRouter`。

### 3.2 M65 要补的缺口

- `GptProtocolRequest` 没有 `tools` / `toolChoice` / `parallelToolCalls` / `previousResponseId` / item-list input。
- `GptProtocolResponse` 没有结构化 `functionCalls`。
- `openai-responses-adapter.ts` 不解析 function call，不保留 reasoning items，不构造 continuation request。
- 没有 `function_call_output` 的安全序列化器。
- 没有把 `ToolExecutionResult` 转成模型可读 tool output 的标准格式。
- 没有受控 loop 的最大轮次、失败熔断、门禁和敏感信息约束。

## 4. M65 范围

### 4.1 纳入范围

1. 扩展 GPT Protocol 类型，支持 OpenAI Responses function calling 的最小结构。
2. 扩展 OpenAI Responses Adapter：
   - 传入 `tools`；
   - 传入 `parallel_tool_calls: false`；
   - 解析 `response.output` 中的 `function_call`；
   - 摘要 reasoning / message / function_call，但不保存完整敏感 arguments 到诊断摘要。
3. 新增 `ToolCallIntent` 映射层：
   - OpenAI `function_call` 只被解析为“模型意图”；
   - 模型参数不得直接成为 `ToolRouterInput`；
   - `projectId`、已确认 `artifactRefs`、`sourceMessageId`、HumanGate / PlanGuard / budget 状态必须来自后端/CTS 当前状态；
   - 模型伪造 `projectId`、`artifactRefs`、`sourceMessageId`、provider 参数时必须被忽略或阻断。
4. 新增 tool output serializer：
   - 将 `ToolExecutionResult` 转为安全 JSON 字符串；
   - 仅暴露教师语义字段，例如 `statusLabel`、`teacherSafeSummary`、`nextActionLabel`、`artifactTitle`、`artifactReadyForReview`；
   - 内部 ID（`capabilityId`、`toolId`、`artifactKind`、provider 名、nodeKey）默认只能进入不可见 diagnostics，不能进入模型 continuation input；
   - 不回显 token、路径、provider 内部字段。
5. 新增受控 tool-call loop runner：
   - 调用模型；
   - 若有 function_call，调用 `ToolRouter`；
   - 追加 `function_call_output`；
   - 再次请求模型获得最终文本；
   - 最多 N 轮，默认 1-2 轮。
6. 完整测试：解析、意图降级、序列化、安全、loop 成功/失败/熔断。

### 4.2 不纳入范围

- 不接入真实 MCP Client Adapter。
- 不把所有工具一次性暴露给模型；先采用 allowlist。
- 不支持并行 tool calls；M65 默认 `parallel_tool_calls: false`。
- 不迁移前端 UI。
- 不改密钥、部署、生产配置。
- 不把 `ConversationTurnService` 的 artifact 持久化责任移动到 adapter/router。
- 不让模型绕过 CapabilityAvailability / PlanGuard / HumanGate / AgentHarnessBudget。

## 5. 设计原则

1. **模型只表达意图**：`function_call` 只能形成 `ToolCallIntent`，不能直接形成 `ToolRouterInput`，更不能直接写数据库、文件或调用 provider。
2. **后端继续做门禁**：ToolRouter / ConversationTurnService 仍控制 side effect。
3. **工具暴露最小化**：首批只暴露已实现且适合模型选择的工具，blocked tool 不作为 callable 暴露，或作为不可执行状态由 router 返回。
4. **server-authoritative 参数注入**：`projectId`、approved artifacts、source artifact refs、sourceMessageId、project context、generation job context 都来自后端状态，不采信模型参数。
5. **禁止敏感与工程词回灌**：function_call arguments、tool output、diagnostics 都不能含 token、绝对路径、providerMode、API key、baseURL；continuation input 不包含 `capabilityId`、`toolId`、provider、nodeKey、schema 等可能被模型复述给教师的工程词。
6. **不破坏 M64 产物真伪门禁**：真实 PPTX 仍以 provider result / job lifecycle / artifactTruth 为准。
7. **可回退**：M65 只新增 GPT protocol 能力，若 native loop 不稳定，可回退 M64 ToolRouter 直接执行链路。

## 6. 分阶段任务

### Task A：协议类型与 OpenAI tool schema 接入

文件：

- 修改：`src/server/gpt-protocol/types.ts`
- 修改：`src/server/gpt-protocol/openai-responses-adapter.ts`
- 测试：`tests/gpt-protocol-adapter.test.ts`

验收：

- `GptProtocolRequest` 支持 `tools`、`toolChoice`、`parallelToolCalls`、`inputItems`。
- Adapter 传递 `tools` 和 `parallel_tool_calls: false`。
- Adapter 解析 `function_call` 为结构化 `GptFunctionCall`，包含 `callId/name/argumentsText/argumentsJsonParseStatus`。
- output summary 仍不保存完整 arguments。

### Task B：Tool output 安全序列化

文件：

- 新增：`src/server/gpt-protocol/tool-call-intent.ts`
- 新增：`src/server/gpt-protocol/tool-output-serializer.ts`
- 测试：`tests/gpt-tool-call-intent.test.ts`
- 测试：`tests/gpt-tool-output-serializer.test.ts`

验收：

- `function_call` 可被解析成 `ToolCallIntent`，只保留 `toolName` 和低风险教师意图字段。
- 模型伪造的 `projectId`、`artifactRefs`、`sourceMessageId`、provider 参数不会进入 `ToolRouterInput`。
- `ToolExecutionResult` 成功/失败/needs_input 都可转为 `function_call_output.output` 字符串。
- 输出只含教师语义字段：`statusLabel`、`teacherSafeSummary`、`nextActionLabel`、`artifactTitle`、`artifactReadyForReview`。
- 输出不含 `capabilityId`、`toolId`、`artifactKind`、nodeKey、provider、local path、URL、token、API key、baseURL、debug 等工程词或敏感值。

### Task C：受控 OpenAI tool-call loop runner

文件：

- 新增：`src/server/gpt-protocol/openai-tool-loop-runner.ts`
- 测试：`tests/openai-tool-loop-runner.test.ts`

验收：

- 第一次模型返回 `function_call` 时，runner 先降级为 `ToolCallIntent`，再由 server-side context 组装 `ToolRouterInput`，最后调用注入的 `toolRouter`。
- runner 追加原 `response.output` 与 `function_call_output` 后进行 continuation。
- reasoning items 若存在，保留在下一次 input items。
- 最多轮次可配置；超限返回安全失败诊断。
- `parallel_tool_calls: false`。
- 多个 function_call 出现时，M65 MVP 返回安全失败或只处理第一个并记录诊断；推荐先安全失败，避免未定义 side effect。

### Task D：与 OpenAIRuntime 的最小可选接线

文件：

- 修改：`src/server/agent-runtime/openai-runtime.ts`
- 测试：`tests/agent-runtime/openai-runtime.test.ts`

验收：

- 默认行为不变，仍支持纯 structured output。
- 通过显式选项启用 native tool loop。
- 未配置 toolRouter / tool allowlist 时不启用。
- 失败时保留当前 deterministic / safe fallback 行为。

### Task E：集中验收与收尾

文件：

- 新增：`docs/stages/local-real-mvp-m65-openai-native-tool-call-closeout.md`

验收命令：

```powershell
npx vitest run tests/gpt-protocol-adapter.test.ts tests/gpt-tool-output-serializer.test.ts tests/openai-tool-loop-runner.test.ts tests/agent-runtime/openai-runtime.test.ts tests/tool-router.test.ts tests/conversation-turn-service.test.ts --maxWorkers=1
npx tsc --noEmit
npm run build
```

## 7. 测试策略

### 7.1 必须 RED/GREEN 的新增测试

- Adapter 传 tools 与 `parallel_tool_calls: false`。
- Adapter 从 `response.output` 解析 `function_call`。
- ToolCallIntent 忽略模型伪造的 `projectId` / `artifactRefs` / `sourceMessageId`。
- Serializer 脱敏 tool output。
- Serializer 输出和 final assistantText 不含 `capabilityId|toolId|artifactKind|provider|schema|debug|local path|API`。
- Loop runner 执行 `function_call -> ToolRouter -> function_call_output -> final response`。
- Loop runner 超限、未知工具、多工具调用、JSON arguments 解析失败。

### 7.2 回归测试

- `tests/tool-registry.test.ts`
- `tests/tool-router.test.ts`
- `tests/provider-tool-adapter.test.ts`
- `tests/internal-capability-tool-adapter.test.ts`
- `tests/conversation-turn-service.test.ts`
- `tests/agent-runtime/openai-runtime.test.ts`

## 8. 风险与回退

| 风险 | 影响 | 控制方式 |
|---|---|---|
| 模型一次返回多个 tool calls | side effect 顺序不明 | M65 禁用并行；多调用安全失败 |
| 模型参数 JSON 不合法 | ToolRouter 输入污染 | 解析失败不执行，写安全诊断 |
| 模型伪造 projectId / artifactRefs | 越权或错误 side effect | ToolCallIntent 降级；server-authoritative 注入；伪造参数测试 |
| tool output 泄露内部字段 | 用户可见或模型回灌污染 | 教师语义 allowlist + final assistantText 工程词测试 |
| reasoning items 未传回 | reasoning 模型 continuation 失败 | 保留原 response.output items |
| 与 structured output 冲突 | OpenAIRuntime 回归 | 默认不启用 native loop，显式开关 |
| 绕过 CTS 门禁 | 产生未授权 side effect | loop runner 只走 ToolRouter，CTS 主链路仍做 gate |

回退方式：

- 保留 M64 ToolRouter 直接执行路径。
- 禁用 M65 native loop 开关。
- `OpenAIRuntime` 回到纯 structured output request。

## 9. 提交节奏

```text
commit 1：docs M65 native tool_call 规划
commit 2：GPT Protocol function_call 类型与 adapter
commit 3：ToolCallIntent 与 tool output serializer
commit 4：OpenAI tool-call loop runner
commit 5：OpenAIRuntime 可选接线
commit 6：M65 收尾验收
```

## 10. 成功标准

- 官方 function calling 五步流在本地协议层有对应实现。
- 模型 tool call 必须经 ToolRouter 受控执行。
- function_call_output 回灌安全、可测试、可熔断。
- M64 的 artifact truth、generation job、budget、observation 不回退。
- 所有新增能力都有 targeted tests，集中验收通过。
