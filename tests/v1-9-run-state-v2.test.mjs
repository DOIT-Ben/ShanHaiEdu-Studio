import assert from "node:assert/strict";
import { test } from "node:test";

import {
  advanceV1_9PlanRevision,
  assertV1_9InterruptedRunningResumeState,
  bindV1_9RunStateProjectIdentity,
  bindV1_9TaskContractLock,
  createV1_9RunManifestV2,
  createV1_9RunState,
  markV1_9RunStateContractUpgradeTermination,
  markV1_9RunStatePackageReady,
  markV1_9RunStatePendingDecision,
  markV1_9RunStateRecoveryStop,
  normalizeV1_9RunState,
  recordV1_9ExternalAcceptanceRound,
  recordV1_9RunStateMutation,
  updateV1_9RunStateCheckpoint,
} from "../scripts/lib/v1-9-e2e-contract.mjs";

const digest = (character) => character.repeat(64);

test("run-state persists project identity before binding one immutable task contract", () => {
  const manifest = createManifest();
  let state = createV1_9RunState({ manifest, createdAt: "2026-07-15T10:00:00.000Z" });

  assert.deepEqual(state.identity, { actorUserId: null, projectId: null, taskId: null, intentEpoch: null });
  assert.equal(state.checkpoint, null);
  assert.equal(state.pendingDecision, null);
  assert.equal(state.recovery, null);
  assert.equal(state.packageAcceptance, null);

  state = bindV1_9RunStateProjectIdentity(state, {
    actorUserId: "teacher-1",
    projectId: "project-1",
    boundAt: "2026-07-15T10:01:00.000Z",
  });
  assert.deepEqual(state.identity, {
    actorUserId: "teacher-1",
    projectId: "project-1",
    taskId: null,
    intentEpoch: null,
  });
  assert.equal(state.status, "prepared");

  state = bindTask(state);
  assert.equal(state.status, "running");
  assert.equal(state.taskContractLock.taskBriefDigest, digest("1"));
  assert.equal(state.taskContractLock.intensity, "standard");
  assert.equal(state.ledger.currentPlanRevision, 0);
  assert.throws(() => bindTask(state, { budgetDigest: digest("9") }), /task_contract_lock_mismatch/);
  assert.throws(() => bindV1_9RunStateProjectIdentity(state, {
    actorUserId: "teacher-1", projectId: "project-2", boundAt: "2026-07-15T10:03:00.000Z",
  }), /project_identity_mismatch/);
});

test("run-state permits interrupted running resume only for the one frozen UI task", () => {
  let state = createV1_9RunState({ manifest: createManifest(), createdAt: "2026-07-15T10:00:00.000Z" });
  state = recordV1_9RunStateMutation(state, {
    method: "POST", pathname: "/api/workbench/projects", source: "ui", recordedAt: "2026-07-15T10:00:30.000Z",
  });
  state = bindTask(bindProject(state));
  state = recordV1_9RunStateMutation(state, {
    method: "POST",
    pathname: "/api/workbench/projects/project-1/messages",
    source: "ui",
    recordedAt: "2026-07-15T10:03:00.000Z",
  });

  assert.deepEqual(assertV1_9InterruptedRunningResumeState(state), state);
  assert.throws(
    () => assertV1_9InterruptedRunningResumeState({
      ...state,
      ledger: { ...state.ledger, taskSubmissionCount: 0 },
    }),
    /v1_9_running_resume_submission_invalid/,
  );
  assert.throws(
    () => assertV1_9InterruptedRunningResumeState({
      ...state,
      ledger: {
        ...state.ledger,
        mutations: state.ledger.mutations.map((mutation) => mutation.pathname.endsWith("/messages")
          ? { ...mutation, pathname: "/api/workbench/projects/project-other/messages" }
          : mutation),
      },
    }),
    /v1_9_running_resume_task_identity_mismatch/,
  );
  assert.throws(
    () => assertV1_9InterruptedRunningResumeState({ ...state, status: "paused_pending_decision" }),
    /v1_9_running_resume_state_invalid/,
  );
});

