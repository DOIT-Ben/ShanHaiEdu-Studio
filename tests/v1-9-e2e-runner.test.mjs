import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import {
  V1_9_FROZEN_PROMPT,
  advanceV1_9PlanRevision,
  assertV1_9BaselineLockDigest,
  assertV1_9RunManifestV2Digest,
  assertV1_9ResumeIdentity,
  bindV1_9ProviderLock,
  bindV1_9RunStateProjectIdentity,
  bindV1_9SkillLock,
  bindV1_9TaskContractLock,
  bindV1_9TaskIdentity,
  createV1_9BaselineLockDigest,
  createV1_9RunManifest,
  createV1_9RunManifestV2,
  createV1_9RunManifestV2Digest,
  createV1_9RunState,
  deriveV1_9RecoveryObservationRefs,
  deriveV1_9RecoveryStop,
  deriveV1_9ExternalCodexOrchestrationCount,
  markV1_9Completed,
  markV1_9PendingDecision,
  markV1_9RecoveryStop,
  markV1_9RunStatePackageReady,
  markV1_9RunStateRecoveryStop,
  normalizeV1_9RunManifestV2,
  normalizeV1_9RunManifestV2ReadOnly,
  normalizeV1_9RunState,
  projectV1_9OrchestrationAuthoritySummary,
  recordV1_9ExternalAcceptanceRound,
  recordV1_9RunStateMutation,
  recordV1_9UiMutation,
} from "../scripts/lib/v1-9-e2e-contract.mjs";
import {
  assertManifestBytesUnchanged,
  assertV1_9ResumeRunStorage,
  createV1_9ChildEnvironment,
  mainV1_9E2E,
  readV1_9OrchestrationAuthoritySummaryAfterStop,
  runV1_9SupervisedM67Command,
  resolveV1_9RunContext,
  resolveV1_9RunMode,
} from "../scripts/run-v1-9-e2e.mjs";

const digest = (character) => character.repeat(64);

function expectContractError(operation, pattern) {
  try {
    operation();
  } catch (error) {
    if (pattern.test(String(error instanceof Error ? error.message : error))) return;
    throw error;
  }
  throw new Error(`expected contract error: ${pattern}`);
}

function createV2ManifestInput(overrides = {}) {
  return {
    runId: "v1-9-20260715-a23-contract",
    relativeRunRoot: "test-results\\v1-9-20260715-a23-contract",
    createdAt: "2026-07-15T01:00:00.000Z",
    baselineLock: {
      schemaVersion: "v1-9-baseline-lock.v2",
      branch: "main",
      gitHead: "a".repeat(40),
      generationIntensity: "standard",
      runtimeSourceDigest: digest("1"),
      requirementsBaselineDigest: digest("2"),
      registryDigest: digest("3"),
      projectionRegistryDigest: digest("3"),
      providerLedgerManifestDigest: digest("4"),
      projectionId: "a23-runtime-projection",
      verificationManifestSha256: digest("5"),
      workingTreeDigest: digest("6"),
      policySha256: digest("7"),
      stageSha256: digest("8"),
      providerContinuityManifestSha256: digest("b"),
      providerContinuityReceiptSha256: digest("9"),
      providerContinuityEvidenceRootDigest: digest("c"),
      providerContinuitySubjectDigest: digest("a"),
    },
    skillLock: {
      schemaVersion: "v1-9-skill-lock.v1",
      projectionLockDigest: digest("6"),
      bindingPolicyDigest: digest("7"),
      activeSkills: [
        { name: "shanhai-video", version: "1.2" },
        { name: "shanhai-jiaoan", version: "1.1" },
      ],
    },
    agentBrain: {
      providerLock: {
        schemaVersion: "v1-9-provider-lock.v1",
        channel: "fallback",
        model: "gpt-5.6-terra",
        endpointCategory: "openai_compatible_responses",
        reasoningEffort: "medium",
        credentialSource: "ledger_private_env",
        configDigest: digest("8"),
      },
    },
    providerRuntimeLocks: [
      {
        capability: "agent_brain",
        credentialSource: "ledger_private_env",
        configDigest: digest("8"),
      },
      {
        capability: "coze_ppt",
        credentialSource: "ledger_private_env",
        configDigest: digest("9"),
      },
      {
        capability: "image_generation",
        credentialSource: "ledger_private_env",
        configDigest: digest("a"),
      },
      {
        capability: "video_generation",
        credentialSource: "ledger_private_env",
        configDigest: digest("b"),
      },
      {
        capability: "tts_minimax",
        credentialSource: "ledger_private_env",
        configDigest: digest("c"),
      },
    ],
    predecessor: {
      runId: "v1-9-20260714212914-a036beb9",
      relativeRunRoot: "test-results\\v1-9-20260714212914-a036beb9",
      manifestSha256: digest("d"),
      disposition: "historical_failed",
    },
    ...overrides,
  };
}

async function createRunnerFixture(t, { stateStatus = "prepared", pointerVersion = "v1-9-active-run.v2" } = {}) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "shanhai-v1-9-runner-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const input = createV2ManifestInput({
    runId: "v1-9-20260715-runner-fixture",
    relativeRunRoot: "test-results/v1-9-20260715-runner-fixture",
  });
  const manifest = createV1_9RunManifestV2(input);
  const state = createRunnerState(manifest, stateStatus);
  const runRoot = path.join(rootDir, "test-results", input.runId);
  const manifestPath = path.join(runRoot, "run-manifest.json");
  const statePath = path.join(runRoot, "run-state.json");
  const pointerPath = path.join(rootDir, "test-results", "v1-9-product-e2e-active.json");
  await mkdir(runRoot, { recursive: true });
  if (stateStatus === "running") {
    await mkdir(path.join(runRoot, "artifact-storage"), { recursive: true });
    await mkdir(path.join(runRoot, "next-app-frozen"), { recursive: true });
    initializeSqliteFixture(path.join(runRoot, "m67.sqlite"));
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  const pointer = pointerVersion === "v1-9-active-run.v1"
    ? {
        schemaVersion: pointerVersion,
        runId: input.runId,
        relativeRunRoot: input.relativeRunRoot,
        status: "active",
      }
    : {
        schemaVersion: pointerVersion,
        runId: input.runId,
        relativeRunRoot: input.relativeRunRoot,
        manifestPath: `${input.relativeRunRoot}/run-manifest.json`,
        manifestSha256: createV1_9RunManifestV2Digest(manifest),
        statePath: `${input.relativeRunRoot}/run-state.json`,
      };
  await writeFile(pointerPath, `${JSON.stringify(pointer, null, 2)}\n`, "utf8");
  return { rootDir, runRoot, manifestPath, statePath };
}

