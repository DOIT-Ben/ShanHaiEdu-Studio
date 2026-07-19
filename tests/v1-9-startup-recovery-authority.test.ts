import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { createControlPlaneStore } from "@/server/conversation/control-plane-store";
import { drainProjectConversationQueue } from "@/server/conversation/conversation-turn-queue";
import {
  createV1_9StartupRecoverySingleFlight,
  recoverV1_9StartupConversationTurn,
} from "@/server/conversation/conversation-turn-recovery";
import { createMainAgentReActCheckpoint } from "@/server/conversation/main-agent-react-checkpoint";
import { createTaskBrief, type IntentGrant } from "@/server/conversation/task-contract";
import {
  readV1_9StartupRecoveryRunContext,
  requeueV1_9CheckpointRecoveryTurn,
  resolveV1_9StartupRecoveryDisposition,
} from "@/server/conversation/v1-9-startup-recovery-authority";
import { createPrismaWorkbenchRepository } from "@/server/workbench/repository";
import { createWorkbenchService } from "@/server/workbench/service";
import {
  createV1_9RunManifestV2,
  createV1_9RunManifestV2Digest,
  createV1_9RunState,
  normalizeV1_9RunState,
} from "../scripts/lib/v1-9-e2e-contract.mjs";
import { projectReadyV1_9Authority } from "./support/v1-9-authority-summary";

const databasePath = path.resolve(`.tmp/v1-9-startup-recovery-${crypto.randomUUID()}.db`);
const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
let client: PrismaClient;
const runRoots: string[] = [];

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

