import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import { createControlPlaneStore } from "@/server/conversation/control-plane-store";
import { resolveContractRepairRecoveryConfig } from "@/server/conversation/conversation-turn-recovery";
import { createAgentObservation } from "@/server/conversation/react-control";
import { createExecutionEnvelope, createTaskBrief, type IntentGrant } from "@/server/conversation/task-contract";
import { createPrismaWorkbenchRepository } from "@/server/workbench/repository";
import { createWorkbenchService } from "@/server/workbench/service";

const root = process.cwd();
const stageRoot = path.join(root, ".tmp", "conversation-contract-repair-tests");
const databasePath = path.join(stageRoot, `recovery-${randomUUID()}.db`);
const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
let client: PrismaClient;

beforeAll(() => {
  mkdirSync(stageRoot, { recursive: true });
  const initialized = spawnSync(process.execPath, ["scripts/init-sqlite-schema.mjs"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl, SHANHAI_DB_INIT_SKIP_DOTENV: "1" },
    encoding: "utf8",
  });
  if (initialized.status !== 0) {
    throw new Error(initialized.stderr || initialized.stdout || "Contract repair test database initialization failed.");
  }
  client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
});

afterAll(async () => {
  await client?.$disconnect();
  for (const suffix of ["", "-shm", "-wal"]) rmSync(`${databasePath}${suffix}`, { force: true });
});

