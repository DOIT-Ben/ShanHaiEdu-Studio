# M64 Tool Registry / ToolRouter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or equivalent task-by-task execution. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build ShanHaiEdu's first production-grade tool registration and routing layer so existing internal capability tools and provider tools can be registered once, routed consistently, and observed safely.

**Architecture:** M64 introduces `src/server/tools` as the boundary between model/tool plans and real execution. `ConversationTurnService` should call `ToolRouter.execute(...)` instead of owning capability/provider execution details. The router must preserve M63 gates: `CapabilityAvailability`, `PlanGuard`, `HumanGate`, `AgentHarnessBudget`, `ToolObservation`, and Artifact Truth Gate.

**Tech Stack:** TypeScript, Vitest, existing Workbench service, existing `CapabilityRunner`, existing provider functions, existing M62/M63 modules.

---

## File Structure

- Create `src/server/tools/tool-types.ts`: shared `ToolDefinition`, `ToolInvocation`, `ToolExecutionResult`, schema types, adapter contracts.
- Create `src/server/tools/tool-registry.ts`: stable first-batch tool definitions and lookup helpers.
- Create `src/server/tools/openai-tool-schema.ts`: safe projection from `ToolDefinition` to future OpenAI Responses function tool schema.
- Create `src/server/tools/internal-capability-tool-adapter.ts`: adapter that wraps `runCapabilityWithAgentRuntime`.
- Create `src/server/tools/provider-tool-adapter.ts`: adapter that wraps existing `coze_ppt`, `image_asset`, and `video_segment_generate` provider execution semantics.
- Create `src/server/tools/tool-router.ts`: central router that checks registry, schemas, required approved artifacts, availability, gates, budget, and delegates to adapters.
- Modify `src/server/conversation/conversation-turn-service.ts`: first remove duplicated execution branches only after router tests are green.
- Add tests: `tests/tool-registry.test.ts`, `tests/tool-router.test.ts`, `tests/internal-capability-tool-adapter.test.ts`, `tests/provider-tool-adapter.test.ts`, plus targeted updates to `tests/conversation-turn-service.test.ts`.

---

## Task A: Tool Types and Registry

**Files:**
- Create: `src/server/tools/tool-types.ts`
- Create: `src/server/tools/tool-registry.ts`
- Create: `src/server/tools/openai-tool-schema.ts`
- Test: `tests/tool-registry.test.ts`

- [ ] **Step A1: Write failing registry tests**

Create `tests/tool-registry.test.ts` with tests for:

```ts
import { describe, expect, it } from "vitest";
import { getToolDefinition, getToolDefinitionByCapabilityId, listToolDefinitions } from "@/server/tools/tool-registry";
import { toolDefinitionToOpenAiFunctionTool } from "@/server/tools/openai-tool-schema";

describe("ToolRegistry", () => {
  it("registers first-batch internal and provider tools with stable ids", () => {
    expect(listToolDefinitions().map((tool) => tool.id)).toEqual(expect.arrayContaining([
      "create_requirement_spec",
      "create_lesson_plan",
      "create_ppt_outline",
      "create_ppt_design_draft",
      "generate_pptx_from_design",
    ]));
  });

  it("finds tools by capability id", () => {
    expect(getToolDefinitionByCapabilityId("lesson_plan")).toMatchObject({
      id: "create_lesson_plan",
      adapterKind: "internal_capability",
      requiredArtifactKinds: ["requirement_spec"],
      producedArtifactKind: "lesson_plan",
      requiresHumanGate: true,
    });
  });

  it("exports safe OpenAI function tool schema without provider or storage terms", () => {
    const schema = toolDefinitionToOpenAiFunctionTool(getToolDefinition("generate_pptx_from_design"));

    expect(schema).toMatchObject({
      type: "function",
      name: "generate_pptx_from_design",
      strict: true,
      parameters: expect.objectContaining({ additionalProperties: false }),
    });
    expect(JSON.stringify(schema)).not.toMatch(/provider|storage|runtimeKind|debug|token|API_KEY|SECRET|local path/i);
  });
});
```

- [ ] **Step A2: Verify RED**

Run:

```powershell
npx vitest run tests/tool-registry.test.ts --maxWorkers=1
```

Expected: fails because `@/server/tools/tool-registry` does not exist.

- [ ] **Step A3: Implement minimal types and registry**

Create the three files. `ToolDefinition` must include `id`, `label`, `description`, `adapterKind`, `capabilityId`, `inputSchema`, `outputSchema`, `requiresHumanGate`, `sideEffectLevel`, `requiredArtifactKinds`, `producedArtifactKind`, `failurePolicy`, `implemented`, and optional `blockedReason`.

