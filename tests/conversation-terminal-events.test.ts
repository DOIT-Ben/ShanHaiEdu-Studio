import { describe, expect, it } from "vitest";

import { createControlPlaneStore } from "@/server/conversation/control-plane-store";
import { drainProjectConversationQueue } from "@/server/conversation/conversation-turn-queue";
import { createTaskBrief, type IntentGrant } from "@/server/conversation/task-contract";
import { createWorkbenchService } from "@/server/workbench/service";

describe("conversation terminal events", () => {
  it("publishes persisted text and run completion events from a real queued turn", async () => {
    const service = createWorkbenchService(undefined, undefined, {
      actorUserId: "local-event-user",
      actorAuthMode: "local",
      authSessionId: null,
    });
    const project = await service.createProject({ title: `terminal-events-${crypto.randomUUID()}` });
    const teacher = await service.addMessage(project.id, { role: "teacher", content: "整理百分数课件" });
    await service.enqueueConversationTurn(project.id, {
      teacherMessageId: teacher.id,
      idempotencyKey: `turn:${crypto.randomUUID()}`,
    });

    await drainProjectConversationQueue(project.id, {
      service,
      executor: async ({ service: guarded, job }) => {
        await createControlPlaneStore().appendEvent({
          eventId: crypto.randomUUID(),
          projectId: project.id,
          taskId: `conversation-turn:${job.id}`,
          runId: `turn:${teacher.id}`,
          intentEpoch: 0,
          kind: "tool_started",
          visibility: "teacher",
          occurredAt: new Date().toISOString(),
          payload: { activityId: "tool:outline", label: "生成课件结构", status: "running" },
        });
        const assistant = await guarded.addMessage(project.id, { role: "assistant", content: "课件结构已经整理完成。" });
        return { assistantMessageId: assistant.id };
      },
    });

    const events = await createControlPlaneStore().listEvents(project.id);
    expect(events.map((event) => event.kind)).toEqual(expect.arrayContaining(["run_started", "text_completed", "run_completed"]));
    expect(events.findIndex((event) => event.kind === "run_started"))
      .toBeLessThan(events.findIndex((event) => event.kind === "text_completed"));
    expect(events.find((event) => event.kind === "text_completed")).toMatchObject({
      visibility: "teacher",
      payload: { text: "课件结构已经整理完成。" },
    });
    const assistant = (await service.getMessages(project.id)).find((message) => message.role === "assistant");
    expect(assistant?.metadata.agentTimeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "activity", activityId: "tool:outline" }),
      expect.objectContaining({ type: "text", text: "课件结构已经整理完成。" }),
      expect.objectContaining({ type: "activity", status: "completed" }),
    ]));
  });

  it("does not mark a TurnJob succeeded while its TaskAggregate still has requested outputs", async () => {
    const service = createWorkbenchService(undefined, undefined, {
      actorUserId: "local-incomplete-task-user",
      actorAuthMode: "local",
      authSessionId: null,
    });
    const project = await service.createProject({ title: `incomplete-task-${crypto.randomUUID()}` });
    const taskBrief = createTaskBrief({
      taskId: `task:${crypto.randomUUID()}`,
      projectId: project.id,
      intentEpoch: 0,
      goal: "完成百分数课件",
      requestedOutputs: ["ppt"],
      constraints: [],
      excludedOutputs: [],
      generationIntensity: "standard",
      sourceMessageId: "pending",
    });
    const intentGrant = standardGrant(taskBrief.taskId, project.id);
    const teacher = await service.addMessage(project.id, {
      role: "teacher",
      content: taskBrief.goal,
      metadata: { taskBrief: { ...taskBrief, sourceMessageId: "pending" }, intentGrant },
    });
    const persistedBrief = createTaskBrief({
      taskId: taskBrief.taskId,
      projectId: taskBrief.projectId,
      intentEpoch: taskBrief.intentEpoch,
      goal: taskBrief.goal,
      requestedOutputs: taskBrief.requestedOutputs,
      constraints: taskBrief.constraints,
      excludedOutputs: taskBrief.excludedOutputs,
      generationIntensity: taskBrief.generationIntensity,
      sourceMessageId: teacher.id,
    });
    await service.updateMessageMetadata(project.id, teacher.id, { taskBrief: persistedBrief, intentGrant });
    await createControlPlaneStore().upsertTaskAggregate({
      taskBrief: persistedBrief,
      intentGrant,
      plan: { planId: `plan:${persistedBrief.taskId}`, revision: 0, status: "active" },
      status: "active",
      checkpoint: null,
    });
    const queued = await service.enqueueConversationTurn(project.id, {
      teacherMessageId: teacher.id,
      idempotencyKey: `turn:${crypto.randomUUID()}`,
    });

    await drainProjectConversationQueue(project.id, {
      service,
      executor: async ({ service: guarded }) => {
        const assistant = await guarded.addMessage(project.id, { role: "assistant", content: "我已经处理好了。" });
        return { assistantMessageId: assistant.id };
      },
    });

    const snapshot = await service.getProjectSnapshot(project.id);
    expect(snapshot.turnJobs.find((job) => job.id === queued.id)).toMatchObject({
      status: "blocked",
      errorCode: "completion_contract_unsatisfied",
    });
    await expect(createControlPlaneStore().getTaskAggregate(project.id, 0)).resolves.toMatchObject({
      status: "paused_recovery",
      checkpoint: expect.objectContaining({
        reasonCode: "completion_contract_unsatisfied",
        remainingRequestedOutputs: ["ppt"],
      }),
    });
    const events = await createControlPlaneStore().listEvents(project.id);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "run_failed", payload: expect.objectContaining({ status: "blocked" }) }),
    ]));
    expect(events.some((event) => event.kind === "run_completed")).toBe(false);
  });

  it("publishes a teacher-safe failed step and reasonCode when a queued turn throws before an assistant message", async () => {
    const service = createWorkbenchService(undefined, undefined, {
      actorUserId: "local-terminal-failure-user",
      actorAuthMode: "local",
      authSessionId: null,
    });
    const project = await service.createProject({ title: `terminal-failure-${crypto.randomUUID()}` });
    const teacher = await service.addMessage(project.id, { role: "teacher", content: "继续刚才的课件任务" });
    await service.enqueueConversationTurn(project.id, {
      teacherMessageId: teacher.id,
      idempotencyKey: `turn:${crypto.randomUUID()}`,
    });

    await drainProjectConversationQueue(project.id, {
      service,
      executor: async () => { throw new Error("Task aggregate identity cannot change within an IntentEpoch."); },
    });

    const failed = (await createControlPlaneStore().listEvents(project.id)).find((event) => event.kind === "run_failed");
    expect(failed).toMatchObject({
      visibility: "teacher",
      payload: {
        status: "failed",
        reasonCode: "turn_execution_failed",
        label: "恢复当前任务时未完成，失败位置已保存",
      },
    });
    expect(JSON.stringify(failed?.payload)).not.toMatch(/Task aggregate|IntentEpoch|identity cannot change/i);
  });

  it("atomically completes the TurnJob and TaskAggregate only after trusted outputs exist", async () => {
    const service = createWorkbenchService(undefined, undefined, {
      actorUserId: "local-complete-task-user",
      actorAuthMode: "local",
      authSessionId: null,
    });
    const project = await service.createProject({ title: `complete-task-${crypto.randomUUID()}` });
    const teacher = await service.addMessage(project.id, { role: "teacher", content: "整理百分数需求" });
    const taskBrief = createTaskBrief({
      taskId: `task:${crypto.randomUUID()}`,
      projectId: project.id,
      intentEpoch: 0,
      goal: teacher.content,
      requestedOutputs: ["requirement_spec"],
      constraints: [],
      excludedOutputs: [],
      generationIntensity: "standard",
      sourceMessageId: teacher.id,
    });
    const intentGrant = standardGrant(taskBrief.taskId, project.id);
    await service.updateMessageMetadata(project.id, teacher.id, { taskBrief, intentGrant });
    await createControlPlaneStore().upsertTaskAggregate({
      taskBrief,
      intentGrant,
      plan: { planId: `plan:${taskBrief.taskId}`, revision: 0, status: "active" },
      status: "active",
      checkpoint: null,
    });
    const requirement = await service.saveArtifact(project.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "可信需求规格",
      status: "needs_review",
      summary: "任务语义完整。",
      markdownContent: "# 需求规格",
      structuredContent: {
        artifactQualityState: {
          validationStatus: "passed",
          reviewStatus: "passed",
          downstreamEligibility: "eligible",
        },
      },
    });
    await service.approveArtifact(project.id, requirement.id);
    const queued = await service.enqueueConversationTurn(project.id, {
      teacherMessageId: teacher.id,
      idempotencyKey: `turn:${crypto.randomUUID()}`,
    });

    await drainProjectConversationQueue(project.id, {
      service,
      executor: async ({ service: guarded }) => {
        const assistant = await guarded.addMessage(project.id, { role: "assistant", content: "需求规格已经完成。" });
        return { assistantMessageId: assistant.id };
      },
    });

    const snapshot = await service.getProjectSnapshot(project.id);
    expect(snapshot.turnJobs.find((job) => job.id === queued.id)).toMatchObject({ status: "succeeded" });
    await expect(createControlPlaneStore().getTaskAggregate(project.id, 0)).resolves.toMatchObject({
      status: "completed",
      checkpoint: null,
    });
  });
});

function standardGrant(taskId: string, projectId: string): IntentGrant {
  return {
    schemaVersion: "intent-grant.v1",
    taskId,
    projectId,
    intentEpoch: 0,
    standardWorkAuthorized: true,
    intensity: "standard",
    budgetPolicyVersion: "v1-standard-task-scope.v1",
    maxCostCredits: null,
    maxExternalProviderCalls: 2,
    requiredCheckpoints: [],
    expiresAt: null,
  };
}
