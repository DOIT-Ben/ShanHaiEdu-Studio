# OpenAI SDK 与 GPT 协议适配分析

日期：2026-07-09

状态：探讨阶段分析文档，仅用于记录判断与后续重审；当前不进入具体开发实施

关联文档：

- `docs\product\2026-07-09-agent-os-first-principles-analysis.md`
- `docs\product\2026-07-09-agent-os-requirements-integration.md`
- `docs\product\2026-07-09-conversation-failure-derived-requirements.md`
- `docs\stages\local-real-mvp-m61-agent-os-context-memory-and-tool-reliability-plan.md`
- `docs\product\current-requirements-baseline.md`

## 1. 结论先行

当前文档只记录讨论结论、代码现状、官方依据、风险和后续可选路线，不代表已经批准开发，也不要求立即改代码。

用户判断“OpenAI SDK 应该介入”方向正确，但需要修正表述：

- 当前项目已经接入 `openai` JavaScript SDK，依赖版本为 `openai@^6.45.0`。
- 当前也已经调用了 `client.responses.create(...)`，不是完全没接 OpenAI SDK。
- 真正问题不是“有没有 SDK”，而是“SDK 只被当作 JSON 文本生成器使用，没有被收口为 GPT 协议适配层和 Agent loop 运行层”。
- 当前接入使用了 Responses API 的 `text.format.json_schema`，方向基本正确；但还没有使用 Responses API 的关键 agentic primitives：typed output items、function/tool calling、function_call_output、previous_response_id、reasoning items、conversation state、动态工具集。
- 因此 M61 不应继续叠加节点级 if-else，而应先补齐 `GptProtocolAdapter`、`ModelCapabilityProbe`、`ToolObservationLoop` 和 `AgentWorldState` 的边界。

推荐技术路线：

```text
短期：保留 OpenAI JS SDK，优先完整用好 Responses API，自建 ShanHaiEdu 的业务状态机与工具执行闭环。
中期：为 OpenAI-compatible 中转增加能力探测与 Chat Completions fallback adapter。
长期：评估是否引入 OpenAI Agents SDK，但不应在当前阶段直接整体替换现有 workflow/artifact 状态机。
```

## 2. 用户观点与修正

### 2.1 用户观点

用户提出：

> “我们还没接入 OpenAI SDK 吧？这个应该介入吧？”

该观点背后的核心判断是：当前系统没有充分利用 GPT 模型协议能力，导致模型像被锁在固定流程和 JSON 填空里，不能自主理解、规划、修正、重试和换路。

### 2.2 修正后的判断

经代码核对：

- `package.json` 已包含 `openai@^6.45.0`。
- `src\server\agent-runtime\runtime-factory.ts` 使用 `import OpenAI from "openai"` 并创建 client。
- `src\server\conversation\model-main-conversation-agent.ts` 使用 `client.responses.create(...)`。
- `src\server\conversation\conversation-orchestrator.ts` 使用 `client.responses.create(...)`。
- `src\server\agent-runtime\openai-runtime.ts` 使用 Responses API payload 和 structured output。

因此准确表述应为：

```text
OpenAI SDK 已接入，但没有作为统一 GPT 协议适配层介入；
Responses API 已使用，但没有用成 Agent loop；
当前接入是浅接入，不是协议级接入。
```

## 3. 官方文档依据摘要

以下事实来自 OpenAI 官方开发文档，2026-07-09 调研。

### 3.1 Responses API 与 Chat Completions

OpenAI 官方文档将 Responses API 定位为 Chat Completions 的演进版本，并推荐新项目使用 Responses API。

关键差异：

- Chat Completions 以 `messages` 为核心，输出 `choices[].message`。
- Responses API 以 typed `input/output items` 为核心，输出 `response.output`，SDK 提供 `response.output_text` helper。
- Responses API 支持 agentic loop，可以在一次或多次请求中处理内置工具、自定义 function tools、MCP、code interpreter、file search、web search 等。
- Responses API 支持 `previous_response_id` 和 Conversations API，以便处理多轮状态。
- Responses API 的 Structured Outputs 形态是 `text.format`，Chat Completions 旧形态通常是 `response_format`。

对 ShanHaiEdu 的意义：

```text
当前使用 Responses API endpoint 是对的；
但只读 output_text 会丢掉 function_call、reasoning、tool output 等 typed items 的协议语义。
```