First-batch registry must include at least:

```text
create_requirement_spec -> requirement_spec
create_lesson_plan -> lesson_plan
create_ppt_outline -> ppt_outline
create_ppt_design_draft -> ppt_design
generate_pptx_from_design -> coze_ppt
```

Do not register unsupported tools as executable.

- [ ] **Step A4: Verify GREEN**

Run:

```powershell
npx vitest run tests/tool-registry.test.ts --maxWorkers=1
```

Expected: pass.

- [ ] **Step A5: Commit Task A**

```powershell
git add src/server/tools/tool-types.ts src/server/tools/tool-registry.ts src/server/tools/openai-tool-schema.ts tests/tool-registry.test.ts
git commit -m "feat: 建立工具定义与注册表 | v0.9.76 | 2026-07-10 00:10"
```

---

## Task B: Internal Capability Tool Adapter

**Files:**
- Create: `src/server/tools/internal-capability-tool-adapter.ts`
- Test: `tests/internal-capability-tool-adapter.test.ts`

- [ ] **Step B1: Write failing adapter tests**

Tests must cover:

1. `create_requirement_spec` calls existing runtime path and returns `status: "succeeded"` with an artifact draft result shape.
2. A failed runtime result returns `status: "retryable_failed"` or `status: "failed"`, includes `ToolObservation`, and `artifactCreated: false`.
3. `validation` error category maps to `quality_gate_failed`.

- [ ] **Step B2: Verify RED**

Run:

```powershell
npx vitest run tests/internal-capability-tool-adapter.test.ts --maxWorkers=1
```

Expected: fails because adapter does not exist.

- [ ] **Step B3: Implement adapter**

Adapter signature:

```ts
export async function executeInternalCapabilityTool(input: InternalCapabilityToolInput): Promise<ToolExecutionResult>
```

It must wrap `runCapabilityWithAgentRuntime`, map success to `ToolExecutionResult.status = "succeeded"`, and map failures to `ToolObservation` using existing M63 helpers. It must not save artifacts itself in Task B; saving happens in router/service integration.

- [ ] **Step B4: Verify GREEN**

Run:

```powershell
npx vitest run tests/internal-capability-tool-adapter.test.ts tests/tool-observation.test.ts --maxWorkers=1
```

Expected: pass.

- [ ] **Step B5: Commit Task B**

```powershell
git add src/server/tools/internal-capability-tool-adapter.ts tests/internal-capability-tool-adapter.test.ts
git commit -m "feat: 接入内部能力工具适配器 | v0.9.77 | 2026-07-10 00:25"
```

---

## Task C: Provider Tool Adapter Result

**Files:**
- Create: `src/server/tools/provider-tool-adapter.ts`
- Test: `tests/provider-tool-adapter.test.ts`

- [ ] **Step C1: Write failing provider adapter tests**

Tests must cover:

1. `generate_pptx_from_design` with invalid PPT design returns `quality_gate_failed`, no artifact created.
2. Missing source artifact returns `blocked_by_policy`, no artifact created.
3. Successful provider result shape includes `artifactTruth.placeholder === false`, `bytes`, `sha256`, `localOutput`, and `producedArtifactKind`.
4. Serialized result does not expose token, external URL, task id, or absolute local path.

- [ ] **Step C2: Verify RED**

Run:

```powershell
npx vitest run tests/provider-tool-adapter.test.ts --maxWorkers=1
```

Expected: fails because adapter does not exist.

- [ ] **Step C3: Implement provider adapter**

Initial adapter may wrap only `coze_ppt` fully. It may register image/video definitions but must not expand behavior beyond existing provider semantics. Provider result must be structured, not message-string classified.

- [ ] **Step C4: Verify GREEN**

Run:

```powershell
npx vitest run tests/provider-tool-adapter.test.ts tests/conversation-turn-service.test.ts --maxWorkers=1
```

Expected: pass.

- [ ] **Step C5: Commit Task C**

```powershell
git add src/server/tools/provider-tool-adapter.ts tests/provider-tool-adapter.test.ts
git commit -m "feat: 统一真实生成工具适配结果 | v0.9.78 | 2026-07-10 00:45"
```

---

## Task D: ToolRouter Core

**Files:**
- Create: `src/server/tools/tool-router.ts`
- Test: `tests/tool-router.test.ts`

- [ ] **Step D1: Write failing router tests**