test("run-state owns the UI mutation ledger and derives external orchestration violations", () => {
  let state = createV1_9RunState({ manifest: createManifest(), createdAt: "2026-07-15T10:00:00.000Z" });
  state = recordV1_9RunStateMutation(state, {
    method: "POST", pathname: "/api/auth/login", source: "ui", recordedAt: "2026-07-15T10:00:10.000Z",
  });
  state = recordV1_9RunStateMutation(state, {
    method: "POST", pathname: "/api/workbench/projects", source: "ui", recordedAt: "2026-07-15T10:00:20.000Z",
  });
  state = recordV1_9RunStateMutation(state, {
    method: "POST", pathname: "/api/workbench/projects/project-1/messages", source: "ui", recordedAt: "2026-07-15T10:00:30.000Z",
  });
  state = recordV1_9RunStateMutation(state, {
    method: "POST", pathname: "/api/workbench/projects/project-1/artifacts", source: "runner", recordedAt: "2026-07-15T10:00:40.000Z",
  });

  assert.equal(state.ledger.taskSubmissionCount, 1);
  assert.equal(state.ledger.externalCodexOrchestrationCount, 1);
  assert.equal(state.ledger.violations[0].reasonCode, "runner_mutation_not_allowed");
});

test("checkpoint, plan revision, pending decision, and recovery remain monotonic and typed", () => {
  let state = bindTask(bindProject(createV1_9RunState({
    manifest: createManifest(), createdAt: "2026-07-15T10:00:00.000Z",
  })));
  state = advanceV1_9PlanRevision(state, {
    nextPlanRevision: 2,
    advancedAt: "2026-07-15T10:03:00.000Z",
  });
  state = updateV1_9RunStateCheckpoint(state, {
    checkpointId: "checkpoint-2",
    planRevision: 2,
    observationRefs: ["observation-2"],
    recordedAt: "2026-07-15T10:04:00.000Z",
  });
  assert.equal(state.checkpoint.checkpointId, "checkpoint-2");
  assert.throws(() => updateV1_9RunStateCheckpoint(state, {
    checkpointId: "checkpoint-old", planRevision: 1, observationRefs: [], recordedAt: "2026-07-15T10:05:00.000Z",
  }), /plan_revision_regression/);

  state = markV1_9RunStatePendingDecision(state, {
    kind: "material_choice",
    actionId: "decision-1",
    reasonCode: "teacher_choice_required",
    stoppedAt: "2026-07-15T10:05:00.000Z",
  });
  assert.equal(state.status, "paused_pending_decision");
  assert.equal(state.pendingDecision.actionId, "decision-1");

  state = markV1_9RunStateRecoveryStop({ ...state, status: "running", pendingDecision: null }, {
    reasonCode: "main_agent_provider_unavailable",
    checkpointId: "checkpoint-2",
    observationRefs: ["observation-2"],
    turnJobId: "turn-job-1",
    teacherMessageId: "teacher-message-1",
    stoppedAt: "2026-07-15T10:06:00.000Z",
  });
  assert.equal(state.status, "paused_recovery");
  assert.equal(state.recovery.healthEvidenceNotBefore, "2026-07-15T10:06:00.000Z");
});

