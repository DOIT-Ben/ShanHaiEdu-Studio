# M66 Runtime Native Tool Loop 主线接入实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or an equivalent reviewer-gated workflow to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 M65 已完成 OpenAI Responses 原生 `function_call -> function_call_output -> continuation` 可选闭环的基础上，建立安全可回退的主线接入方案，让 `OpenAIRuntime` 能在受控配置下进入真实对话执行链路，同时不绕过 `ConversationTurnService`、`ToolRouter`、Artifact truth、PlanGuard、HumanGate、Quality Gate 与预算门禁。

**Architecture:** M66 不把工具调用能力直接散落到 `ConversationTurnService`，而是在 Runtime 工厂层增加显式配置与 server-authoritative mapper；主线仍由 `ConversationTurnService` 负责项目、消息、Artifact 与 GenerationJob 持久化。工具选择可由模型表达，但工具执行输入必须由后端当前项目状态、已确认产物、触发消息和能力门禁构造。

**Tech Stack:** TypeScript、Next.js 后端服务、Vitest、OpenAI Responses Adapter、`OpenAIRuntime`、`ToolRegistry`、`ToolRouter`、`ConversationTurnService`。

---

## 1. 当前收尾状态

M65 已完成并收尾：

- 最新 M65 收尾提交：`6674233 docs: 完成M65原生工具调用验收收尾 | v0.9.96 | 2026-07-10 11:00`
- M65 最终能力：GPT Protocol 支持 OpenAI Responses function tools；模型 tool call 会先降级为 `ToolCallIntent`；工具结果通过安全 serializer 回灌；`OpenAIRuntime` 仅在显式配置 `nativeToolLoop` 时启用闭环。
- M65 集中验收：9 个测试文件、91 个测试通过；`npx tsc --noEmit` 通过；`npm run build` 通过；`graphify update .` 通过。
- 当前边界：未接真实 MCP，未把 native loop 接入 `ConversationTurnService` 主链路，未做生产 provider / E2E 验证。

## 2. 推荐方向

推荐 M66 先做“**主线接入前的受控 Runtime 配置层**”，不要直接把所有工具暴露给模型，也不要改动前端流程。

理由：

1. M65 的 loop runner 已证明协议闭环可行，但 `createAgentRuntimeFromEnv(...)` 默认仍创建普通 `OpenAIRuntime`，主链路尚未启用 native tool loop。
2. `ConversationTurnService` 当前已经在 `runPlannedArtifact(...)` 中完成 CapabilityAvailability、PlanGuard、HumanGate、AgentHarnessBudget，再进入 `ToolRouter` 或 `runCapabilityWithAgentRuntime(...)`；M66 必须复用这条门禁顺序，不能让模型直接绕过。
3. `ToolRouterInput` 中的 `projectId`、`artifactRefs`、`approvedArtifacts`、`sourceMessageId`、`projectContext` 必须来自后端状态；M66 需要把这个映射从测试示例升级为可复用工厂，而不是让业务代码临时拼接。
4. 主线接入必须可回退：环境变量未开启或依赖不完整时，系统继续走 M65 之前的 structured output 路径。

## 3. 范围

### 3.1 M66 纳入范围

- 新增 Runtime native tool loop 配置构建模块，按 `AgentRuntimeInput.task` 动态声明单工具 allowlist、OpenAI tools schema、ToolRouter 调用和 server-authoritative mapper。
- 为 native loop 内部工具执行准备一个“无 native loop 的子 Runtime”，避免 `OpenAIRuntime -> ToolRouter -> internal capability -> OpenAIRuntime` 无限递归。
- 在 `createAgentRuntimeFromEnv(...)` 中用显式环境开关启用 native tool loop；默认关闭。
- 只允许首批低风险 internal capability tools 进入 native loop allowlist；provider 型 `coze_ppt` 暂不在 M66 首批主线暴露，避免模型在同一轮里触发真实外部文件生成。
- 为 `AgentRuntimeInput` 增加可选 `sourceMessageId`，并从 `ConversationTurnService` 当前触发教师消息向下传递，保证 ToolObservation / budget 审计链不误用 `runId`。
- 为主线配置补测试：默认关闭、显式开启、依赖缺失回退、伪造字段不进入 ToolRouter、失败文案不泄露工程词。
- 更新阶段收尾文档，记录 M66 的接入边界、验证结果、回退方式。

