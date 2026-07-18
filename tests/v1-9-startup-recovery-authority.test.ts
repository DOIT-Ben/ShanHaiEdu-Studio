import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { rmSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { createControlPlaneStore } from "@/server/conversation/control-plane-store";
import { createMainAgentReActCheckpoint } from "@/server/conversation/main-agent-react-checkpoint";
import { createTaskBrief, type IntentGrant } from "@/server/conversation/task-contract";
import { resolveV1_9StartupRecoveryDisposition } from "@/server/conversation/v1-9-startup-recovery-authority";
import { createPrismaWorkbenchRepository } from "@/server/workbench/repository";
import { createWorkbenchService } from "@/server/workbench/service";
import {
  normalizeV1_9RunState,
  type V1_9RunState,
} from "../scripts/lib/v1-9-e2e-contract.mjs";
import { projectReadyV1_9Authority } from "./support/v1-9-authority-summary";

const databasePath = path.resolve(`.tmp/v1-9-startup-recovery-${crypto.randomUUID()}.db`);
const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
let client: PrismaClient;

beforeAll(() => {
  execFileSync(process.execPath, ["scripts/init-sqlite-schema.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });
  client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
});

afterAll(async () => {
  await client?.$disconnect();
  for (const suffix of ["", "-shm", "-wal"]) rmSync(`${databasePath}${suffix}`, { force: true });
});

describe("V1-9 DB-first startup recovery disposition", () => {
  it("derives Provider-health recovery from one exact SQLite identity", async () => {
    const fixture = await createFixture("provider_health");

    await expect(resolveV1_9StartupRecoveryDisposition({
      client,
      runState: fixture.state,
      now: new Date("2026-07-18T18:00:00.000Z"),
    })).resolves.toMatchObject({
      kind: "provider_health",
      reasonCode: "main_agent_provider_unavailable",
      identity: {
        projectId: fixture.projectId,
        taskId: fixture.taskId,
        teacherMessageId: fixture.teacherMessageId,
        turnJobId: fixture.turnJobId,
        checkpointId: fixture.checkpointId,
      },
    });
  });

  it.each(["queued", "expired_running"] as const)("derives interrupted running for an exact %s TurnJob", async (mode) => {
    const fixture = await createFixture(mode);

    await expect(resolveV1_9StartupRecoveryDisposition({
      client,
      runState: fixture.state,
      now: new Date("2026-07-18T18:00:00.000Z"),
    })).resolves.toMatchObject({ kind: "interrupted_running", identity: { turnJobId: fixture.turnJobId } });
  });

  it("fails closed on missing checkpoint binding and another active TurnJob", async () => {
    const missingCheckpoint = await createFixture("provider_health");
    const state = structuredClone(missingCheckpoint.state) as Record<string, any>;
    state.recovery.checkpointId = null;
    state.checkpoint = null;
    expect(() => normalizeV1_9RunState(state)).not.toThrow();
    await expect(resolveV1_9StartupRecoveryDisposition({ client, runState: state }))
      .rejects.toThrow("v1_9_startup_recovery_identity_invalid");

    const ambiguous = await createFixture("provider_health");
    await client.conversationTurnJob.create({
      data: {
        projectId: ambiguous.projectId,
        teacherMessageId: ambiguous.teacherMessageId,
        status: "queued",
        actorUserId: ambiguous.actorUserId,
        actorAuthMode: "local",
      },
    });
    await expect(resolveV1_9StartupRecoveryDisposition({ client, runState: ambiguous.state }))
      .rejects.toThrow("v1_9_startup_recovery_identity_invalid");
  });

  it("rejects an unexpired running lease and TurnJob actor or session drift", async () => {
    const leased = await createFixture("expired_running");
    await expect(resolveV1_9StartupRecoveryDisposition({
      client,
      runState: leased.state,
      now: new Date("2026-07-18T17:58:00.000Z"),
    })).rejects.toThrow("v1_9_startup_recovery_identity_invalid");

    const drifted = await createFixture("queued");
    await client.conversationTurnJob.update({
      where: { id: drifted.turnJobId },
      data: { actorUserId: "other-actor", authSessionId: "unexpected-session" },
    });
    await expect(resolveV1_9StartupRecoveryDisposition({ client, runState: drifted.state }))
      .rejects.toThrow("v1_9_startup_recovery_identity_invalid");
  });

  it("returns none for a prepared run without reading a project-global latest task", async () => {
    const state = createBaseState({
      actorUserId: null,
      projectId: null,
      taskId: null,
      intentEpoch: null,
      teacherMessageId: "unused",
      turnJobId: "unused",
      taskBriefDigest: "1".repeat(64),
      checkpointId: "2".repeat(64),
      status: "prepared",
    });
    await expect(resolveV1_9StartupRecoveryDisposition({ client, runState: state })).resolves.toEqual({ kind: "none" });
  });
});

async function createFixture(mode: "provider_health" | "queued" | "expired_running") {
  const actorUserId = `recovery-user-${crypto.randomUUID()}`;
  const service = createWorkbenchService(createPrismaWorkbenchRepository(client), undefined, {
    actorUserId,
    actorAuthMode: "local",
    authSessionId: null,
  });
  const project = await service.createProject({ title: `recovery-${crypto.randomUUID()}` });
  const teacherMessage = await service.addMessage(project.id, { role: "teacher", content: "继续完成当前备课任务" });
  const taskId = `task:${crypto.randomUUID()}`;
  const taskBrief = createTaskBrief({
    taskId,
    projectId: project.id,
    intentEpoch: 0,
    goal: "继续完成当前备课任务",
    requestedOutputs: ["requirement_spec"],
    constraints: [],
    excludedOutputs: [],
    generationIntensity: "standard",
    sourceMessageId: teacherMessage.id,
  });
  const intentGrant: IntentGrant = {
    schemaVersion: "intent-grant.v1",
    taskId,
    projectId: project.id,
    intentEpoch: 0,
    standardWorkAuthorized: true,
    intensity: "standard",
    budgetPolicyVersion: null,
    maxCostCredits: null,
    maxExternalProviderCalls: 1,
    requiredCheckpoints: [],
    expiresAt: null,
  };
  await service.updateMessageMetadata(project.id, teacherMessage.id, { taskBrief, intentGrant });
  const checkpoint = createMainAgentReActCheckpoint({
    request: { instructions: "recovery test", input: taskBrief.goal },
    seed: {
      projectId: project.id,
      taskId,
      taskBriefDigest: taskBrief.digest,
      intentEpoch: 0,
      planRevision: 1,
      generationIntensity: "standard",
      authorization: {
        standardWorkAuthorized: true,
        budgetPolicyVersion: null,
        maxCostCredits: null,
        maxExternalProviderCalls: 1,
      },
    },
    records: [],
    currentToolNames: [],
  });
  await createControlPlaneStore(client).upsertTaskAggregate({
    taskBrief,
    intentGrant,
    plan: { planId: "plan-fixture", revision: 1, status: mode === "provider_health" ? "paused_recovery" : "active" },
    status: mode === "provider_health" ? "paused_recovery" : "active",
    checkpoint,
  });
  const job = await service.enqueueConversationTurn(project.id, {
    teacherMessageId: teacherMessage.id,
    idempotencyKey: `turn:${crypto.randomUUID()}`,
    maxAttempts: 2,
  });
  if (mode !== "queued") {
    await service.startNextConversationTurnJob(project.id, { lockedBy: "recovery-test", lockMs: 60_000 });
  }
  if (mode === "provider_health") {
    await service.failConversationTurnJob(project.id, job.id, {
      errorCode: "main_agent_provider_unavailable",
      errorMessage: "provider unavailable",
      retryability: "after_provider_health_change",
      failureEvidenceDigest: "a".repeat(64),
    });
  }
  if (mode === "expired_running") {
    await client.conversationTurnJob.update({
      where: { id: job.id },
      data: { lockedUntil: new Date("2026-07-18T17:59:00.000Z") },
    });
  }
  const state = createBaseState({
    actorUserId,
    projectId: project.id,
    taskId,
    intentEpoch: 0,
    teacherMessageId: teacherMessage.id,
    turnJobId: job.id,
    taskBriefDigest: taskBrief.digest,
    checkpointId: checkpoint.checkpointDigest,
    status: mode === "provider_health" ? "paused_recovery" : "running",
  });
  return {
    actorUserId,
    projectId: project.id,
    taskId,
    teacherMessageId: teacherMessage.id,
    turnJobId: job.id,
    checkpointId: checkpoint.checkpointDigest,
    state,
  };
}

function createBaseState(input: {
  actorUserId: string | null;
  projectId: string | null;
  taskId: string | null;
  intentEpoch: number | null;
  teacherMessageId: string;
  turnJobId: string;
  taskBriefDigest: string;
  checkpointId: string;
  status: "prepared" | "running" | "paused_recovery";
}) {
  const timestamp = "2026-07-18T17:00:00.000Z";
  const taskBound = input.status !== "prepared";
  let state = normalizeV1_9RunState({
    schemaVersion: "v1-9-run-state.v3",
    runId: `v1-9-recovery-${crypto.randomUUID()}`,
    manifestSha256: "f".repeat(64),
    status: taskBound ? "running" : "prepared",
    identity: {
      actorUserId: taskBound ? input.actorUserId : null,
      projectId: taskBound ? input.projectId : null,
      taskId: taskBound ? input.taskId : null,
      intentEpoch: taskBound ? input.intentEpoch : null,
    },
    taskContractLock: taskBound ? {
      schemaVersion: "v1-9-task-contract-lock.v1",
      actorAuthMode: "local",
      teacherMessageId: input.teacherMessageId,
      turnJobId: input.turnJobId,
      taskBriefDigest: input.taskBriefDigest,
      intentEpoch: input.intentEpoch,
      intensity: "standard",
      intentGrantDigest: "2".repeat(64),
      budgetDigest: "3".repeat(64),
      initialPlanRevision: 1,
    } : null,
    checkpoint: taskBound ? {
      checkpointId: input.checkpointId,
      planRevision: 1,
      observationRefs: [],
      recordedAt: timestamp,
    } : null,
    pendingDecision: null,
    recovery: null,
    termination: null,
    packageAcceptance: null,
    orchestrationAuthoritySummary: null,
    ledger: {
      schemaVersion: "v1-9-run-ledger.v1",
      currentPlanRevision: taskBound ? 1 : null,
      planRevisionHistory: taskBound ? [{ revision: 1, recordedAt: timestamp }] : [],
      taskSubmissionCount: taskBound ? 1 : 0,
      finalDownloadCount: 0,
      externalCodexOrchestrationCount: 0,
      mutations: taskBound ? [{ method: "POST", pathname: `/api/workbench/projects/${input.projectId}/messages`, source: "ui" }] : [],
      violations: [],
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  if (!taskBound) return state;
  state = projectReadyV1_9Authority(state);
  if (input.status === "paused_recovery") {
    state = normalizeV1_9RunState({
      ...state,
      status: "paused_recovery",
      recovery: {
        reasonCode: "main_agent_provider_unavailable",
        checkpointId: input.checkpointId,
        observationRefs: [],
        healthEvidenceNotBefore: timestamp,
        turnJobId: input.turnJobId,
        teacherMessageId: input.teacherMessageId,
      },
    });
  }
  return state;
}
