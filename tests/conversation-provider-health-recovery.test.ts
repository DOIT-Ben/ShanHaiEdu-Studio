import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  resolveV1_9ProviderHealthRecoveryAuthority,
  shouldInspectV1_9StartupRecovery,
} from "@/server/conversation/conversation-turn-recovery";
import { createControlPlaneStore } from "@/server/conversation/control-plane-store";
import { createTaskBrief, type IntentGrant } from "@/server/conversation/task-contract";
import { createPrismaWorkbenchRepository } from "@/server/workbench/repository";
import { createWorkbenchService } from "@/server/workbench/service";
import {
  advanceV1_9PlanRevision,
  bindV1_9RunStateProjectIdentity,
  bindV1_9TaskContractLock,
  createV1_9RunManifestV2,
  createV1_9RunManifestV2Digest,
  createV1_9RunState,
  markV1_9RunStateRecoveryStop,
  recordV1_9RunStateMutation,
} from "../scripts/lib/v1-9-e2e-contract.mjs";

const root = process.cwd();
const stageRoot = path.join(root, ".tmp", "conversation-provider-health-recovery");
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
  if (initialized.status !== 0) throw new Error(initialized.stderr || initialized.stdout || "Provider-health recovery test database initialization failed.");
  client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
});

afterAll(async () => {
  await client?.$disconnect();
  for (const suffix of ["", "-shm", "-wal"]) rmSync(`${databasePath}${suffix}`, { force: true });
});