### 3.2 M66 不纳入范围

- 不接真实 MCP Client / MCP Server。
- 不支持并行 tool calls。
- 不把所有工具一次性暴露给模型。
- 不改前端 UI。
- 不改部署、生产密钥、账号权限或外部 provider 配置。
- 不把 Artifact 持久化责任从 `ConversationTurnService` 移到 adapter、runner 或 router。
- 不允许模型直接写数据库、文件、GenerationJob 或 provider 参数。

## 4. 文件结构与职责

### 新增文件

- `src/server/agent-runtime/native-tool-loop-config.ts`
  - 负责构建 `OpenAIRuntimeNativeToolLoopResolver`：每次 `runtime.run(input)` 根据 `input.task` 返回单工具 options。
  - 负责读取可暴露工具定义、按当前 task 生成一个 OpenAI function tool schema、定义单工具 allowlist。
  - 负责把 `ToolCallIntent + AgentRuntimeInput` 转成 `ToolRouterInput`。
  - 负责注入 internal capability 执行时使用的子 Runtime；该 Runtime 不启用 native loop。
  - 只使用 server-authoritative runtime input，不读取模型伪造字段。

- `tests/agent-runtime/native-tool-loop-config.test.ts`
  - 覆盖 allowlist、schema 导出、mapper 安全、缺依赖回退。

- `docs/stages/local-real-mvp-m66-runtime-tool-loop-mainline-closeout.md`
  - M66 完成后的集中验收和风险记录。

### 修改文件

- `src/server/agent-runtime/runtime-factory.ts`
  - 在环境开关开启时注入 native tool loop 配置。
  - 默认路径不变。

- `src/server/agent-runtime/types.ts`
  - 为 `AgentRuntimeInput` 增加可选 `sourceMessageId?: string`，不改变已有调用方必填字段。

- `src/server/capabilities/capability-runner.ts`
  - 为 `AgentRuntimeCapabilityInput` 增加可选 `sourceMessageId?: string`，传入 `runtime.run(...)`。

- `src/server/conversation/conversation-turn-service.ts`
  - 在调用 `runCapabilityWithAgentRuntime(...)` 时传入 `triggerMessage.id`，只做审计上下文透传，不改门禁顺序。

- `src/server/agent-runtime/openai-runtime.ts`
  - 支持 native tool loop resolver：每次 `run(input)` 按当前 task 解析工具配置；默认静态 structured output 行为不变。
  - 不改变默认 structured output schema。

- `tests/agent-runtime/openai-runtime.test.ts`
  - 只补回归测试，不重复测试 M65 已覆盖的 runner 细节。

- `tests/agent-runtime/runtime-factory.test.ts`
  - 若当前不存在，则新增；若已有，则补默认关闭/显式开启测试。

## 5. 开关设计

新增环境变量建议：

```text
SHANHAI_OPENAI_NATIVE_TOOL_LOOP=1
```

规则：

1. 未设置或不等于 `1`：不启用 native tool loop。
2. 设置为 `1` 但 OpenAI-compatible config 不存在：继续返回 `DeterministicRuntime` fallback。
3. 设置为 `1` 且配置存在：`createAgentRuntimeFromEnv(...)` 创建带 `nativeToolLoop` 的 `OpenAIRuntime`，外层仍包 `FallbackAgentRuntime`。
4. 后续如需灰度到 provider 工具，另起 M67，不在 M66 混入。

## 5.1 递归防护设计

M66 必须特别处理 internal capability 的递归风险。当前 `ToolRouter` 执行 internal capability 时需要 `runtime`，并会通过 `runCapabilityWithAgentRuntime(...)` 再次调用 `runtime.run(...)`。如果 native loop 内部把“当前同一个 `OpenAIRuntime`”传回 `ToolRouterInput.runtime`，会形成以下递归：