### 3.2 Structured Outputs

官方文档说明：Structured Outputs 可以让模型输出符合 JSON Schema 的结构化结果。对于非工具调用场景，可用 `text.format` 约束模型最终回复；对于连接模型与系统工具、数据和动作的场景，应优先使用 function calling。

对 ShanHaiEdu 的意义：

- 当前 `model-main-conversation-agent.ts` 和 `openai-runtime.ts` 使用 `text.format.json_schema` 是合理的，但这只适合“让模型输出结构化决策/文本产物”。
- 当模型需要调用 ShanHaiEdu 工具，例如生成 PPT、生成图片、生成视频、检查 artifact、选择 fallback 时，不应只让模型填写 `toolPlan.capabilityId`，而应逐步迁移到 function calling 或至少模拟 function calling 的 observation loop。

### 3.3 Function calling / Tool calling

官方 function calling 流程包含五步：

1. 应用向模型请求，并提供可调用工具列表。
2. 模型返回 tool/function call。
3. 应用执行对应工具。
4. 应用把 tool output 作为 `function_call_output` 回传模型。
5. 模型输出最终回答，或继续发起更多 tool calls。

关键协议事实：

- Responses API 的 `response.output` 可包含 `function_call` item。
- 每个 function call 有 `call_id`，后续 `function_call_output` 要用该 `call_id` 关联。
- 对 reasoning 模型，带 tool call 的 reasoning items 也应随 tool outputs 一起传回后续请求。
- 模型可能一次返回多个 tool calls，应用需要按工具策略处理或关闭 parallel calls。

对 ShanHaiEdu 的意义：

```text
当前系统在工具失败后直接由业务层返回失败，模型没有收到 function_call_output/observation，
所以模型没有机会基于失败原因重试、换工具、降级或追问。
```

### 3.4 Conversation state

官方文档提供几种多轮状态方式：

- 手动把历史 user/assistant messages 传入 `input`。
- 把上一轮 `response.output` items 追加到下一轮 `input`。
- 使用 `previous_response_id` 连接 response chain。
- 使用 Conversations API 创建持久 conversation object。
- 如果 `store: false`，可以通过 `include: ["reasoning.encrypted_content"]` 在无状态模式下保留 reasoning items。

对 ShanHaiEdu 的意义：

- 当前系统自己拼 `projectContext`、`conversationContext`、`availableArtifactKinds`、`availableCapabilities`，这保留了业务控制权，但没有保留 Responses API 的 typed output/reasoning/tool-call 状态。
- 如果要让 GPT 真正具备“上一轮工具失败后继续推理”的能力，需要持久化或回传必要的 typed items / tool observations，而不是只把业务摘要塞给模型。

### 3.5 Agents SDK

官方文档区分：

- Responses API：适合应用自己控制 loop、tool routing、state、orchestration。
- Agents SDK：适合让 SDK 管理 recurring orchestration、agent loop、handoff、sessions、tracing、guardrails、approval flows。

对 ShanHaiEdu 的意义：

- ShanHaiEdu 已有项目、对话、artifact、workflow node、generation job、confirmation、quality gate、storage 等业务状态机。
- 因此当前更适合先用 Responses API 自建 loop，而不是立即引入 Agents SDK 接管全流程。
- Agents SDK 可以作为设计参考，尤其是 runner、trace、guardrail、approval、handoff，但不宜在 M61 初期直接替换现有业务状态机。

## 4. 当前代码状态

### 4.1 已接 OpenAI SDK 的位置

#### `package.json`

```json
"openai": "^6.45.0"
```

#### `src\server\agent-runtime\runtime-factory.ts`

- 创建 `new OpenAI({ apiKey, baseURL, timeout, maxRetries })`。
- 注入 `OpenAIRuntime`。
- 外层包了一层 `FallbackAgentRuntime`，OpenAI 失败时退回 `DeterministicRuntime`。

#### `src\server\agent-runtime\openai-runtime.ts`

- 调用 `client.responses.create(buildOpenAIResponseRequest(...))`。
- 使用 `text.format.json_schema` 要求模型输出 `assistantMessage`、`artifactDraft`、`nextSuggestedAction`。
- 只读取 `response.output_text`，没有处理 `response.output` typed items。