test("contract upgrades terminate one v2 run with typed immutable successor evidence", () => {
  let state = bindTask(bindProject(createV1_9RunState({
    manifest: createManifest(), createdAt: "2026-07-15T10:00:00.000Z",
  })));
  state = markV1_9RunStateRecoveryStop(state, {
    reasonCode: "main_agent_provider_unavailable",
    checkpointId: null,
    observationRefs: ["observation-1"],
    stoppedAt: "2026-07-15T10:05:00.000Z",
  });

  const terminated = markV1_9RunStateContractUpgradeTermination(state, {
    reasonCode: "v1_9_contract_upgrade",
    successorRunId: "v1-9-successor",
    driftedFields: ["runtimeSourceDigest", "requirementsBaselineDigest"],
    recoveryEntry: "test-results/v1-9-successor/run-state.json",
    terminatedAt: "2026-07-15T10:06:00.000Z",
  });

  assert.equal(terminated.status, "terminated_contract_upgrade");
  assert.equal(terminated.pendingDecision, null);
  assert.equal(terminated.recovery, null);
  assert.deepEqual(terminated.termination, {
    reasonCode: "v1_9_contract_upgrade",
    successorRunId: "v1-9-successor",
    driftedFields: ["runtimeSourceDigest", "requirementsBaselineDigest"],
    recoveryEntry: "test-results/v1-9-successor/run-state.json",
    terminatedAt: "2026-07-15T10:06:00.000Z",
  });
  assert.deepEqual(normalizeV1_9RunState(structuredClone(terminated)), terminated);
  assert.deepEqual(markV1_9RunStateContractUpgradeTermination(terminated, {
    reasonCode: "v1_9_contract_upgrade",
    successorRunId: "v1-9-successor",
    driftedFields: ["runtimeSourceDigest", "requirementsBaselineDigest"],
    recoveryEntry: "test-results/v1-9-successor/run-state.json",
    terminatedAt: "2026-07-15T10:06:00.000Z",
  }), terminated);
  assert.throws(() => recordV1_9RunStateMutation(terminated, {
    method: "GET",
    pathname: "/api/workbench/projects/project-1/snapshot",
    source: "runner",
    recordedAt: "2026-07-15T10:07:00.000Z",
  }), /terminal_state_immutable/);
  assert.throws(() => advanceV1_9PlanRevision(terminated, {
    nextPlanRevision: 1,
    advancedAt: "2026-07-15T10:07:00.000Z",
  }), /terminal_state_immutable/);
  assert.throws(() => markV1_9RunStateContractUpgradeTermination(terminated, {
    reasonCode: "different_upgrade",
    successorRunId: "v1-9-different-successor",
    recoveryEntry: "test-results/v1-9-different-successor/run-state.json",
    terminatedAt: "2026-07-15T10:07:00.000Z",
  }), /termination_mismatch/);

  const active = bindTask(bindProject(createV1_9RunState({
    manifest: createManifest(), createdAt: "2026-07-15T10:00:00.000Z",
  })));
  assert.throws(() => markV1_9RunStateContractUpgradeTermination(active, {
    reasonCode: "v1_9_contract_upgrade",
    successorRunId: active.runId,
    recoveryEntry: `test-results/${active.runId}/run-state.json`,
    terminatedAt: "2026-07-15T10:06:00.000Z",
  }), /successor_run_id_invalid/);
});