```text
OpenAIRuntime(native loop)
  -> runOpenAIToolCallLoop
  -> ToolRouter internal capability
  -> runCapabilityWithAgentRuntime
  -> OpenAIRuntime(native loop)
  -> ...
```

因此 M66 的配置工厂必须显式接收或创建一个 **toolExecutionRuntime**：

```text
primaryRuntime = OpenAIRuntime(native loop enabled)
toolExecutionRuntime = FallbackAgentRuntime(OpenAIRuntime(native loop disabled), DeterministicRuntime)
```

`buildToolRouterInput(...)` 只能把 `toolExecutionRuntime` 注入 `ToolRouterInput.runtime`。测试必须断言注入的不是 primary runtime，也不能为空。

## 6. 首批 allowlist

M66 首批建议只开放 internal capability tools：

```text
create_requirement_spec
create_lesson_plan
create_ppt_outline
create_ppt_design_draft
extract_knowledge_anchors
generate_intro_creative_themes
generate_intro_video_script
generate_video_storyboard
generate_video_asset_brief
plan_video_segments
create_final_delivery_checklist
```

暂不开放：

```text
generate_pptx_from_design
asset_image_generate
intro_video
concat_only_assemble
```

原因：这些能力涉及外部 provider、真实文件、视频或最终交付 side effect，需要 HumanGate、GenerationJob 与 Quality Gate 更完整的主线设计，不应在 M66 首批让模型自由选择。

## 7. 实施任务

### Task 1: 建立 native tool loop 配置模块

**Files:**
- Modify: `src/server/agent-runtime/types.ts`
- Modify: `src/server/agent-runtime/openai-runtime.ts`
- Modify: `src/server/capabilities/capability-runner.ts`
- Modify: `src/server/conversation/conversation-turn-service.ts`
- Create: `src/server/agent-runtime/native-tool-loop-config.ts`
- Create: `tests/agent-runtime/native-tool-loop-config.test.ts`

- [ ] **Step 0: 扩展 Runtime 输入审计上下文与 resolver 类型**

在 `src/server/agent-runtime/types.ts` 为 `AgentRuntimeInput` 增加可选字段：

```ts
export type AgentRuntimeInput = {
  projectId: string;
  runId: string;
  sourceMessageId?: string;
  task: AgentRuntimeTask;
  userMessage: string;
  projectContext: AgentProjectContext;
  approvedArtifacts: ApprovedArtifactInput[];
};
```

在 `src/server/agent-runtime/openai-runtime.ts` 增加 resolver 类型，并让 `run(input)` 每次按当前 input 解析配置：

```ts
export type OpenAIRuntimeNativeToolLoopResolver = (
  input: AgentRuntimeInput,
) => OpenAIRuntimeNativeToolLoopOptions | undefined;

export type OpenAIRuntimeOptions = {
  client: OpenAIResponsesClient;
  model: string;
  nativeToolLoop?: OpenAIRuntimeNativeToolLoopOptions | OpenAIRuntimeNativeToolLoopResolver;
};
```

在 `createAssistantText(...)` 中使用当前 input 解析：

```ts
const nativeToolLoop = resolveNativeToolLoop(this.nativeToolLoop, input);
if (!isNativeToolLoopEnabled(nativeToolLoop)) {
  const response = await adapter.createResponse(request);
  return response.assistantText;
}
```

在 `src/server/capabilities/capability-runner.ts` 的 `AgentRuntimeCapabilityInput` 增加 `sourceMessageId?: string`，并传给 `runtime.run(...)`：

```ts
const result = await input.runtime.run({
  projectId: input.projectId,
  runId: randomUUID(),
  sourceMessageId: input.sourceMessageId,
  task,
  userMessage: input.userMessage,
  projectContext: input.projectContext,
  approvedArtifacts: input.approvedArtifacts ?? [],
});
```