#### `src\server\conversation\model-main-conversation-agent.ts`

- 调用 `client.responses.create(buildMainAgentRequest(...))`。
- 使用 `text.format.json_schema` 输出 `assistantMessage`、`state`、`toolPlan`、`deliveryPlan` 等。
- 只读取 `response.output_text`。
- `toolPlan` 是业务 JSON，不是 GPT Responses function call。

#### `src\server\conversation\conversation-orchestrator.ts`

- 调用 `client.responses.create(buildOpenAIConversationRequest(...))`。
- 使用 structured output 做意图分类：`chat`、`clarify`、`start_requirement`。

### 4.2 当前接入的优点

- OpenAI SDK 已在服务端使用，符合项目规则“不得放进 React 组件”。
- 使用 Responses API 而不是继续只用 Chat Completions，方向符合新项目推荐。
- 使用 `text.format.json_schema`，比纯 prompt 要求 JSON 更稳定。
- 有 fallback runtime，避免模型不可用时系统完全崩溃。

### 4.3 当前接入的核心缺陷

#### 缺陷 A：没有统一协议适配层

当前多个模块各自 `new OpenAI(...)` 或各自接受 `OpenAIResponsesClient`：

- agent runtime 一套。
- main conversation agent 一套。
- conversation orchestrator 一套。

问题：

- 超时、重试、错误分类、脱敏日志、协议能力探测分散。
- 无法统一判断当前 `baseURL` 是否支持 Responses API 完整能力。
- 无法统一降级 Chat Completions。

#### 缺陷 B：没有 capability probe

`src\server\openai-compatible-config.ts` 只选择 key、baseURL、model。

但 OpenAI-compatible 中转可能只部分兼容：

- 可能支持 `/v1/chat/completions`，但不支持 `/v1/responses`。
- 可能支持普通 Responses text generation，但不支持 `text.format.json_schema`。
- 可能支持 structured output，但不支持 function calling。
- 可能支持 function calling，但不支持 `previous_response_id` 或 reasoning items。

当前没有探测，导致系统无法区分：

```text
模型真的不可用
vs
协议 endpoint 不兼容
vs
structured output 不兼容
vs
tool calling 不兼容
vs
中转吞字段/改字段
```

#### 缺陷 C：只读 `output_text`，没有处理 `response.output`

Responses API 的关键能力在 typed output items：

- `message`
- `reasoning`
- `function_call`
- `function_call_output`
- built-in tool call/output

当前只读 `response.output_text`，等于把 Responses API 降级成“最终文本获取器”。

这会导致：

- 无法执行 GPT 原生 function calls。
- 无法保留 reasoning/tool state。
- 无法把工具失败作为 protocol-level observation 回传。
- 无法实现模型多步调用工具直到完成的 loop。

#### 缺陷 D：`toolPlan` 是静态业务计划，不是模型工具调用

当前模型输出类似：

```json
{
  "toolPlan": {
    "capabilityId": "asset_image_generate"
  }
}
```

问题：

- capability 是否可用主要由静态表决定，不是动态 tool health。
- 模型没有得到工具执行结果的结构化 observation。
- 工具失败后，下一轮用户说“继续”，模型容易再次选择同一失败工具。
- 对 `asset_image_generate` 这类不可用工具，系统没有把失败转为可推理状态。

#### 缺陷 E：fallback runtime 可能掩盖真实协议错误

`FallbackAgentRuntime` 在 OpenAI runtime failed 后调用 deterministic runtime。

短期可用，但长期风险是：

- 协议错误被吞掉。
- 中转不兼容被误判为普通模型失败。
- deterministic 产物可能与“不得 mock/placeholder 冒充真实生成”的原则冲突。
- 用户以为 GPT 在工作，实际是 fallback 在输出。

#### 缺陷 F：缺少 GPT 状态链与本地业务状态的映射策略

当前 ShanHaiEdu 有本地 DB 状态，但没有定义：

- 哪些 GPT `response.id` 要持久化？
- 是否使用 `previous_response_id`？
- 是否保存 `response.output` items？
- 工具 observation 如何映射为 `function_call_output` 或本地 `ToolObservation`？
- `store: true/false` 如何选择？
- 中转不支持 stateful Responses 时如何降级？

## 5. 推荐架构

### 5.1 总体边界

推荐边界：

