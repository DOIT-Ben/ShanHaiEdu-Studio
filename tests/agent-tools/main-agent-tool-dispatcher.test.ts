import { describe, expect, it, vi } from "vitest";

import { dispatchMainAgentToolCall } from "@/server/tools/main-agent-tool-dispatcher";
import { createExecutionEnvelope, createTaskBrief, type IntentGrant } from "@/server/conversation/task-contract";
import { validPptDirectorOutput } from "../support/ppt-director-output-fixture";

function serverContextFor(toolName: string, args: Record<string, unknown>) {
  const taskBrief = createTaskBrief({
    taskId: "task-1",
    projectId: "project-1",
    intentEpoch: 2,
    goal: "规划课件",
    requestedOutputs: ["ppt"],
    constraints: [],
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
    planRevision: 0,
    intensity: "standard",
    intentGrant,
    action: { toolName, arguments: args },
  });
  return {
    identity: { actorUserId: "teacher-1", actorAuthMode: "password" as const, authSessionId: "session-1" },
    projectId: "project-1",
    intentEpoch: 2,
    sourceMessageId: "message-1",
    generationIntensity: "standard" as const,
    approvedArtifactRefs: [],
    executionEnvelope,
    executionScope: {
      actorUserId: "teacher-1",
      projectId: "project-1",
      taskId: taskBrief.taskId,
      intentEpoch: 2,
      planRevision: 0,
      intensity: "standard" as const,
      taskBriefDigest: taskBrief.digest,
    },
  };
}

describe("V1-3 Main Agent Tool Dispatcher", () => {
  it("routes a model-visible Agent Tool through the Agent Tool Router with a server-owned envelope", async () => {
    const executor = vi.fn(async (envelope) => ({
      status: "succeeded" as const,
      toolId: "ppt_director.plan_or_repair" as const,
      invocationId: envelope.invocationId,
      structuredOutput: validPptDirectorOutput(),
      assistantSummary: "已形成课件规划。",
      artifactCreated: false as const,
    }));

    const args = { goal: "规划课件", stage: "page_design", targetPageIds: [], focus: null };
    const result = await dispatchMainAgentToolCall({
      invocationId: "invocation-1",
      toolName: "ppt_director_plan_or_repair",
      arguments: args,
      serverContext: serverContextFor("ppt_director.plan_or_repair", args),
    }, {
      agentToolExecutor: executor,
      authorizeAgentTool: async () => true,
    });

    expect(result.kind).toBe("agent_tool");
    if (result.kind !== "agent_tool") return;
    expect(result.envelope).toMatchObject({
      projectId: "project-1",
      intentEpoch: 2,
      sourceMessageId: "message-1",
      identity: { actorUserId: "teacher-1" },
      toolId: "ppt_director.plan_or_repair",
    });
    expect(result.result).toMatchObject({ status: "succeeded", artifactCreated: false });
  });

  it("does not execute business tools inside the read-only Agent Tool loop", async () => {
    const businessToolRouter = vi.fn();
    const result = await dispatchMainAgentToolCall({
      invocationId: "invocation-2",
      toolName: "assemble_ppt_full_deck",
      arguments: {},
      serverContext: serverContextFor("assemble_ppt_full_deck", {}),
    }, { businessToolRouter });

    expect(result).toMatchObject({ kind: "blocked", result: { status: "failed" } });
    expect(businessToolRouter).not.toHaveBeenCalled();
  });

  it("rejects hidden tools and does not let model arguments override server authority", async () => {
    const executor = vi.fn();
    const unknown = await dispatchMainAgentToolCall({
      invocationId: "invocation-3",
      toolName: "raw_provider_submit",
      arguments: {},
      serverContext: serverContextFor("raw_provider_submit", {}),
    }, { agentToolExecutor: executor, authorizeAgentTool: async () => true });
    expect(unknown.kind).toBe("blocked");

    const overriddenArgs = {
      goal: "规划课件",
      stage: "page_design",
      targetPageIds: [],
      focus: null,
      projectId: "other-project",
    };
    const overridden = await dispatchMainAgentToolCall({
      invocationId: "invocation-4",
      toolName: "ppt_director_plan_or_repair",
      arguments: overriddenArgs,
      serverContext: serverContextFor("ppt_director.plan_or_repair", overriddenArgs),
    }, { agentToolExecutor: executor, authorizeAgentTool: async () => true });
    expect(overridden).toMatchObject({
      kind: "agent_tool",
      envelope: { projectId: "project-1" },
      result: { status: "failed", errorCategory: "agent_tool_arguments_invalid" },
    });
    expect(executor).not.toHaveBeenCalled();
  });
});