在 `src/server/conversation/conversation-turn-service.ts` 调用 `runCapabilityWithAgentRuntime(...)` 时补入：

```ts
sourceMessageId: input.triggerMessage.id,
```

- [ ] **Step 1: 写失败测试：allowlist 只导出 internal 工具**

```ts
import { describe, expect, it, vi } from "vitest";
import { nativeToolLoopTaskToolMap } from "@/server/agent-runtime/native-tool-loop-config";

describe("OpenAIRuntime native tool loop config", () => {
  it("exposes only the first-batch internal tool allowlist", () => {
    expect(nativeToolLoopTaskToolMap.requirement_spec).toBe("create_requirement_spec");
    expect(nativeToolLoopTaskToolMap.ppt_design).toBe("create_ppt_design_draft");
    expect(Object.values(nativeToolLoopTaskToolMap)).not.toContain("generate_pptx_from_design");
    expect(Object.values(nativeToolLoopTaskToolMap)).not.toContain("asset_image_generate");
  });
});
```

- [ ] **Step 2: 运行失败测试**

```powershell
npx vitest run tests/agent-runtime/native-tool-loop-config.test.ts --maxWorkers=1
```

Expected: FAIL，原因是 `native-tool-loop-config.ts` 尚不存在。

- [ ] **Step 3: 写最小实现**

