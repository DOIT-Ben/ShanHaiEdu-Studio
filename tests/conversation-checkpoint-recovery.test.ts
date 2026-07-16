import { describe, expect, it, vi } from "vitest";

import { recoverConversationTurnFromCheckpoint } from "@/server/conversation/conversation-turn-checkpoint-recovery";
import { createControlPlaneStore } from "@/server/conversation/control-plane-store";
import { createTaskBrief, type IntentGrant } from "@/server/conversation/task-contract";
import { createWorkbenchService } from "@/server/workbench/service";

describe("conversation checkpoint recovery", () => {
  it("requeues the same failed TurnJob bound to the persisted checkpoint without creating a message", async () => {
    const service = createWorkbenchService(undefined, undefined, {
      actorUserId: "local-recovery-user",
      actorAuthMode: "local",
      authSessionId: null,
    });
    const store = createControlPlaneStore();
    const project = await service.createProject({ title: `checkpoint-recovery-${crypto.randomUUID()}` });
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
    const checkpointId = `checkpoint:${crypto.randomUUID()}`;
    const intentGrant: IntentGrant = {
      schemaVersion: "intent-grant.v1",
      taskId: taskBrief.taskId,
      projectId: project.id,
      intentEpoch: 0,
      standardWorkAuthorized: true,
      intensity: "standard",
      budgetPolicyVersion: null,
      maxCostCredits: null,
      maxExternalProviderCalls: 3,
      requiredCheckpoints: [],
      expiresAt: null,
    };
    const queued = await service.enqueueMessageAndConversationTurn(project.id, {
      role: "teacher",
      content: "完成百分数课件",
      metadata: {
        taskBrief,
        intentGrant,
        agentRunCheckpoint: { checkpointId },
      },
      idempotencyKey: `turn:${crypto.randomUUID()}`,
      maxAttempts: 2,
    });
    const running = await service.startNextConversationTurnJob(project.id, { lockedBy: "first-worker" });
    await service.failConversationTurnJob(project.id, running!.id, {
      errorCode: "main_agent_provider_timeout",
      errorMessage: "本轮智能处理超过了等待时间。",
      retryability: "retryable",
      failureEvidenceDigest: "a".repeat(64),
    });
    await store.upsertTaskAggregate({
      taskBrief,
      intentGrant,
      plan: { planId: `plan:${taskBrief.taskId}`, revision: 0, status: "paused_recovery" },
      status: "paused_recovery",
      checkpoint: { checkpointId },
    });
    const messageCountBefore = (await service.getMessages(project.id)).length;

    const recovered = await recoverConversationTurnFromCheckpoint({
      projectId: project.id,
      checkpointId,
      service,
      controlPlaneStore: store,
    });

    expect(recovered.job).toMatchObject({ id: queued.job.id, status: "queued" });
    expect(recovered.message.id).toBe(queued.message.id);
    expect((await service.getMessages(project.id))).toHaveLength(messageCountBefore);
  });

  it("fails closed when the checkpoint does not match the failed turn", async () => {
    const service = createWorkbenchService(undefined, undefined, {
      actorUserId: "local-recovery-user",
      actorAuthMode: "local",
      authSessionId: null,
    });
    const project = await service.createProject({ title: `checkpoint-mismatch-${crypto.randomUUID()}` });

    await expect(recoverConversationTurnFromCheckpoint({
      projectId: project.id,
      checkpointId: "checkpoint:unknown",
      service,
      controlPlaneStore: createControlPlaneStore(),
    })).rejects.toThrow(/checkpoint/i);
  });

  it("fails closed when the requested checkpoint is not the aggregate current checkpoint", async () => {
    const requeue = vi.fn();
    const service = {
      getConversationTurnJobs: vi.fn(async () => [{
        id: "turn-job-1",
        projectId: "project-a",
        teacherMessageId: "teacher-message-1",
        assistantMessageId: null,
        status: "failed",
        attempts: 1,
        maxAttempts: 2,
        failureRetryability: "retryable",
        failureEvidenceDigest: "a".repeat(64),
      }]),
      getMessages: vi.fn(async () => [{
        id: "teacher-message-1",
        metadata: {
          taskBrief: { taskId: "task-a", intentEpoch: 1 },
          agentRunCheckpoint: { checkpointId: "checkpoint-old" },
        },
      }]),
      requeueConversationTurnJobForRecovery: requeue,
    };
    const controlPlaneStore = {
      getTaskAggregate: vi.fn(async () => ({
        taskBrief: { taskId: "task-a", projectId: "project-a" },
        checkpoint: { checkpointId: "checkpoint-current" },
      })),
    };

    await expect(recoverConversationTurnFromCheckpoint({
      projectId: "project-a",
      checkpointId: "checkpoint-old",
      service: service as never,
      controlPlaneStore: controlPlaneStore as never,
    })).rejects.toThrow(/checkpoint/i);
    expect(requeue).not.toHaveBeenCalled();
    expect(service.getMessages).toHaveBeenCalledTimes(1);
  });
});
