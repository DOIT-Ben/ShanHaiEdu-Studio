import { describe, expect, it, vi } from "vitest";

import { executeThroughToolGateway } from "@/server/tools/tool-execution-gateway";
import { createExecutionEnvelope, createTaskBrief, type IntentGrant } from "@/server/conversation/task-contract";
import { dispatchMainAgentToolCall } from "@/server/tools/main-agent-tool-dispatcher";

describe("tool execution gateway", () => {
  it("does not execute a read-only Agent Tool without the same task-level ExecutionEnvelope", async () => {
    const executor = vi.fn();

    const result = await dispatchMainAgentToolCall({
      invocationId: "agent-invocation-1",
      toolName: "ppt_director_plan_or_repair",
      arguments: { goal: "规划课件", stage: "page_design", targetPageIds: [], focus: null },
      serverContext: {
        identity: { actorUserId: "teacher-1", actorAuthMode: "password", authSessionId: "session-1" },
        projectId: "project-1",
        intentEpoch: 2,
        sourceMessageId: "message-1",
        generationIntensity: "standard",
        approvedArtifactRefs: [],
      },
    }, {
      agentToolExecutor: executor,
      authorizeAgentTool: async () => true,
    });

    expect(result).toMatchObject({
      kind: "blocked",
      result: { observation: { internalReasonSanitized: "execution_envelope_required" } },
    });
    expect(executor).not.toHaveBeenCalled();
  });

  it("fails closed when a mutating business tool has no current ExecutionEnvelope", async () => {
    const execute = vi.fn();
    const result = await executeThroughToolGateway({
      request: { toolName: "create_lesson_plan", projectId: "project-1", intentEpoch: 2, arguments: {} },
      current: { actorUserId: "teacher-1", projectId: "project-1", taskId: "task-1", intentEpoch: 2, planRevision: 4, intensity: "standard" },
      executionEnvelope: undefined,
      execute,
    });

    expect(result).toMatchObject({ status: "failed", reasonCode: "execution_envelope_required" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("blocks the production dispatcher when model arguments do not match the signed action", async () => {
    const taskBrief = createTaskBrief({
      taskId: "task-1",
      projectId: "project-1",
      intentEpoch: 2,
      goal: "整理百分数备课需求",
      requestedOutputs: ["requirement_spec"],
      constraints: ["五年级数学"],
      excludedOutputs: [],
      generationIntensity: "standard",
      sourceMessageId: "message-1",
    });
    const intentGrant: IntentGrant = {
      schemaVersion: "intent-grant.v1",
      taskId: taskBrief.taskId,
      projectId: taskBrief.projectId,
      intentEpoch: taskBrief.intentEpoch,
      standardWorkAuthorized: true,
      intensity: "standard",
      budgetPolicyVersion: "standard.v1",
      maxCostCredits: null,
      maxExternalProviderCalls: null,
      requiredCheckpoints: [],
      expiresAt: null,
    };
    const executionEnvelope = createExecutionEnvelope({
      actorUserId: "teacher-1",
      taskBrief,
      planRevision: 4,
      intensity: "standard",
      intentGrant,
      action: { toolName: "create_requirement_spec", arguments: { goal: "原始目标" } },
    });
    const businessToolRouter = vi.fn();

    const result = await dispatchMainAgentToolCall({
      invocationId: "invocation-1",
      toolName: "create_requirement_spec",
      arguments: { goal: "被模型替换的目标" },
      serverContext: {
        identity: { actorUserId: "teacher-1", actorAuthMode: "password", authSessionId: "session-1" },
        projectId: "project-1",
        intentEpoch: 2,
        sourceMessageId: "message-1",
        generationIntensity: "standard",
        approvedArtifactRefs: [],
        executionEnvelope,
        executionScope: {
          actorUserId: "teacher-1",
          projectId: "project-1",
          taskId: "task-1",
          intentEpoch: 2,
          planRevision: 4,
          intensity: "standard",
          taskBriefDigest: taskBrief.digest,
        },
      },
    }, {
      allowBusinessExecution: true,
      businessToolRouter,
      buildBusinessToolInput: () => ({
        toolName: "create_requirement_spec",
        projectId: "project-1",
        executionIntentEpoch: 2,
        executionEnvelope,
      }),
    });

    expect(result).toMatchObject({ kind: "blocked", result: { observation: { internalReasonSanitized: "execution_action_mismatch" } } });
    expect(businessToolRouter).not.toHaveBeenCalled();
  });
});