```ts
import type { AgentRuntime, AgentRuntimeInput } from "./types";
import type { OpenAIRuntimeNativeToolLoopResolver } from "./openai-runtime";
import type { ToolCallIntent } from "@/server/gpt-protocol/tool-call-intent";
import { routeToolCall, type ToolRouterInput } from "@/server/tools/tool-router";
import { getToolDefinition } from "@/server/tools/tool-registry";
import { toolDefinitionToOpenAiFunctionTool } from "@/server/tools/openai-tool-schema";

export type BuildOpenAIRuntimeNativeToolLoopOptionsInput = {
  toolExecutionRuntime: AgentRuntime;
  toolRouter?: typeof routeToolCall;
};

export const nativeToolLoopTaskToolMap = {
  requirement_spec: "create_requirement_spec",
  lesson_plan: "create_lesson_plan",
  ppt_outline: "create_ppt_outline",
  ppt_design: "create_ppt_design_draft",
  knowledge_anchor_extract: "extract_knowledge_anchors",
  creative_theme_generate: "generate_intro_creative_themes",
  video_script_generate: "generate_intro_video_script",
  storyboard_generate: "generate_video_storyboard",
  asset_brief_generate: "generate_video_asset_brief",
  video_segment_plan: "plan_video_segments",
  final_delivery_checklist: "create_final_delivery_checklist",
} as const satisfies Partial<Record<AgentRuntimeInput["task"], string>>;

export function buildOpenAIRuntimeNativeToolLoopResolver(
  input: BuildOpenAIRuntimeNativeToolLoopOptionsInput,
): OpenAIRuntimeNativeToolLoopResolver {
  return (runtimeInput) => {
    const toolName = nativeToolLoopTaskToolMap[runtimeInput.task];
    if (!toolName) return undefined;

    return {
      tools: [toolDefinitionToOpenAiFunctionTool(getToolDefinition(toolName))],
      allowedToolNames: [toolName],
      toolRouter: input.toolRouter ?? routeToolCall,
      buildToolRouterInput: (intent, currentRuntimeInput) => buildToolRouterInput(intent, currentRuntimeInput, input.toolExecutionRuntime),
      maxToolRounds: 1,
    };
  };
}

export function buildToolRouterInput(
  intent: ToolCallIntent,
  input: AgentRuntimeInput,
  toolExecutionRuntime: AgentRuntime,
): ToolRouterInput {
  const userInstruction = intent.teacherIntent?.userInstruction
    ?? intent.teacherIntent?.teacherIntent
    ?? intent.teacherIntent?.notes
    ?? input.userMessage;

  return {
    toolName: intent.toolName,
    projectId: input.projectId,
    userInstruction,
    runtime: toolExecutionRuntime,
    projectContext: input.projectContext,
    approvedArtifacts: input.approvedArtifacts,
    artifactRefs: [],
    sourceMessageId: input.sourceMessageId,
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

```powershell
npx vitest run tests/agent-runtime/native-tool-loop-config.test.ts --maxWorkers=1
```

Expected: PASS。

- [ ] **Step 5: 补 mapper 安全测试**

```ts
it("builds ToolRouterInput from server-authoritative runtime input", () => {
  const toolExecutionRuntime = { run: vi.fn() };
  const routerInput = buildToolRouterInput(
    {
      status: "ready",
      toolName: "create_ppt_design_draft",
      callId: "call_1",
      teacherIntent: {
        userInstruction: "按课堂活动生成设计稿",
      },
    },
    {
      projectId: "server-project",
      runId: "server-run",
      sourceMessageId: "server-message",
      task: "ppt_design",
      userMessage: "教师原始需求",
      projectContext: {
        grade: "五年级",
        subject: "数学",
        topic: "百分数",
        requestedOutputs: ["PPT"],
      },
      approvedArtifacts: [
        { nodeKey: "ppt_outline", title: "大纲", summary: "已确认", markdown: "# 大纲" },
      ],
    },
    toolExecutionRuntime,
  );

  expect(routerInput).toMatchObject({
    toolName: "create_ppt_design_draft",
    projectId: "server-project",
    sourceMessageId: "server-message",
    userInstruction: "按课堂活动生成设计稿",
  });
  expect(routerInput.approvedArtifacts).toHaveLength(1);
  expect(routerInput.runtime).toBe(toolExecutionRuntime);
});
```

- [ ] **Step 6: 提交 Task 1**

```powershell
git status --short
git add src/server/agent-runtime/types.ts src/server/agent-runtime/openai-runtime.ts src/server/capabilities/capability-runner.ts src/server/conversation/conversation-turn-service.ts src/server/agent-runtime/native-tool-loop-config.ts tests/agent-runtime/native-tool-loop-config.test.ts
git commit -m "feat: 建立运行时工具闭环配置 | v0.9.98 | 2026-07-10 11:40"
```

### Task 2: Runtime 工厂显式开关接入

**Files:**
- Modify: `src/server/agent-runtime/runtime-factory.ts`
- Create or Modify: `tests/agent-runtime/runtime-factory.test.ts`

- [ ] **Step 1: 写失败测试：默认不启用 native tool loop**

```ts
import { describe, expect, it } from "vitest";
import { OpenAIRuntime } from "@/server/agent-runtime/openai-runtime";
import { createAgentRuntimeFromEnv, FallbackAgentRuntime } from "@/server/agent-runtime/runtime-factory";

describe("createAgentRuntimeFromEnv native tool loop", () => {
  it("keeps native tool loop disabled by default", () => {
    const runtime = createAgentRuntimeFromEnv({
      OPENAI_API_KEY: "test-key",
      OPENAI_MODEL: "gpt-test",
    });

    expect(runtime).toBeInstanceOf(FallbackAgentRuntime);
    const primary = (runtime as FallbackAgentRuntime).getPrimaryForTesting();
    expect(primary).toBeInstanceOf(OpenAIRuntime);
    expect((primary as OpenAIRuntime).getNativeToolLoopForTesting()).toBeUndefined();
  });
});
```

- [ ] **Step 2: 暴露只读测试辅助方法**

在 `FallbackAgentRuntime` 中增加只读测试辅助方法，不改变运行行为：

```ts
  getPrimaryForTesting(): AgentRuntime {
    return this.primary;
  }
```

在 `OpenAIRuntime` 中增加只读测试辅助方法，不改变运行行为：

```ts
  getNativeToolLoopForTesting() {
    return this.nativeToolLoop;
  }
```

- [ ] **Step 3: 修改工厂开关逻辑**

```ts
import { buildOpenAIRuntimeNativeToolLoopResolver } from "./native-tool-loop-config";

