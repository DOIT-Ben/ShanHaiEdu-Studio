# M64 Tool Registry / ToolRouter 工具层规划

日期：2026-07-09

状态：阶段规划；以本文作为 M64 工具层开发总控。M64 开发前必须先阅读 `docs\product\current-requirements-baseline.md`、智能体统一口径文档、核心设计串联文档和本文。

## 1. 阶段背景

M62 已建立 `AgentWorldState`、`CapabilityAvailability` 和 `GptProtocolAdapter`，让模型能看到可信世界状态与能力可用性。M63 已建立 `ToolObservation` 和 `AgentHarnessBudget`，让失败可见、可恢复、可熔断。

当前仍缺一个关键中间层：

```text
GPT tool_call / 内部 toolPlan
  -> ToolRouter
    -> Internal Capability Adapter
    -> Provider Adapter
    -> MCP Client Adapter
  -> ToolResult / Artifact / ToolObservation
```

M64 的目标不是接入 MCP，也不是一次性切换到 OpenAI Responses 原生 tool loop，而是先把现有 ShanHaiEdu 工具能力注册化、路由化，让后续新增工具只注册、不改主链路。

## 2. 统一口径

```text
OpenAI SDK 管模型，MCP 管工具，中间需要 ToolRouter / Agent Runtime。
MCP 是工具接入协议之一，不是 Agent OS 状态机，也不是 OpenAI SDK 的替代品。
GPT 只提出 tool_call 意图；真实执行必须由后端 ToolRouter、adapter、gate 和 truth gate 控制。
```

ShanHaiEdu 分层：

```text
React UI
  -> ShanHaiEdu Backend / ConversationTurnService
    -> AgentOrchestrator / AgentWorldState
      -> GptProtocolAdapter
        -> OpenAI SDK / Responses API
          -> GPT 模型
      -> ToolRouter
        -> Internal Capability Adapter
        -> Provider Adapter
        -> MCP Client Adapter
          -> MCP Server / External Tool
```

## 3. 阶段目标

M64 必须完成：

1. 建立 `ToolDefinition` 标准，声明工具 ID、描述、schema、adapter、门禁、副作用、产物和失败策略。
2. 建立 `ToolRegistry`，把现有稳定能力注册为工具。
3. 建立 `ToolRouter`，把现有 `CapabilityToolPlan` 路由到 Internal 或 Provider adapter。
4. 复用 M63 的 `ToolObservation` / `AgentHarnessBudget`，把阻断、失败、成功统一成 `ToolExecutionResult`。
5. 从 `ConversationTurnService` 剥离第一批工具执行分支，避免继续扩大主链路。
6. 为未来 MCP 保留 `mcp` adapterKind 和接口边界，但本阶段不接真实 MCP server。

## 4. 明确不做项

M64 不做：

- 不接真实 MCP client / MCP server。
- 不把 OpenAI Responses 原生 `function_call_output` 闭环直接接到真实执行。
- 不让 GPT tool_call 绕过 `PlanGuard`、`HumanGate`、`CapabilityAvailability`、`AgentHarnessBudget` 或 `Quality Gate`。
- 不一次性注册尚未真实接通的 `asset_image_generate`、`concat_only_assemble`、`intro_video` 为可执行工具。
- 不把 provider、本地路径、token、task id、外部 URL 写入教师可见文本。
- 不重写整个 workflow engine。

## 5. ToolDefinition 初版契约

建议类型字段：

```ts
type ToolDefinition = {
  id: string;
  label: string;
  description: string;
  adapterKind: "internal_capability" | "provider" | "mcp";
  capabilityId?: CapabilityId;
  providerToolId?: string;
  mcpServerId?: string;
  mcpToolName?: string;
  inputSchema: JsonSchemaObject;
  outputSchema: JsonSchemaObject;
  requiresHumanGate: boolean;
  sideEffectLevel: "none" | "artifact_write" | "external_call" | "file_write" | "package_write";
  requiredArtifactKinds: string[];
  producedArtifactKind?: string;
  failurePolicy: {
    retryable: boolean;
    maxRetries: number;
    onFailure: "record_observation";
  };
  implemented: boolean;
  blockedReason?: string;
};
```

初版要求：

- `inputSchema` 必须是严格 JSON Schema object，`additionalProperties: false`。
- `description` 给模型看，必须是教师业务语义，不写 provider、storage、debug、runtimeKind 等工程词。
- `requiresHumanGate` 对任何写 artifact、外部调用、文件写入、打包动作默认 `true`。
- `requiredArtifactKinds` 由 capability 的 `upstreamCapabilities` 推导，但允许在文档里显式标注当前不一致项。
- `implemented: false` 的工具可以注册为“不可执行能力”，但 ToolRouter 必须返回 blocked observation，不得执行。