describe("conversation contract repair recovery", () => {
  it("requires one evidence-v2 digest and rejects legacy recovery fields", () => {
    expect(resolveContractRepairRecoveryConfig({
      V1_9_CONTRACT_REPAIR_EVIDENCE_DIGEST: "b".repeat(64),
    })).toEqual({ repairEvidenceDigest: "b".repeat(64) });
    expect(resolveContractRepairRecoveryConfig({
      V1_9_CONTRACT_REPAIR_EVIDENCE_DIGEST: "b".repeat(64),
      V1_9_CONTRACT_REPAIR_FAILURE_EVIDENCE_DIGEST: "a".repeat(64),
      V1_9_CONTRACT_REPAIR_TASK_ID: "task:one",
      V1_9_CONTRACT_REPAIR_INTENT_EPOCH: "0",
    })).toBeNull();
  });

  it.each([
    ["wrongly succeeded", "succeeded", null],
    ["controlled recovery pause", "failed", "main_agent_retry_budget_exhausted"],
    ["legacy controlled pause", "failed", "turn_failed"],
  ] as const)("requeues a manifest-bound %s Job exactly once when no other Job is active", async (_label, outcome, errorCode) => {
    const service = createWorkbenchService(createPrismaWorkbenchRepository(client), undefined, {
      actorUserId: "local-contract-repair-user",
      actorAuthMode: "local",
      authSessionId: null,
    });
    const project = await service.createProject({ title: `contract-repair-${crypto.randomUUID()}` });
    const teacherMessage = await service.addMessage(project.id, {
      role: "teacher",
      content: "完成五年级数学《百分数》材料包",
    });
    const taskBrief = createTaskBrief({
      taskId: `task:${crypto.randomUUID()}`,
      projectId: project.id,
      intentEpoch: 0,
      goal: teacherMessage.content,
      requestedOutputs: ["ppt", "package"],
      constraints: [],
      excludedOutputs: [],
      generationIntensity: "standard",
      sourceMessageId: teacherMessage.id,
    });
    const intentGrant: IntentGrant = {
      schemaVersion: "intent-grant.v1",
      taskId: taskBrief.taskId,
      projectId: project.id,
      intentEpoch: 0,
      standardWorkAuthorized: true,
      intensity: "standard",
      budgetPolicyVersion: null,
      maxCostCredits: null,
      maxExternalProviderCalls: null,
      requiredCheckpoints: [],
      expiresAt: null,
    };
    await service.updateMessageMetadata(project.id, teacherMessage.id, { taskBrief, intentGrant });
    const idempotencyKey = `turn:${crypto.randomUUID()}`;
    const queued = await service.enqueueConversationTurn(project.id, {
      teacherMessageId: teacherMessage.id,
      idempotencyKey,
      maxAttempts: 1,
    });
    const store = createControlPlaneStore(client);
    await store.upsertTaskAggregate({
      taskBrief,
      intentGrant,
      plan: { planId: `plan:${taskBrief.taskId}`, revision: 0, status: "active" },
      status: "active",
      checkpoint: null,
    });
    const envelope = createExecutionEnvelope({
      actorUserId: "local-contract-repair-user",
      taskBrief,
      planRevision: 0,
      intensity: "standard",
      intentGrant,
      action: { toolName: "generate_video_storyboard", arguments: { source: "video-script" } },
    });
    const invocationId = crypto.randomUUID();
    await store.startToolInvocation({
      invocationId,
      envelope,
      toolName: "generate_video_storyboard",
      request: { source: "video-script" },
    });
    const failure = createAgentObservation({
      projectId: project.id,
      source: "tool",
      status: "failed",
      actionKey: "generate_video_storyboard",
      inputHash: envelope.idempotencyKey,
      reasonCodes: ["provider", "tool_execution_not_succeeded"],
      reportRefs: [],
      targetLocators: [],
      responsibleStage: "storyboard_generate",
      minimalNextAction: "repair_upstream",
      teacherSafeSummary: "分镜生成没有可靠完成。",
    });
    await store.commitToolFailure({
      invocationId,
      observation: {
        observationId: failure.observationId,
        status: failure.status,
        reasonCodes: failure.reasonCodes,
        payload: structuredClone(failure) as unknown as Record<string, unknown>,
      },
      event: {
        eventId: crypto.randomUUID(),
        projectId: project.id,
        taskId: taskBrief.taskId,
        runId: `turn:${teacherMessage.id}`,
        intentEpoch: taskBrief.intentEpoch,
        kind: "tool_observed",
        visibility: "internal",
        occurredAt: new Date().toISOString(),
        payload: { observationId: failure.observationId, status: "failed" },
      },
    });
    const running = await service.startNextConversationTurnJob(project.id, { lockedBy: "contract-worker" });
    if (outcome === "succeeded") {
      await service.finishConversationTurnJob(project.id, running!.id, { status: "succeeded" });
    } else {
      await service.failConversationTurnJob(project.id, running!.id, {
        errorCode: errorCode!,
        errorMessage: "当前进度已保存。",
        failureCategory: "control_plane",
        ...(errorCode === "main_agent_retry_budget_exhausted" ? { retryability: "not_retryable" as const } : {}),
      });
      if (errorCode === "turn_failed") {
        await store.upsertTaskAggregate({
          taskBrief,
          intentGrant,
          plan: { planId: `plan:${taskBrief.taskId}`, revision: 1, status: "paused_recovery" },
          status: "paused_recovery",
          checkpoint: null,
        });
      }
    }

    const recovery = {
      projectId: project.id,
      jobId: queued.id,
      teacherMessageId: teacherMessage.id,
      taskId: taskBrief.taskId,
      intentEpoch: taskBrief.intentEpoch,
      taskBriefDigest: taskBrief.digest,
      idempotencyKey,
      failureObservationId: failure.observationId,
      expectedFailureSignature: failure.failureSignature!,
      repairEvidenceDigest: "b".repeat(64),
    };
    const otherMessage = await service.addMessage(project.id, { role: "teacher", content: "另一条排队消息" });
    const otherJob = await service.enqueueConversationTurn(project.id, {
      teacherMessageId: otherMessage.id,
      idempotencyKey: `turn:${crypto.randomUUID()}`,
    });
    await expect(service.requeueConversationTurnJobAfterContractRepair(project.id, queued.id, recovery)).resolves.toBeNull();
    await client.conversationTurnJob.delete({ where: { id: otherJob.id } });
    const messageCount = (await service.getMessages(project.id)).length;
    await expect(service.requeueConversationTurnJobAfterContractRepair(project.id, queued.id, {
      ...recovery,
      expectedFailureSignature: "a".repeat(64),
    })).resolves.toBeNull();
    const recovered = await service.requeueConversationTurnJobAfterContractRepair(project.id, queued.id, recovery);

    expect(recovered).toMatchObject({
      id: queued.id,
      teacherMessageId: teacherMessage.id,
      status: "queued",
      attempts: 1,
      maxAttempts: 2,
      recoveryEvidenceDigest: "b".repeat(64),
    });
    expect(await service.getMessages(project.id)).toHaveLength(messageCount);
    await expect(service.requeueConversationTurnJobAfterContractRepair(project.id, queued.id, recovery)).resolves.toBeNull();
  });
});
