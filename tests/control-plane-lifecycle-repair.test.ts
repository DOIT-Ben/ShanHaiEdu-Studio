import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildSemanticContextSnapshot } from "@/server/conversation/context-semantic-snapshot";
import { createControlPlaneStore } from "@/server/conversation/control-plane-store";
import { repairControlPlaneLifecycleConflict } from "@/server/conversation/control-plane-lifecycle-repair";
import { createTaskBrief, type IntentGrant } from "@/server/conversation/task-contract";
import { createPrismaWorkbenchRepository } from "@/server/workbench/repository";
import { createWorkbenchService } from "@/server/workbench/service";

const root = process.cwd();
const stageRoot = path.join(root, ".tmp", "control-plane-lifecycle-repair-tests");
const databasePath = path.join(stageRoot, `repair-${randomUUID()}.db`);
const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
let client: PrismaClient;

beforeAll(() => {
  mkdirSync(stageRoot, { recursive: true });
  const initialized = spawnSync(process.execPath, ["scripts/init-sqlite-schema.mjs"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl, SHANHAI_DB_INIT_SKIP_DOTENV: "1" },
    encoding: "utf8",
  });
  if (initialized.status !== 0) throw new Error(initialized.stderr || initialized.stdout || "Lifecycle repair database initialization failed.");
  client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
});

afterAll(async () => {
  await client?.$disconnect();
  for (const suffix of ["", "-shm", "-wal"]) rmSync(`${databasePath}${suffix}`, { force: true });
});

describe("control-plane lifecycle repair", () => {
  it("restores the latest semantic revision and materializes the exact run failure Observation", async () => {
    const service = createWorkbenchService(createPrismaWorkbenchRepository(client), undefined, {
      actorUserId: "lifecycle-repair-user",
      actorAuthMode: "local",
      authSessionId: null,
    });
    const project = await service.createProject({ title: `lifecycle-repair-${randomUUID()}` });
    const queued = await service.enqueueMessageAndConversationTurn(project.id, {
      role: "teacher",
      content: "完成五年级数学百分数材料包",
      idempotencyKey: `turn:${randomUUID()}`,
      maxAttempts: 1,
    });
    const taskBrief = createTaskBrief({
      taskId: `task:${queued.message.id}`,
      projectId: project.id,
      intentEpoch: 0,
      goal: queued.message.content,
      requestedOutputs: ["ppt", "package"],
      constraints: [],
      excludedOutputs: [],
      generationIntensity: "standard",
      sourceMessageId: queued.message.id,
    });
    const intentGrant: IntentGrant = {
      schemaVersion: "intent-grant.v1",
      taskId: taskBrief.taskId,
      projectId: project.id,
      intentEpoch: 0,
      standardWorkAuthorized: true,
      intensity: "standard",
      budgetPolicyVersion: "v1-standard-task-scope.v1",
      maxCostCredits: null,
      maxExternalProviderCalls: 8,
      requiredCheckpoints: [],
      expiresAt: null,
    };
    await service.updateMessageMetadata(project.id, queued.message.id, {
      taskBrief,
      intentGrant,
      mainAgentFailure: { reasonCode: "main_agent_response_invalid" },
    });
    const store = createControlPlaneStore(client);
    await store.upsertTaskAggregate({
      taskBrief,
      intentGrant,
      plan: { planId: `plan:${taskBrief.taskId}`, revision: 6, status: "paused_recovery" },
      status: "paused_recovery",
      checkpoint: null,
    });
    const snapshot = buildSemanticContextSnapshot({
      taskBrief,
      plan: { planId: `plan:${taskBrief.taskId}`, revision: 11, status: "paused_recovery" },
      pendingDecision: null,
      trustedArtifactRefs: [],
      observationRefs: [],
      recentMessages: [{ role: "teacher", content: taskBrief.goal }],
    });
    await store.saveSemanticSnapshot(snapshot, 0);
    const failureObservationId = randomUUID();
    await store.appendEvent({
      eventId: randomUUID(),
      projectId: project.id,
      taskId: taskBrief.taskId,
      runId: `turn:${queued.message.id}`,
      intentEpoch: 0,
      kind: "run_failed",
      visibility: "internal",
      occurredAt: "2026-07-15T03:50:14.281Z",
      payload: { reasonCode: "main_agent_response_invalid", observationId: failureObservationId },
    });
    const running = await service.startNextConversationTurnJob(project.id, { lockedBy: "repair-worker" });
    await service.failConversationTurnJob(project.id, running!.id, {
      errorCode: "main_agent_response_invalid",
      errorMessage: "本轮智能结果不完整，未进入后续执行。",
      failureCategory: "invalid_response",
      retryability: "retryable",
    });

    const repaired = await repairControlPlaneLifecycleConflict({
      client,
      projectId: project.id,
      taskId: taskBrief.taskId,
      intentEpoch: 0,
      jobId: queued.job.id,
      teacherMessageId: queued.message.id,
    });

    expect(repaired).toMatchObject({
      failureObservationId,
      previousPlanRevision: 6,
      restoredPlanRevision: 11,
      reasonCode: "control_plane_lifecycle_conflict",
      failureSignature: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    await expect(store.getTaskAggregate(project.id, 0)).resolves.toMatchObject({
      status: "paused_recovery",
      plan: { revision: 11 },
    });
    await expect(store.getObservation(failureObservationId)).resolves.toMatchObject({
      status: "failed",
      reasonCodes: ["control_plane_lifecycle_conflict"],
      payload: { failureSignature: repaired.failureSignature },
    });
    await expect(service.getConversationTurnJobs(project.id)).resolves.toEqual([
      expect.objectContaining({
        id: queued.job.id,
        status: "failed",
        errorCode: "control_plane_lifecycle_conflict",
        failureCategory: "control_plane",
        failureRetryability: "not_retryable",
      }),
    ]);
    await expect(service.requeueConversationTurnJobAfterContractRepair(project.id, queued.job.id, {
      projectId: project.id,
      jobId: queued.job.id,
      teacherMessageId: queued.message.id,
      taskId: taskBrief.taskId,
      intentEpoch: taskBrief.intentEpoch,
      taskBriefDigest: taskBrief.digest,
      idempotencyKey: queued.job.idempotencyKey!,
      failureObservationId,
      expectedFailureSignature: repaired.failureSignature,
      repairEvidenceDigest: "b".repeat(64),
    })).resolves.toMatchObject({
      id: queued.job.id,
      status: "queued",
      attempts: 1,
      maxAttempts: 2,
    });
  });
});