describe("V1-9 Provider-health startup recovery authority", () => {
  it("lets product paths trigger recovery inspection without a runner recovery switch", () => {
    expect(shouldInspectV1_9StartupRecovery({
      V1_9_E2E_MANIFEST_PATH: "E:\\run\\run-manifest.json",
      V1_9_E2E_STATE_PATH: "E:\\run\\run-state.json",
    })).toBe(true);
    expect(shouldInspectV1_9StartupRecovery({
      V1_9_E2E_MANIFEST_PATH: "E:\\run\\run-manifest.json",
    })).toBe(false);
  });

  it("validates the active pointer, frozen Provider lock, real ledger evidence and exact manifest binding", () => {
    const fixture = recoveryAuthorityFixture();

    const authority = resolveV1_9ProviderHealthRecoveryAuthority({
      cwd: fixture.cwd,
      env: fixture.env,
      dependencies: fixture.dependencies,
    });

    expect(authority).toMatchObject({
      runId: "v1-9-authority-run",
      projectId: "project-authority",
      taskId: "task-authority",
      intentEpoch: 3,
      turnJobId: "turn-job-authority",
      teacherMessageId: "teacher-message-authority",
      reasonCode: "main_agent_provider_unavailable",
      healthEvidenceNotBefore: "2026-07-15T04:00:00.000Z",
      evidenceId: "agent-brain-health-authority",
    });
    expect(authority.recoveryEvidenceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(fixture.dependencies.readHealthEvidence).toHaveBeenCalledOnce();
  });

  it.each([
    ["wrong active pointer", { pointerRunId: "v1-9-other-run" }],
    ["stale evidence", { evidenceTestedAt: "2026-07-15T03:59:59.999Z" }],
    ["wrong Provider lock", { evidenceConfigDigest: "f".repeat(64) }],
    ["failed health probe", { evidenceResult: "failed", evidenceErrorCategory: "provider" }],
    ["missing TurnJob binding", { turnJobId: null }],
  ])("fails closed for %s before any TurnJob can be requeued", (_label, overrides) => {
    const fixture = recoveryAuthorityFixture(overrides);

    expect(() => resolveV1_9ProviderHealthRecoveryAuthority({
      cwd: fixture.cwd,
      env: fixture.env,
      dependencies: fixture.dependencies,
    })).toThrow("v1_9_provider_health_recovery_invalid");
  });

  it("validates a v2 active pointer and run-state for the new immutable run", () => {
    const fixture = v2RecoveryAuthorityFixture();

    const authority = resolveV1_9ProviderHealthRecoveryAuthority({
      cwd: fixture.cwd,
      env: fixture.env,
      dependencies: fixture.dependencies,
    });

    expect(authority).toMatchObject({
      runId: "v1-9-authority-v2",
      projectId: "project-authority",
      taskId: "task-authority",
      intentEpoch: 3,
      turnJobId: "turn-job-authority",
      teacherMessageId: "teacher-message-authority",
      reasonCode: "main_agent_provider_unavailable",
      healthEvidenceNotBefore: "2026-07-15T04:00:00.000Z",
      evidenceId: "agent-brain-health-authority",
    });
  });
});

describe("Provider-health TurnJob recovery boundary", () => {
  it("keeps checkpoint recovery separate and requeues only the manifest-bound health-gated TurnJob", async () => {
    const actorUserId = `provider-health-user-${crypto.randomUUID()}`;
    const service = createWorkbenchService(createPrismaWorkbenchRepository(client), undefined, {
      actorUserId,
      actorAuthMode: "local",
      authSessionId: null,
    });
    const project = await service.createProject({ title: `provider-health-${crypto.randomUUID()}` });
    const taskId = `task:${crypto.randomUUID()}`;
    const teacherMessage = await service.addMessage(project.id, {
      role: "teacher",
      content: "完成百分数公开课材料包",
    });
    const teacherMessageId = teacherMessage.id;
    const taskBrief = createTaskBrief({
      taskId,
      projectId: project.id,
      intentEpoch: 2,
      goal: "完成百分数公开课材料包",
      requestedOutputs: ["ppt", "package"],
      constraints: [],
      excludedOutputs: [],
      generationIntensity: "standard",
      sourceMessageId: teacherMessageId,
    });
    const intentGrant: IntentGrant = {
      schemaVersion: "intent-grant.v1",
      taskId,
      projectId: project.id,
      intentEpoch: 2,
      standardWorkAuthorized: true,
      intensity: "standard",
      budgetPolicyVersion: null,
      maxCostCredits: null,
      maxExternalProviderCalls: 4,
      requiredCheckpoints: [],
      expiresAt: null,
    };
    await service.updateMessageMetadata(project.id, teacherMessageId, { taskBrief, intentGrant });
    const queued = await service.enqueueConversationTurn(project.id, {
      teacherMessageId,
      idempotencyKey: `turn:${crypto.randomUUID()}`,
      maxAttempts: 1,
    });
    await createControlPlaneStore(client).upsertTaskAggregate({
      taskBrief,
      intentGrant,
      plan: { planId: `plan:${taskId}`, revision: 1, status: "paused_recovery" },
      status: "paused_recovery",
      checkpoint: { checkpointId: "checkpoint-provider-health" },
    });
    const running = await service.startNextConversationTurnJob(project.id, { lockedBy: "provider-health-worker" });
    await service.failConversationTurnJob(project.id, running!.id, {
      errorCode: "main_agent_provider_unavailable",
      errorMessage: "当前智能服务通道暂时不可用。",
      retryability: "after_provider_health_change",
      failureEvidenceDigest: "a".repeat(64),
    });

    await expect(service.requeueConversationTurnJobForRecovery(project.id, queued.id, {
      recoveryEvidenceDigest: "b".repeat(64),
    })).resolves.toBeNull();
    await expect(service.requeueConversationTurnJobAfterProviderHealth(project.id, queued.id, {
      projectId: project.id,
      jobId: queued.id,
      teacherMessageId,
      taskId,
      intentEpoch: 1,
      expectedErrorCode: "main_agent_provider_unavailable",
      recoveryEvidenceDigest: "b".repeat(64),
    })).resolves.toBeNull();
    await expect(service.requeueConversationTurnJobAfterProviderHealth(project.id, queued.id, {
      projectId: project.id,
      jobId: queued.id,
      teacherMessageId,
      taskId,
      intentEpoch: 2,
      expectedErrorCode: "main_agent_provider_policy_blocked",
      recoveryEvidenceDigest: "b".repeat(64),
    })).resolves.toBeNull();

    const recovered = await service.requeueConversationTurnJobAfterProviderHealth(project.id, queued.id, {
      projectId: project.id,
      jobId: queued.id,
      teacherMessageId,
      taskId,
      intentEpoch: 2,
      expectedErrorCode: "main_agent_provider_unavailable",
      recoveryEvidenceDigest: "b".repeat(64),
    });

    expect(recovered).toMatchObject({
      id: queued.id,
      projectId: project.id,
      teacherMessageId,
      status: "queued",
      attempts: 1,
      maxAttempts: 2,
    });
  });
});

function recoveryAuthorityFixture(overrides: Record<string, unknown> = {}) {
  const cwd = "E:\\fixture-repo";
  const relativeRunRoot = "test-results/v1-9-authority-run";
  const manifestPath = `${cwd}\\test-results\\v1-9-authority-run\\run-manifest.json`;
  const configDigest = "a".repeat(64);
  const pointer = {
    schemaVersion: "v1-9-active-run.v1",
    status: "active",
    runId: overrides.pointerRunId ?? "v1-9-authority-run",
    relativeRunRoot,
  };
  const manifest = {
    schemaVersion: "v1-9-run-manifest.v1",
    runId: "v1-9-authority-run",
    status: "paused_recovery",
    relativeRunRoot,
    promptDigest: "b".repeat(64),
    skillLock: null,
    providerLock: {
      schemaVersion: "v1-9-provider-lock.v1",
      channel: "primary",
      model: "gpt-fixture",
      endpointCategory: "openai_compatible_responses",
      reasoningEffort: "high",
      credentialSource: "ledger_private_env",
      configDigest,
    },
    providerLockHistory: [],
    projectId: "project-authority",
    taskId: "task-authority",
    intentEpoch: 3,
    checkpointId: "checkpoint-authority",
    taskSubmissionCount: 1,
    finalDownloadCount: 0,
    externalCodexOrchestrationCount: 0,
    pendingDecision: null,
    recovery: {
      reasonCode: "main_agent_provider_unavailable",
      checkpointId: "checkpoint-authority",
      observationRefs: ["observation-authority"],
      healthEvidenceNotBefore: "2026-07-15T04:00:00.000Z",
      turnJobId: overrides.turnJobId === undefined ? "turn-job-authority" : overrides.turnJobId,
      teacherMessageId: "teacher-message-authority",
    },
    mutations: [{ method: "POST", pathname: "/api/workbench/projects/project-authority/messages", source: "ui" }],
    violations: [],
    createdAt: "2026-07-15T01:00:00.000Z",
    updatedAt: "2026-07-15T04:00:00.000Z",
  };
  const evidence = {
    schemaVersion: "v1-9-agent-brain-health.v2",
    evidenceId: "agent-brain-health-authority",
    providerId: "agent_brain",
    capability: "agent_brain",
    purpose: "main_agent_responses",
    channel: "primary",
    model: "gpt-fixture",
    endpointCategory: "openai_compatible_responses",
    reasoningEffort: "high",
    credentialSource: "ledger_private_env",
    configDigest: overrides.evidenceConfigDigest ?? configDigest,
    probe: "single_strict_structured_text",
    result: overrides.evidenceResult ?? "succeeded",
    testedAt: overrides.evidenceTestedAt ?? "2026-07-15T04:00:00.001Z",
    providerRequestCount: 1,
    maxRetries: 0,
    retryCount: 0,
    errorCategory: overrides.evidenceErrorCategory ?? "none",
  };
  const dependencies = {
    readJson: vi.fn((filePath: string) => filePath.endsWith("v1-9-product-e2e-active.json") ? pointer : manifest),
    readHealthEvidence: vi.fn(() => evidence),
    resolveConfig: vi.fn(() => ({
      credential: "not-observable",
      credentialSource: "provider_ledger_private_env" as const,
      baseURL: "https://fixture.invalid/v1",
      model: "gpt-fixture",
      reasoningEffort: "high" as const,
      channel: "primary" as const,
      endpointCategory: "openai_compatible_responses" as const,
    })),
    resolveRuntimeContract: vi.fn(() => ({
      schemaVersion: "provider-runtime-contract.v1" as const,
      kind: "agent_brain_responses" as const,
      endpointCategory: "openai_compatible_responses" as const,
      selectedChannelEnv: "AGENT_BRAIN_CHANNEL",
      purposeChannels: {
        main_agent_responses: { channel: "primary" as const, credentialEnv: "PRIMARY_KEY", baseUrlEnv: "PRIMARY_BASE", modelEnv: "PRIMARY_MODEL" },
        critic_responses: { channel: "third" as const, credentialEnv: "THIRD_KEY", baseUrlEnv: "THIRD_BASE", modelEnv: "THIRD_MODEL" },
        fallback_responses: { channel: "fallback" as const, credentialEnv: "FALLBACK_KEY", baseUrlEnv: "FALLBACK_BASE", modelEnv: "FALLBACK_MODEL" },
      },
      reasoning: { env: "REASONING", default: "high" as const, allowed: ["low", "medium", "high", "xhigh"] as const },
    })),
    createConfigDigest: vi.fn(() => configDigest),
  };
  return {
    cwd,
    env: {
      V1_9_E2E_MANIFEST_PATH: manifestPath,
      V1_9_AGENT_BRAIN_HEALTH_EVIDENCE_ID: "agent-brain-health-authority",
    },
    dependencies,
  };
}

function v2RecoveryAuthorityFixture() {
  const legacy = recoveryAuthorityFixture();
  const cwd = legacy.cwd;
  const runId = "v1-9-authority-v2";
  const relativeRunRoot = `test-results/${runId}`;
  const manifestPath = `${cwd}\\test-results\\${runId}\\run-manifest.json`;
  const statePath = `${cwd}\\test-results\\${runId}\\run-state.json`;
  const manifest = createV1_9RunManifestV2({
    runId,
    relativeRunRoot,
    createdAt: "2026-07-15T01:00:00.000Z",
    baselineLock: {
      schemaVersion: "v1-9-baseline-lock.v2", branch: "main", gitHead: "a".repeat(40),
      generationIntensity: "standard", runtimeSourceDigest: "1".repeat(64),
      requirementsBaselineDigest: "2".repeat(64), registryDigest: "3".repeat(64),
      projectionRegistryDigest: "3".repeat(64), providerLedgerManifestDigest: "4".repeat(64),
      projectionId: "runtime-projection-a23",
      verificationManifestSha256: "5".repeat(64), workingTreeDigest: "6".repeat(64),
      policySha256: "7".repeat(64), stageSha256: "8".repeat(64),
      providerContinuityManifestSha256: "8".repeat(64), providerContinuityReceiptSha256: "9".repeat(64),
      providerContinuityEvidenceRootDigest: "e".repeat(64), providerContinuitySubjectDigest: "f".repeat(64),
    },
    skillLock: {
      schemaVersion: "v1-9-skill-lock.v1", projectionLockDigest: "5".repeat(64),
      bindingPolicyDigest: "6".repeat(64), activeSkills: [{ name: "shanhai-suite", version: "1.1" }],
    },
    agentBrain: { providerLock: {
      schemaVersion: "v1-9-provider-lock.v1", channel: "primary", model: "gpt-fixture",
      endpointCategory: "openai_compatible_responses", reasoningEffort: "high",
      credentialSource: "ledger_private_env", configDigest: "a".repeat(64),
    } },
    providerRuntimeLocks: ["agent_brain", "coze_ppt", "image_generation", "tts_minimax", "video_generation"]
      .map((capability, index) => ({
        capability: capability as "agent_brain" | "coze_ppt" | "image_generation" | "tts_minimax" | "video_generation",
        credentialSource: "ledger_private_env" as const,
        configDigest: capability === "agent_brain" ? "a".repeat(64) : String.fromCharCode(98 + index).repeat(64),
      })),
    predecessor: {
      runId: "v1-9-previous", relativeRunRoot: "test-results/v1-9-previous",
      manifestSha256: "f".repeat(64), disposition: "historical_failed",
    },
  });
  let state = createV1_9RunState({ manifest, createdAt: "2026-07-15T01:00:01.000Z" });
  state = bindV1_9RunStateProjectIdentity(state, {
    actorUserId: "teacher-authority", projectId: "project-authority", boundAt: "2026-07-15T01:01:00.000Z",
  });
  state = bindV1_9TaskContractLock(state, {
    actorUserId: "teacher-authority", actorAuthMode: "local", projectId: "project-authority",
    taskId: "task-authority", teacherMessageId: "teacher-message-authority", turnJobId: "turn-job-authority",
    taskBriefDigest: "7".repeat(64), intentEpoch: 3, intensity: "standard",
    intentGrantDigest: "8".repeat(64), budgetDigest: "9".repeat(64), initialPlanRevision: 0,
    boundAt: "2026-07-15T01:02:00.000Z",
  });
  state = advanceV1_9PlanRevision(state, { nextPlanRevision: 3, advancedAt: "2026-07-15T01:03:00.000Z" });
  state = recordV1_9RunStateMutation(state, {
    method: "POST", pathname: "/api/workbench/projects/project-authority/messages", source: "ui",
    recordedAt: "2026-07-15T01:04:00.000Z",
  });
  state = markV1_9RunStateRecoveryStop(state, {
    reasonCode: "main_agent_provider_unavailable", checkpointId: "checkpoint-authority",
    observationRefs: ["observation-authority"], turnJobId: "turn-job-authority",
    teacherMessageId: "teacher-message-authority", stoppedAt: "2026-07-15T04:00:00.000Z",
  });
  const pointer = {
    schemaVersion: "v1-9-active-run.v2",
    runId,
    relativeRunRoot,
    manifestPath: `${relativeRunRoot}/run-manifest.json`,
    manifestSha256: createV1_9RunManifestV2Digest(manifest),
    statePath: `${relativeRunRoot}/run-state.json`,
  };
  return {
    cwd,
    env: {
      ...legacy.env,
      V1_9_E2E_MANIFEST_PATH: manifestPath,
      V1_9_E2E_STATE_PATH: statePath,
    },
    dependencies: {
      ...legacy.dependencies,
      readJson: vi.fn((filePath: string) => {
        if (filePath.endsWith("v1-9-product-e2e-active.json")) return pointer;
        if (filePath.endsWith("run-state.json")) return state;
        return manifest;
      }),
    },
  };
}