test("external acceptance rounds preserve P0 evidence and only complete after a revised package closes it", () => {
  let state = bindTask(bindProject(createV1_9RunState({
    manifest: createManifest(), createdAt: "2026-07-15T10:00:00.000Z",
  })));
  state = recordV1_9RunStateMutation(state, {
    method: "GET",
    pathname: "/api/workbench/projects/project-1/artifacts/package-1/package",
    source: "ui",
    recordedAt: "2026-07-15T10:10:00.000Z",
  });
  state = markV1_9RunStatePackageReady(state, {
    packageArtifactId: "package-1",
    packageArtifactVersion: 1,
    packageVersion: "course-v1",
    packageSha256: digest("a"),
    turnJobId: "turn-job-1",
    teacherMessageId: "teacher-message-1",
    downloadedAt: "2026-07-15T10:10:01.000Z",
  });
  assert.equal(state.status, "package_ready_for_external_acceptance");
  assert.deepEqual(state.packageAcceptance.rounds, []);

  state = recordV1_9ExternalAcceptanceRound(state, repairRound());
  assert.equal(state.status, "external_acceptance_repair_required");
  assert.deepEqual(state.packageAcceptance.currentRepair.openP0FindingIds, ["finding-page-3"]);
  assert.deepEqual(state.packageAcceptance.currentRepair.responsibilityLayers, ["quality_gate"]);
  assert.equal(state.packageAcceptance.rounds.length, 1);

  assert.throws(() => markV1_9RunStatePackageReady(state, {
    packageArtifactId: "package-1",
    packageArtifactVersion: 1,
    packageVersion: "course-v1",
    packageSha256: digest("a"),
    turnJobId: "turn-job-1",
    teacherMessageId: "teacher-message-1",
    downloadedAt: "2026-07-15T10:21:00.000Z",
  }), /external_acceptance_package_not_revised/);

  state = markV1_9RunStatePackageReady(state, {
    packageArtifactId: "package-2",
    packageArtifactVersion: 2,
    packageVersion: "course-v2",
    packageSha256: digest("c"),
    turnJobId: "turn-job-1",
    teacherMessageId: "teacher-message-1",
    downloadedAt: "2026-07-15T10:21:00.000Z",
  });
  assert.equal(state.status, "package_ready_for_external_acceptance");
  assert.equal(state.packageAcceptance.rounds.length, 1);
  assert.deepEqual(state.packageAcceptance.currentRepair.openP0FindingIds, ["finding-page-3"]);

  state = recordV1_9ExternalAcceptanceRound(state, acceptedRound());
  assert.equal(state.status, "completed");
  assert.equal(state.packageAcceptance.currentRepair, null);
  assert.equal(state.packageAcceptance.rounds.length, 2);
  assert.equal(state.packageAcceptance.acceptedAt, "2026-07-15T10:30:00.000Z");
  assert.throws(() => recordV1_9RunStateMutation(state, {
    method: "GET",
    pathname: "/api/workbench/projects/project-1/snapshot",
    source: "runner",
    recordedAt: "2026-07-15T10:21:00.000Z",
  }), /terminal_state_immutable/);
  assert.deepEqual(normalizeV1_9RunState(structuredClone(state)), state);
});

test("run-state rejects any drift between current repair projection and the latest immutable round", () => {
  const mutations = [
    (state) => { state.packageAcceptance.currentRepair.affectedUnits[0].pageNumber = 8; },
    (state) => { state.packageAcceptance.currentRepair.feedback[0].engineering = "扩大为全包重做。"; },
    (state) => { state.packageAcceptance.currentRepair.responsibilityLayers = ["provider_adapter"]; },
    (state) => { state.packageAcceptance.currentRepair.repairHandoffPath = "external-acceptance/round-0001/other.json"; },
    (state) => { state.packageAcceptance.packageSha256 = digest("f"); },
  ];

  for (const mutate of mutations) {
    const drifted = structuredClone(createRepairRequiredState());
    mutate(drifted);
    assert.throws(() => normalizeV1_9RunState(drifted), /external_acceptance_repair_state_invalid/);
  }
});

function createManifest() {
  return createV1_9RunManifestV2({
    runId: "v1-9-20260715-a23-state",
    relativeRunRoot: "test-results/v1-9-20260715-a23-state",
    prompt: "完成一套公开课材料包。",
    createdAt: "2026-07-15T10:00:00.000Z",
    baselineLock: {
      schemaVersion: "v1-9-baseline-lock.v1",
      branch: "main",
      gitHead: "a".repeat(40),
      generationIntensity: "standard",
      runtimeSourceDigest: digest("c"),
      requirementsBaselineDigest: digest("d"),
      registryDigest: digest("e"),
      projectionRegistryDigest: digest("e"),
      providerLedgerManifestDigest: digest("f"),
      projectionId: "runtime-projection-a23",
    },
    skillLock: {
      schemaVersion: "v1-9-skill-lock.v1",
      projectionLockDigest: digest("1"),
      bindingPolicyDigest: digest("2"),
      activeSkills: [{ name: "shanhai-suite", version: "1.1" }],
    },
    agentBrain: { providerLock: {
      schemaVersion: "v1-9-provider-lock.v1",
      channel: "primary",
      model: "gpt-5.6-terra",
      endpointCategory: "openai_compatible_responses",
      reasoningEffort: "medium",
      credentialSource: "ledger_private_env",
      configDigest: digest("3"),
    } },
    providerRuntimeLocks: [
      ["agent_brain", "3"], ["coze_ppt", "4"], ["image_generation", "5"],
      ["tts_minimax", "6"], ["video_generation", "7"],
    ].map(([capability, character]) => ({
      capability,
      credentialSource: "ledger_private_env",
      configDigest: digest(character),
    })),
    predecessor: {
      runId: "v1-9-20260714212914-a036beb9",
      relativeRunRoot: "test-results/v1-9-20260714212914-a036beb9",
      manifestSha256: digest("8"),
      disposition: "historical_failed",
    },
  });
}

