import { describe, expect, it, vi } from "vitest";

import { runMainAgentControlledReActLoop } from "@/server/conversation/main-agent-controlled-react-loop";
import type { GptProtocolResponse } from "@/server/gpt-protocol/types";

describe("V1-3 Main Agent controlled ReAct loop", () => {
  it("feeds a read-only Agent Tool result back to the model in the same turn", async () => {
    const adapter = sequenceAdapter([
      toolCallResponse("call-1", "ppt_director_plan_or_repair", { goal: "规划", stage: "page_design", targetPageIds: [], focus: null }),
      completedResponse("{\"assistantMessage\":{\"body\":\"请先确认样张方案。\"}}"),
    ]);
    const dispatch = vi.fn(async () => ({
      status: "succeeded" as const,
      observation: {
        observationId: "observation-1",
        status: "succeeded" as const,
        reasonCodes: ["agent_tool_succeeded"],
        advisoryNextToolIntents: ["assemble_ppt_key_samples"],
      },
    }));

    const result = await runMainAgentControlledReActLoop({
      adapter,
      request: { instructions: "test", input: "teacher request" },
      tools: [{ type: "function", name: "ppt_director_plan_or_repair" }],
      allowedToolNames: ["ppt_director_plan_or_repair"],
      dispatch,
    });

    expect(result).toMatchObject({ status: "completed", toolRoundsUsed: 1, observationIds: ["observation-1"] });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(adapter.requests[1].inputItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "function_call_output", call_id: "call-1" }),
    ]));
  });

  it("refreshes qualified tools after an Observation while leaving the next choice to the model", async () => {
    const adapter = sequenceAdapter([
      toolCallResponse("call-requirement", "create_requirement_spec", {}),
      toolCallResponse("call-lesson", "create_lesson_plan", {}),
      completedResponse("{\"assistantMessage\":{\"body\":\"已形成可继续使用的结构化候选。\"}}"),
    ]);
    const dispatch = vi.fn(async (call: { toolName: string }) => ({
      status: "succeeded" as const,
      observation: {
        observationId: `observation-${call.toolName}`,
        status: "succeeded" as const,
        reasonCodes: ["business_tool_succeeded"],
      },
    }));
    const refreshTools = vi.fn(async () => ({
      tools: [
        { type: "function", name: "create_lesson_plan" },
        { type: "function", name: "create_ppt_outline" },
      ],
      allowedToolNames: ["create_lesson_plan", "create_ppt_outline"],
    }));

    const result = await runMainAgentControlledReActLoop({
      adapter,
      request: { instructions: "test", input: "teacher request" },
      tools: [{ type: "function", name: "create_requirement_spec" }],
      allowedToolNames: ["create_requirement_spec"],
      dispatch,
      refreshTools,
    });

    expect(result).toMatchObject({ status: "completed", toolRoundsUsed: 2 });
    expect(refreshTools).toHaveBeenCalledTimes(2);
    expect(adapter.requests[1].tools).toEqual([
      { type: "function", name: "create_lesson_plan" },
      { type: "function", name: "create_ppt_outline" },
    ]);
    expect(dispatch.mock.calls.map(([call]) => call.toolName)).toEqual([
      "create_requirement_spec",
      "create_lesson_plan",
    ]);
    expect(adapter.requests[2].inputItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "function_call_output", call_id: "call-lesson" }),
    ]));
    expect(JSON.stringify(adapter.requests[2].inputItems)).toContain("observation-create_requirement_spec");
  });

  it("compacts each continuation to a deterministic checkpoint plus only the latest call/output pair", async () => {
    const adapter = sequenceAdapter([
      toolCallResponseWithReasoning("call-1", "create_requirement_spec", {}, "raw-reasoning-round-1"),
      toolCallResponseWithReasoning("call-2", "create_lesson_plan", {}, "raw-reasoning-round-2"),
      completedResponse("{\"assistantMessage\":{\"body\":\"已形成可继续使用的候选。\"}}"),
    ]);
    const dispatch = vi.fn(async (call: { callId: string; toolName: string }) => ({
      status: "succeeded" as const,
      observation: {
        observationId: `observation-${call.callId}`,
        status: "succeeded" as const,
        reasonCodes: ["business_tool_succeeded"],
        artifactRefs: [{ artifactId: `artifact-${call.callId}`, kind: call.toolName }],
        summary: "已保存可信候选。",
      },
    }));

    await runMainAgentControlledReActLoop({
      adapter,
      request: { instructions: "test", input: "teacher request" },
      tools: [{ type: "function", name: "create_requirement_spec" }],
      allowedToolNames: ["create_requirement_spec", "create_lesson_plan"],
      dispatch,
      checkpointSeed: {
        projectId: "project-1",
        taskId: "task-1",
        taskBriefDigest: "a".repeat(64),
        intentEpoch: 2,
        planRevision: 4,
        generationIntensity: "standard",
        authorization: {
          standardWorkAuthorized: true,
          budgetPolicyVersion: "budget-v1",
          maxCostCredits: 20,
          maxExternalProviderCalls: 0,
        },
      },
    });

    const secondContinuation = JSON.stringify(adapter.requests[2].inputItems);
    expect(secondContinuation).toContain("react-checkpoint.v1");
    expect(secondContinuation).toContain("observation-call-1");
    expect(secondContinuation).toContain("observation-call-2");
    expect(secondContinuation).toContain("call-2");
    expect(secondContinuation).not.toContain("raw-reasoning-round-1");
    expect(secondContinuation).not.toContain("raw-reasoning-round-2");
    expect(secondContinuation).not.toContain('\"call_id\":\"call-1\"');
    expect((adapter.requests[2].inputItems as Array<Record<string, unknown>>).filter((item) => item.type === "function_call_output")).toHaveLength(1);
  });

  it("emits bounded body-free context telemetry for initial and continuation requests", async () => {
    const telemetry: Array<Record<string, unknown>> = [];
    const adapter = sequenceAdapter([
      toolCallResponseWithReasoning("call-telemetry", "create_requirement_spec", {}, "private-reasoning-body".repeat(5_000)),
      completedResponse("{\"assistantMessage\":{\"body\":\"完成。\"}}"),
    ]);

    await runMainAgentControlledReActLoop({
      adapter,
      request: { instructions: "test", input: "private-teacher-body" },
      tools: [{ type: "function", name: "create_requirement_spec" }],
      allowedToolNames: ["create_requirement_spec"],
      dispatch: async () => ({
        status: "succeeded",
        observation: {
          observationId: "observation-telemetry",
          status: "succeeded",
          reasonCodes: ["business_tool_succeeded"],
          summary: "private-tool-body".repeat(5_000),
        },
      }),
      onContextTelemetry: async (event) => { telemetry.push(event); },
    });

    expect(telemetry).toHaveLength(2);
    expect(telemetry).toEqual([
      expect.objectContaining({ phase: "initial", toolRound: 0, toolCount: 1, checkpointCharacters: 0, checkpointObservationCount: 0 }),
      expect.objectContaining({ phase: "continuation", toolRound: 1, toolCount: 1, checkpointObservationCount: 1 }),
    ]);
    expect(telemetry.every((event) => Number(event.requestCharacters) > 0 && Number(event.estimatedInputTokens) > 0 && Number(event.responseDurationMs) >= 0)).toBe(true);
    expect(JSON.stringify(telemetry)).not.toMatch(/private-teacher-body|private-reasoning-body|private-tool-body/);
    expect(Number(telemetry[1].requestCharacters)).toBeLessThan(20_000);
  });

  it("blocks an identical Tool call after it already succeeded", async () => {
    const call = toolCallResponse("call-1", "ppt_director_plan_or_repair", { goal: "规划", stage: "page_design", targetPageIds: [], focus: null });
    const adapter = sequenceAdapter([call, { ...call, output: [{ ...call.output[0], call_id: "call-2" }] } as never]);
    const dispatch = vi.fn(async () => ({
      status: "succeeded" as const,
      observation: { status: "succeeded" as const, reasonCodes: ["agent_tool_succeeded"] },
    }));
    const rejected: string[] = [];

    const result = await runMainAgentControlledReActLoop({
      adapter,
      request: { instructions: "test", input: "teacher request" },
      tools: [{ type: "function", name: "ppt_director_plan_or_repair" }],
      allowedToolNames: ["ppt_director_plan_or_repair"],
      dispatch,
      onRejectedToolCall: async (event) => { rejected.push(`${event.toolName}:${event.reason}`); },
    });

    expect(result).toMatchObject({ status: "blocked", reason: "repeated_tool_call", toolRoundsUsed: 1 });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(rejected).toEqual(["ppt_director_plan_or_repair:repeated_tool_call"]);
  });

  it("allows one identical failed Tool retry and stops on the second matching failure", async () => {
    const first = toolCallResponse("call-failed-1", "create_ppt_design_draft", { revision: 1 });
    const second = toolCallResponse("call-failed-2", "create_ppt_design_draft", { revision: 1 });
    const dispatch = vi.fn(async () => ({
      status: "failed" as const,
      observation: {
        status: "failed" as const,
        reasonCodes: ["validation", "composition_layer_source_invalid"],
      },
    }));

    const result = await runMainAgentControlledReActLoop({
      adapter: sequenceAdapter([first, second]),
      request: { instructions: "test", input: "teacher request" },
      tools: [{ type: "function", name: "create_ppt_design_draft" }],
      allowedToolNames: ["create_ppt_design_draft"],
      dispatch,
    });

    expect(result).toMatchObject({ status: "blocked", reason: "repeated_tool_failure", toolRoundsUsed: 2 });
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("blocks a two-step repair cycle after the same Tool failure category repeats", async () => {
    const adapter = sequenceAdapter([
      toolCallResponse("call-design-1", "create_ppt_design_draft", { revision: 1 }),
      toolCallResponse("call-director", "ppt_director_plan_or_repair", { goal: "repair", stage: "page_design", targetPageIds: [], focus: "composition" }),
      toolCallResponse("call-design-2", "create_ppt_design_draft", { revision: 2 }),
    ]);
    const dispatch = vi.fn(async (call: { toolName: string }) => call.toolName === "create_ppt_design_draft"
      ? { status: "failed" as const, observation: { status: "failed" as const, reasonCodes: ["validation", "composition_layer_source_invalid"] } }
      : { status: "succeeded" as const, observation: { status: "repair" as const, reasonCodes: ["repair_planned"] } });

    const result = await runMainAgentControlledReActLoop({
      adapter,
      request: { instructions: "test", input: "teacher request" },
      tools: [],
      allowedToolNames: ["create_ppt_design_draft", "ppt_director_plan_or_repair"],
      dispatch,
      maxToolRounds: 8,
    });

    expect(result).toMatchObject({ status: "blocked", reason: "repeated_tool_failure", toolRoundsUsed: 3 });
    expect(dispatch).toHaveBeenCalledTimes(3);
  });

  it("reports a recoverable budget pause before rejecting the next Tool call", async () => {
    const adapter = sequenceAdapter([
      toolCallResponse("call-1", "create_requirement_spec", { revision: 1 }),
      toolCallResponse("call-2", "create_lesson_plan", { revision: 2 }),
    ]);
    const onBudgetExhausted = vi.fn();
    const dispatch = vi.fn(async () => ({
      status: "succeeded" as const,
      observation: {
        observationId: "observation-1",
        status: "succeeded" as const,
        reasonCodes: ["business_tool_succeeded"],
      },
    }));

    const result = await runMainAgentControlledReActLoop({
      adapter,
      request: { instructions: "test", input: "teacher request" },
      tools: [],
      allowedToolNames: ["create_requirement_spec", "create_lesson_plan"],
      dispatch,
      maxToolRounds: 1,
      onBudgetExhausted,
    });

    expect(result).toMatchObject({ status: "failed", reason: "tool_round_limit_reached", toolRoundsUsed: 1 });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(onBudgetExhausted).toHaveBeenCalledWith({
      reason: "tool_round_limit_reached",
      toolRoundsUsed: 1,
      maxToolRounds: 1,
      pendingToolName: "create_lesson_plan",
      observationIds: ["observation-1"],
    });
  });

  it("blocks unknown and parallel tool calls", async () => {
    const unknown = await runMainAgentControlledReActLoop({
      adapter: sequenceAdapter([toolCallResponse("call-x", "raw_provider_submit", {})]),
      request: { instructions: "test", input: "teacher request" },
      tools: [],
      allowedToolNames: [],
      dispatch: vi.fn(),
    });
    expect(unknown).toMatchObject({ status: "blocked", reason: "tool_call_invalid" });

    const parallelResponse = toolCallResponse("call-1", "ppt_director_plan_or_repair", {});
    parallelResponse.output.push({ ...parallelResponse.output[0], call_id: "call-2", id: "item-2" });
    parallelResponse.outputItems.push({ ...parallelResponse.outputItems[0], call_id: "call-2", id: "item-2" });
    parallelResponse.functionCalls.push({
      ...parallelResponse.functionCalls[0],
      id: "item-2",
      callId: "call-2",
    });
    const parallel = await runMainAgentControlledReActLoop({
      adapter: sequenceAdapter([parallelResponse]),
      request: { instructions: "test", input: "teacher request" },
      tools: [],
      allowedToolNames: ["ppt_director_plan_or_repair"],
      dispatch: vi.fn(),
    });
    expect(parallel).toMatchObject({ status: "blocked", reason: "multiple_tool_calls_blocked" });
  });

  it("preserves the sanitized adapter diagnostic when a ReAct request fails", async () => {
    const diagnosticMessage = "Request rejected: invalid response schema at [redacted-url]";
    const result = await runMainAgentControlledReActLoop({
      adapter: sequenceAdapter([{
        assistantText: "", rawText: "", functionCalls: [], outputItems: [], outputItemsSummary: [],
        diagnostics: { status: "failed", provider: "openai_responses", model: "test", errorMessage: diagnosticMessage },
      }]),
      request: { instructions: "test", input: "teacher request" },
      tools: [{ type: "function", name: "ppt_director_plan_or_repair" }],
      allowedToolNames: ["ppt_director_plan_or_repair"],
      dispatch: vi.fn(),
    });
    expect(result).toMatchObject({ status: "failed", reason: "adapter_failed", diagnosticMessage });
  });
});