## 6. 第一批工具注册范围

### 6.1 首批 internal capability 工具

注册这些已由 `CapabilityRunner` 支持的内部能力：

| toolId | capabilityId | requiredArtifactKinds | producedArtifactKind |
|---|---|---|---|
| `create_requirement_spec` | `requirement_spec` | `[]` | `requirement_spec` |
| `create_lesson_plan` | `lesson_plan` | `["requirement_spec"]` | `lesson_plan` |
| `create_ppt_outline` | `ppt_outline` | `["requirement_spec"]` | `ppt_draft` |
| `create_ppt_design_draft` | `ppt_design` | `["ppt_draft"]`，后续可加强为同时要求 `lesson_plan` | `ppt_design_draft` |
| `extract_knowledge_anchors` | `knowledge_anchor_extract` | `["lesson_plan"]` | `knowledge_anchor_extract` |
| `generate_intro_creative_themes` | `creative_theme_generate` | `["knowledge_anchor_extract"]` | `creative_theme_generate` |
| `generate_intro_video_script` | `video_script_generate` | `["creative_theme_generate"]` | `video_script_generate` |
| `generate_video_storyboard` | `storyboard_generate` | `["video_script_generate"]` | `storyboard_generate` |
| `generate_video_asset_brief` | `asset_brief_generate` | `["storyboard_generate"]` | `asset_brief_generate` |
| `plan_video_segments` | `video_segment_plan` | `["storyboard_generate", "asset_image_generate"]` | `video_segment_plan` |
| `create_final_delivery_checklist` | `final_package` | 按 registry 最小口径 | `final_delivery` |

### 6.2 首批 provider 工具

注册现有真实 provider 链路：

| toolId | capabilityId | providerToolId | requiredArtifactKinds | producedArtifactKind |
|---|---|---|---|---|
| `generate_pptx_from_design` | `coze_ppt` | `coze_ppt.generate_pptx` | `["ppt_design_draft"]` | `pptx_artifact` |
| `generate_classroom_image` | `image_asset` | `image_generation.generate_classroom_image` | 当前需先统一 `ppt_design_draft` 与 `ppt_draft` 源口径 | `image_prompts` |
| `generate_video_segment` | `video_segment_generate` | `video_generation.generate_segment` | `["video_segment_plan", "asset_image_generate"]` | `video_segment_generate` |

M64 第一阶段实现建议：`generate_pptx_from_design` 必须接入；`generate_classroom_image` 和 `generate_video_segment` 可以先注册并保持现有 provider route 语义，若源口径不一致则作为 M64-A 的修正项处理。

### 6.3 暂缓执行型注册

这些能力可以在 registry 中标记 `implemented: false`，但不得暴露为可执行真实工具：

- `intro_video`：当前没有清晰执行路径。
- `asset_image_generate`：真实 provider/availability 未接通。
- `concat_only_assemble`：真实拼接未接通，当前 unsupported。

## 7. ToolRouter 初版职责

`ToolRouter.execute(...)` 负责：

```text
1. 查 ToolDefinition。
2. 校验 tool arguments schema。
3. 检查 requiredArtifactKinds 与 approved artifacts。
4. 检查 CapabilityAvailability。
5. 检查 PlanGuard / HumanGate。
6. 检查 AgentHarnessBudget。
7. 根据 adapterKind 调用 Internal / Provider / MCP adapter。
8. 将结果映射为 ToolExecutionResult。
9. 成功写 tool_succeeded budget event；失败写 ToolObservation 和 budget event。
```

`ToolRouter` 不负责：

- 不生成教师 UI 文案版式。
- 不直接操作 React UI。
- 不保存未通过 truth gate 的假 artifact。
- 不执行未确认的高副作用动作。
- 不把 provider 原始错误、外部 URL、本地绝对路径、token 写入可见结果。

## 8. ToolExecutionResult 初版契约

```ts
type ToolExecutionResult =
  | {
      status: "succeeded";
      toolId: string;
      capabilityId?: CapabilityId;
      artifact?: ArtifactRecord;
      assistantSummary: string;
      budgetEvent: AgentHarnessBudgetEvent;
    }
  | {
      status: "blocked" | "needs_input" | "failed" | "retryable_failed" | "quality_gate_failed";
      toolId: string;
      capabilityId?: CapabilityId;
      observation: ToolObservation;
      budgetEvent: AgentHarnessBudgetEvent;
      artifactCreated: false;
    };
```

成功必须由 adapter 返回真实 artifact 或明确无副作用结果。失败必须 `artifactCreated: false`。

## 9. Provider Adapter Result 与 Artifact Truth Gate

M64 需要为 provider 链路统一结果，避免 `conversation-turn-service.ts` 继续按 message 文本判断失败类别。

Provider adapter 结果至少包含：

