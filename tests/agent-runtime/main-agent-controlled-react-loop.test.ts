import { describe, expect, it, vi } from "vitest";

import { runMainAgentControlledReActLoop } from "@/server/conversation/main-agent-controlled-react-loop";
import { createMainAgentReActCheckpoint } from "@/server/conversation/main-agent-react-checkpoint";
import type { GptProtocolResponse } from "@/server/gpt-protocol/types";

describe("V1-3 Main Agent controlled ReAct loop", () => {
  it("prepares the current Tool set before the first model request", async () => {
    const adapter = sequenceAdapter([
      completedResponse("{\"assistantMessage\":{\"body\":\"已记录当前任务。\"}}"),
    ]);
    const prepareTools = vi.fn(async () => ({
      tools: [{ type: "function", name: "create_requirement_spec" }],
      allowedToolNames: ["create_requirement_spec"],
    }));

    await runMainAgentControlledReActLoop({
      adapter,
      request: { instructions: "test", input: "teacher request" },
      tools: [],
      allowedToolNames: [],
      prepareTools,
      dispatch: async () => ({ status: "blocked", observation: { status: "blocked", reasonCodes: ["unexpected"] } }),
    });

    expect(prepareTools).toHaveBeenCalledOnce();
    expect(adapter.requests[0].tools).toEqual([{ type: "function", name: "create_requirement_spec" }]);
  });

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

  it("emits step start and Observation progress without letting projection failures change control flow", async () => {
    const adapter = sequenceAdapter([
      toolCallResponse("call-progress", "create_ppt_outline", {}),
      completedResponse('{"assistantMessage":{"body":"大纲已完成。"}}'),
    ]);
    const progress: string[] = [];
    const result = await runMainAgentControlledReActLoop({
      adapter,
      request: { instructions: "test", input: "teacher request" },
      tools: [{ type: "function", name: "create_ppt_outline" }],
      allowedToolNames: ["create_ppt_outline"],
      dispatch: async () => ({
        status: "failed",
        observation: {
          observationId: "observation-outline",
          status: "failed",
          reasonCodes: ["ppt_outline_validation_failed"],
          summary: "PPT 大纲未通过结构检查。",
          nextAction: "repair",
        },
      }),
      onProgress: (event) => {
        progress.push(event.type);
        if (event.type === "step_observed") throw new Error("projection unavailable");
      },
    });

    expect(progress).toEqual(["step_started", "step_observed"]);
    expect(result).toMatchObject({ status: "completed", toolRoundsUsed: 1 });
  });

  it("persists the first HumanGate Observation as a terminal pause without another model or Tool cycle", async () => {
    const adapter = sequenceAdapter([
      toolCallResponse("call-human-gate", "generate_ppt_sample_assets", {}),
      completedResponse("{\"assistantMessage\":{\"body\":\"不应再次请求模型。\"}}"),
    ]);
    const dispatch = vi.fn(async () => ({
      status: "blocked" as const,
      observation: {
        observationId: "observation-human-gate",
        status: "blocked" as const,
        reasonCodes: ["missing_grant"],
        nextAction: "ask_teacher",
      },
    }));
    const refreshTools = vi.fn(async () => ({
      tools: [{ type: "function", name: "generate_ppt_sample_assets" }],
      allowedToolNames: ["generate_ppt_sample_assets"],
    }));
    const validateCompletion = vi.fn(async () => ({
      status: "unsatisfied" as const,
      remainingRequestedOutputs: ["ppt"],
    }));
    const onRecoveryCheckpoint = vi.fn();

    const result = await runMainAgentControlledReActLoop({
      adapter,
      request: { instructions: "test", input: "teacher request" },
      tools: [{ type: "function", name: "generate_ppt_sample_assets" }],
      allowedToolNames: ["generate_ppt_sample_assets"],
      dispatch,
      refreshTools,
      validateCompletion,
      onRecoveryCheckpoint,
    });

    expect(result).toMatchObject({
      status: "blocked",
      reason: "human_gate_required",
      toolRoundsUsed: 1,
      observationIds: ["observation-human-gate"],
    });
    expect(adapter.requests).toHaveLength(1);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(refreshTools).not.toHaveBeenCalled();
    expect(validateCompletion).not.toHaveBeenCalled();
    expect(onRecoveryCheckpoint).toHaveBeenCalledOnce();
    const recovery = onRecoveryCheckpoint.mock.calls[0][0];
    expect(recovery).toMatchObject({
      reason: "human_gate_required",
      observationIds: ["observation-human-gate"],
      checkpoint: {
        schemaVersion: "react-checkpoint.v1",
        completedRounds: [expect.objectContaining({
          toolName: "generate_ppt_sample_assets",
          observation: expect.objectContaining({
            observationId: "observation-human-gate",
            status: "blocked",
            nextAction: "ask_teacher",
          }),
        })],
      },
    });
    expect(recovery.checkpoint.checkpointDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(recovery.checkpoint.completedRounds.flatMap(
      (round: { observation: { artifactRefs?: unknown[] } }) => round.observation.artifactRefs ?? [],
    )).toHaveLength(0);
  });

  it("persists a Main Agent chosen DialogueCheckpoint and stops before another model or business Tool cycle", async () => {
    const adapter = sequenceAdapter([
      toolCallResponse("call-dialogue", "request_teacher_decision", {
        question: "这份课件更偏向概念理解还是解题训练？",
        understandingSummary: "当前目标是制作认识百分数的数学课件。",
        impactSummary: "不同侧重会改变例题比例和页面结构。",
        options: [
          { id: "concept", label: "概念理解", description: "强调生活情境和意义建构", recommended: true },
          { id: "practice", label: "解题训练", description: "强调题型和练习", recommended: false },
        ],
        allowFreeText: true,
      }),
      completedResponse('{"assistantMessage":{"body":"不应再次请求模型。"}}'),
    ]);
    const onRecoveryCheckpoint = vi.fn();
    const dispatch = vi.fn(async () => ({
      status: "blocked" as const,
      pauseKind: "dialogue_checkpoint" as const,
      observation: {
        observationId: "observation-dialogue",
        status: "needs_input" as const,
        reasonCodes: ["dialogue_checkpoint_requested"],
        nextAction: "ask_teacher",
      },
    }));

    const result = await runMainAgentControlledReActLoop({
      adapter,
      request: { instructions: "test", input: "做一份认识百分数PPT" },
      tools: [{ type: "function", name: "request_teacher_decision" }],
      allowedToolNames: ["request_teacher_decision"],
      dispatch,
      onRecoveryCheckpoint,
    });

    expect(result).toMatchObject({
      status: "blocked",
      reason: "dialogue_checkpoint_required",
      toolRoundsUsed: 1,
      observationIds: ["observation-dialogue"],
    });
    expect(adapter.requests).toHaveLength(1);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(onRecoveryCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      reason: "dialogue_checkpoint_required",
      observationIds: ["observation-dialogue"],
    }));
  });

  it("returns an unsatisfied completion contract to the same Main Agent before accepting completion", async () => {
    const adapter = sequenceAdapter([
      toolCallResponse("call-requirement", "create_requirement_spec", {}),
      completedResponse("{\"assistantMessage\":{\"body\":\"我先停在这里。\"}}"),
      toolCallResponse("call-lesson", "create_lesson_plan", {}),
      completedResponse("{\"assistantMessage\":{\"body\":\"任务已经完整完成。\"}}"),
    ]);
    const completionStates = [
      { status: "unsatisfied" as const, remainingRequestedOutputs: ["lesson_plan"] },
      { status: "satisfied" as const, remainingRequestedOutputs: [] },
    ];
    const validateCompletion = vi.fn(async () => completionStates.shift()!);
    const dispatch = vi.fn(async (call: { toolName: string }) => ({
      status: "succeeded" as const,
      observation: {
        observationId: `observation-${call.toolName}`,
        status: "succeeded" as const,
        reasonCodes: ["business_tool_succeeded"],
      },
    }));

    const result = await runMainAgentControlledReActLoop({
      adapter,
      request: { instructions: "test", input: "teacher full package request" },
      tools: [],
      allowedToolNames: ["create_requirement_spec", "create_lesson_plan"],
      dispatch,
      validateCompletion,
    });

    expect(result).toMatchObject({ status: "completed", toolRoundsUsed: 2 });
    expect(dispatch.mock.calls.map(([call]) => call.toolName)).toEqual([
      "create_requirement_spec",
      "create_lesson_plan",
    ]);
    expect(JSON.stringify(adapter.requests[2].inputItems)).toContain("main_agent_completion_contract_unsatisfied");
    expect(JSON.stringify(adapter.requests[2].inputItems)).toContain("lesson_plan");
  });

  it("persists a recovery checkpoint instead of accepting a second incomplete direct response", async () => {
    const onRecoveryCheckpoint = vi.fn();
    const result = await runMainAgentControlledReActLoop({
      adapter: sequenceAdapter([
        toolCallResponse("call-requirement", "create_requirement_spec", {}),
        completedResponse("{\"assistantMessage\":{\"body\":\"先到这里。\"}}"),
        completedResponse("{\"assistantMessage\":{\"body\":\"仍然先到这里。\"}}"),
      ]),
      request: { instructions: "test", input: "teacher full package request" },
      tools: [],
      allowedToolNames: ["create_requirement_spec", "create_lesson_plan"],
      dispatch: vi.fn(async () => ({
        status: "succeeded" as const,
        observation: {
          observationId: "observation-requirement",
          status: "succeeded" as const,
          reasonCodes: ["business_tool_succeeded"],
        },
      })),
      validateCompletion: vi.fn(async () => ({
        status: "unsatisfied" as const,
        remainingRequestedOutputs: ["lesson_plan", "package"],
      })),
      onRecoveryCheckpoint,
    });

    expect(result).toMatchObject({
      status: "blocked",
      reason: "completion_contract_unsatisfied",
      toolRoundsUsed: 1,
    });
    expect(onRecoveryCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      reason: "completion_contract_unsatisfied",
      remainingRequestedOutputs: ["lesson_plan", "package"],
      checkpoint: expect.objectContaining({
        schemaVersion: "react-checkpoint.v1",
        completedRounds: [expect.objectContaining({ toolName: "create_requirement_spec" })],
      }),
    }));
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

  it("uses explicit checkpoint continuation by default even when a compatible REST provider returns a response id", async () => {
    const firstResponse = {
      ...toolCallResponse("call-rest", "create_requirement_spec", {}),
      responseId: "resp-rest-only",
    };
    const adapter = sequenceAdapter([
      firstResponse,
      completedResponse("已继续处理。"),
    ]);

    await runMainAgentControlledReActLoop({
      adapter,
      request: { instructions: "test", input: "七年级语文《春》课件" },
      tools: [{ type: "function", name: "create_requirement_spec" }],
      allowedToolNames: ["create_requirement_spec"],
      dispatch: async () => ({
        status: "succeeded",
        observation: {
          observationId: "observation-rest",
          status: "succeeded",
          reasonCodes: ["business_tool_succeeded"],
          summary: "已保存需求规格。",
        },
      }),
    });

    expect(adapter.requests[1].previousResponseId).toBeUndefined();
    expect(JSON.stringify(adapter.requests[1].inputItems)).toContain("react-checkpoint.v1");
    expect(JSON.stringify(adapter.requests[1].inputItems)).toContain("observation-rest");
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
    let failureOrdinal = 0;
    const dispatch = vi.fn(async () => ({
      status: "failed" as const,
      observation: {
        observationId: `observation-failed-${++failureOrdinal}`,
        status: "failed" as const,
        reasonCodes: ["validation", "composition_layer_source_invalid"],
      },
    }));
    const recoveries: Array<{ reason: string; observationIds: string[] }> = [];

    const result = await runMainAgentControlledReActLoop({
      adapter: sequenceAdapter([first, second]),
      request: { instructions: "test", input: "teacher request" },
      tools: [{ type: "function", name: "create_ppt_design_draft" }],
      allowedToolNames: ["create_ppt_design_draft"],
      dispatch,
      onRecoveryCheckpoint: async (event) => {
        recoveries.push({ reason: event.reason, observationIds: event.observationIds });
      },
    });

    expect(result).toMatchObject({ status: "blocked", reason: "repeated_tool_failure", toolRoundsUsed: 2 });
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(recoveries).toEqual([{
      reason: "repeated_tool_failure",
      observationIds: ["observation-failed-1", "observation-failed-2"],
    }]);
  });

  it("allows a two-step repair cycle when the Tool arguments materially change", async () => {
    const adapter = sequenceAdapter([
      toolCallResponse("call-design-1", "create_ppt_design_draft", { revision: 1 }),
      toolCallResponse("call-director", "ppt_director_plan_or_repair", { goal: "repair", stage: "page_design", targetPageIds: [], focus: "composition" }),
      toolCallResponse("call-design-2", "create_ppt_design_draft", { revision: 2 }),
      completedResponse("{\"assistantMessage\":{\"body\":\"已保存两次不同输入的失败证据。\"}}"),
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

    expect(result).toMatchObject({ status: "completed", toolRoundsUsed: 3 });
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

  it("continues the same Main Agent task across persisted internal segments", async () => {
    const adapter = sequenceAdapter([
      toolCallResponse("call-1", "create_requirement_spec", { revision: 1 }),
      toolCallResponse("call-2", "create_lesson_plan", { revision: 2 }),
      toolCallResponse("call-3", "create_ppt_outline", { revision: 3 }),
      completedResponse("{\"assistantMessage\":{\"body\":\"完整任务继续完成。\"}}"),
    ]);
    const onSegmentCheckpoint = vi.fn();
    const dispatch = vi.fn(async (call: { callId: string }) => ({
      status: "succeeded" as const,
      observation: {
        observationId: `observation-${call.callId}`,
        status: "succeeded" as const,
        reasonCodes: ["business_tool_succeeded"],
      },
    }));

    const result = await runMainAgentControlledReActLoop({
      adapter,
      request: { instructions: "test", input: "teacher full package request" },
      tools: [],
      allowedToolNames: ["create_requirement_spec", "create_lesson_plan", "create_ppt_outline"],
      dispatch,
      maxToolRounds: 4,
      maxToolRoundsPerSegment: 1,
      onSegmentCheckpoint,
    });

    expect(result).toMatchObject({ status: "completed", reason: "none", toolRoundsUsed: 3 });
    expect(dispatch).toHaveBeenCalledTimes(3);
    expect(onSegmentCheckpoint).toHaveBeenCalledTimes(2);
    expect(onSegmentCheckpoint.mock.calls).toEqual([
      [expect.objectContaining({ segmentIndex: 1, toolRoundsUsed: 1, pendingToolName: "create_lesson_plan" })],
      [expect.objectContaining({ segmentIndex: 2, toolRoundsUsed: 2, pendingToolName: "create_ppt_outline" })],
    ]);
    expect(onSegmentCheckpoint.mock.calls[1][0].checkpoint).toMatchObject({
      schemaVersion: "react-checkpoint.v1",
      completedRounds: [
        expect.objectContaining({ round: 1, toolName: "create_requirement_spec" }),
        expect.objectContaining({ round: 2, toolName: "create_lesson_plan" }),
      ],
    });
  });

  it("restores a persisted segment checkpoint after process restart without replaying completed Tools", async () => {
    const request = { instructions: "test", input: "teacher full package request" };
    const checkpoint = createMainAgentReActCheckpoint({
      request,
      records: [{
        round: 1,
        toolName: "create_requirement_spec",
        callDigest: "a".repeat(64),
        observation: {
          observationId: "observation-before-restart",
          status: "succeeded",
          reasonCodes: ["business_tool_succeeded"],
          artifactRefs: [{ artifactId: "artifact-requirement", kind: "requirement_spec", version: 1 }],
        },
      }],
      currentToolNames: ["create_lesson_plan"],
    });
    const adapter = sequenceAdapter([
      toolCallResponse("call-after-restart", "create_lesson_plan", {}),
      completedResponse("{\"assistantMessage\":{\"body\":\"已从保存进度继续。\"}}"),
    ]);
    const dispatch = vi.fn(async () => ({
      status: "succeeded" as const,
      observation: {
        observationId: "observation-after-restart",
        status: "succeeded" as const,
        reasonCodes: ["business_tool_succeeded"],
      },
    }));

    const result = await runMainAgentControlledReActLoop({
      adapter,
      request,
      tools: [{ type: "function", name: "create_lesson_plan" }],
      allowedToolNames: ["create_lesson_plan"],
      dispatch,
      maxToolRounds: 4,
      resumeCheckpoint: checkpoint,
    });

    expect(result).toMatchObject({
      status: "completed",
      toolRoundsUsed: 2,
      observationIds: ["observation-before-restart", "observation-after-restart"],
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ toolName: "create_lesson_plan" }));
    expect(JSON.stringify(adapter.requests[0].inputItems)).toContain("observation-before-restart");
  });

  it("restores a task-bound checkpoint when only dynamic world state and plan revision advanced", async () => {
    const seed = {
      projectId: "project-resume",
      taskId: "task-resume",
      taskBriefDigest: "b".repeat(64),
      intentEpoch: 3,
      planRevision: 8,
      generationIntensity: "standard" as const,
      authorization: {
        standardWorkAuthorized: true,
        budgetPolicyVersion: "budget-v1",
        maxCostCredits: 12,
        maxExternalProviderCalls: 19,
      },
    };
    const checkpoint = createMainAgentReActCheckpoint({
      request: { instructions: "stable instructions", input: "world-state revision 8" },
      seed,
      records: [],
      currentToolNames: ["create_ppt_design_draft"],
    });

    const result = await runMainAgentControlledReActLoop({
      adapter: sequenceAdapter([completedResponse("{\"assistantMessage\":{\"body\":\"已读取最新世界状态。\"}}")]),
      request: { instructions: "stable instructions", input: "world-state revision 9 with latest validation observation" },
      tools: [{ type: "function", name: "create_ppt_design_draft" }],
      allowedToolNames: ["create_ppt_design_draft"],
      dispatch: async () => { throw new Error("no Tool should run"); },
      checkpointSeed: { ...seed, planRevision: 9 },
      resumeCheckpoint: checkpoint,
    });

    expect(result).toMatchObject({ status: "completed", reason: "none" });
  });

  it("rejects a task-bound checkpoint after IntentEpoch changes", async () => {
    const seed = {
      projectId: "project-resume",
      taskId: "task-resume",
      taskBriefDigest: "b".repeat(64),
      intentEpoch: 3,
      planRevision: 8,
      generationIntensity: "standard" as const,
      authorization: {
        standardWorkAuthorized: true,
        budgetPolicyVersion: "budget-v1",
        maxCostCredits: 12,
        maxExternalProviderCalls: 19,
      },
    };
    const checkpoint = createMainAgentReActCheckpoint({
      request: { instructions: "stable instructions", input: "world-state revision 8" },
      seed,
      records: [],
      currentToolNames: ["create_ppt_design_draft"],
    });

    const result = await runMainAgentControlledReActLoop({
      adapter: sequenceAdapter([completedResponse("{\"assistantMessage\":{\"body\":\"不应使用。\"}}")]),
      request: { instructions: "stable instructions", input: "new intent" },
      tools: [],
      allowedToolNames: [],
      dispatch: async () => { throw new Error("no Tool should run"); },
      checkpointSeed: { ...seed, intentEpoch: 4, planRevision: 0 },
      resumeCheckpoint: checkpoint,
    });

    expect(result).toMatchObject({
      status: "failed",
      reason: "checkpoint_restore_failed",
      diagnosticMessage: "checkpoint_context_mismatch",
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

  it("persists a recovery checkpoint when a continuation fails after a successful Tool round", async () => {
    const onRecoveryCheckpoint = vi.fn();
    const result = await runMainAgentControlledReActLoop({
      adapter: sequenceAdapter([
        toolCallResponse("call-1", "create_requirement_spec", {}),
        {
          assistantText: "", rawText: "", functionCalls: [], outputItems: [], outputItemsSummary: [],
          diagnostics: { status: "failed", provider: "openai_responses", model: "test", errorMessage: "403 request blocked" },
        },
      ]),
      request: { instructions: "test", input: "teacher request" },
      tools: [{ type: "function", name: "create_requirement_spec" }],
      allowedToolNames: ["create_requirement_spec"],
      checkpointSeed: {
        taskId: "task-1",
        projectId: "project-1",
        intentEpoch: 0,
        planRevision: 0,
        taskBriefDigest: "a".repeat(64),
        generationIntensity: "standard",
        authorization: {
          standardWorkAuthorized: true,
          budgetPolicyVersion: "v1-standard",
          maxCostCredits: null,
          maxExternalProviderCalls: null,
        },
      },
      dispatch: vi.fn(async () => ({
        status: "succeeded" as const,
        observation: { observationId: "observation-1", status: "succeeded" as const, reasonCodes: ["business_tool_succeeded"] },
      })),
      onRecoveryCheckpoint,
    });

    expect(result).toMatchObject({ status: "failed", reason: "adapter_failed", toolRoundsUsed: 1 });
    expect(onRecoveryCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      reason: "adapter_failed",
      checkpoint: expect.objectContaining({
        schemaVersion: "react-checkpoint.v1",
        completedRounds: [expect.objectContaining({ toolName: "create_requirement_spec" })],
      }),
    }));
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
