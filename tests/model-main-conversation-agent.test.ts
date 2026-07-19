import { describe, expect, it, vi } from "vitest";

import type { OpenAIResponsesClient } from "@/server/agent-runtime/openai-runtime";
import {
  createMainConversationAgentFromEnv,
  OpenAIMainConversationAgent,
  resolveMainAgentTimeoutMs,
} from "@/server/conversation/model-main-conversation-agent";
import { buildSemanticContextSnapshot } from "@/server/conversation/context-semantic-snapshot";
import { createTaskBrief } from "@/server/conversation/task-contract";

describe("native-only Main Conversation Agent", () => {
  it("returns natural model text without an outer JSON control contract", async () => {
    const client = queuedClient([
      { output_text: "收到：三年级数学。你想先从哪个课题开始？", output: [] },
    ]);
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });

    const turn = await agent.respond({
      userMessage: "三年级 数学",
      availableArtifactKinds: [],
    });

    expect(turn).toEqual({
      assistantMessage: { body: "收到：三年级数学。你想先从哪个课题开始？" },
      state: "chatting",
      quickReplies: [],
      recommendedOptions: [],
      runtimeKind: "openai",
    });
    expect(client.payloads[0]).not.toHaveProperty("text");
    expect(client.payloads[0]).not.toHaveProperty("tools");
    expect(client.payloads[0].instructions).toContain("原生 function-call 循环独占");
    expect(client.payloads[0].instructions).toContain("不得在正文中输出外层计划");
  });

  it("passes TaskBrief, grant, semantic snapshot and PendingDecision without a pending delivery plan", async () => {
    const client = queuedClient([{ output_text: "任务边界已读取。", output: [] }]);
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });
    const taskBrief = makeTaskBrief();
    const pendingDecision = {
      actionId: "decision-1",
      status: "pending",
      kind: "semantic_clarification",
      intentEpoch: 0,
    };
    const semanticSnapshot = buildSemanticContextSnapshot({
      taskBrief,
      plan: { planId: "plan-1", revision: 1, status: "active" },
      pendingDecision,
      trustedArtifactRefs: [],
      observationRefs: [],
      recentMessages: [],
    });

    await agent.respond({
      userMessage: "继续当前任务",
      taskBrief,
      intentGrant: {
        schemaVersion: "intent-grant.v1",
        taskId: taskBrief.taskId,
        projectId: taskBrief.projectId,
        intentEpoch: 0,
        standardWorkAuthorized: true,
        intensity: "standard",
        budgetPolicyVersion: "v1-standard",
        maxCostCredits: null,
        maxExternalProviderCalls: null,
        requiredCheckpoints: [],
        expiresAt: null,
      },
      availableArtifactKinds: [],
      conversationContext: {
        semanticSnapshot,
        recentMessages: [],
      },
    });

    const requestInput = JSON.parse(String(client.payloads[0].input));
    expect(requestInput).toMatchObject({
      taskBrief: { taskId: taskBrief.taskId, digest: taskBrief.digest },
      intentGrant: { taskId: taskBrief.taskId, standardWorkAuthorized: true },
      semanticSnapshot: { snapshotDigest: semanticSnapshot.snapshotDigest },
      pendingDecision,
    });
    expect(JSON.stringify(requestInput)).not.toContain("pendingDeliveryPlan");
  });

  it("submits an explicit TaskBrief through the intake function call", async () => {
    const client = queuedClient([{
      output_text: "",
      output: [{
        id: "task-item",
        type: "function_call",
        call_id: "task-call",
        name: "submit_task_brief",
        arguments: JSON.stringify({
          goal: "只做需求规格",
          requestedOutputs: ["requirement_spec"],
          constraints: ["五年级数学百分数"],
          excludedOutputs: ["lesson_plan", "ppt", "image", "video", "package"],
        }),
      }],
    }]);
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });

    const decision = await agent.intakeTask!({
      userMessage: "只做需求规格，不要教案、PPT、图片、视频或整包。",
      generationIntensity: "standard",
      projectContext: { grade: "五年级", subject: "数学", topic: "百分数" },
      recentMessages: [],
    });

    expect(decision).toMatchObject({
      kind: "task",
      proposal: {
        goal: "只做需求规格，不要教案、PPT、图片、视频或整包。",
        requestedOutputs: ["requirement_spec"],
        excludedOutputs: ["image", "lesson_plan", "package", "ppt", "video"],
      },
    });
    expect(client.payloads[0]).toMatchObject({
      tool_choice: "auto",
      parallel_tool_calls: false,
      tools: [expect.objectContaining({ name: "submit_task_brief", strict: true })],
    });
    expect(client.payloads[0]).not.toHaveProperty("text");
  });

  it("keeps an ambiguous active-task direction change as natural conversation", async () => {
    const client = queuedClient([{
      output_text: "你是在比较两种方向，还是希望我现在停止 PPT 并改做视频脚本？",
      output: [],
    }]);
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });
    const taskBrief = makeTaskBrief();

    const decision = await agent.intakeTask!({
      userMessage: "如果改成视频脚本会不会更好？",
      generationIntensity: "standard",
      projectContext: {},
      activeTask: taskBrief,
      recentMessages: [],
    });

    expect(decision).toMatchObject({
      kind: "conversation",
      turn: {
        assistantMessage: { body: expect.stringContaining("还是希望我现在") },
        runtimeKind: "openai",
      },
    });
    expect(client.payloads[0].tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "revise_active_task" }),
      expect.objectContaining({ name: "submit_conversation_control" }),
    ]));
  });

  it("executes one native Tool call and returns the continuation as natural text", async () => {
    const client = queuedClient([
      {
        output_text: "",
        output: [{
          id: "tool-item",
          type: "function_call",
          call_id: "tool-call",
          name: "create_requirement_spec",
          arguments: JSON.stringify({ revision: 1 }),
        }],
      },
      { output_text: "需求规格已经生成，本轮没有扩张到其他材料。", output: [] },
    ]);
    const dispatch = vi.fn(async () => ({
      status: "succeeded" as const,
      observation: {
        observationId: "observation-1",
        status: "succeeded" as const,
        reasonCodes: ["business_tool_succeeded"],
      },
    }));
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });

    const turn = await agent.respond({
      userMessage: "只做需求规格",
      taskBrief: makeTaskBrief(["requirement_spec"]),
      availableArtifactKinds: [],
      agentToolLoop: {
        tools: [{ type: "function", name: "create_requirement_spec" }],
        allowedToolNames: ["create_requirement_spec"],
        dispatch,
      },
    });

    expect(dispatch).toHaveBeenCalledWith({
      callId: "tool-call",
      toolName: "create_requirement_spec",
      arguments: { revision: 1 },
    });
    expect(client.payloads).toHaveLength(2);
    expect(client.payloads[0]).toMatchObject({
      tools: [expect.objectContaining({ name: "create_requirement_spec" })],
      tool_choice: "auto",
      parallel_tool_calls: false,
    });
    expect(client.payloads[0]).not.toHaveProperty("text");
    expect(client.payloads[1].input).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "function_call_output", call_id: "tool-call" }),
    ]));
    expect(turn).toEqual({
      assistantMessage: { body: "需求规格已经生成，本轮没有扩张到其他材料。" },
      state: "succeeded",
      quickReplies: [],
      recommendedOptions: [],
      runtimeKind: "openai",
    });
  });

  it("fails closed when native Tool dispatch violates its lifecycle", async () => {
    const client = queuedClient([{
      output_text: "",
      output: [{
        id: "tool-item",
        type: "function_call",
        call_id: "tool-call",
        name: "create_requirement_spec",
        arguments: "{}",
      }],
    }]);
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });

    const turn = await agent.respond({
      userMessage: "继续",
      availableArtifactKinds: [],
      agentToolLoop: {
        tools: [{ type: "function", name: "create_requirement_spec" }],
        allowedToolNames: ["create_requirement_spec"],
        dispatch: async () => {
          throw new Error("Tool invocation is not active.");
        },
      },
    });

    expect(turn).toMatchObject({
      state: "failed_blocked",
      runtimeKind: "openai",
      failure: {
        phase: "agent_tool_loop",
        reasonCode: "control_plane_lifecycle_conflict",
        category: "control_plane",
        retryability: "not_retryable",
      },
    });
    expect(turn).not.toHaveProperty("toolPlan");
    expect(turn).not.toHaveProperty("deliveryPlan");
  });

  it("returns a typed, sanitized Provider failure without fabricating a result", async () => {
    const diagnostic = vi.fn();
    const client = {
      responses: {
        async create() {
          throw new Error("403 blocked at https://example.invalid/v1 token=secret-value");
        },
      },
    } as OpenAIResponsesClient;
    const agent = new OpenAIMainConversationAgent({
      client,
      model: "test-model",
      onFailureDiagnostic: diagnostic,
    });

    const turn = await agent.respond({ userMessage: "请完成百分数PPT", availableArtifactKinds: [] });

    expect(turn).toMatchObject({
      state: "failed_retryable",
      runtimeKind: "openai",
      failure: {
        phase: "direct_response",
        reasonCode: "main_agent_provider_policy_blocked",
        category: "provider_policy",
      },
    });
    expect(turn).not.toHaveProperty("artifactRefs");
    expect(JSON.stringify(diagnostic.mock.calls)).not.toMatch(/example\.invalid|secret-value/);
  });

  it("fails honestly when Main Agent Provider configuration is absent", async () => {
    const agent = createMainConversationAgentFromEnv({
      SHANHAI_PROVIDER_LEDGER_ROOT: "tests/fixtures/missing-provider-ledger",
      SHANHAI_PROVIDER_LEDGER_SECRET_SOURCE: "deployment_secret",
    });

    const turn = await agent.respond({ userMessage: "开始", availableArtifactKinds: [] });

    expect(turn).toMatchObject({
      state: "failed_retryable",
      runtimeKind: "openai",
      failure: {
        reasonCode: "main_agent_provider_unavailable",
        category: "provider_unavailable",
      },
    });
    expect(turn).not.toHaveProperty("toolPlan");
    expect(turn).not.toHaveProperty("deliveryPlan");
  });

  it("uses a configurable 180-second timeout", () => {
    expect(resolveMainAgentTimeoutMs({})).toBe(180_000);
    expect(resolveMainAgentTimeoutMs({ MAIN_AGENT_TIMEOUT_MS: "45000" })).toBe(45_000);
    expect(resolveMainAgentTimeoutMs({ MAIN_AGENT_TIMEOUT_MS: "1000" })).toBe(180_000);
    expect(resolveMainAgentTimeoutMs({ MAIN_AGENT_TIMEOUT_MS: "not-a-number" })).toBe(180_000);
  });
});

function makeTaskBrief(requestedOutputs: Parameters<typeof createTaskBrief>[0]["requestedOutputs"] = ["ppt"]) {
  return createTaskBrief({
    taskId: "task-native-contract",
    projectId: "project-native-contract",
    intentEpoch: 0,
    goal: "请做五年级数学百分数公开课材料。",
    requestedOutputs,
    constraints: ["五年级数学百分数"],
    excludedOutputs: [],
    generationIntensity: "standard",
    sourceMessageId: "message-native-contract",
  });
}

function queuedClient(responses: Array<Record<string, unknown>>): OpenAIResponsesClient & {
  payloads: Array<Record<string, unknown>>;
} {
  const queue = [...responses];
  const payloads: Array<Record<string, unknown>> = [];
  return {
    payloads,
    responses: {
      async create(payload: Record<string, unknown>) {
        payloads.push(payload);
        const response = queue.shift();
        if (!response) throw new Error("No fake response queued");
        return response;
      },
    },
  } as OpenAIResponsesClient & { payloads: Array<Record<string, unknown>> };
}