```text
React UI
  -> Next.js API / Server Actions
    -> ConversationTurnService
      -> AgentOrchestrator / AgentWorldState
        -> GptProtocolAdapter
          -> OpenAI JS SDK
        -> ToolRouter
          -> CapabilityRunner / ProviderAdapter
        -> ArtifactRepository / WorkflowRepository
```

OpenAI SDK 只能出现在服务端 runtime adapter 内，不进入 UI，不散落在业务服务里。

### 5.2 新增 GptProtocolAdapter

职责：

- 统一创建 OpenAI client。
- 统一管理 `model`、`baseURL`、timeout、maxRetries。
- 提供 Responses API 调用封装。
- 提供 Chat Completions fallback 封装。
- 统一解析 typed items。
- 统一错误分类和脱敏日志。
- 对外返回项目内部稳定类型，而不是直接泄露 OpenAI SDK response。

建议接口草案：

```ts
type GptProtocolMode = "responses" | "chat_completions";

type GptCapabilityProbeResult = {
  providerKind: "openai_native" | "openai_compatible" | "unknown";
  selectedMode: GptProtocolMode;
  supportsResponses: boolean;
  supportsChatCompletions: boolean;
  supportsStructuredOutputs: boolean;
  supportsFunctionCalling: boolean;
  supportsPreviousResponseId: boolean;
  supportsReasoningItems: boolean;
  limitations: string[];
};

type GptTurnInput = {
  instructions: string;
  worldState: AgentWorldState;
  tools: GptToolDefinition[];
  responseChain?: GptResponseChainState;
  outputContract?: GptStructuredOutputContract;
};

type GptTurnResult = {
  assistantMessage?: string;
  structuredOutput?: unknown;
  toolCalls: GptToolCall[];
  responseState: GptResponseChainState;
  rawDiagnostics: GptDiagnostics;
};
```

### 5.3 新增 ModelCapabilityProbe

目标：启动或首次使用时确认当前 provider 能力。

探测项：

1. Responses 基础生成。
2. Responses `text.format.json_schema`。
3. Responses function calling。
4. Responses `previous_response_id`。
5. Chat Completions 基础生成。
6. Chat Completions structured output。
7. Chat Completions function calling。

探测原则：

- 不回显密钥。
- 不写业务代码硬编码 key。
- 探测结果写入本地 server-only cache 或 DB health 表。
- UI 只显示“智能生成服务可用/部分可用/不可用”，不暴露 endpoint、schema、provider debug。

输出示例：

```json
{
  "selectedMode": "responses",
  "supportsResponses": true,
  "supportsStructuredOutputs": true,
  "supportsFunctionCalling": false,
  "supportsPreviousResponseId": false,
  "limitations": ["当前中转不支持 Responses function_call items"]
}
```

### 5.4 新增 ToolObservationLoop

目标：工具执行后不直接结束，而是把结果回传给模型。

ShanHaiEdu 内部 observation：

```ts
type ToolObservation = {
  toolId: string;
  callId?: string;
  status: "succeeded" | "failed" | "blocked";
  errorType?: "provider_unavailable" | "missing_input" | "quality_gate_failed" | "unsupported_capability" | "rate_limited" | "unknown";
  teacherMessage: string;
  internalDiagnostic?: string;
  retryable: boolean;
  fallbackOptions: AgentFallbackOption[];
  outputArtifactId?: string;
};
```

Responses API 模式下，优先映射为：

```json
{
  "type": "function_call_output",
  "call_id": "call_xxx",
  "output": "{...tool observation json...}"
}
```

如果不支持 function calling，则退化为普通 input message 中的结构化 observation，但必须保留相同语义。

### 5.5 动态工具暴露策略

当前 `availableCapabilities` 是静态列表。M61 应改为动态列表：

```text
真实可用工具
+ 当前节点允许工具
+ 上游 artifact 已满足工具
+ provider health 通过工具
+ 用户权限/确认状态允许工具
```

对模型暴露工具时遵守：

- 不把不可用工具暴露为可执行工具。
- 可以把不可用工具作为状态/限制告诉模型，让模型解释或选择 fallback。
- 初始工具数尽量少，避免一次暴露全部 capability。
- 对需要确认、会写文件、会调用外部服务的工具加 approval/confirmation gate。

### 5.6 Responses API 与 Chat Completions fallback

推荐模式：