function sequenceAdapter(responses: Array<Record<string, any>>) {
  const requests: Array<Record<string, any>> = [];
  let index = 0;
  return {
    requests,
    async createResponse(request: Record<string, any>) {
      requests.push(request);
      return responses[Math.min(index++, responses.length - 1)] as GptProtocolResponse;
    },
  };
}

function toolCallResponse(callId: string, name: string, args: Record<string, unknown>) {
  const item = {
    id: `item-${callId}`,
    type: "function_call",
    call_id: callId,
    name,
    arguments: JSON.stringify(args),
  };
  return {
    assistantText: "",
    rawText: "",
    functionCalls: [{
      id: item.id,
      callId,
      name,
      argumentsText: item.arguments,
      argumentsJsonParseStatus: "parsed" as const,
      argumentsJson: args,
    }],
    output: [item],
    outputItems: [item],
    outputItemsSummary: [],
    diagnostics: { status: "succeeded" as const, provider: "openai_responses" as const, model: "test" },
  };
}

function toolCallResponseWithReasoning(callId: string, name: string, args: Record<string, unknown>, reasoningText: string) {
  const response: Record<string, any> = toolCallResponse(callId, name, args);
  const reasoning = { id: `reasoning-${callId}`, type: "reasoning", summary: [{ type: "summary_text", text: reasoningText }] };
  response.output = [reasoning, ...response.output];
  response.outputItems = [reasoning, ...response.outputItems];
  return response;
}

function completedResponse(text: string) {
  return {
    assistantText: text,
    rawText: text,
    functionCalls: [],
    outputItems: [],
    outputItemsSummary: [],
    diagnostics: { status: "succeeded" as const, provider: "openai_responses" as const, model: "test" },
  };
}
