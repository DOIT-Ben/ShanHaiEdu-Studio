import { describe, expect, it, vi } from "vitest";

import { FixtureAgentRuntime } from "./helpers/fixture-agent-runtime";
import type { OpenAIResponsesClient } from "@/server/agent-runtime/openai-runtime";
import { createWorkbenchActor } from "@/server/auth/actor";
import { createConversationTurnService } from "@/server/conversation/conversation-turn-service";
import type { MainConversationAgentInput } from "@/server/conversation/main-conversation-agent";
import { OpenAIMainConversationAgent } from "@/server/conversation/model-main-conversation-agent";
import { createTaskBrief } from "@/server/conversation/task-contract";
import { createWorkbenchService } from "@/server/workbench/service";

describe("production single orchestrator", () => {
  it("lets the Main Agent native function-call loop choose and dispatch the business Tool", async () => {
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
        observationId: "observation-native-tool",
        status: "succeeded" as const,
        reasonCodes: ["business_tool_succeeded"],
      },
    }));
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });

    const turn = await agent.respond({
      userMessage: "只做需求规格",
      taskBrief: createTaskBrief({
        taskId: "task-native-only",
        projectId: "project-native-only",
        intentEpoch: 0,
        goal: "只做需求规格",
        requestedOutputs: ["requirement_spec"],
        constraints: ["五年级数学百分数"],
        excludedOutputs: ["lesson_plan", "ppt", "image", "video", "package"],
        generationIntensity: "standard",
        sourceMessageId: "message-native-only",
      }),
      availableArtifactKinds: [],
      agentToolLoop: {
        tools: [{ type: "function", name: "create_requirement_spec" }],
        allowedToolNames: ["create_requirement_spec"],
        dispatch,
      },
    });

    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith({
      callId: "tool-call",
      toolName: "create_requirement_spec",
      arguments: { revision: 1 },
    });
    expect(client.payloads[0]).toMatchObject({
      tool_choice: "auto",
      parallel_tool_calls: false,
      tools: [expect.objectContaining({ name: "create_requirement_spec" })],
    });
    expect(turn).toMatchObject({
      assistantMessage: { body: expect.stringContaining("没有扩张") },
      state: "succeeded",
      runtimeKind: "openai",
    });
  });

  it("keeps native ownership when no business Tool remains qualified", async () => {
    const actor = createWorkbenchActor({
      userId: `teacher-${crypto.randomUUID()}`,
      displayName: "Teacher",
      authMode: "local",
    });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({
      title: "零业务 Tool 单一编排者",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });
    const existing = await service.saveArtifact(project.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "已完成需求规格",
      status: "needs_review",
      summary: "当前任务需求已完整保存。",
      markdownContent: "# 已完成需求规格",
      structuredContent: {},
    });
    await service.approveArtifact(project.id, existing.id);
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    let captured: MainConversationAgentInput | undefined;

    try {
      const turnService = createConversationTurnService({
        service,
        runtime: new FixtureAgentRuntime(),
        executionIdentity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null },
        executionFence: fence,
        agent: {
          async intakeTask(input) {
            return {
              kind: "task",
              proposal: {
                goal: input.userMessage,
                requestedOutputs: ["requirement_spec"],
                constraints: ["五年级数学百分数"],
                excludedOutputs: [],
              },
            };
          },
          async respond(input) {
            captured = input;
            return {
              assistantMessage: { body: "当前需求规格已经存在，可以继续讨论。" },
              state: "succeeded",
              quickReplies: [],
              recommendedOptions: [],
              runtimeKind: "openai",
            };
          },
        },
      });

      const result = await turnService.createTurn(project.id, {
        role: "teacher",
        content: "继续核对当前需求规格。",
      });

      expect(captured?.agentToolLoop?.allowedToolNames).toEqual(["request_teacher_decision"]);
      expect(result.agentTurn).toMatchObject({ state: "succeeded", runtimeKind: "openai" });
      expect(await service.getArtifacts(project.id)).toHaveLength(1);
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });
});

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