```text
首选：Responses API + structured output + function calling + local AgentWorldState
降级：Responses API + structured output + 手写 ToolObservationLoop
再降级：Chat Completions + structured output/function calling adapter
最低：模型不可用，停止自动生成，不用 deterministic 冒充真实模型输出
```

关键原则：

- fallback 是协议能力降级，不是质量门禁降级。
- 任何生成产物仍必须真实保存、真实校验。
- deterministic runtime 只能用于测试或明确的本地规则判断，不能伪装成模型生成。

## 6. 是否引入 OpenAI Agents SDK

### 6.1 不建议 M61 初期直接整体引入

原因：

- ShanHaiEdu 已有自己的业务状态机和 artifact 数据模型。
- Agents SDK runner 可能接管 loop、state、handoff、approval，与现有 workflow engine 边界重叠。
- 当前首要问题是协议适配和 observation loop，不是多 agent handoff。
- 直接引入会扩大改动面，不利于定位卡点。

### 6.2 可以作为中期评估项

适合评估的功能：

- tracing / observability。
- guardrails / approvals。
- resumable state。
- specialist handoff，例如 PPT agent、image agent、video agent、package agent。
- sessions 管理。

### 6.3 当前推荐

```text
M61：使用 OpenAI JS SDK + Responses API，自建 ShanHaiEdu Agent loop。
M62 或以后：对 OpenAI Agents SDK 做小型 POC，只评估 trace/guardrail/handoff，不直接迁移主链路。
```

## 7. 与当前卡点的关系

### 7.1 asset_image_generate 卡死

当前现象：

- 用户说“继续下一步”“生成图片”“先生成图片”。
- pending plan 固定在 `asset_image_generate`。
- 工具不可执行或被硬拦。
- 模型没有看到“工具失败且不可用”的 observation。
- 后续继续撞同一失败工具。

按新方案应变为：

```text
模型选择 image generation tool
-> ToolRouter 发现 provider 不可用或缺上游
-> 返回 ToolObservation(status=blocked/failed, fallbackOptions=[...])
-> 模型收到 observation
-> 模型选择：生成图片提示词 / 请求用户确认换路 / 跳过图片先做 PPTX / 调用本地 fallback
```

### 7.2 假上游记忆

当前 `availableArtifactKinds` / `upstreamAvailable` 可能把未真实生成成功的 `pptx_artifact` 或 `image_prompts` 当成可用。

新方案要求：

- AgentWorldState 必须从真实 artifact、job status、quality gate 反推。
- 不从计划推断“已经有产物”。
- 模型上下文中明确区分：planned / running / failed / needs_review / approved / usableAsInput。

### 7.3 硬编码小学门禁

当前存在短期止血逻辑：代码里用关键词判断是否超出小学范围。

新方案要求：

- 小学范围仍是产品边界。
- 但应优先作为模型 instruction + soft constraint + review gate。
- 只有真正越界生成交付产物时才做硬门禁。
- 不应在用户自然输入阶段用关键词直接锁死模型理解。

## 8. 推荐实施阶段

### Phase 0：只读核查与文档对齐

目标：把协议问题纳入 M61 正式范围。

任务：

- 完成本分析文档。
- 更新 M61 阶段计划，加入 GPT 协议适配专项。
- 列出当前 SDK 调用点和风险。

验收：

- 文档存在。
- M61 文档引用本分析。
- 不改运行逻辑。

### Phase 1：GptProtocolAdapter 骨架

目标：把散落的 OpenAI client 创建收口。

任务：

- 新建 server-only `GptProtocolAdapter`。
- 统一 OpenAI client 创建。
- 保持现有功能不变，只迁移调用入口。
- 增加错误分类和脱敏 diagnostics。

验收：

- 原测试通过。
- OpenAI 调用点减少到 adapter 内。
- UI 不出现工程词。

### Phase 2：ModelCapabilityProbe

目标：确认当前 provider/中转能力。

任务：

- 增加可手动运行的 server-side probe。
- 探测 Responses、Chat Completions、structured outputs、function calling、previous_response_id。
- 记录脱敏结果。

验收：

- 无密钥泄露。
- 能明确当前环境是 full responses / partial responses / chat-only / unavailable。

### Phase 3：ToolObservationLoop 最小闭环

目标：先解决当前卡点，不全量重写工具。