function createRunnerState(manifest, stateStatus) {
  const prepared = createV1_9RunState({ manifest, createdAt: "2026-07-15T01:00:01.000Z" });
  if (stateStatus === "prepared") return prepared;
  if (stateStatus === "running") {
    const projectCreated = recordV1_9RunStateMutation(prepared, {
      method: "POST",
      pathname: "/api/workbench/projects",
      source: "ui",
      recordedAt: "2026-07-15T01:00:02.000Z",
    });
    const taskBound = bindRunnerTaskContract(projectCreated, {
      projectBoundAt: "2026-07-15T01:00:03.000Z",
      taskBoundAt: "2026-07-15T01:00:04.000Z",
    });
    return recordV1_9RunStateMutation(taskBound, {
      method: "POST",
      pathname: "/api/workbench/projects/project-1/messages",
      source: "ui",
      recordedAt: "2026-07-15T01:00:05.000Z",
    });
  }
  if (stateStatus === "external_acceptance_repair_required") {
    const taskBound = bindRunnerTaskContract(prepared);
    const downloaded = recordV1_9RunStateMutation(taskBound, {
      method: "GET",
      pathname: "/api/workbench/projects/project-1/artifacts/package-1/package",
      source: "ui",
      recordedAt: "2026-07-15T01:00:04.000Z",
    });
    const packageReady = markV1_9RunStatePackageReady(projectReadyAuthority(downloaded), {
      packageArtifactId: "package-1",
      packageArtifactVersion: 1,
      packageVersion: "course-v1",
      packageSha256: digest("e"),
      turnJobId: "turn-job-1",
      teacherMessageId: "teacher-message-1",
      downloadedAt: "2026-07-15T01:00:05.000Z",
    });
    return recordV1_9ExternalAcceptanceRound(packageReady, {
      auditRound: 1,
      reportId: "external-acceptance-round-1",
      reportPath: "external-acceptance/round-0001/report.json",
      reportDigest: digest("f"),
      packageArtifactId: "package-1",
      packageArtifactVersion: 1,
      packageVersion: "course-v1",
      packageSha256: digest("e"),
      outcome: "repair_required",
      reviewedFindingIds: [],
      openP0FindingIds: ["finding-page-3"],
      affectedUnits: [{
        unitId: "ppt_deck:page:3",
        kind: "page",
        artifactRole: "ppt_deck",
        artifactId: "pptx-1",
        artifactVersion: "course-v1",
        pageNumber: 3,
        shotId: null,
        packageEntry: "materials/course-v1.pptx",
      }],
      repairFeedback: [{
        findingId: "finding-page-3",
        responsibilityLayer: "quality_gate",
        category: "design_quality",
        design: "第3页越过安全边距。",
        vulnerability: null,
        engineering: "仅返修第3页。",
      }],
      repairHandoffPath: "external-acceptance/round-0001/repair-handoff.json",
      repairHandoffDigest: digest("a"),
      generatedAt: "2026-07-15T01:00:06.000Z",
    });
  }
  if (!["paused_recovery", "failed"].includes(stateStatus)) {
    throw new Error(`unsupported_runner_fixture_state:${stateStatus}`);
  }
  const recovery = markV1_9RunStateRecoveryStop(bindRunnerTaskContract(prepared), {
    reasonCode: "main_agent_provider_unavailable",
    checkpointId: "checkpoint-1",
    observationRefs: ["observation-1"],
    turnJobId: "turn-job-1",
    teacherMessageId: "teacher-message-1",
    stoppedAt: "2026-07-15T01:00:04.000Z",
  });
  return stateStatus === "failed"
    ? normalizeV1_9RunState({ ...recovery, status: "failed" })
    : recovery;
}

function bindRunnerTaskContract(state, {
  projectBoundAt = "2026-07-15T01:00:02.000Z",
  taskBoundAt = "2026-07-15T01:00:03.000Z",
} = {}) {
  const projectBound = bindV1_9RunStateProjectIdentity(state, {
    actorUserId: "teacher-1",
    projectId: "project-1",
    boundAt: projectBoundAt,
  });
  return bindV1_9TaskContractLock(projectBound, {
    actorUserId: "teacher-1",
    projectId: "project-1",
    taskId: "task-1",
    actorAuthMode: "local",
    teacherMessageId: "teacher-message-1",
    turnJobId: "turn-job-1",
    taskBriefDigest: digest("1"),
    intentEpoch: 0,
    intensity: "standard",
    intentGrantDigest: digest("2"),
    budgetDigest: digest("3"),
    initialPlanRevision: 0,
    boundAt: taskBoundAt,
  });
}

function projectReadyAuthority(state, summary = authoritySummary({
  subject: { ...authoritySummary().subject, planRevision: state.ledger.currentPlanRevision },
})) {
  return projectV1_9OrchestrationAuthoritySummary(state, {
    summary,
    projectedAt: new Date(Math.max(Date.parse(state.updatedAt), Date.parse("2026-07-15T01:00:03.500Z"))).toISOString(),
    requireReady: true,
  });
}

