import { describe, expect, it, vi } from "vitest";

import { createMainAgentToolLoopOptions } from "@/server/conversation/main-agent-tool-loop-config";
import { readAgentObservationsFromMessages } from "@/server/conversation/react-control";
import { readAgentToolReportsFromMessages } from "@/server/tools/agent-tool-report";
import { createWorkbenchService } from "@/server/workbench/service";
import { createWorkbenchActor } from "@/server/auth/actor";

describe("V1-3 Main Agent Agent Tool loop config", () => {
  it("persists a signed Agent Tool report and observation under the active project lease", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `V1-3-loop-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "请规划PPT样张。" });
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    expect(lease).not.toBeNull();
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    const executor = vi.fn(async (envelope) => ({
      status: "succeeded" as const,
      toolId: "ppt_director.plan_or_repair" as const,
      invocationId: envelope.invocationId,
      structuredOutput: {
        decision: "plan",
        summary: "先确定关键样张。",
        targetLocators: [],
        nextToolIntents: ["assemble_ppt_key_samples"],
        assumptions: [],
        stopConditions: ["sample_review"],
      },
      assistantSummary: "已形成样张规划。",
      artifactCreated: false as const,
    }));

    try {
      const config = createMainAgentToolLoopOptions({
        service,
        project,
        triggerMessage: message,
        artifacts: [],
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null },
        fence,
        executor,
      });
      expect(config?.allowedToolNames).toContain("ppt_director_plan_or_repair");
      const result = await config!.dispatch({
        callId: "call-1",
        toolName: "ppt_director_plan_or_repair",
        arguments: { goal: "规划课件", stage: "sample_plan", targetPageIds: [], focus: null },
      });

      expect(result).toMatchObject({ status: "succeeded", observationId: expect.any(String) });
      const messages = await service.getMessages(project.id);
      expect(readAgentToolReportsFromMessages(messages)).toEqual([
        expect.objectContaining({ projectId: project.id, toolId: "ppt_director.plan_or_repair", status: "succeeded" }),
      ]);
      expect(readAgentObservationsFromMessages(messages)).toEqual([
        expect.objectContaining({ projectId: project.id, actionKey: "ppt_director.plan_or_repair", status: "succeeded" }),
      ]);
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("does not execute or persist an Agent Tool after IntentEpoch changes", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `V1-3-stale-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "请规划PPT样张。" });
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    const executor = vi.fn();
    try {
      const config = createMainAgentToolLoopOptions({
        service,
        project,
        triggerMessage: message,
        artifacts: [],
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null },
        fence,
        executor,
      });
      await service.advanceProjectIntentEpoch(project.id, project.intentEpoch ?? 0);
      const result = await config!.dispatch({
        callId: "call-2",
        toolName: "ppt_director_plan_or_repair",
        arguments: { goal: "规划课件", stage: "sample_plan", targetPageIds: [], focus: null },
      });
      expect(result).toMatchObject({ status: "inconclusive", modelOutput: { reason: "intent_changed" } });
      expect(executor).not.toHaveBeenCalled();
      expect(readAgentToolReportsFromMessages(await service.getMessages(project.id))).toEqual([]);
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });
});