```text
status: succeeded | blocked | provider_unavailable | retryable_failed | quality_gate_failed | artifact_truth_failed | timeout
artifactTruth.created / persisted / placeholder=false
localOutput / fileName / bytes / sha256 / mime
qualityGate.passed / gates[]
failure.category / code / teacherSafeMessage / internalReasonSanitized / retryable / nextAction
```

真实 PPTX、图片、视频必须继续遵守：

- PPTX：zip、`ppt/presentation.xml`、slideCount 与 requestedPageCount。
- 图片：PNG/JPEG 格式、最小 bytes、mime。
- 视频：MP4 `ftyp` / `moov`、最小 bytes、mime。
- 不保存 provider 外部 URL 或 token。

## 10. GPT tool_call 与 OpenAI Responses 的阶段边界

M64 先注册/路由现有 `CapabilityToolPlan`，不先做完整 OpenAI function_call 回灌循环。

可选预备工作：让 `ToolDefinition` 能导出成 Responses function tool schema，但默认只用于文档和后续协议适配，不直接让 GPT tool_call 绕过当前 state machine。

后续 M65 再处理：

```text
Responses function_call
  -> ToolCallIntent
  -> ToolRouter
  -> function_call_output / ToolObservation
  -> GPT continuation
```

## 11. 任务拆分与并发执行方式

### M64-A：工具契约与注册表

目标：新增 `src\server\tools\tool-types.ts`、`tool-registry.ts` 和第一批 ToolDefinition。

验收：

- 注册表能按 `toolId` 查询工具。
- 能按 `capabilityId` 找到对应工具。
- 能导出模型安全的 tool schema。
- 未实现工具返回 blocked definition，不可执行。

### M64-B：Internal Capability Adapter

目标：把 `runCapabilityWithAgentRuntime` 包成 `internal_capability` adapter。

验收：

- `create_requirement_spec` 成功保存 artifact。
- `create_lesson_plan` 无 approved `requirement_spec` 时 blocked。
- validation/provider/unknown failure 能映射 ToolObservation。

### M64-C：Provider Adapter 统一结果

目标：把 `coze_ppt`、`image_asset`、`video_segment_generate` 的现有 provider 分支收束成 provider adapter result。

验收：

- `generate_pptx_from_design` 质量门禁失败返回 `quality_gate_failed`。
- 成功 provider result 包含 truth fields。
- 失败不保存假 artifact。
- 结果不泄露 token、外部 URL、本地绝对路径。

### M64-D：ToolRouter 集成

目标：让 `ConversationTurnService` 第一批执行路径改为调用 `ToolRouter.execute(...)`。

验收：

- PlanGuard / HumanGate / CapabilityAvailability / AgentHarnessBudget 顺序不回退。
- 现有完整材料包链路仍可推进。
- `conversation-turn-service.ts` 不再新增 capability/provider 业务分支。

### M64-E：文档、验收与提交

目标：更新收尾记录，运行集中验收，审查后提交。

验收：

- targeted vitest 通过。
- `npx tsc --noEmit` 通过。
- `npm run build` 通过。
- `graphify update .` 已运行。
- 每个阶段按提交边界提交，不跨阶段混合。

## 12. 推荐提交节奏

```text
commit 1：docs M64 统一口径与规划
commit 2：M64-A ToolDefinition / ToolRegistry
commit 3：M64-B Internal Capability Adapter
commit 4：M64-C Provider Adapter Result
commit 5：M64-D ToolRouter 集成 ConversationTurnService
commit 6：M64-E 收尾文档与集中验收
```

每个 commit 前至少运行对应 targeted tests；集成 commit 前运行集中验收。

## 13. 集中验收命令

M64 完成后至少执行：

```powershell
npx vitest run tests/tool-registry.test.ts tests/tool-router.test.ts tests/internal-capability-tool-adapter.test.ts tests/provider-tool-adapter.test.ts tests/conversation-turn-service.test.ts tests/agent-harness-budget.test.ts tests/tool-observation.test.ts --maxWorkers=1
```

```powershell
npx tsc --noEmit
```

```powershell
npm run build
```

提交前：

```powershell
graphify update .
git status --short
git diff --check
```

## 14. 风险与回退

- `ConversationTurnService` 已偏大，M64-D 必须外科式迁移，不做无关重写。
- `image_asset` 的 required source 口径当前不一致，必须先明确 `ppt_design_draft` 与 `ppt_draft` 的真实依赖。
- Provider adapter result 若一次性抽太大，优先只迁移 `coze_ppt`，图片/视频保留注册但不扩大行为。
- 如 M64-D 引发回归，可回退到 M63 的 direct capability/provider execution，但保留 ToolDefinition 文档与注册表测试。
- 不得为了让测试通过把 deterministic draft 或 placeholder 写成真实产物。