Tests must cover:

1. Unknown tool returns blocked observation and no artifact.
2. Missing approved required artifact returns blocked observation.
3. PlanGuard failure returns blocked observation and budget event.
4. Budget retry exhausted returns blocked observation.
5. `create_requirement_spec` succeeds through internal adapter.

- [ ] **Step D2: Verify RED**

Run:

```powershell
npx vitest run tests/tool-router.test.ts --maxWorkers=1
```

Expected: fails because router does not exist.

- [ ] **Step D3: Implement router**

Router must accept `ToolInvocation` with `toolId`, `arguments`, and context. It must call registry, gate checks, budget checks, then adapter. It must return `ToolExecutionResult` only; it must not produce React/UI concerns.

- [ ] **Step D4: Verify GREEN**

Run:

```powershell
npx vitest run tests/tool-router.test.ts tests/tool-registry.test.ts tests/internal-capability-tool-adapter.test.ts tests/provider-tool-adapter.test.ts --maxWorkers=1
```

Expected: pass.

- [ ] **Step D5: Commit Task D**

```powershell
git add src/server/tools/tool-router.ts tests/tool-router.test.ts
git commit -m "feat: 建立工具路由执行核心 | v0.9.79 | 2026-07-10 01:05"
```

---

## Task E: ConversationTurnService Integration

**Files:**
- Modify: `src/server/conversation/conversation-turn-service.ts`
- Test: `tests/conversation-turn-service.test.ts`

- [ ] **Step E1: Write failing integration assertion**

Add or update tests so that confirmed `requirement_spec` and `coze_ppt` execution flows use `ToolRouter` and still produce identical external behavior:

- successful internal artifact saved as before;
- provider quality gate failure writes `quality_gate_failed` observation;
- budget succeeded event still written;
- no fake artifact on failure.

- [ ] **Step E2: Verify RED**

Run:

```powershell
npx vitest run tests/conversation-turn-service.test.ts --maxWorkers=1
```

Expected: fails before service uses router or before assertion is satisfied.

- [ ] **Step E3: Integrate router minimally**

Replace only the first-batch execution path. Preserve existing helper functions until tests prove they are dead. Do not rewrite unrelated workflow planning or message formatting.

- [ ] **Step E4: Verify GREEN**

Run:

```powershell
npx vitest run tests/conversation-turn-service.test.ts tests/tool-router.test.ts tests/agent-harness-budget.test.ts tests/tool-observation.test.ts --maxWorkers=1
```

Expected: pass.

- [ ] **Step E5: Commit Task E**

```powershell
git add src/server/conversation/conversation-turn-service.ts tests/conversation-turn-service.test.ts
git commit -m "feat: 对话执行接入工具路由 | v0.9.80 | 2026-07-10 01:30"
```

---

## Task F: Final Validation and Closeout

**Files:**
- Create: `docs/stages/local-real-mvp-m64-tool-registry-router-closeout.md`

- [ ] **Step F1: Run concentrated validation**

```powershell
npx vitest run tests/tool-registry.test.ts tests/tool-router.test.ts tests/internal-capability-tool-adapter.test.ts tests/provider-tool-adapter.test.ts tests/conversation-turn-service.test.ts tests/agent-harness-budget.test.ts tests/tool-observation.test.ts --maxWorkers=1
```

- [ ] **Step F2: Run TypeScript and build**

```powershell
npx tsc --noEmit
npm run build
```

- [ ] **Step F3: Run graphify and git checks**

```powershell
graphify update .
git status --short
git diff --check
```

- [ ] **Step F4: Write closeout document**

Record implemented scope, tests, non-goals, known risks, and next milestone M65 GPT native tool_call loop.

- [ ] **Step F5: Commit closeout**

```powershell
git add docs/stages/local-real-mvp-m64-tool-registry-router-closeout.md
git commit -m "docs: 完成M64工具层收尾记录 | v0.9.81 | 2026-07-10 01:45"
```

---

## Self-Review

- M64 spec coverage: ToolDefinition, registry, router, internal adapter, provider adapter, non-goals, validation, commit cadence all mapped to tasks.
- Placeholder scan: no TBD/TODO placeholders; unsupported tools explicitly remain blocked.
- Type consistency: terms are aligned with M64 planning doc: `ToolDefinition`, `ToolRouter`, `ToolExecutionResult`, `adapterKind`, `requiredArtifactKinds`, `producedArtifactKind`.
- Scope control: true MCP and native OpenAI function_call loop are deferred to later milestones.