const toolExecutionRuntime = new FallbackAgentRuntime(
  new OpenAIRuntime({
    client,
    model: config.model,
  }),
  fallback,
);
const nativeToolLoop = env.SHANHAI_OPENAI_NATIVE_TOOL_LOOP === "1"
  ? buildOpenAIRuntimeNativeToolLoopResolver({ toolExecutionRuntime })
  : undefined;

return new FallbackAgentRuntime(
  new OpenAIRuntime({
    client,
    model: config.model,
    nativeToolLoop,
  }),
  fallback,
);
```

- [ ] **Step 4: 写显式开启测试**

```ts
it("injects native tool loop only when the feature flag is enabled", () => {
  const runtime = createAgentRuntimeFromEnv({
    OPENAI_API_KEY: "test-key",
    OPENAI_MODEL: "gpt-test",
    SHANHAI_OPENAI_NATIVE_TOOL_LOOP: "1",
  });

  expect(runtime).toBeInstanceOf(FallbackAgentRuntime);
  const primary = (runtime as FallbackAgentRuntime).getPrimaryForTesting();
  expect(primary).toBeInstanceOf(OpenAIRuntime);
  expect((primary as OpenAIRuntime).getNativeToolLoopForTesting()).toBeTypeOf("function");
});
```

- [ ] **Step 5: 运行工厂测试**

```powershell
npx vitest run tests/agent-runtime/runtime-factory.test.ts --maxWorkers=1
```

Expected: PASS。

- [ ] **Step 6: 提交 Task 2**

```powershell
git status --short
git add src/server/agent-runtime/runtime-factory.ts tests/agent-runtime/runtime-factory.test.ts
git commit -m "feat: 为运行时工具闭环增加显式开关 | v0.9.99 | 2026-07-10 12:00"
```

### Task 3: 主线回归测试与失败安全

**Files:**
- Modify: `tests/agent-runtime/openai-runtime.test.ts`
- Modify: `tests/agent-runtime/native-tool-loop-config.test.ts`

- [ ] **Step 1: 补 OpenAIRuntime 主线失败安全测试**

测试目标：native loop blocked/failed 时，外层 `FallbackAgentRuntime` 能回退到 deterministic runtime；教师可见文案不含 `schema`、`provider`、`function_call`、`tool`、`debug`、`OPENAI_API_KEY`、本地路径等工程词。

- [ ] **Step 2: 补 mapper 伪造字段回归测试**

测试目标：即使 `ToolCallIntent` 中只有教师语义字段，模型原始 arguments 中曾出现的 `projectId`、`artifactRefs`、`sourceMessageId` 也不能进入最终 `ToolRouterInput`。

- [ ] **Step 3: 补递归防护测试**

测试目标：native loop 内部交给 `ToolRouterInput.runtime` 的必须是 `toolExecutionRuntime`，不能是 primary `OpenAIRuntime` 自身；否则 internal capability 会递归进入 native loop。

- [ ] **Step 4: 运行目标测试**

```powershell
npx vitest run tests/agent-runtime/openai-runtime.test.ts tests/agent-runtime/native-tool-loop-config.test.ts tests/agent-runtime/runtime-factory.test.ts --maxWorkers=1
```

Expected: PASS，失败数 0。

- [ ] **Step 5: 提交 Task 3**

```powershell
git status --short
git add tests/agent-runtime/openai-runtime.test.ts tests/agent-runtime/native-tool-loop-config.test.ts tests/agent-runtime/runtime-factory.test.ts
git commit -m "test: 补齐运行时工具闭环主线回归 | v0.10.0 | 2026-07-10 12:20"
```

### Task 4: 集中验收与收尾文档

**Files:**
- Create: `docs/stages/local-real-mvp-m66-runtime-tool-loop-mainline-closeout.md`

- [ ] **Step 1: 运行集中验收**

```powershell
npx vitest run tests/agent-runtime/native-tool-loop-config.test.ts tests/agent-runtime/runtime-factory.test.ts tests/agent-runtime/openai-runtime.test.ts tests/openai-tool-loop-runner.test.ts tests/gpt-protocol-adapter.test.ts tests/gpt-tool-call-intent.test.ts tests/gpt-tool-output-serializer.test.ts tests/tool-router.test.ts tests/conversation-turn-service.test.ts tests/tool-observation.test.ts tests/agent-harness-budget.test.ts --maxWorkers=1
npx tsc --noEmit
npm run build
graphify update .
git diff --check
```

Expected: 所有命令 exit 0；Vitest 失败数 0；build 成功；graphify 成功或如实记录失败原因。

- [ ] **Step 2: 写 M66 closeout**

文档必须包含：目标、范围、开关状态、完成提交、验证命令与结果、未纳入范围、风险、回退方式、M67 建议。

- [ ] **Step 3: 文档核验**

```powershell
Get-Item docs/stages/local-real-mvp-m66-runtime-tool-loop-mainline-closeout.md
Get-Content -TotalCount 20 docs/stages/local-real-mvp-m66-runtime-tool-loop-mainline-closeout.md
```

Expected: 文件存在，开头内容正常。

- [ ] **Step 4: 提交 Task 4**

```powershell
git status --short
git add docs/stages/local-real-mvp-m66-runtime-tool-loop-mainline-closeout.md
git commit -m "docs: 完成M66运行时工具闭环主线验收 | v0.10.1 | 2026-07-10 12:40"
```

## 8. 验证方式

M66 完成前不能只凭局部测试宣称通过，必须至少完成：

```powershell
npx vitest run tests/agent-runtime/native-tool-loop-config.test.ts tests/agent-runtime/runtime-factory.test.ts tests/agent-runtime/openai-runtime.test.ts tests/openai-tool-loop-runner.test.ts tests/gpt-protocol-adapter.test.ts tests/gpt-tool-call-intent.test.ts tests/gpt-tool-output-serializer.test.ts tests/tool-router.test.ts tests/conversation-turn-service.test.ts tests/tool-observation.test.ts tests/agent-harness-budget.test.ts --maxWorkers=1
npx tsc --noEmit
npm run build
graphify update .
git diff --check
git status --short
```

## 9. 风险与回退

| 风险 | 处理 |
|---|---|
| 模型误选工具或重复调用 | M66 保持 allowlist + `maxToolRounds: 1` + `parallelToolCalls: false`。 |
| 模型伪造项目、产物或消息字段 | mapper 只使用 `AgentRuntimeInput`，测试必须覆盖伪造字段不进入 `ToolRouterInput`。 |
| internal capability 递归进入 native loop | mapper 注入无 native loop 的 `toolExecutionRuntime`，测试必须覆盖 `ToolRouterInput.runtime` 非 primary runtime。 |
| 教师可见文案泄露工程词 | failure 文案继续走 `OpenAIRuntime` / fallback 安全文案；测试扫描工程词。 |
| provider side effect 被模型误触发 | M66 不开放 provider 工具，`generate_pptx_from_design` 等留到 M67。 |
| 主线不稳定 | 删除或关闭 `SHANHAI_OPENAI_NATIVE_TOOL_LOOP=1` 即回退到 M65 默认 structured output 路径。 |

## 10. M67 建议

M67 再评估 provider 工具灰度，重点包括：

1. `coze_ppt` 是否可在 HumanGate 确认后进入 native tool loop。
2. GenerationJob 生命周期如何在 native loop 中保留 start / finish / fail。
3. provider 结果如何继续由 `ConversationTurnService` 保存 Artifact，而不是由模型或 runner 保存。
4. 是否需要独立的 `ProviderToolLoopPolicy` 控制真实外部 side effect。

## 11. 自检

- 规划已区分 M66 与 M67，避免一次性开放 provider side effect。
- 规划没有要求接真实 MCP，也没有宣称生产可用。
- 所有新增能力都在显式环境开关下启用，默认行为保持不变。
- 每个任务都包含目标文件、测试命令、提交边界与预期结果。