afterEach(() => {
  for (const root of runRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("V1-9 DB-first startup recovery disposition", () => {
  it("shares one startup recovery promise across concurrent and failed callers", async () => {
    const singleFlight = createV1_9StartupRecoverySingleFlight();
    let complete!: () => void;
    const pending = new Promise<void>((resolve) => { complete = resolve; });
    let calls = 0;
    const first = singleFlight(async () => { calls += 1; await pending; });
    const second = singleFlight(async () => { calls += 1; });
    expect(second).toBe(first);
    expect(calls).toBe(1);
    complete();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);

    const failedSingleFlight = createV1_9StartupRecoverySingleFlight();
    const failed = failedSingleFlight(async () => { throw new Error("startup recovery failed"); });
    expect(failedSingleFlight(async () => undefined)).toBe(failed);
    await expect(failed).rejects.toThrow("startup recovery failed");
    await expect(failedSingleFlight(async () => undefined)).rejects.toThrow("startup recovery failed");
  });

  it("reads one exact v2 pointer, v2 manifest and v3 run-state", () => {
    const fixture = createRunFileFixture();

    expect(readV1_9StartupRecoveryRunContext({
      cwd: fixture.rootDir,
      manifestPath: fixture.manifestPath,
      statePath: fixture.statePath,
    })).toMatchObject({
      runId: fixture.runId,
      manifestPath: fixture.manifestPath,
      statePath: fixture.statePath,
      manifest: { schemaVersion: "v1-9-run-manifest.v2", runId: fixture.runId },
      runState: { schemaVersion: "v1-9-run-state.v3", runId: fixture.runId },
    });
  });

  it.each([
    ["pointer path", (fixture: ReturnType<typeof createRunFileFixture>) => {
      const pointer = JSON.parse(readFileSync(fixture.pointerPath, "utf8"));
      pointer.manifestPath = `${fixture.relativeRunRoot}/other-manifest.json`;
      writeFileSync(fixture.pointerPath, `${JSON.stringify(pointer, null, 2)}\n`, "utf8");
    }],
    ["manifest bytes", (fixture: ReturnType<typeof createRunFileFixture>) => {
      writeFileSync(fixture.manifestPath, `${readFileSync(fixture.manifestPath, "utf8")}\n`, "utf8");
    }],
    ["run-state runId", (fixture: ReturnType<typeof createRunFileFixture>) => {
      const state = JSON.parse(readFileSync(fixture.statePath, "utf8"));
      state.runId = `${fixture.runId}-other`;
      writeFileSync(fixture.statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    }],
  ])("fails closed when the active %s drifts", (_label, mutate) => {
    const fixture = createRunFileFixture();
    mutate(fixture);

    expect(() => readV1_9StartupRecoveryRunContext({
      cwd: fixture.rootDir,
      manifestPath: fixture.manifestPath,
      statePath: fixture.statePath,
    })).toThrow("v1_9_startup_recovery_identity_invalid");
  });

  it("orders context, DB disposition, typed evidence and execution and propagates startup failure", async () => {
    const calls: string[] = [];
    const disposition = { kind: "none" as const };
    const env = {
      V1_9_E2E_MANIFEST_PATH: "E:\\run\\run-manifest.json",
      V1_9_E2E_STATE_PATH: "E:\\run\\run-state.json",
    };
    await expect(recoverV1_9StartupConversationTurn(env, {
      readRunContext: () => {
        calls.push("context");
        return { runState: {} } as any;
      },
      resolveDisposition: async () => {
        calls.push("disposition");
        return disposition;
      },
      validateEvidence: () => {
        calls.push("evidence");
        return { kind: "none" };
      },
      execute: async () => {
        calls.push("execute");
      },
    })).resolves.toEqual(disposition);
    expect(calls).toEqual(["context", "disposition", "evidence", "execute"]);

    await expect(recoverV1_9StartupConversationTurn(env, {
      readRunContext: () => ({ runState: {} } as any),
      resolveDisposition: async () => disposition,
      validateEvidence: () => ({ kind: "none" }),
      execute: async () => {
        throw new Error("recovery execution failed");
      },
    })).rejects.toThrow("recovery execution failed");

    await expect(recoverV1_9StartupConversationTurn({
      V1_9_E2E_MANIFEST_PATH: "E:\\run\\run-manifest.json",
    })).rejects.toThrow("v1_9_startup_recovery_paths_incomplete");
    await expect(recoverV1_9StartupConversationTurn({
      V1_9_E2E_STATE_PATH: "E:\\run\\run-state.json",
    })).rejects.toThrow("v1_9_startup_recovery_paths_incomplete");
  });

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

  it("atomically requeues only the checkpoint TurnJob selected by the DB disposition", async () => {
    const fixture = await createFixture("checkpoint");
    const disposition = await resolveV1_9StartupRecoveryDisposition({ client, runState: fixture.state });
    expect(disposition.kind).toBe("checkpoint");
    if (disposition.kind !== "checkpoint") throw new Error("checkpoint disposition expected");

    await expect(requeueV1_9CheckpointRecoveryTurn({
      client,
      identity: disposition.identity,
      reasonCode: disposition.reasonCode,
    })).resolves.toBe(true);
    await expect(client.conversationTurnJob.findUnique({ where: { id: fixture.turnJobId } }))
      .resolves.toMatchObject({ status: "queued" });
    await expect(requeueV1_9CheckpointRecoveryTurn({
      client,
      identity: disposition.identity,
      reasonCode: disposition.reasonCode,
    })).resolves.toBe(true);
    await expect(resolveV1_9StartupRecoveryDisposition({ client, runState: fixture.state }))
      .resolves.toMatchObject({
        kind: "checkpoint",
        identity: { turnJobId: fixture.turnJobId, recoveryEvidenceDigest: expect.any(String) },
      });

    await expect(fixture.service.startNextConversationTurnJob(fixture.projectId, {
      expectedJobId: fixture.turnJobId,
    })).resolves.toMatchObject({
      id: fixture.turnJobId,
      status: "running",
      attempts: 2,
      errorCode: null,
    });
    await client.conversationTurnJob.update({
      where: { id: fixture.turnJobId },
      data: {
        lockedUntil: new Date("2026-07-18T17:59:00.000Z"),
      },
    });
    const expired = await resolveV1_9StartupRecoveryDisposition({
      client,
      runState: fixture.state,
      now: new Date("2026-07-18T18:00:00.000Z"),
    });
    expect(expired).toMatchObject({ kind: "checkpoint", identity: { turnJobId: fixture.turnJobId } });
    if (expired.kind !== "checkpoint") throw new Error("expired checkpoint disposition expected");
    await expect(requeueV1_9CheckpointRecoveryTurn({
      client,
      identity: expired.identity,
      reasonCode: expired.reasonCode,
      now: new Date("2026-07-18T18:00:00.000Z"),
    })).resolves.toBe(true);
    await expect(fixture.service.startNextConversationTurnJob(fixture.projectId, {
      expectedJobId: fixture.turnJobId,
      now: new Date("2026-07-18T18:00:00.000Z"),
    })).resolves.toMatchObject({ id: fixture.turnJobId, status: "running", attempts: 2, maxAttempts: 2 });
  });

  it("does not substitute another failed TurnJob when the frozen checkpoint job drifts", async () => {
    const fixture = await createFixture("checkpoint");
    const disposition = await resolveV1_9StartupRecoveryDisposition({ client, runState: fixture.state });
    if (disposition.kind !== "checkpoint") throw new Error("checkpoint disposition expected");
    await client.conversationTurnJob.update({
      where: { id: fixture.turnJobId },
      data: { status: "succeeded", failureRetryability: null },
    });
    const alternate = await client.conversationTurnJob.create({
      data: {
        projectId: fixture.projectId,
        teacherMessageId: fixture.teacherMessageId,
        status: "failed",
        attempts: 1,
        maxAttempts: 2,
        errorCode: disposition.reasonCode,
        failureRetryability: "retryable",
        actorUserId: fixture.actorUserId,
        actorAuthMode: "local",
      },
    });

    await expect(requeueV1_9CheckpointRecoveryTurn({
      client,
      identity: disposition.identity,
      reasonCode: disposition.reasonCode,
    })).resolves.toBe(false);
    await expect(client.conversationTurnJob.findUnique({ where: { id: alternate.id } }))
      .resolves.toMatchObject({ status: "failed" });
  });

  it("keeps an exact checkpoint job resumable when the project lease is temporarily unavailable", async () => {
    const fixture = await createFixture("checkpoint");
    const disposition = await resolveV1_9StartupRecoveryDisposition({ client, runState: fixture.state });
    if (disposition.kind !== "checkpoint") throw new Error("checkpoint disposition expected");
    await expect(requeueV1_9CheckpointRecoveryTurn({
      client,
      identity: disposition.identity,
      reasonCode: disposition.reasonCode,
    })).resolves.toBe(true);
    const lease = await fixture.service.acquireProjectExecutionLease({
      projectId: fixture.projectId,
      holderId: "competing-recovery-worker",
      leaseMs: 60_000,
    });
    expect(lease).not.toBeNull();

    await expect(drainProjectConversationQueue(fixture.projectId, {
      service: fixture.service,
      expectedJobId: fixture.turnJobId,
      executor: async () => ({ status: "blocked" }),
    })).resolves.toEqual({ started: 0, succeeded: 0, blocked: 0, failed: 0 });
    await expect(client.conversationTurnJob.findUnique({ where: { id: fixture.turnJobId } }))
      .resolves.toMatchObject({ status: "queued" });

    if (!lease) throw new Error("competing lease expected");
    await fixture.service.releaseProjectExecutionLease({
      projectId: fixture.projectId,
      holderId: "competing-recovery-worker",
      fencingToken: lease.fencingToken,
    });
    await expect(drainProjectConversationQueue(fixture.projectId, {
      service: fixture.service,
      expectedJobId: fixture.turnJobId,
      executor: async () => ({ status: "blocked" }),
    })).resolves.toEqual({ started: 1, succeeded: 0, blocked: 1, failed: 0 });
  });

  it("rejects a queued checkpoint intermediate with a different recovery evidence digest", async () => {
    const fixture = await createFixture("checkpoint");
    const disposition = await resolveV1_9StartupRecoveryDisposition({ client, runState: fixture.state });
    if (disposition.kind !== "checkpoint") throw new Error("checkpoint disposition expected");
    await expect(requeueV1_9CheckpointRecoveryTurn({
      client,
      identity: disposition.identity,
      reasonCode: disposition.reasonCode,
    })).resolves.toBe(true);
    await client.conversationTurnJob.update({
      where: { id: fixture.turnJobId },
      data: { recoveryEvidenceDigest: "f".repeat(64) },
    });
    const resumed = await resolveV1_9StartupRecoveryDisposition({ client, runState: fixture.state });
    if (resumed.kind !== "checkpoint") throw new Error("queued checkpoint disposition expected");
    await expect(requeueV1_9CheckpointRecoveryTurn({
      client,
      identity: resumed.identity,
      reasonCode: resumed.reasonCode,
    })).resolves.toBe(false);
  });

  it.each(["queued", "expired_running"] as const)("derives interrupted running for an exact %s TurnJob", async (mode) => {
    const fixture = await createFixture(mode);

    await expect(resolveV1_9StartupRecoveryDisposition({
      client,
      runState: fixture.state,
      now: new Date("2026-07-18T18:00:00.000Z"),
    })).resolves.toMatchObject({ kind: "interrupted_running", identity: { turnJobId: fixture.turnJobId } });
  });

  it("claims only the expected recovery TurnJob and refuses an ambiguous active queue", async () => {
    const ambiguous = await createFixture("queued");
    const other = await ambiguous.service.enqueueConversationTurn(ambiguous.projectId, {
      teacherMessageId: ambiguous.teacherMessageId,
      idempotencyKey: `turn:${crypto.randomUUID()}`,
      maxAttempts: 2,
    });
    await expect(drainProjectConversationQueue(ambiguous.projectId, {
      service: ambiguous.service,
      expectedJobId: ambiguous.turnJobId,
      executor: async () => ({ status: "blocked" }),
    })).resolves.toEqual({ started: 0, succeeded: 0, blocked: 0, failed: 0 });
    await expect(client.conversationTurnJob.findMany({
      where: { id: { in: [ambiguous.turnJobId, other.id] } },
      orderBy: { createdAt: "asc" },
    })).resolves.toEqual([
      expect.objectContaining({ id: ambiguous.turnJobId, status: "queued" }),
      expect.objectContaining({ id: other.id, status: "queued" }),
    ]);

    const exact = await createFixture("queued");
    await expect(drainProjectConversationQueue(exact.projectId, {
      service: exact.service,
      expectedJobId: exact.turnJobId,
      executor: async () => ({ status: "blocked" }),
    })).resolves.toEqual({ started: 1, succeeded: 0, blocked: 1, failed: 0 });
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

async function createFixture(mode: "provider_health" | "checkpoint" | "queued" | "expired_running") {
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
    plan: { planId: "plan-fixture", revision: 1, status: ["provider_health", "checkpoint"].includes(mode) ? "paused_recovery" : "active" },
    status: ["provider_health", "checkpoint"].includes(mode) ? "paused_recovery" : "active",
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
  if (mode === "checkpoint") {
    await service.failConversationTurnJob(project.id, job.id, {
      errorCode: "main_agent_provider_timeout",
      errorMessage: "provider timeout",
      retryability: "retryable",
      failureEvidenceDigest: "b".repeat(64),
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
    status: ["provider_health", "checkpoint"].includes(mode) ? "paused_recovery" : "running",
    recoveryReasonCode: mode === "checkpoint" ? "main_agent_provider_timeout" : undefined,
  });
  return {
    service,
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
  recoveryReasonCode?: string;
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
        reasonCode: input.recoveryReasonCode ?? "main_agent_provider_unavailable",
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

function createRunFileFixture() {
  const rootDir = path.resolve(`.tmp/v1-9-startup-run-files-${crypto.randomUUID()}`);
  runRoots.push(rootDir);
  const runId = `v1-9-startup-${crypto.randomUUID()}`;
  const relativeRunRoot = `test-results/${runId}`;
  const runRoot = path.join(rootDir, "test-results", runId);
  const manifestPath = path.join(runRoot, "run-manifest.json");
  const statePath = path.join(runRoot, "run-state.json");
  const pointerPath = path.join(rootDir, "test-results", "v1-9-product-e2e-active.json");
  const manifest = createV1_9RunManifestV2({
    runId,
    relativeRunRoot,
    createdAt: "2026-07-18T17:00:00.000Z",
    baselineLock: {
      schemaVersion: "v1-9-baseline-lock.v2",
      branch: "main",
      gitHead: "a".repeat(40),
      generationIntensity: "standard",
      runtimeSourceDigest: "1".repeat(64),
      requirementsBaselineDigest: "2".repeat(64),
      registryDigest: "3".repeat(64),
      projectionRegistryDigest: "3".repeat(64),
      providerLedgerManifestDigest: "4".repeat(64),
      projectionId: "runtime-projection-a23",
      verificationManifestSha256: "5".repeat(64),
      workingTreeDigest: "6".repeat(64),
      policySha256: "7".repeat(64),
      stageSha256: "8".repeat(64),
      providerContinuityManifestSha256: "9".repeat(64),
      providerContinuityReceiptSha256: "a".repeat(64),
      providerContinuityEvidenceRootDigest: "b".repeat(64),
      providerContinuitySubjectDigest: "c".repeat(64),
    },
    skillLock: {
      schemaVersion: "v1-9-skill-lock.v1",
      projectionLockDigest: "d".repeat(64),
      bindingPolicyDigest: "e".repeat(64),
      activeSkills: [{ name: "shanhai-suite", version: "1.1" }],
    },
    agentBrain: { providerLock: {
      schemaVersion: "v1-9-provider-lock.v1",
      channel: "primary",
      model: "gpt-5.6-terra",
      endpointCategory: "openai_compatible_responses",
      reasoningEffort: "medium",
      credentialSource: "ledger_private_env",
      configDigest: "f".repeat(64),
    } },
    providerRuntimeLocks: ["agent_brain", "coze_ppt", "image_generation", "tts_minimax", "video_generation"]
      .map((capability, index) => ({
        capability: capability as "agent_brain" | "coze_ppt" | "image_generation" | "tts_minimax" | "video_generation",
        credentialSource: "ledger_private_env" as const,
        configDigest: capability === "agent_brain" ? "f".repeat(64) : String(index + 1).repeat(64),
      })),
    predecessor: null,
  });
  const state = createV1_9RunState({ manifest, createdAt: "2026-07-18T17:00:01.000Z" });
  const manifestSha256 = createV1_9RunManifestV2Digest(manifest);
  const pointer = {
    schemaVersion: "v1-9-active-run.v2",
    runId,
    relativeRunRoot,
    manifestPath: `${relativeRunRoot}/run-manifest.json`,
    manifestSha256,
    statePath: `${relativeRunRoot}/run-state.json`,
  };
  mkdirSync(runRoot, { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  writeFileSync(pointerPath, `${JSON.stringify(pointer, null, 2)}\n`, "utf8");
  return { rootDir, runId, relativeRunRoot, manifestPath, statePath, pointerPath };
}