function authoritySummary(overrides = {}) {
  const publicSummary = {
    schemaVersion: "orchestration-authority-summary.v1",
    subject: {
      projectId: "project-1",
      actorUserId: "teacher-1",
      taskId: "task-1",
      taskBriefDigest: digest("1"),
      intentEpoch: 0,
      teacherMessageId: "teacher-message-1",
      turnJobId: "turn-job-1",
      planId: "plan-1",
      planRevision: 0,
    },
    windowStartSequence: 1,
    watermark: 4,
    eventCount: 4,
    attemptCount: 2,
    resolvedCount: 2,
    openAttemptCount: 0,
    toolClaimCount: 0,
    toolTerminalCount: 0,
    mainAgentToolCount: 0,
    nonMainAgentToolCount: 0,
    firstToolOrdinal: null,
    lastToolOrdinal: null,
    toolOrdinalsContiguous: true,
    authorities: ["teacher_http"],
    violationReasonCodes: [],
    factsDigest: digest("4"),
    complete: true,
    readyEligible: true,
    ...overrides,
  };
  return {
    ...publicSummary,
    summaryDigest: createHash("sha256")
      .update("shanhai-orchestration-authority-summary.v1\0", "utf8")
      .update(canonicalJson(publicSummary), "utf8")
      .digest("hex"),
  };
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function initializeSqliteFixture(databasePath) {
  new Database(databasePath).close();
}

test("V1-9 recovery keeps checkpoint refs and falls back to persisted message observations", () => {
  const snapshot = {
    messages: [
      { metadata: { agentObservations: [{ observationId: "observation-1" }, { observationId: "observation-2" }] } },
      { metadata: { agentObservations: [{ observationId: "observation-2" }, { observationId: "" }] } },
    ],
  };

  assert.deepEqual(deriveV1_9RecoveryObservationRefs(snapshot, ["checkpoint-observation"]), ["checkpoint-observation"]);
  assert.deepEqual(deriveV1_9RecoveryObservationRefs(snapshot, []), ["observation-1", "observation-2"]);
});

test("V1-9 recovery attributes a newer explicit failed Job before a stale paused checkpoint", () => {
  const snapshot = {
    messages: [{ metadata: { agentObservations: [
      { observationId: "old-checkpoint-observation" },
      { observationId: "latest-provider-observation" },
    ] } }],
    turnJobs: [{
      id: "turn-job-current",
      teacherMessageId: "teacher-message-current",
      status: "failed",
      errorCode: "main_agent_provider_unavailable",
    }],
  };
  const checkpoint = {
    status: "paused",
    reasonCode: "completion_contract_unsatisfied",
    checkpointId: "checkpoint-old",
    observationRefs: ["old-checkpoint-observation"],
  };

  assert.deepEqual(deriveV1_9RecoveryStop(snapshot, checkpoint), {
    reasonCode: "main_agent_provider_unavailable",
    checkpointId: "checkpoint-old",
    observationRefs: ["old-checkpoint-observation", "latest-provider-observation"],
    turnJobId: "turn-job-current",
    teacherMessageId: "teacher-message-current",
  });
});

test("V1-9 run manifest freezes one task identity and resumes the same run", () => {
  const manifest = createV1_9RunManifest({
    runId: "v1-9-run-1",
    relativeRunRoot: "test-results/v1-9-run-1",
    prompt: "请完成一套百分数公开课材料包。",
    createdAt: "2026-07-15T00:00:00.000Z",
  });
  const bound = {
    ...manifest,
    projectId: "project-1",
    taskId: "task-1",
    intentEpoch: 0,
    checkpointId: "checkpoint-1",
  };

  assert.doesNotThrow(() => assertV1_9ResumeIdentity(bound, {
    runId: "v1-9-run-1",
    projectId: "project-1",
    taskId: "task-1",
    intentEpoch: 0,
  }));
  assert.throws(() => assertV1_9ResumeIdentity(bound, {
    runId: "v1-9-run-1",
    projectId: "project-2",
    taskId: "task-1",
    intentEpoch: 0,
  }), /resume_identity_mismatch/);
  assert.match(manifest.promptDigest, /^[a-f0-9]{64}$/);
  assert.equal(manifest.skillLock, null);
  assert.equal(manifest.providerLock, null);
});

test("V1-9 run manifest freezes the selected non-secret Provider configuration", () => {
  const manifest = createV1_9RunManifest({
    runId: "v1-9-run-provider-lock",
    relativeRunRoot: "test-results/v1-9-run-provider-lock",
    prompt: "请完成一套百分数公开课材料包。",
    createdAt: "2026-07-15T00:00:00.000Z",
  });
  const lock = {
    schemaVersion: "v1-9-provider-lock.v1",
    channel: "fallback",
    model: "gpt-test",
    endpointCategory: "openai_compatible_responses",
    reasoningEffort: "medium",
    credentialSource: "ledger_private_env",
    configDigest: "c".repeat(64),
  };
  const bound = bindV1_9ProviderLock(manifest, lock);

  assert.deepEqual(bound.providerLock, lock);
  assert.deepEqual(bindV1_9ProviderLock(bound, lock).providerLock, lock);
  assert.throws(() => bindV1_9ProviderLock(bound, { ...lock, channel: "primary", configDigest: "d".repeat(64) }), /provider_lock_mismatch/);
});

test("V1-9 run manifest freezes the Skill projection and binding policy across resume", () => {
  const manifest = createV1_9RunManifest({
    runId: "v1-9-run-skill-lock",
    relativeRunRoot: "test-results/v1-9-run-skill-lock",
    prompt: "请完成一套百分数公开课材料包。",
    createdAt: "2026-07-15T00:00:00.000Z",
  });
  const lock = {
    schemaVersion: "v1-9-skill-lock.v1",
    projectionLockDigest: "a".repeat(64),
    bindingPolicyDigest: "b".repeat(64),
    activeSkills: [{ name: "shanhai-video", version: "1.2" }],
  };
  const bound = bindV1_9SkillLock(manifest, lock);

  assert.deepEqual(bound.skillLock, lock);
  assert.deepEqual(bindV1_9SkillLock(bound, lock).skillLock, lock);
  assert.throws(() => bindV1_9SkillLock(bound, {
    ...lock,
    projectionLockDigest: "c".repeat(64),
  }), /skill_lock_mismatch/);
});

test("V1-9 mutation ledger derives external orchestration instead of hard-coding zero", () => {
  let manifest = createV1_9RunManifest({
    runId: "v1-9-run-2",
    relativeRunRoot: "test-results/v1-9-run-2",
    prompt: "请完成一套百分数公开课材料包。",
    createdAt: "2026-07-15T00:00:00.000Z",
  });
  manifest = recordV1_9UiMutation(manifest, { method: "POST", pathname: "/api/auth/login", source: "ui" });
  manifest = recordV1_9UiMutation(manifest, { method: "POST", pathname: "/api/workbench/projects", source: "ui" });
  manifest = recordV1_9UiMutation(manifest, { method: "POST", pathname: "/api/workbench/projects/project-1/messages", source: "ui" });
  manifest = recordV1_9UiMutation(manifest, { method: "GET", pathname: "/api/workbench/projects/project-1/artifacts/package-1/package", source: "ui" });
  manifest = recordV1_9UiMutation(manifest, { method: "GET", pathname: "/api/workbench/projects/project-1/artifacts/package-1/package", source: "ui" });

  assert.equal(manifest.taskSubmissionCount, 1);
  assert.equal(manifest.externalCodexOrchestrationCount, 0);
  assert.equal(manifest.finalDownloadCount, 2);
  assert.equal(deriveV1_9ExternalCodexOrchestrationCount(manifest), 0);

  manifest = recordV1_9UiMutation(manifest, {
    method: "POST",
    pathname: "/api/workbench/projects/project-1/artifacts/artifact-1/approve",
    source: "runner",
  });
  assert.equal(manifest.externalCodexOrchestrationCount, 1);
  assert.equal(deriveV1_9ExternalCodexOrchestrationCount(manifest), 1);
  assert.deepEqual(manifest.violations.map((item) => item.reasonCode), ["runner_mutation_not_allowed"]);
});

test("V1-9 resume binds one project task epoch and preserves a typed pending decision", () => {
  let manifest = createV1_9RunManifest({
    runId: "v1-9-run-3",
    relativeRunRoot: "test-results/v1-9-run-3",
    prompt: "请完成一套百分数公开课材料包。",
    createdAt: "2026-07-15T00:00:00.000Z",
  });
  manifest = bindV1_9TaskIdentity(manifest, {
    projectId: "project-1",
    taskId: "task-1",
    intentEpoch: 2,
    checkpointId: "checkpoint-1",
  });
  manifest = markV1_9PendingDecision(manifest, {
    kind: "budget_upgrade",
    actionId: "human:project-1:budget:task-1",
    reasonCode: "budget_upgrade_required",
  });

  assert.equal(manifest.status, "paused_pending_decision");
  assert.deepEqual(manifest.pendingDecision, {
    kind: "budget_upgrade",
    actionId: "human:project-1:budget:task-1",
    reasonCode: "budget_upgrade_required",
  });
  assert.throws(() => bindV1_9TaskIdentity(manifest, {
    projectId: "project-1",
    taskId: "task-2",
    intentEpoch: 2,
    checkpointId: "checkpoint-1",
  }), /resume_identity_mismatch:taskId/);

  manifest = markV1_9RecoveryStop(manifest, {
    reasonCode: "repeated_failure",
    checkpointId: "checkpoint-1",
    observationRefs: ["observation-1"],
    turnJobId: "turn-job-1",
    teacherMessageId: "teacher-message-1",
  });
  assert.equal(manifest.status, "paused_recovery");
  assert.deepEqual({
    ...manifest.recovery,
    healthEvidenceNotBefore: undefined,
  }, {
    reasonCode: "repeated_failure",
    checkpointId: "checkpoint-1",
    observationRefs: ["observation-1"],
    turnJobId: "turn-job-1",
    teacherMessageId: "teacher-message-1",
    healthEvidenceNotBefore: undefined,
  });
  assert.equal(typeof manifest.recovery.healthEvidenceNotBefore, "string");
  assert.equal(Number.isFinite(Date.parse(manifest.recovery.healthEvidenceNotBefore)), true);
  assert.throws(() => markV1_9RecoveryStop(manifest, {
    reasonCode: "main_agent_provider_unavailable",
    checkpointId: "checkpoint-1",
    observationRefs: ["observation-1"],
    turnJobId: "turn-job-without-message",
  }), /recovery_turn_binding_invalid/);

  manifest = recordV1_9UiMutation(manifest, {
    method: "GET",
    pathname: "/api/workbench/projects/project-1/artifacts/package-1/package",
    source: "ui",
  });
  manifest = markV1_9Completed(manifest);
  assert.equal(manifest.status, "completed");
  assert.equal(manifest.recovery, null);
});

test("V1-9 v2 manifest freezes the complete A23 baseline without mutable run state", () => {
  const manifest = createV1_9RunManifestV2(createV2ManifestInput());

  assert.equal(manifest.schemaVersion, "v1-9-run-manifest.v2");
  assert.equal(manifest.relativeRunRoot, "test-results/v1-9-20260715-a23-contract");
  assert.equal(manifest.baselineLock.requirementsBaselineDigest, digest("2"));
  assert.equal(manifest.baselineLock.registryDigest, digest("3"));
  assert.equal(manifest.baselineLock.projectionRegistryDigest, digest("3"));
  assert.equal(manifest.baselineLock.providerLedgerManifestDigest, digest("4"));
  assert.equal(manifest.baselineLock.projectionId, "a23-runtime-projection");
  assert.deepEqual(manifest.skillLock.activeSkills.map((skill) => skill.name), ["shanhai-jiaoan", "shanhai-video"]);
  assert.deepEqual(manifest.providerRuntimeLocks.map((lock) => lock.capability), [
    "agent_brain",
    "coze_ppt",
    "image_generation",
    "tts_minimax",
    "video_generation",
  ]);
  assert.deepEqual(manifest.predecessor, {
    runId: "v1-9-20260714212914-a036beb9",
    relativeRunRoot: "test-results/v1-9-20260714212914-a036beb9",
    manifestSha256: digest("d"),
    disposition: "historical_failed",
  });
  for (const forbidden of [
    "status", "projectId", "taskId", "intentEpoch", "checkpointId", "mutations", "violations", "updatedAt",
  ]) {
    assert.equal(Object.hasOwn(manifest, forbidden), false, `${forbidden} must live in run-state`);
  }
  assert.match(manifest.promptDigest, /^[a-f0-9]{64}$/);
  if (manifest.promptDigest !== createHash("sha256").update(V1_9_FROZEN_PROMPT).digest("hex")) {
    throw new Error("frozen prompt digest did not use the contract authority");
  }
  assert.match(manifest.baselineLock.runtimeSourceDigest, /^[a-f0-9]{64}$/);
  assert.match(manifest.agentBrain.providerLock.configDigest, /^[a-f0-9]{64}$/);
  for (const lock of manifest.providerRuntimeLocks) {
    assert.match(lock.configDigest, /^[a-f0-9]{64}$/);
    assert.deepEqual(Object.keys(lock), ["capability", "credentialSource", "configDigest"]);
  }
});

test("V1-9 v2 manifest normalizes deterministically and rejects digest, field, enum, and path drift", () => {
  const manifest = createV1_9RunManifestV2(createV2ManifestInput());
  const baselineDigest = createV1_9BaselineLockDigest(manifest.baselineLock);
  const manifestDigest = createV1_9RunManifestV2Digest(manifest);

  assert.match(baselineDigest, /^[a-f0-9]{64}$/);
  assert.match(manifestDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(assertV1_9BaselineLockDigest(manifest.baselineLock, baselineDigest), manifest.baselineLock);
  assert.deepEqual(assertV1_9RunManifestV2Digest(manifest, manifestDigest), manifest);
  assert.deepEqual(normalizeV1_9RunManifestV2(structuredClone(manifest)), manifest);
  assert.throws(() => assertV1_9BaselineLockDigest(manifest.baselineLock, digest("e")), /baseline_lock_digest_mismatch/);
  assert.throws(() => assertV1_9RunManifestV2Digest(manifest, digest("e")), /run_manifest_digest_mismatch/);
  assert.throws(() => normalizeV1_9RunManifestV2({ ...manifest, status: "running" }), /run_manifest_unknown_field:status/);
  expectContractError(() => createV1_9RunManifestV2({
    ...createV2ManifestInput(),
    prompt: V1_9_FROZEN_PROMPT,
  }), /run_manifest_input_unknown_field:prompt/);
  if (createV1_9RunManifestV2(createV2ManifestInput({ predecessor: null })).predecessor !== null) {
    throw new Error("fresh run predecessor must remain null");
  }
  const currentBaseline = createV2ManifestInput().baselineLock;
  const legacyBaseline = {
    branch: currentBaseline.branch,
    gitHead: currentBaseline.gitHead,
    generationIntensity: currentBaseline.generationIntensity,
    runtimeSourceDigest: currentBaseline.runtimeSourceDigest,
    requirementsBaselineDigest: currentBaseline.requirementsBaselineDigest,
    registryDigest: currentBaseline.registryDigest,
    projectionRegistryDigest: currentBaseline.projectionRegistryDigest,
    providerLedgerManifestDigest: currentBaseline.providerLedgerManifestDigest,
    projectionId: currentBaseline.projectionId,
  };
  expectContractError(() => createV1_9RunManifestV2(createV2ManifestInput({
    baselineLock: { schemaVersion: "v1-9-baseline-lock.v1", ...legacyBaseline },
  })), /baseline_lock_upgrade_required/);
  const legacyManifest = {
    ...manifest,
    baselineLock: { schemaVersion: "v1-9-baseline-lock.v1", ...legacyBaseline },
  };
  if (normalizeV1_9RunManifestV2ReadOnly(legacyManifest).baselineLock.schemaVersion !== "v1-9-baseline-lock.v1") {
    throw new Error("legacy baseline must remain read-only parseable");
  }
  expectContractError(() => normalizeV1_9RunManifestV2(legacyManifest), /baseline_lock_upgrade_required/);
  expectContractError(() => createV1_9RunState({
    manifest: legacyManifest,
    createdAt: "2026-07-15T01:01:00.000Z",
  }), /baseline_lock_upgrade_required/);
  assert.throws(() => createV1_9RunManifestV2(createV2ManifestInput({
    baselineLock: { ...createV2ManifestInput().baselineLock, projectionId: "../a23" },
  })), /projectionId_invalid/);
  assert.throws(() => createV1_9RunManifestV2(createV2ManifestInput({
    predecessor: { ...createV2ManifestInput().predecessor, disposition: "resume_in_place" },
  })), /predecessor_disposition_invalid/);
  assert.throws(() => createV1_9RunManifestV2(createV2ManifestInput({
    baselineLock: { ...createV2ManifestInput().baselineLock, generationIntensity: "enhanced" },
  })), /baseline_generation_intensity_invalid/);
  assert.throws(() => createV1_9RunManifestV2(createV2ManifestInput({
    providerRuntimeLocks: createV2ManifestInput().providerRuntimeLocks.filter((lock) => lock.capability !== "tts_minimax"),
  })), /provider_runtime_capability_missing:tts_minimax/);
  assert.throws(() => createV1_9RunManifestV2(createV2ManifestInput({
    providerRuntimeLocks: createV2ManifestInput().providerRuntimeLocks.map((lock) =>
      lock.capability === "coze_ppt" ? { ...lock, model: "must-not-be-frozen-here" } : lock
    ),
  })), /provider_runtime_lock_unknown_field:model/);
  assert.throws(() => createV1_9RunManifestV2(createV2ManifestInput({
    providerRuntimeLocks: createV2ManifestInput().providerRuntimeLocks.map((lock) =>
      lock.capability === "agent_brain" ? { ...lock, configDigest: digest("e") } : lock
    ),
  })), /agent_brain_runtime_lock_mismatch/);
  assert.throws(() => createV1_9RunManifestV2(createV2ManifestInput({
    providerRuntimeLocks: createV2ManifestInput().providerRuntimeLocks.map((lock) =>
      lock.capability === "image_generation" ? { ...lock, configDigest: "not-a-digest" } : lock
    ),
  })), /configDigest_invalid/);
});

test("V1-9 run-state binds one task contract and only advances plan revision monotonically", () => {
  const manifest = createV1_9RunManifestV2(createV2ManifestInput());
  const state = createV1_9RunState({ manifest, createdAt: "2026-07-15T01:00:01.000Z" });
  const contract = {
    actorUserId: "teacher-1",
    projectId: "project-1",
    taskId: "task-1",
    actorAuthMode: "local",
    teacherMessageId: "teacher-message-1",
    turnJobId: "turn-job-1",
    taskBriefDigest: digest("1"),
    intentEpoch: 0,
    intensity: "standard",
    intentGrantDigest: digest("2"),
    budgetDigest: digest("3"),
    initialPlanRevision: 3,
    boundAt: "2026-07-15T01:00:02.000Z",
  };

  assert.equal(state.schemaVersion, "v1-9-run-state.v3");
  assert.equal(state.manifestSha256, createV1_9RunManifestV2Digest(manifest));
  assert.equal(state.status, "prepared");
  assert.equal(state.taskContractLock, null);
  assert.equal(state.ledger.currentPlanRevision, null);

  const bound = bindV1_9TaskContractLock(state, contract);
  assert.deepEqual(bound.identity, {
    actorUserId: "teacher-1",
    projectId: "project-1",
    taskId: "task-1",
    intentEpoch: 0,
  });
  assert.deepEqual(bound.taskContractLock, {
    schemaVersion: "v1-9-task-contract-lock.v1",
    actorAuthMode: "local",
    teacherMessageId: "teacher-message-1",
    turnJobId: "turn-job-1",
    taskBriefDigest: digest("1"),
    intentEpoch: 0,
    intensity: "standard",
    intentGrantDigest: digest("2"),
    budgetDigest: digest("3"),
    initialPlanRevision: 3,
  });
  assert.equal(bound.ledger.currentPlanRevision, 3);
  assert.deepEqual(bindV1_9TaskContractLock(bound, contract), bound);
  assert.throws(() => bindV1_9TaskContractLock(bound, {
    ...contract,
    taskBriefDigest: digest("4"),
  }), /task_contract_lock_mismatch/);
  assert.throws(() => bindV1_9TaskContractLock(bound, {
    ...contract,
    intentEpoch: 1,
  }), /task_contract_lock_mismatch/);

  const advanced = advanceV1_9PlanRevision(bound, {
    nextPlanRevision: 5,
    advancedAt: "2026-07-15T01:00:03.000Z",
  });
  assert.equal(advanced.ledger.currentPlanRevision, 5);
  assert.deepEqual(advanced.ledger.planRevisionHistory.map((entry) => entry.revision), [3, 5]);
  assert.deepEqual(advanceV1_9PlanRevision(advanced, {
    nextPlanRevision: 5,
    advancedAt: "2026-07-15T01:00:04.000Z",
  }), advanced);
  assert.throws(() => advanceV1_9PlanRevision(advanced, {
    nextPlanRevision: 4,
    advancedAt: "2026-07-15T01:00:04.000Z",
  }), /plan_revision_regression/);
  assert.throws(() => advanceV1_9PlanRevision(state, {
    nextPlanRevision: 1,
    advancedAt: "2026-07-15T01:00:04.000Z",
  }), /task_contract_lock_required/);
});

test("V1-9 runner is desktop-only, deterministic-off and bound to a reusable run root", async () => {
  const source = await readFile(new URL("../scripts/run-v1-9-e2e.mjs", import.meta.url), "utf8");
  const isolatedHarnessSource = await readFile(new URL("../scripts/run-m67-e2e.mjs", import.meta.url), "utf8");
  const specSource = await readFile(new URL("e2e/v1-9-unique-real-product.spec.ts", import.meta.url), "utf8");
  assert.match(source, /chromium-desktop/);
  assert.doesNotMatch(source, /chromium-narrow/);
  assert.match(source, /M67_E2E_DETERMINISTIC:\s*"0"/);
  assert.match(source, /SHANHAI_SKILL_RUNTIME_MODE:\s*"required"/);
  assert.match(source, /SHANHAI_SKILLS_EXPECTED_PROJECTION_LOCK_DIGEST:\s*skillLock\.projectionLockDigest/);
  assert.match(source, /SHANHAI_SKILLS_EXPECTED_BINDING_POLICY_DIGEST:\s*skillLock\.bindingPolicyDigest/);
  assert.match(source, /readFrozenSkillLock\(runContext\.manifest\)/);
  assert.match(source, /SHANHAI_RECOVER_RETRYABLE_TURNS_ON_START:\s*runMode === "resume" \? "1" : "0"/);
  assert.match(source, /V1_9_AGENT_BRAIN_HEALTH_EVIDENCE_ID/);
  assert.match(source, /V1_9_E2E_STATE_PATH:\s*runContext\.statePath/);
  assert.match(source, /M67_E2E_FROZEN_APP_ROOT:\s*runContext\.frozenAppRoot/);
  assert.match(source, /V1_9_E2E_RUN_ID:\s*runContext\.manifest\.runId/);
  assert.match(source, /V1_9_E2E_MANIFEST_SHA256:\s*runContext\.manifestSha256/);
  assert.match(source, /SHANHAI_V1_9_REPOSITORY_ROOT:\s*runContext\.rootDir/);
  assert.match(source, /M67_E2E_RUN_ROOT/);
  assert.match(source, /tests\/e2e\/v1-9-unique-real-product\.spec\.ts/);
  assert.match(source, /assertManifestBytesUnchanged\(runContext\)/);
  assert.doesNotMatch(source, /closeActiveRun\s*\(/);
  assert.doesNotMatch(source, /createV1_9RunManifest\s*\(/);
  assert.doesNotMatch(source, /writeJsonAtomic\s*\(/);
  assert.match(isolatedHarnessSource, /resolveRunRoot\(process\.env\.M67_E2E_RUN_ROOT/);
  assert.match(isolatedHarnessSource, /resumeExistingRun/);
  assert.match(isolatedHarnessSource, /deriveV1_9ExternalCodexOrchestrationCount/);
  assert.doesNotMatch(isolatedHarnessSource, /externalCodexOrchestrationCount:\s*0/);
  assert.match(specSource, /loginThroughUi/);
  assert.match(specSource, /recordV1_9RunStateMutation/);
  assert.match(specSource, /markV1_9RunStatePendingDecision/);
  assert.doesNotMatch(specSource, /page\.route\s*\(/);
  assert.doesNotMatch(specSource, /\.request\.(?:post|put|patch|delete)\s*\(/);
  assert.doesNotMatch(specSource, /\/approve|\/generate|confirmedActionId/);
});

test("V1-9 runner consumes an immutable v2 pointer and separates fresh start from recovery", async () => {
  const source = await readFile(new URL("../scripts/run-v1-9-e2e.mjs", import.meta.url), "utf8");

  assert.match(source, /v1-9-active-run\.v2/);
  assert.match(source, /v1_9_legacy_active_run_not_resumable/);
  assert.match(source, /V1_9_RUN_MODE/);
  assert.match(source, /runMode === "start-new"/);
  assert.match(source, /runState\.status !== "prepared"/);
  assert.match(source, /external_acceptance_repair_required/);
  assert.match(source, /v1_9_agent_brain_health_evidence_required/);
  assert.match(source, /delete childEnv\.V1_9_AGENT_BRAIN_HEALTH_EVIDENCE_ID/);
  assert.match(source, /run-manifest\.json/);
  assert.match(source, /run-state\.json/);
  assert.match(source, /next-app-frozen/);
});

test("V1-9 fresh runner consumes prepared v2 state without reusing recovery evidence", async (t) => {
  const fixture = await createRunnerFixture(t);
  const runContext = resolveV1_9RunContext({ rootDir: fixture.rootDir });
  const env = {
    V1_9_RUN_MODE: "start-new",
    V1_9_AGENT_BRAIN_HEALTH_EVIDENCE_ID: "stale-evidence-must-not-cross-runs",
  };

  assert.equal(resolveV1_9RunMode(env, runContext.runState), "start-new");
  assert.throws(
    () => resolveV1_9RunMode({ ...env, V1_9_RUN_MODE: "resume" }, runContext.runState),
    /v1_9_resume_run_state_invalid/,
  );

  const childEnv = createV1_9ChildEnvironment({
    env,
    runContext,
    runMode: "start-new",
    skillLock: runContext.manifest.skillLock,
  });
  assert.equal(childEnv.V1_9_AGENT_BRAIN_HEALTH_EVIDENCE_ID, "");
  assert.equal(childEnv.SHANHAI_RECOVER_RETRYABLE_TURNS_ON_START, "0");
  assert.equal(childEnv.M67_E2E_PROJECTS, "chromium-desktop");
  assert.equal(childEnv.M67_E2E_DETERMINISTIC, "0");
  assert.equal(childEnv.V1_9_E2E_MANIFEST_PATH, fixture.manifestPath);
  assert.equal(childEnv.V1_9_E2E_STATE_PATH, fixture.statePath);
  assert.equal(childEnv.M67_E2E_FROZEN_APP_ROOT, path.join(fixture.runRoot, "next-app-frozen"));
});

test("V1-9 stopped runner reads authority from the owned SQLite bridge", async (t) => {
  const fixture = await createRunnerFixture(t, { stateStatus: "running" });
  let state = normalizeV1_9RunState(JSON.parse(await readFile(fixture.statePath, "utf8")));
  state = projectReadyAuthority(state);
  await writeFile(fixture.statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  const runContext = resolveV1_9RunContext({ rootDir: fixture.rootDir });
  const calls = [];
  const actual = await readV1_9OrchestrationAuthoritySummaryAfterStop(runContext, {
    spawnBridge(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, stdout: `${JSON.stringify(state.orchestrationAuthoritySummary)}\n` };
    },
  });

  assert.deepEqual(actual, state.orchestrationAuthoritySummary);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.at(-3), path.join(fixture.runRoot, "m67.sqlite"));
  assert.deepEqual(calls[0].args.slice(-2), ["project-1", "teacher-1"]);
});

test("V1-9 recovery runner requires an evidence id only for paused or failed state", async (t) => {
  for (const stateStatus of ["paused_recovery", "failed"]) {
    await t.test(stateStatus, async (subtest) => {
      const fixture = await createRunnerFixture(subtest, { stateStatus });
      const runContext = resolveV1_9RunContext({ rootDir: fixture.rootDir });
      assert.throws(
        () => resolveV1_9RunMode({ V1_9_RUN_MODE: "resume" }, runContext.runState),
        /v1_9_agent_brain_health_evidence_required/,
      );
      const env = {
        V1_9_RUN_MODE: "resume",
        V1_9_AGENT_BRAIN_HEALTH_EVIDENCE_ID: `new-evidence-${stateStatus}`,
      };
      assert.equal(resolveV1_9RunMode(env, runContext.runState), "resume");
      assert.throws(
        () => resolveV1_9RunMode({ ...env, V1_9_RUN_MODE: "start-new" }, runContext.runState),
        /v1_9_fresh_run_state_invalid/,
      );

      const childEnv = createV1_9ChildEnvironment({
        env,
        runContext,
        runMode: "resume",
        skillLock: runContext.manifest.skillLock,
      });
      assert.equal(childEnv.V1_9_AGENT_BRAIN_HEALTH_EVIDENCE_ID, `new-evidence-${stateStatus}`);
      assert.equal(childEnv.SHANHAI_RECOVER_RETRYABLE_TURNS_ON_START, "1");
    });
  }
});

test("V1-9 interrupted running runner resumes the same frozen task without reusing health evidence", async (t) => {
  const fixture = await createRunnerFixture(t, { stateStatus: "running" });
  const runContext = resolveV1_9RunContext({ rootDir: fixture.rootDir });
  const env = {
    V1_9_RUN_MODE: "resume",
    V1_9_AGENT_BRAIN_HEALTH_EVIDENCE_ID: "stale-evidence-from-another-stop",
  };

  assert.equal(resolveV1_9RunMode(env, runContext.runState), "resume");
  assert.doesNotThrow(() => assertV1_9ResumeRunStorage(runContext));
  const childEnv = createV1_9ChildEnvironment({
    env,
    runContext,
    runMode: "resume",
    skillLock: runContext.manifest.skillLock,
  });

  assert.equal(childEnv.V1_9_AGENT_BRAIN_HEALTH_EVIDENCE_ID, undefined);
  assert.equal(childEnv.M67_E2E_RUN_ROOT, runContext.relativeRunRoot);
  assert.equal(childEnv.M67_E2E_FROZEN_APP_ROOT, path.join(fixture.runRoot, "next-app-frozen"));
  assert.equal(runContext.runState.identity.projectId, "project-1");
  assert.equal(runContext.runState.identity.taskId, "task-1");
  assert.equal(runContext.runState.identity.intentEpoch, 0);
  assert.equal(runContext.runState.taskContractLock.turnJobId, "turn-job-1");
  assert.equal(runContext.runState.taskContractLock.teacherMessageId, "teacher-message-1");
  assert.equal(runContext.runState.ledger.taskSubmissionCount, 1);

  const calls = [];
  await mainV1_9E2E({
    rootDir: fixture.rootDir,
    env,
    runCommand: async (command, args, commandEnv) => {
      calls.push({ command, args, env: commandEnv });
      if (calls.length !== 2) return;
      const running = JSON.parse(await readFile(fixture.statePath, "utf8"));
      const downloaded = recordV1_9RunStateMutation(running, {
        method: "GET",
        pathname: "/api/workbench/projects/project-1/artifacts/package-1/package",
        source: "ui",
        recordedAt: "2026-07-15T01:00:06.000Z",
      });
      const packageReady = markV1_9RunStatePackageReady(projectReadyAuthority(downloaded), {
        packageArtifactId: "package-1",
        packageArtifactVersion: 1,
        packageVersion: "course-v1",
        packageSha256: digest("e"),
        turnJobId: "turn-job-1",
        teacherMessageId: "teacher-message-1",
        downloadedAt: "2026-07-15T01:00:07.000Z",
      });
      await writeFile(fixture.statePath, `${JSON.stringify(packageReady, null, 2)}\n`, "utf8");
    },
    verifyAfterM67Stop: async () => undefined,
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].env.V1_9_AGENT_BRAIN_HEALTH_EVIDENCE_ID, undefined);
  assert.equal(calls[1].env.M67_E2E_RUN_ROOT, runContext.relativeRunRoot);
});

test("V1-9 interrupted running resume fails closed on missing storage or an invalid submission ledger", async (t) => {
  await t.test("missing frozen SQLite", async (subtest) => {
    const fixture = await createRunnerFixture(subtest, { stateStatus: "running" });
    await rm(path.join(fixture.runRoot, "m67.sqlite"));
    const runContext = resolveV1_9RunContext({ rootDir: fixture.rootDir });

    assert.throws(() => assertV1_9ResumeRunStorage(runContext), /v1_9_resume_database_missing/);
  });

  for (const taskSubmissionCount of [0, 2]) {
    await t.test(`taskSubmissionCount=${taskSubmissionCount}`, async (subtest) => {
      const fixture = await createRunnerFixture(subtest, { stateStatus: "running" });
      const current = JSON.parse(await readFile(fixture.statePath, "utf8"));
      current.ledger.taskSubmissionCount = taskSubmissionCount;
      await writeFile(fixture.statePath, `${JSON.stringify(current, null, 2)}\n`, "utf8");
      const runContext = resolveV1_9RunContext({ rootDir: fixture.rootDir });

      assert.throws(
        () => resolveV1_9RunMode({ V1_9_RUN_MODE: "resume" }, runContext.runState),
        /v1_9_running_resume_submission_invalid/,
      );
    });
  }
});

test("V1-9 external acceptance repair resumes the same task without Provider health evidence", async (t) => {
  const fixture = await createRunnerFixture(t, { stateStatus: "external_acceptance_repair_required" });
  const runContext = resolveV1_9RunContext({ rootDir: fixture.rootDir });
  const env = { V1_9_RUN_MODE: "resume" };

  assert.equal(resolveV1_9RunMode(env, runContext.runState), "resume");
  const childEnv = createV1_9ChildEnvironment({
    env,
    runContext,
    runMode: "resume",
    skillLock: runContext.manifest.skillLock,
  });
  assert.equal(childEnv.V1_9_AGENT_BRAIN_HEALTH_EVIDENCE_ID, undefined);
  assert.equal(childEnv.SHANHAI_RECOVER_RETRYABLE_TURNS_ON_START, "1");
  assert.equal(runContext.runState.taskContractLock.turnJobId, "turn-job-1");
  assert.equal(runContext.runState.taskContractLock.teacherMessageId, "teacher-message-1");
  assert.equal(runContext.runState.identity.taskId, "task-1");
  assert.equal(runContext.runState.identity.intentEpoch, 0);
});

test("V1-9 runner rejects legacy pointer execution and detects manifest byte mutation", async (t) => {
  const legacy = await createRunnerFixture(t, { pointerVersion: "v1-9-active-run.v1" });
  assert.throws(
    () => resolveV1_9RunContext({ rootDir: legacy.rootDir }),
    /v1_9_legacy_active_run_not_resumable/,
  );

  const current = await createRunnerFixture(t);
  const runContext = resolveV1_9RunContext({ rootDir: current.rootDir });
  await writeFile(current.manifestPath, `${await readFile(current.manifestPath, "utf8")}\n`, "utf8");
  assert.throws(() => assertManifestBytesUnchanged(runContext), /v1_9_run_manifest_mutated/);
});

test("V1-9 outer runner rejects a repository root reached through an ancestor junction", async (t) => {
  const fixture = await createRunnerFixture(t);
  const linkedRoot = `${fixture.rootDir}-linked`;
  try {
    await symlink(fixture.rootDir, linkedRoot, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.skip(`directory link unavailable: ${error instanceof Error ? error.message : "unknown"}`);
    return;
  }
  t.after(() => rm(linkedRoot, { recursive: true, force: true }));
  assert.throws(
    () => resolveV1_9RunContext({ rootDir: linkedRoot }),
    /v1_9_(?:active_run_pointer_invalid|run_root_invalid)/,
  );
});

test("V1-9 outer runner uses IPC supervision and verifies after an M67 command failure", async (t) => {
  const fixture = await createRunnerFixture(t);
  const source = await readFile(path.resolve("scripts", "run-v1-9-e2e.mjs"), "utf8");
  assert.match(source, /createRunnerShutdownAuthority/);
  assert.match(source, /gracefulIpc:\s*true/);
  assert.doesNotMatch(source, /const timeout = setTimeout\(\(\) => \{\s*child\.kill\(\)/s);

  let commandCount = 0;
  let verifyCount = 0;
  await assert.rejects(
    mainV1_9E2E({
      rootDir: fixture.rootDir,
      env: { V1_9_RUN_MODE: "start-new", V1_9_E2E_TIMEOUT_MS: "60000" },
      runCommand: async () => {
        commandCount += 1;
        if (commandCount === 2) throw new Error("controlled_m67_failure");
      },
      verifyAfterM67Stop: async () => {
        verifyCount += 1;
      },
    }),
    /controlled_m67_failure/,
  );
  assert.equal(commandCount, 2);
  assert.equal(verifyCount, 1);
});

test("V1-9 supervised M67 signal waits for IPC exit and post-stop before rejecting", async () => {
  const processObject = new EventEmitter();
  processObject.exitCode = undefined;
  const child = new EventEmitter();
  child.pid = 7701;
  child.exitCode = null;
  child.signalCode = null;
  child.connected = true;
  child.send = (message, callback) => {
    callback?.(null);
    queueMicrotask(() => child.emit("message", {
      type: "runner-shutdown-ack.v1",
      requestId: message.requestId,
      ok: true,
    }));
    setTimeout(() => {
      child.exitCode = 1;
      child.emit("exit", 1, null);
    }, 10);
  };
  let postStopCount = 0;
  const completion = runV1_9SupervisedM67Command({
    command: "fixture-m67",
    args: [],
    env: {},
    timeoutMs: 1_000,
    postStop: () => { postStopCount += 1; },
    dependencies: {
      platform: "win32",
      processObject,
      spawnProcess: () => child,
    },
  });
  setImmediate(() => processObject.emit("SIGTERM"));

  await assert.rejects(completion);
  assert.equal(processObject.exitCode, 143);
  assert.equal(child.exitCode, 1);
  assert.equal(postStopCount, 1);
});

test("V1-9 outer verify-only failure prevents external acceptance", async (t) => {
  const fixture = await createRunnerFixture(t);
  let commandCount = 0;
  await assert.rejects(
    mainV1_9E2E({
      rootDir: fixture.rootDir,
      env: { V1_9_RUN_MODE: "start-new", V1_9_E2E_TIMEOUT_MS: "60000" },
      runCommand: async () => {
        commandCount += 1;
        if (commandCount !== 2) return;
        const prepared = JSON.parse(await readFile(fixture.statePath, "utf8"));
        const submitted = recordV1_9RunStateMutation(bindRunnerTaskContract(prepared), {
          method: "POST",
          pathname: "/api/workbench/projects/project-1/messages",
          source: "ui",
          recordedAt: "2026-07-15T01:00:04.000Z",
        });
        const downloaded = recordV1_9RunStateMutation(submitted, {
          method: "GET",
          pathname: "/api/workbench/projects/project-1/artifacts/package-1/package",
          source: "ui",
          recordedAt: "2026-07-15T01:00:05.000Z",
        });
        const packageReady = markV1_9RunStatePackageReady(
          projectReadyAuthority(downloaded),
          {
            packageArtifactId: "package-1",
            packageArtifactVersion: 1,
            packageVersion: "course-v1",
            packageSha256: digest("f"),
            turnJobId: "turn-job-1",
            teacherMessageId: "teacher-message-1",
            downloadedAt: "2026-07-15T01:00:06.000Z",
          },
        );
        await writeFile(fixture.statePath, `${JSON.stringify(packageReady, null, 2)}\n`, "utf8");
      },
      verifyAfterM67Stop: async () => {
        throw new Error("controlled_verify_only_failure");
      },
    }),
    /controlled_verify_only_failure/,
  );
});

test("V1-9 runner keeps frozen files immutable and stops at external acceptance", async (t) => {
  const fixture = await createRunnerFixture(t);
  const originalManifest = await readFile(fixture.manifestPath);
  const pointerPath = path.join(fixture.rootDir, "test-results", "v1-9-product-e2e-active.json");
  const originalPointer = await readFile(pointerPath);
  const runContext = resolveV1_9RunContext({ rootDir: fixture.rootDir });
  const calls = [];

  await mainV1_9E2E({
    rootDir: fixture.rootDir,
    env: { V1_9_RUN_MODE: "start-new", V1_9_E2E_TIMEOUT_MS: "60000" },
    runCommand: async (command, args, env, timeoutMs) => {
      calls.push({ command, args, env, timeoutMs });
      if (calls.length !== 2) return;
      const prepared = JSON.parse(await readFile(fixture.statePath, "utf8"));
      const submitted = recordV1_9RunStateMutation(bindRunnerTaskContract(prepared), {
        method: "POST",
        pathname: "/api/workbench/projects/project-1/messages",
        source: "ui",
        recordedAt: "2026-07-15T01:00:04.000Z",
      });
      const downloaded = recordV1_9RunStateMutation(submitted, {
        method: "GET",
        pathname: "/api/workbench/projects/project-1/artifacts/package-1/package",
        source: "ui",
        recordedAt: "2026-07-15T01:00:05.000Z",
      });
      const packageReady = markV1_9RunStatePackageReady(projectReadyAuthority(downloaded), {
        packageArtifactId: "package-1",
        packageArtifactVersion: 1,
        packageVersion: "course-v1",
        packageSha256: digest("a"),
        turnJobId: "turn-job-1",
        teacherMessageId: "teacher-message-1",
        downloadedAt: "2026-07-15T01:00:06.000Z",
      });
      await writeFile(fixture.statePath, `${JSON.stringify(packageReady, null, 2)}\n`, "utf8");
    },
    verifyAfterM67Stop: async () => undefined,
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, ["node_modules/tsx/dist/cli.mjs", "scripts/v1-9-product-preflight.ts"]);
  assert.deepEqual(calls[1].args, ["scripts/run-m67-e2e.mjs"]);
  assert.equal(calls[1].env.M67_E2E_PROJECTS, "chromium-desktop");
  assert.equal(calls[1].env.V1_9_E2E_STATE_PATH, fixture.statePath);
  assert.equal(calls[1].env.M67_E2E_FROZEN_APP_ROOT, path.join(fixture.runRoot, "next-app-frozen"));
  assert.equal(calls[1].env.V1_9_E2E_RUN_ID, runContext.manifest.runId);
  assert.equal(calls[1].env.V1_9_E2E_MANIFEST_SHA256, runContext.manifestSha256);
  assert.equal(calls[1].env.SHANHAI_V1_9_REPOSITORY_ROOT, fixture.rootDir);
  assert.deepEqual(await readFile(fixture.manifestPath), originalManifest);
  assert.deepEqual(await readFile(pointerPath), originalPointer);
});