任务：

- 选一个工具链试点：`asset_image_generate` 或 `coze_ppt`。
- 工具失败后产生 `ToolObservation`。
- 下一轮模型输入包含 observation。
- 模型能选择 fallback、追问或停止，而不是重复撞失败工具。

验收：

- 复测“继续下一步 / 生成图片 / 先生成图片”不再重复撞同一失败文案。
- 不产生假 artifact。
- 教师界面不暴露 provider/debug/schema。

### Phase 4：Responses function calling 试点

目标：把至少一个内部工具从 `toolPlan JSON` 迁移为 GPT function tool。

任务：

- 定义 1-3 个 function tools，例如：
  - `inspect_project_state`
  - `generate_ppt_design`
  - `run_image_asset_generation`
- 处理 `response.output` 中的 `function_call`。
- 执行工具后回传 `function_call_output`。

验收：

- 模型可以根据工具结果继续推理。
- 工具失败后模型能换路。
- 保留本地 artifact truth gate。

### Phase 5：状态链策略

目标：决定是否保存 GPT response chain。

任务：

- 评估 `previous_response_id` 与本地持久化 response.output items 两种方案。
- 根据数据保留、成本、可复现、兼容中转情况选择默认策略。
- 明确 `store: true/false`。

验收：

- 多轮对话不会丢关键上下文。
- 可从本地 DB 复盘工具失败与模型决策。
- 不依赖不可控远端状态才能恢复项目。

## 9. 风险与约束

### 9.1 中转兼容风险

OpenAI-compatible 不等于完整 OpenAI Responses API。

必须实测，不允许假设。

### 9.2 成本和上下文风险

传入完整 AgentWorldState、工具 schema、历史 output items 会增加 token。

需要：

- 工具按需暴露。
- ContextCompiler 摘要压缩。
- 长对话 compaction。

### 9.3 数据保留风险

使用 Responses 默认 stateful 能力可能涉及 response 存储。

需要：

- 明确是否设置 `store: false`。
- 不把敏感个人信息或密钥放入模型上下文。
- 如果使用 encrypted reasoning items，需验证 provider 支持。

### 9.4 过早引入 Agents SDK 的风险

Agents SDK 可能带来更强能力，但也可能导致状态机双轨、调试复杂、交付周期拉长。

当前应先把 Responses API 用正确。

### 9.5 模型过度自主风险

释放模型不等于取消门禁。

硬门禁仍必须保留在：

- 真实文件交付。
- 安全与敏感信息。
- 质量达标。
- 外部服务写入/成本较高动作。
- 用户确认。

## 10. 后续重审清单

后续基于本文档重新审视系统时，应逐项确认：

- [ ] OpenAI SDK 调用是否已收口到统一 adapter。
- [ ] 当前 provider 是否经过能力探测。
- [ ] 是否明确 Responses API / Chat Completions 的选择与降级策略。
- [ ] 是否仍只读 `output_text`，忽略 `response.output`。
- [ ] 是否有至少一个工具完成 function_call / observation loop。
- [ ] 工具失败是否能回传模型，而不是直接卡死用户。
- [ ] `availableCapabilities` 是否按真实 tool health 动态暴露。
- [ ] `availableArtifactKinds` 是否从真实 artifact 和质量门禁反推。
- [ ] deterministic fallback 是否仍可能冒充模型生成。
- [ ] 教师界面是否没有暴露工程词。
- [ ] M61 是否停止新增关键词硬拦截和节点 if-else 补丁。

## 11. 最终建议

本项目应把 OpenAI SDK 从“散落的模型调用库”升级为“GPT 协议适配层”。

不是简单换 API，也不是直接上 Agents SDK，而是：

```text
OpenAI JS SDK
  -> GptProtocolAdapter
    -> Responses typed items / structured outputs / function calling / state
      -> ShanHaiEdu AgentWorldState
        -> ToolObservationLoop
          -> Artifact truth gate
            -> 教师可见交付
```

这条路线能同时满足：

- 释放 GPT 模型理解、规划、修正、换路能力。
- 保留 ShanHaiEdu 对项目、产物、质量、确认和安全的控制权。
- 避免继续用关键词和节点 if-else 把模型锁死。
- 避免工具失败后重复撞同一个失败工具。
- 为后续是否引入 Agents SDK 留出清晰边界。