function bindProject(state) {
  return bindV1_9RunStateProjectIdentity(state, {
    actorUserId: "teacher-1", projectId: "project-1", boundAt: "2026-07-15T10:01:00.000Z",
  });
}

function bindTask(state, overrides = {}) {
  return bindV1_9TaskContractLock(state, {
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
    boundAt: "2026-07-15T10:02:00.000Z",
    ...overrides,
  });
}

function createRepairRequiredState() {
  let state = bindTask(bindProject(createV1_9RunState({
    manifest: createManifest(), createdAt: "2026-07-15T10:00:00.000Z",
  })));
  state = recordV1_9RunStateMutation(state, {
    method: "GET",
    pathname: "/api/workbench/projects/project-1/artifacts/package-1/package",
    source: "ui",
    recordedAt: "2026-07-15T10:10:00.000Z",
  });
  state = markV1_9RunStatePackageReady(state, {
    packageArtifactId: "package-1",
    packageArtifactVersion: 1,
    packageVersion: "course-v1",
    packageSha256: digest("a"),
    turnJobId: "turn-job-1",
    teacherMessageId: "teacher-message-1",
    downloadedAt: "2026-07-15T10:10:01.000Z",
  });
  return recordV1_9ExternalAcceptanceRound(state, repairRound());
}

function repairRound() {
  return {
    auditRound: 1,
    reportId: "external-acceptance-round-1",
    reportPath: "external-acceptance/round-0001/report.json",
    reportDigest: digest("b"),
    packageArtifactId: "package-1",
    packageArtifactVersion: 1,
    packageVersion: "course-v1",
    packageSha256: digest("a"),
    outcome: "repair_required",
    reviewedFindingIds: [],
    openP0FindingIds: ["finding-page-3"],
    affectedUnits: [{
      unitId: "ppt_deck:page:3", kind: "page", artifactRole: "ppt_deck", artifactId: "pptx-1",
      artifactVersion: "course-v1", pageNumber: 3, shotId: null, packageEntry: "materials/course-v1.pptx",
    }],
    repairFeedback: [{
      findingId: "finding-page-3", responsibilityLayer: "quality_gate", category: "design_quality",
      design: "第3页越过安全边距。", vulnerability: null, engineering: "仅返修第3页。",
    }],
    repairHandoffPath: "external-acceptance/round-0001/repair-handoff.json",
    repairHandoffDigest: digest("d"),
    generatedAt: "2026-07-15T10:20:00.000Z",
  };
}

function acceptedRound() {
  return {
    auditRound: 2,
    reportId: "external-acceptance-round-2",
    reportPath: "external-acceptance/round-0002/report.json",
    reportDigest: digest("e"),
    packageArtifactId: "package-2",
    packageArtifactVersion: 2,
    packageVersion: "course-v2",
    packageSha256: digest("c"),
    outcome: "accepted",
    reviewedFindingIds: ["finding-page-3"],
    openP0FindingIds: [],
    affectedUnits: [],
    repairFeedback: [],
    repairHandoffPath: null,
    repairHandoffDigest: null,
    generatedAt: "2026-07-15T10:30:00.000Z",
  };
}
