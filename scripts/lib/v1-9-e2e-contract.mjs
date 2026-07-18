import { createHash } from "node:crypto";

export const V1_9_RUN_MANIFEST_VERSION = "v1-9-run-manifest.v1";
export const V1_9_RUN_MANIFEST_V2_VERSION = "v1-9-run-manifest.v2";
export const V1_9_BASELINE_LOCK_VERSION = "v1-9-baseline-lock.v2";
export const V1_9_LEGACY_BASELINE_LOCK_VERSION = "v1-9-baseline-lock.v1";
export const V1_9_RUN_STATE_VERSION = "v1-9-run-state.v2";
export const V1_9_RUN_LEDGER_VERSION = "v1-9-run-ledger.v1";
export const V1_9_TASK_CONTRACT_LOCK_VERSION = "v1-9-task-contract-lock.v1";
export const V1_9_FROZEN_PROMPT = [
  "请为五年级数学《百分数》完成一套可直接备课验收的公开课材料包，",
  "包括结构化教案、约10页可编辑PPTX、课堂视觉图、30至90秒独立创意导入视频、",
  "唯一最小课程锚点、ClassroomRunSpec和版本一致ZIP。",
  "视频创意脱离教材仍成立，不固定儿童、教师、教室或课堂活动；标准范围内自主推进，失败只返修受影响页面、镜头或版本。",
].join("");
export const V1_9_FROZEN_PROMPT_DIGEST = sha256(V1_9_FROZEN_PROMPT);

const generationIntensities = new Set(["standard", "enhanced", "deep", "extreme"]);
const providerRuntimeCapabilities = new Set([
  "agent_brain",
  "coze_ppt",
  "image_generation",
  "text_llm",
  "tts_minimax",
  "video_generation",
]);
const requiredProviderRuntimeCapabilities = [
  "agent_brain",
  "coze_ppt",
  "image_generation",
  "tts_minimax",
  "video_generation",
];
const providerCredentialSources = new Set(["ledger_private_env", "deployment_secret"]);
const predecessorDispositions = new Set(["historical_failed", "terminated_contract_upgrade", "completed"]);
const runStateStatuses = new Set([
  "prepared",
  "running",
  "paused_pending_decision",
  "paused_recovery",
  "failed",
  "terminated_contract_upgrade",
  "package_ready_for_external_acceptance",
  "external_acceptance_repair_required",
  "completed",
]);
const pendingDecisionKinds = new Set([
  "authorization",
  "budget_disclosure",
  "budget_upgrade",
  "highest_intensity",
  "publish",
  "permission_change",
  "destructive",
  "material_choice",
]);

export function createV1_9RunManifest(input) {
  const runId = requiredText(input.runId, "runId");
  const relativeRunRoot = normalizeRelativeRunRoot(input.relativeRunRoot);
  const createdAt = requiredTimestamp(input.createdAt, "createdAt");
  const prompt = requiredText(input.prompt, "prompt");
  return {
    schemaVersion: V1_9_RUN_MANIFEST_VERSION,
    runId,
    status: "prepared",
    relativeRunRoot,
    promptDigest: sha256(prompt),
    skillLock: null,
    providerLock: null,
    providerLockHistory: [],
    projectId: null,
    taskId: null,
    intentEpoch: null,
    checkpointId: null,
    taskSubmissionCount: 0,
    finalDownloadCount: 0,
    externalCodexOrchestrationCount: 0,
    pendingDecision: null,
    recovery: null,
    mutations: [],
    violations: [],
    createdAt,
    updatedAt: createdAt,
  };
}

export function createV1_9RunManifestV2(input) {
  const source = requiredRecord(input, "run_manifest_input");
  assertOnlyFields(source, [
    "runId",
    "relativeRunRoot",
    "createdAt",
    "baselineLock",
    "skillLock",
    "agentBrain",
    "providerRuntimeLocks",
    "predecessor",
  ], "run_manifest_input");
  const runId = requiredRunId(source.runId, "runId");
  const relativeRunRoot = normalizeRelativeRunRoot(source.relativeRunRoot);
  assertRunRootMatchesRunId(relativeRunRoot, runId, "run_root");
  const agentBrain = normalizeAgentBrain(source.agentBrain);
  const providerRuntimeLocks = normalizeProviderRuntimeLocks(source.providerRuntimeLocks);
  const agentBrainRuntimeLock = providerRuntimeLocks.find((lock) => lock.capability === "agent_brain");
  if (agentBrainRuntimeLock.configDigest !== agentBrain.providerLock.configDigest ||
      agentBrainRuntimeLock.credentialSource !== agentBrain.providerLock.credentialSource) {
    throw new Error("v1_9_agent_brain_runtime_lock_mismatch");
  }
  const predecessor = normalizePredecessor(source.predecessor);
  if (predecessor?.runId === runId) throw new Error("v1_9_predecessor_run_id_invalid");
  const baselineLock = normalizeV1_9BaselineLock(source.baselineLock);
  if (baselineLock.schemaVersion !== V1_9_BASELINE_LOCK_VERSION) {
    throw new Error("v1_9_baseline_lock_upgrade_required");
  }
  return {
    schemaVersion: V1_9_RUN_MANIFEST_V2_VERSION,
    runId,
    relativeRunRoot,
    createdAt: requiredTimestamp(source.createdAt, "createdAt"),
    promptDigest: V1_9_FROZEN_PROMPT_DIGEST,
    baselineLock,
    skillLock: normalizeSkillLockStrict(source.skillLock),
    agentBrain,
    providerRuntimeLocks,
    predecessor,
  };
}

export function normalizeV1_9RunManifestV2(value) {
  const manifest = normalizeV1_9RunManifestV2ReadOnly(value);
  if (manifest.baselineLock.schemaVersion !== V1_9_BASELINE_LOCK_VERSION) {
    throw new Error("v1_9_baseline_lock_upgrade_required");
  }
  return manifest;
}

export function normalizeV1_9RunManifestV2ReadOnly(value) {
  const manifest = requiredRecord(value, "run_manifest");
  assertOnlyFields(manifest, [
    "schemaVersion",
    "runId",
    "relativeRunRoot",
    "createdAt",
    "promptDigest",
    "baselineLock",
    "skillLock",
    "agentBrain",
    "providerRuntimeLocks",
    "predecessor",
  ], "run_manifest");
  if (manifest.schemaVersion !== V1_9_RUN_MANIFEST_V2_VERSION) {
    throw new Error("v1_9_run_manifest_version_invalid");
  }
  const runId = requiredRunId(manifest.runId, "runId");
  const relativeRunRoot = normalizeRelativeRunRoot(manifest.relativeRunRoot);
  assertRunRootMatchesRunId(relativeRunRoot, runId, "run_root");
  const agentBrain = normalizeAgentBrain(manifest.agentBrain);
  const providerRuntimeLocks = normalizeProviderRuntimeLocks(manifest.providerRuntimeLocks);
  const agentBrainRuntimeLock = providerRuntimeLocks.find((lock) => lock.capability === "agent_brain");
  if (agentBrainRuntimeLock.configDigest !== agentBrain.providerLock.configDigest ||
      agentBrainRuntimeLock.credentialSource !== agentBrain.providerLock.credentialSource) {
    throw new Error("v1_9_agent_brain_runtime_lock_mismatch");
  }
  const predecessor = normalizePredecessor(manifest.predecessor);
  if (predecessor?.runId === runId) throw new Error("v1_9_predecessor_run_id_invalid");
  return {
    schemaVersion: V1_9_RUN_MANIFEST_V2_VERSION,
    runId,
    relativeRunRoot,
    createdAt: requiredTimestamp(manifest.createdAt, "createdAt"),
    promptDigest: requiredDigest(manifest.promptDigest, "runManifest.promptDigest"),
    baselineLock: normalizeV1_9BaselineLock(manifest.baselineLock),
    skillLock: normalizeSkillLockStrict(manifest.skillLock),
    agentBrain,
    providerRuntimeLocks,
    predecessor,
  };
}

export function normalizeV1_9BaselineLock(value) {
  const lock = requiredRecord(value, "baseline_lock");
  const commonFields = [
    "schemaVersion",
    "branch",
    "gitHead",
    "generationIntensity",
    "runtimeSourceDigest",
    "requirementsBaselineDigest",
    "registryDigest",
    "projectionRegistryDigest",
    "providerLedgerManifestDigest",
    "projectionId",
  ];
  const v2Fields = [
    ...commonFields,
    "verificationManifestSha256",
    "workingTreeDigest",
    "policySha256",
    "stageSha256",
    "providerContinuityManifestSha256",
    "providerContinuityReceiptSha256",
    "providerContinuityEvidenceRootDigest",
    "providerContinuitySubjectDigest",
  ];
  if (lock.schemaVersion === V1_9_LEGACY_BASELINE_LOCK_VERSION) {
    assertOnlyFields(lock, commonFields, "baseline_lock");
  } else if (lock.schemaVersion === V1_9_BASELINE_LOCK_VERSION) {
    assertOnlyFields(lock, v2Fields, "baseline_lock");
  } else {
    throw new Error("v1_9_baseline_lock_version_invalid");
  }
  if (lock.branch !== "main") throw new Error("v1_9_baseline_branch_invalid");
  if (lock.generationIntensity !== "standard") {
    throw new Error("v1_9_baseline_generation_intensity_invalid");
  }
  const registryDigest = requiredDigest(lock.registryDigest, "baselineLock.registryDigest");
  const projectionRegistryDigest = requiredDigest(
    lock.projectionRegistryDigest,
    "baselineLock.projectionRegistryDigest",
  );
  if (registryDigest !== projectionRegistryDigest) {
    throw new Error("v1_9_baseline_registry_projection_mismatch");
  }
  const normalized = {
    schemaVersion: lock.schemaVersion,
    branch: "main",
    gitHead: requiredGitCommit(lock.gitHead, "baselineLock.gitHead"),
    generationIntensity: "standard",
    runtimeSourceDigest: requiredDigest(lock.runtimeSourceDigest, "baselineLock.runtimeSourceDigest"),
    requirementsBaselineDigest: requiredDigest(lock.requirementsBaselineDigest, "baselineLock.requirementsBaselineDigest"),
    registryDigest,
    projectionRegistryDigest,
    providerLedgerManifestDigest: requiredDigest(
      lock.providerLedgerManifestDigest,
      "baselineLock.providerLedgerManifestDigest",
    ),
    projectionId: requiredSafeId(lock.projectionId, "baselineLock.projectionId"),
  };
  if (lock.schemaVersion === V1_9_LEGACY_BASELINE_LOCK_VERSION) return normalized;
  return {
    ...normalized,
    verificationManifestSha256: requiredDigest(
      lock.verificationManifestSha256,
      "baselineLock.verificationManifestSha256",
    ),
    workingTreeDigest: requiredDigest(lock.workingTreeDigest, "baselineLock.workingTreeDigest"),
    policySha256: requiredDigest(lock.policySha256, "baselineLock.policySha256"),
    stageSha256: requiredDigest(lock.stageSha256, "baselineLock.stageSha256"),
    providerContinuityManifestSha256: requiredDigest(
      lock.providerContinuityManifestSha256,
      "baselineLock.providerContinuityManifestSha256",
    ),
    providerContinuityReceiptSha256: requiredDigest(
      lock.providerContinuityReceiptSha256,
      "baselineLock.providerContinuityReceiptSha256",
    ),
    providerContinuityEvidenceRootDigest: requiredDigest(
      lock.providerContinuityEvidenceRootDigest,
      "baselineLock.providerContinuityEvidenceRootDigest",
    ),
    providerContinuitySubjectDigest: requiredDigest(
      lock.providerContinuitySubjectDigest,
      "baselineLock.providerContinuitySubjectDigest",
    ),
  };
}

export function createV1_9BaselineLockDigest(value) {
  return sha256(JSON.stringify(normalizeV1_9BaselineLock(value)));
}

export function assertV1_9BaselineLockDigest(value, expectedDigest) {
  const normalized = normalizeV1_9BaselineLock(value);
  if (sha256(JSON.stringify(normalized)) !== requiredDigest(expectedDigest, "baselineLockDigest")) {
    throw new Error("v1_9_baseline_lock_digest_mismatch");
  }
  return normalized;
}

export function createV1_9RunManifestV2Digest(value) {
  return sha256(`${JSON.stringify(normalizeV1_9RunManifestV2(value), null, 2)}\n`);
}

export function assertV1_9RunManifestV2Digest(value, expectedDigest) {
  const normalized = normalizeV1_9RunManifestV2(value);
  if (createV1_9RunManifestV2Digest(normalized) !== requiredDigest(expectedDigest, "runManifestDigest")) {
    throw new Error("v1_9_run_manifest_digest_mismatch");
  }
  return normalized;
}

export function createV1_9RunState(input) {
  const source = requiredRecord(input, "run_state_input");
  assertOnlyFields(source, ["manifest", "createdAt"], "run_state_input");
  const manifest = normalizeV1_9RunManifestV2(source.manifest);
  const createdAt = requiredTimestamp(source.createdAt, "runState.createdAt");
  return {
    schemaVersion: V1_9_RUN_STATE_VERSION,
    runId: manifest.runId,
    manifestSha256: createV1_9RunManifestV2Digest(manifest),
    status: "prepared",
    identity: {
      actorUserId: null,
      projectId: null,
      taskId: null,
      intentEpoch: null,
    },
    taskContractLock: null,
    checkpoint: null,
    pendingDecision: null,
    recovery: null,
    termination: null,
    packageAcceptance: null,
    ledger: {
      schemaVersion: V1_9_RUN_LEDGER_VERSION,
      currentPlanRevision: null,
      planRevisionHistory: [],
      taskSubmissionCount: 0,
      finalDownloadCount: 0,
      externalCodexOrchestrationCount: 0,
      mutations: [],
      violations: [],
    },
    createdAt,
    updatedAt: createdAt,
  };
}

export function assertV1_9InterruptedRunningResumeState(value) {
  if (!value || value.status !== "running") {
    throw new Error("v1_9_running_resume_state_invalid");
  }
  const state = normalizeV1_9RunState(value);
  if (state.taskContractLock === null || state.ledger.taskSubmissionCount !== 1) {
    throw new Error("v1_9_running_resume_submission_invalid");
  }
  if (state.ledger.externalCodexOrchestrationCount !== 0 || state.ledger.violations.length !== 0) {
    throw new Error("v1_9_running_resume_ledger_invalid");
  }

  const projectCreations = state.ledger.mutations.filter((mutation) =>
    mutation.source === "ui" && mutation.method === "POST" &&
    mutation.pathname === "/api/workbench/projects");
  const taskSubmissions = state.ledger.mutations.filter((mutation) =>
    mutation.source === "ui" && mutation.method === "POST" &&
    /^\/api\/workbench\/projects\/[^/]+\/messages$/.test(mutation.pathname));
  if (projectCreations.length !== 1 || taskSubmissions.length !== 1) {
    throw new Error("v1_9_running_resume_submission_invalid");
  }
  const expectedTaskPath = `/api/workbench/projects/${state.identity.projectId}/messages`;
  if (taskSubmissions[0].pathname !== expectedTaskPath) {
    throw new Error("v1_9_running_resume_task_identity_mismatch");
  }
  return state;
}

export function normalizeV1_9RunState(value) {
  const state = requiredRecord(value, "run_state");
  assertOnlyFields(state, [
    "schemaVersion",
    "runId",
    "manifestSha256",
    "status",
    "identity",
    "taskContractLock",
    "checkpoint",
    "pendingDecision",
    "recovery",
    "termination",
    "packageAcceptance",
    "ledger",
    "createdAt",
    "updatedAt",
  ], "run_state");
  if (state.schemaVersion !== V1_9_RUN_STATE_VERSION) throw new Error("v1_9_run_state_version_invalid");
  const status = requiredText(state.status, "runState.status");
  if (!runStateStatuses.has(status)) throw new Error("v1_9_run_state_status_invalid");
  const identity = normalizeRunIdentity(state.identity);
  const taskContractLock = state.taskContractLock === null
    ? null
    : normalizeTaskContractLock(state.taskContractLock);
  const checkpoint = state.checkpoint === null ? null : normalizeRunCheckpoint(state.checkpoint);
  const pendingDecision = state.pendingDecision === null ? null : normalizeRunPendingDecision(state.pendingDecision);
  const recovery = state.recovery === null ? null : normalizeRunRecovery(state.recovery);
  const termination = state.termination === null ? null : normalizeRunTermination(state.termination);
  const packageAcceptance = state.packageAcceptance === null
    ? null
    : normalizePackageAcceptance(state.packageAcceptance);
  const ledger = normalizeRunLedger(state.ledger, taskContractLock);
  const hasTaskIdentity = identity.taskId !== null;
  if (hasTaskIdentity !== Boolean(taskContractLock)) throw new Error("v1_9_run_state_task_binding_invalid");
  if (taskContractLock && identity.intentEpoch !== taskContractLock.intentEpoch) {
    throw new Error("v1_9_run_state_intent_epoch_mismatch");
  }
  if (packageAcceptance && taskContractLock && (
    packageAcceptance.turnJobId !== taskContractLock.turnJobId ||
    packageAcceptance.teacherMessageId !== taskContractLock.teacherMessageId
  )) {
    throw new Error("v1_9_external_acceptance_task_binding_mismatch");
  }
  if (!taskContractLock && (ledger.currentPlanRevision !== null || ledger.planRevisionHistory.length !== 0)) {
    throw new Error("v1_9_run_state_plan_revision_without_task_contract");
  }
  if (!taskContractLock && [
    "running",
    "paused_pending_decision",
    "paused_recovery",
    "failed",
    "package_ready_for_external_acceptance",
    "external_acceptance_repair_required",
    "completed",
  ].includes(status)) {
    throw new Error("v1_9_run_state_status_without_task_contract");
  }
  if (!taskContractLock && checkpoint !== null) throw new Error("v1_9_run_state_checkpoint_without_task_contract");
  if ((status === "paused_pending_decision") !== Boolean(pendingDecision)) {
    throw new Error("v1_9_run_state_pending_decision_status_mismatch");
  }
  if (["paused_recovery", "failed"].includes(status) !== Boolean(recovery)) {
    throw new Error("v1_9_run_state_recovery_status_mismatch");
  }
  if ((status === "terminated_contract_upgrade") !== Boolean(termination)) {
    throw new Error("v1_9_run_state_termination_status_mismatch");
  }
  const packageStatus = [
    "package_ready_for_external_acceptance",
    "external_acceptance_repair_required",
    "completed",
  ].includes(status);
  if (packageStatus !== Boolean(packageAcceptance)) {
    throw new Error("v1_9_run_state_package_status_mismatch");
  }
  if (status === "package_ready_for_external_acceptance" && packageAcceptance?.acceptedAt !== null) {
    throw new Error("v1_9_external_acceptance_report_premature");
  }
  if (status === "external_acceptance_repair_required" && packageAcceptance?.currentRepair === null) {
    throw new Error("v1_9_external_acceptance_repair_state_invalid");
  }
  if (status === "external_acceptance_repair_required" &&
      !packageAcceptanceMatchesLatestRound(packageAcceptance)) {
    throw new Error("v1_9_external_acceptance_repair_state_invalid");
  }
  if (status === "completed" && (
    packageAcceptance?.acceptedAt === null || packageAcceptance?.currentRepair !== null ||
    packageAcceptance?.rounds.at(-1)?.outcome !== "accepted" ||
    !packageAcceptanceMatchesLatestRound(packageAcceptance)
  )) {
    throw new Error("v1_9_external_acceptance_incomplete");
  }
  const createdAt = requiredTimestamp(state.createdAt, "runState.createdAt");
  const updatedAt = requiredTimestamp(state.updatedAt, "runState.updatedAt");
  if (Date.parse(updatedAt) < Date.parse(createdAt)) throw new Error("v1_9_run_state_timestamp_invalid");
  return {
    schemaVersion: V1_9_RUN_STATE_VERSION,
    runId: requiredRunId(state.runId, "runId"),
    manifestSha256: requiredDigest(state.manifestSha256, "runState.manifestSha256"),
    status,
    identity,
    taskContractLock,
    checkpoint,
    pendingDecision,
    recovery,
    termination,
    packageAcceptance,
    ledger,
    createdAt,
    updatedAt,
  };
}

export function bindV1_9RunStateProjectIdentity(stateValue, input) {
  const state = normalizeV1_9RunState(stateValue);
  assertV1_9RunStateMutable(state);
  const source = requiredRecord(input, "run_state_project_identity_input");
  assertOnlyFields(source, ["actorUserId", "projectId", "boundAt"], "run_state_project_identity_input");
  const actorUserId = requiredSafeId(source.actorUserId, "actorUserId");
  const projectId = requiredSafeId(source.projectId, "projectId");
  const boundAt = transitionTimestamp(state, source.boundAt, "projectIdentity.boundAt");
  if (state.identity.actorUserId !== null) {
    if (state.identity.actorUserId !== actorUserId || state.identity.projectId !== projectId) {
      throw new Error("v1_9_run_state_project_identity_mismatch");
    }
    return state;
  }
  if (state.status !== "prepared" || state.taskContractLock !== null) {
    throw new Error("v1_9_run_state_project_identity_state_invalid");
  }
  return normalizeV1_9RunState({
    ...state,
    identity: { actorUserId, projectId, taskId: null, intentEpoch: null },
    updatedAt: boundAt,
  });
}

export function bindV1_9TaskContractLock(stateValue, input) {
  const state = normalizeV1_9RunState(stateValue);
  assertV1_9RunStateMutable(state);
  const source = requiredRecord(input, "task_contract_lock_input");
  assertOnlyFields(source, [
    "actorUserId",
    "projectId",
    "taskId",
    "actorAuthMode",
    "teacherMessageId",
    "turnJobId",
    "taskBriefDigest",
    "intentEpoch",
    "intensity",
    "intentGrantDigest",
    "budgetDigest",
    "initialPlanRevision",
    "boundAt",
  ], "task_contract_lock_input");
  const identity = {
    actorUserId: requiredSafeId(source.actorUserId, "actorUserId"),
    projectId: requiredSafeId(source.projectId, "projectId"),
    taskId: requiredSafeId(source.taskId, "taskId"),
    intentEpoch: requiredNonNegativeInteger(source.intentEpoch, "intentEpoch"),
  };
  const taskContractLock = normalizeTaskContractLock({
    schemaVersion: V1_9_TASK_CONTRACT_LOCK_VERSION,
    actorAuthMode: source.actorAuthMode,
    teacherMessageId: source.teacherMessageId,
    turnJobId: source.turnJobId,
    taskBriefDigest: source.taskBriefDigest,
    intentEpoch: source.intentEpoch,
    intensity: source.intensity,
    intentGrantDigest: source.intentGrantDigest,
    budgetDigest: source.budgetDigest,
    initialPlanRevision: source.initialPlanRevision,
  });
  const boundAt = requiredTimestamp(source.boundAt, "taskContract.boundAt");
  if (state.taskContractLock !== null) {
    if (JSON.stringify(state.identity) !== JSON.stringify(identity) ||
        JSON.stringify(state.taskContractLock) !== JSON.stringify(taskContractLock)) {
      throw new Error("v1_9_task_contract_lock_mismatch");
    }
    return state;
  }
  if (state.status !== "prepared") throw new Error("v1_9_task_contract_lock_state_invalid");
  if (state.identity.actorUserId !== null && (
    state.identity.actorUserId !== identity.actorUserId || state.identity.projectId !== identity.projectId
  )) {
    throw new Error("v1_9_run_state_project_identity_mismatch");
  }
  if (Date.parse(boundAt) < Date.parse(state.createdAt)) throw new Error("v1_9_task_contract_bound_at_invalid");
  return normalizeV1_9RunState({
    ...state,
    status: "running",
    identity,
    taskContractLock,
    ledger: {
      ...state.ledger,
      currentPlanRevision: taskContractLock.initialPlanRevision,
      planRevisionHistory: [{ revision: taskContractLock.initialPlanRevision, recordedAt: boundAt }],
    },
    updatedAt: boundAt,
  });
}

export function advanceV1_9PlanRevision(stateValue, input) {
  const state = normalizeV1_9RunState(stateValue);
  assertV1_9RunStateMutable(state);
  if (state.taskContractLock === null) throw new Error("v1_9_task_contract_lock_required");
  const source = requiredRecord(input, "plan_revision_input");
  assertOnlyFields(source, ["nextPlanRevision", "advancedAt"], "plan_revision_input");
  const nextPlanRevision = requiredNonNegativeInteger(source.nextPlanRevision, "nextPlanRevision");
  const advancedAt = requiredTimestamp(source.advancedAt, "planRevision.advancedAt");
  const current = state.ledger.currentPlanRevision;
  if (nextPlanRevision < current) throw new Error("v1_9_plan_revision_regression");
  if (nextPlanRevision === current) return state;
  if (Date.parse(advancedAt) < Date.parse(state.updatedAt)) throw new Error("v1_9_plan_revision_timestamp_invalid");
  return normalizeV1_9RunState({
    ...state,
    ledger: {
      ...state.ledger,
      currentPlanRevision: nextPlanRevision,
      planRevisionHistory: [
        ...state.ledger.planRevisionHistory,
        { revision: nextPlanRevision, recordedAt: advancedAt },
      ],
    },
    updatedAt: advancedAt,
  });
}

export function recordV1_9RunStateMutation(stateValue, input) {
  const state = normalizeV1_9RunState(stateValue);
  assertV1_9RunStateMutable(state);
  const sourceInput = requiredRecord(input, "run_state_mutation_input");
  assertOnlyFields(sourceInput, ["method", "pathname", "source", "recordedAt"], "run_state_mutation_input");
  const method = requiredText(sourceInput.method, "mutation.method").toUpperCase();
  const pathname = normalizePathname(sourceInput.pathname);
  const source = requiredText(sourceInput.source, "mutation.source");
  const recordedAt = transitionTimestamp(state, sourceInput.recordedAt, "mutation.recordedAt");
  const recorded = { method, pathname, source };
  const ledger = structuredClone(state.ledger);
  ledger.mutations.push(recorded);
  const allowed = classifyAllowedMutation(ledger, recorded);
  if (allowed.kind === "task_submission") ledger.taskSubmissionCount += 1;
  if (allowed.kind === "final_download") ledger.finalDownloadCount += 1;
  if (!allowed.allowed) {
    ledger.violations.push({
      reasonCode: allowed.reasonCode,
      method,
      pathname,
      source,
      orchestrationImpact: true,
    });
  }
  ledger.externalCodexOrchestrationCount = ledger.violations.filter((entry) => entry.orchestrationImpact).length;
  return normalizeV1_9RunState({ ...state, ledger, updatedAt: recordedAt });
}

export function updateV1_9RunStateCheckpoint(stateValue, input) {
  let state = normalizeV1_9RunState(stateValue);
  assertV1_9RunStateMutable(state);
  if (state.taskContractLock === null) throw new Error("v1_9_task_contract_lock_required");
  const source = requiredRecord(input, "run_state_checkpoint_input");
  assertOnlyFields(
    source,
    ["checkpointId", "planRevision", "observationRefs", "recordedAt"],
    "run_state_checkpoint_input",
  );
  const planRevision = requiredNonNegativeInteger(source.planRevision, "checkpoint.planRevision");
  const recordedAt = transitionTimestamp(state, source.recordedAt, "checkpoint.recordedAt");
  if (planRevision < state.ledger.currentPlanRevision) throw new Error("v1_9_plan_revision_regression");
  if (planRevision > state.ledger.currentPlanRevision) {
    state = advanceV1_9PlanRevision(state, { nextPlanRevision: planRevision, advancedAt: recordedAt });
  }
  return normalizeV1_9RunState({
    ...state,
    checkpoint: {
      checkpointId: requiredSafeId(source.checkpointId, "checkpointId"),
      planRevision,
      observationRefs: uniqueText(source.observationRefs),
      recordedAt,
    },
    updatedAt: recordedAt,
  });
}

export function markV1_9RunStatePendingDecision(stateValue, input) {
  const state = normalizeV1_9RunState(stateValue);
  assertV1_9RunStateMutable(state);
  if (state.taskContractLock === null) throw new Error("v1_9_task_contract_lock_required");
  const source = requiredRecord(input, "run_state_pending_decision_input");
  assertOnlyFields(source, ["kind", "actionId", "reasonCode", "stoppedAt"], "run_state_pending_decision_input");
  const kind = requiredText(source.kind, "pendingDecision.kind");
  if (!pendingDecisionKinds.has(kind)) throw new Error("v1_9_pending_decision_kind_invalid");
  const stoppedAt = transitionTimestamp(state, source.stoppedAt, "pendingDecision.stoppedAt");
  return normalizeV1_9RunState({
    ...state,
    status: "paused_pending_decision",
    pendingDecision: {
      kind,
      actionId: requiredText(source.actionId, "pendingDecision.actionId"),
      reasonCode: requiredText(source.reasonCode, "pendingDecision.reasonCode"),
    },
    recovery: null,
    updatedAt: stoppedAt,
  });
}

export function markV1_9RunStateRecoveryStop(stateValue, input) {
  const state = normalizeV1_9RunState(stateValue);
  assertV1_9RunStateMutable(state);
  if (state.taskContractLock === null) throw new Error("v1_9_task_contract_lock_required");
  const source = requiredRecord(input, "run_state_recovery_input");
  assertOnlyFields(source, [
    "reasonCode",
    "checkpointId",
    "observationRefs",
    "turnJobId",
    "teacherMessageId",
    "stoppedAt",
  ], "run_state_recovery_input");
  const stoppedAt = transitionTimestamp(state, source.stoppedAt, "recovery.stoppedAt");
  const turnJobId = optionalText(source.turnJobId);
  const teacherMessageId = optionalText(source.teacherMessageId);
  if (Boolean(turnJobId) !== Boolean(teacherMessageId)) throw new Error("v1_9_recovery_turn_binding_invalid");
  return normalizeV1_9RunState({
    ...state,
    status: "paused_recovery",
    pendingDecision: null,
    recovery: {
      reasonCode: requiredText(source.reasonCode, "recovery.reasonCode"),
      checkpointId: optionalText(source.checkpointId),
      observationRefs: uniqueText(source.observationRefs),
      healthEvidenceNotBefore: stoppedAt,
      turnJobId,
      teacherMessageId,
    },
    updatedAt: stoppedAt,
  });
}

export function markV1_9RunStateContractUpgradeTermination(stateValue, input) {
  const state = normalizeV1_9RunState(stateValue);
  const source = requiredRecord(input, "contract_upgrade_termination_input");
  assertOnlyFields(
    source,
    ["reasonCode", "successorRunId", "driftedFields", "recoveryEntry", "terminatedAt"],
    "contract_upgrade_termination_input",
  );
  const termination = normalizeRunTermination({
    reasonCode: source.reasonCode,
    successorRunId: source.successorRunId,
    driftedFields: source.driftedFields ?? [],
    recoveryEntry: source.recoveryEntry,
    terminatedAt: source.terminatedAt,
  });
  if (termination.successorRunId === state.runId) {
    throw new Error("v1_9_successor_run_id_invalid");
  }
  if (state.status === "terminated_contract_upgrade") {
    if (JSON.stringify(state.termination) !== JSON.stringify(termination)) {
      throw new Error("v1_9_run_state_termination_mismatch");
    }
    return state;
  }
  if (["package_ready_for_external_acceptance", "completed"].includes(state.status)) {
    throw new Error("v1_9_run_state_termination_state_invalid");
  }
  if (Date.parse(termination.terminatedAt) < Date.parse(state.updatedAt)) {
    throw new Error("v1_9_run_state_termination_timestamp_invalid");
  }
  return normalizeV1_9RunState({
    ...state,
    status: "terminated_contract_upgrade",
    pendingDecision: null,
    recovery: null,
    termination,
    updatedAt: termination.terminatedAt,
  });
}

export function markV1_9RunStatePackageReady(stateValue, input) {
  const state = normalizeV1_9RunState(stateValue);
  assertV1_9RunStateMutable(state);
  if (state.taskContractLock === null) throw new Error("v1_9_task_contract_lock_required");
  if (state.ledger.finalDownloadCount < 1) throw new Error("v1_9_final_download_required");
  if (state.ledger.externalCodexOrchestrationCount !== 0 || state.ledger.violations.length !== 0) {
    throw new Error("v1_9_external_orchestration_violation");
  }
  const source = requiredRecord(input, "run_state_package_ready_input");
  assertOnlyFields(source, [
    "packageArtifactId", "packageArtifactVersion", "packageVersion", "packageSha256",
    "turnJobId", "teacherMessageId", "downloadedAt",
  ], "run_state_package_ready_input");
  const downloadedAt = transitionTimestamp(state, source.downloadedAt, "package.downloadedAt");
  const nextPackage = {
    packageArtifactId: requiredSafeId(source.packageArtifactId, "packageArtifactId"),
    packageArtifactVersion: requiredPositiveInteger(source.packageArtifactVersion, "packageArtifactVersion"),
    packageVersion: requiredSafeId(source.packageVersion, "packageVersion"),
    packageSha256: requiredDigest(source.packageSha256, "packageSha256"),
    turnJobId: requiredSafeId(source.turnJobId, "turnJobId"),
    teacherMessageId: requiredSafeId(source.teacherMessageId, "teacherMessageId"),
    downloadedAt,
  };
  const previous = state.packageAcceptance;
  if (previous !== null) {
    if (state.status !== "external_acceptance_repair_required" || previous.currentRepair === null ||
        nextPackage.packageArtifactVersion <= previous.packageArtifactVersion ||
        nextPackage.packageVersion === previous.packageVersion || nextPackage.packageSha256 === previous.packageSha256 ||
        nextPackage.turnJobId !== state.taskContractLock.turnJobId ||
        nextPackage.teacherMessageId !== state.taskContractLock.teacherMessageId) {
      throw new Error("v1_9_external_acceptance_package_not_revised");
    }
  } else if (!["running", "paused_recovery", "failed"].includes(state.status)) {
    throw new Error("v1_9_external_acceptance_state_invalid");
  }
  if (nextPackage.turnJobId !== state.taskContractLock.turnJobId ||
      nextPackage.teacherMessageId !== state.taskContractLock.teacherMessageId) {
    throw new Error("v1_9_external_acceptance_task_binding_mismatch");
  }
  return normalizeV1_9RunState({
    ...state,
    status: "package_ready_for_external_acceptance",
    pendingDecision: null,
    recovery: null,
    packageAcceptance: {
      ...nextPackage,
      rounds: previous?.rounds ?? [],
      currentRepair: previous?.currentRepair ?? null,
      acceptedAt: null,
    },
    updatedAt: downloadedAt,
  });
}

export function recordV1_9ExternalAcceptanceRound(stateValue, input) {
  const state = normalizeV1_9RunState(stateValue);
  assertV1_9RunStateMutable(state);
  if (state.status !== "package_ready_for_external_acceptance" || state.packageAcceptance === null) {
    throw new Error("v1_9_external_acceptance_state_invalid");
  }
  const round = normalizeExternalAcceptanceRound(input);
  const acceptance = state.packageAcceptance;
  if (round.auditRound !== acceptance.rounds.length + 1) {
    throw new Error("v1_9_external_acceptance_round_invalid");
  }
  if (round.packageArtifactId !== acceptance.packageArtifactId ||
      round.packageArtifactVersion !== acceptance.packageArtifactVersion ||
      round.packageVersion !== acceptance.packageVersion || round.packageSha256 !== acceptance.packageSha256) {
    throw new Error("v1_9_external_acceptance_package_binding_mismatch");
  }
  const expectedReviewed = acceptance.currentRepair?.openP0FindingIds ?? [];
  if (!sameTextSet(round.reviewedFindingIds, expectedReviewed)) {
    throw new Error("v1_9_external_acceptance_recheck_scope_invalid");
  }
  if (Date.parse(round.generatedAt) < Date.parse(state.updatedAt)) {
    throw new Error("v1_9_external_acceptance_timestamp_invalid");
  }
  const repairRequired = round.outcome === "repair_required";
  const currentRepair = repairRequired ? normalizeCurrentRepair({
    reportDigest: round.reportDigest,
    repairHandoffPath: round.repairHandoffPath,
    repairHandoffDigest: round.repairHandoffDigest,
    openP0FindingIds: round.openP0FindingIds,
    responsibilityLayers: round.repairFeedback.map((item) => item.responsibilityLayer),
    affectedUnits: round.affectedUnits,
    feedback: round.repairFeedback,
  }) : null;
  return normalizeV1_9RunState({
    ...state,
    status: repairRequired ? "external_acceptance_repair_required" : "completed",
    packageAcceptance: {
      ...acceptance,
      rounds: [...acceptance.rounds, round],
      currentRepair,
      acceptedAt: repairRequired ? null : round.generatedAt,
    },
    updatedAt: round.generatedAt,
  });
}

function assertV1_9RunStateMutable(state) {
  if (["terminated_contract_upgrade", "completed"].includes(state.status)) {
    throw new Error("v1_9_run_state_terminal_state_immutable");
  }
}

export function bindV1_9SkillLock(manifest, skillLock) {
  assertManifest(manifest);
  const normalized = normalizeSkillLock(skillLock);
  if (manifest.skillLock !== null) {
    if (JSON.stringify(normalizeSkillLock(manifest.skillLock)) !== JSON.stringify(normalized)) {
      throw new Error("v1_9_skill_lock_mismatch");
    }
    return structuredClone(manifest);
  }
  const next = structuredClone(manifest);
  next.skillLock = normalized;
  next.updatedAt = new Date().toISOString();
  return next;
}

export function bindV1_9ProviderLock(manifest, providerLock) {
  assertManifest(manifest);
  const normalized = normalizeProviderLock(providerLock);
  if (manifest.providerLock != null) {
    if (JSON.stringify(normalizeProviderLock(manifest.providerLock)) !== JSON.stringify(normalized)) {
      throw new Error("v1_9_provider_lock_mismatch");
    }
    return structuredClone(manifest);
  }
  const next = structuredClone(manifest);
  next.providerLock = normalized;
  next.updatedAt = new Date().toISOString();
  return next;
}

export function rotateV1_9ProviderLockForRecovery(manifest, input) {
  assertManifest(manifest);
  if (manifest.status !== "paused_recovery" || manifest.taskSubmissionCount !== 1 || deriveV1_9ExternalCodexOrchestrationCount(manifest) !== 0 || manifest.violations.length !== 0) {
    throw new Error("v1_9_provider_lock_recovery_state_invalid");
  }
  if (manifest.providerLock == null) throw new Error("v1_9_provider_lock_recovery_current_lock_missing");
  const current = normalizeProviderLock(manifest.providerLock);
  const nextLock = normalizeProviderLock(input.nextProviderLock);
  if (current.channel !== nextLock.channel || current.configDigest === nextLock.configDigest) {
    throw new Error("v1_9_provider_lock_recovery_revision_invalid");
  }
  const failureEvidenceId = requiredText(input.failureEvidenceId, "failureEvidenceId");
  const rotatedAt = requiredTimestamp(input.rotatedAt, "rotatedAt");
  const next = structuredClone(manifest);
  const history = Array.isArray(next.providerLockHistory) ? next.providerLockHistory : [];
  history.push({
    schemaVersion: "v1-9-provider-lock-history.v1",
    revision: history.length + 1,
    providerLock: current,
    failureEvidenceId,
    reasonCode: "authorization_config_repair",
    rotatedAt,
  });
  next.providerLockHistory = history;
  next.providerLock = nextLock;
  next.updatedAt = rotatedAt;
  return next;
}

export function bindV1_9TaskIdentity(manifest, identity) {
  assertManifest(manifest);
  const normalized = {
    projectId: requiredText(identity.projectId, "projectId"),
    taskId: requiredText(identity.taskId, "taskId"),
    intentEpoch: requiredNonNegativeInteger(identity.intentEpoch, "intentEpoch"),
    checkpointId: optionalText(identity.checkpointId),
  };
  assertV1_9ResumeIdentity(manifest, normalized);
  const next = structuredClone(manifest);
  Object.assign(next, normalized, { status: "running", updatedAt: new Date().toISOString() });
  return next;
}

export function bindV1_9ProjectIdentity(manifest, projectId) {
  assertManifest(manifest);
  const normalizedProjectId = requiredText(projectId, "projectId");
  if (manifest.projectId !== null && manifest.projectId !== normalizedProjectId) {
    throw new Error("v1_9_resume_identity_mismatch:projectId");
  }
  const next = structuredClone(manifest);
  next.projectId = normalizedProjectId;
  next.updatedAt = new Date().toISOString();
  return next;
}

export function updateV1_9Checkpoint(manifest, checkpointId) {
  assertManifest(manifest);
  const next = structuredClone(manifest);
  next.checkpointId = optionalText(checkpointId);
  next.updatedAt = new Date().toISOString();
  return next;
}

export function markV1_9PendingDecision(manifest, decision) {
  assertManifest(manifest);
  const kind = requiredText(decision.kind, "pendingDecision.kind");
  if (!pendingDecisionKinds.has(kind)) throw new Error("v1_9_pending_decision_kind_invalid");
  const next = structuredClone(manifest);
  next.status = "paused_pending_decision";
  next.pendingDecision = {
    kind,
    actionId: requiredText(decision.actionId, "pendingDecision.actionId"),
    reasonCode: requiredText(decision.reasonCode, "pendingDecision.reasonCode"),
  };
  next.updatedAt = new Date().toISOString();
  return next;
}

export function markV1_9RecoveryStop(manifest, recovery) {
  assertManifest(manifest);
  const stoppedAt = new Date().toISOString();
  const turnJobId = optionalText(recovery.turnJobId);
  const teacherMessageId = optionalText(recovery.teacherMessageId);
  if (Boolean(turnJobId) !== Boolean(teacherMessageId)) throw new Error("v1_9_recovery_turn_binding_invalid");
  const next = structuredClone(manifest);
  next.status = "paused_recovery";
  next.recovery = {
    reasonCode: requiredText(recovery.reasonCode, "recovery.reasonCode"),
    checkpointId: optionalText(recovery.checkpointId),
    observationRefs: uniqueText(recovery.observationRefs),
    healthEvidenceNotBefore: stoppedAt,
    turnJobId,
    teacherMessageId,
  };
  next.updatedAt = stoppedAt;
  return next;
}

export function markV1_9Completed(manifest) {
  assertManifest(manifest);
  if (manifest.finalDownloadCount < 1) throw new Error("v1_9_final_download_required");
  if (deriveV1_9ExternalCodexOrchestrationCount(manifest) !== 0) {
    throw new Error("v1_9_external_orchestration_violation");
  }
  const next = structuredClone(manifest);
  next.status = "completed";
  next.pendingDecision = null;
  next.recovery = null;
  next.updatedAt = new Date().toISOString();
  return next;
}

export function deriveV1_9ExternalCodexOrchestrationCount(manifest) {
  assertManifest(manifest);
  return manifest.violations.filter((item) => item?.orchestrationImpact !== false).length;
}

export function deriveV1_9RecoveryObservationRefs(snapshot, checkpointObservationRefs) {
  const checkpointRefs = optionalUniqueText(checkpointObservationRefs);
  if (checkpointRefs.length > 0) return checkpointRefs;
  if (!snapshot || !Array.isArray(snapshot.messages)) return [];
  return [...new Set(snapshot.messages.flatMap((message) => {
    const observations = message?.metadata?.agentObservations;
    if (!Array.isArray(observations)) return [];
    return observations.flatMap((observation) => {
      const observationId = typeof observation?.observationId === "string" ? observation.observationId.trim() : "";
      return observationId ? [observationId] : [];
    });
  }))];
}

export function deriveV1_9RecoveryStop(snapshot, checkpoint) {
  const failedTurn = [...(Array.isArray(snapshot?.turnJobs) ? snapshot.turnJobs : [])]
    .reverse()
    .find((job) => job?.status === "failed" || job?.status === "blocked");
  const explicitJobReason = typeof failedTurn?.errorCode === "string" && failedTurn.errorCode.trim() &&
    failedTurn.errorCode !== "turn_failed"
    ? failedTurn.errorCode.trim()
    : null;
  if (explicitJobReason) {
    const turnJobId = optionalText(failedTurn?.id);
    const teacherMessageId = optionalText(failedTurn?.teacherMessageId);
    return {
      reasonCode: explicitJobReason,
      checkpointId: checkpoint.checkpointId,
      observationRefs: deriveV1_9RecoveryObservationRefs(snapshot, []),
      ...(turnJobId && teacherMessageId ? { turnJobId, teacherMessageId } : {}),
    };
  }
  if (checkpoint.status === "paused" || checkpoint.status === "failed") {
    return {
      reasonCode: checkpoint.reasonCode ?? "agent_checkpoint_stopped",
      checkpointId: checkpoint.checkpointId,
      observationRefs: deriveV1_9RecoveryObservationRefs(snapshot, checkpoint.observationRefs),
    };
  }
  if (!failedTurn) return null;
  const turnJobId = optionalText(failedTurn?.id);
  const teacherMessageId = optionalText(failedTurn?.teacherMessageId);
  return {
    reasonCode: failedTurn.errorCode ?? "conversation_turn_stopped",
    checkpointId: checkpoint.checkpointId,
    observationRefs: deriveV1_9RecoveryObservationRefs(snapshot, []),
    ...(turnJobId && teacherMessageId ? { turnJobId, teacherMessageId } : {}),
  };
}

export function assertV1_9ResumeIdentity(manifest, expected) {
  assertManifest(manifest);
  for (const field of ["runId", "projectId", "taskId", "intentEpoch"]) {
    const actual = manifest[field];
    const wanted = expected[field];
    if (actual !== null && wanted !== undefined && actual !== wanted) {
      throw new Error(`v1_9_resume_identity_mismatch:${field}`);
    }
  }
  return structuredClone(manifest);
}

export function recordV1_9UiMutation(manifest, mutation) {
  assertManifest(manifest);
  const method = requiredText(mutation.method, "mutation.method").toUpperCase();
  const pathname = normalizePathname(mutation.pathname);
  const source = requiredText(mutation.source, "mutation.source");
  const recorded = { method, pathname, source };
  const next = structuredClone(manifest);
  next.mutations.push(recorded);

  const allowed = classifyAllowedMutation(next, recorded);
  if (allowed.kind === "task_submission") next.taskSubmissionCount += 1;
  if (allowed.kind === "final_download") next.finalDownloadCount += 1;
  if (!allowed.allowed) {
    next.violations.push({
      reasonCode: allowed.reasonCode,
      method,
      pathname,
      source,
      orchestrationImpact: true,
    });
  }
  next.externalCodexOrchestrationCount = deriveV1_9ExternalCodexOrchestrationCount(next);
  next.updatedAt = new Date().toISOString();
  return next;
}

function classifyAllowedMutation(manifest, mutation) {
  if (mutation.source !== "ui") {
    return { allowed: false, reasonCode: "runner_mutation_not_allowed" };
  }
  if (mutation.method === "POST" && /^\/api\/auth\/(?:csrf|login|logout)$/.test(mutation.pathname)) {
    return { allowed: true, kind: "auth" };
  }
  if (mutation.method === "POST" && mutation.pathname === "/api/workbench/projects") {
    const previousCreates = manifest.mutations.filter((item) =>
      item !== mutation && item.method === "POST" && item.pathname === "/api/workbench/projects"
    ).length;
    return previousCreates === 0
      ? { allowed: true, kind: "project_create" }
      : { allowed: false, reasonCode: "runner_duplicate_project_create" };
  }
  if (mutation.method === "POST" && /^\/api\/workbench\/projects\/[^/]+\/messages$/.test(mutation.pathname)) {
    return manifest.taskSubmissionCount === 0
      ? { allowed: true, kind: "task_submission" }
      : { allowed: false, reasonCode: "runner_duplicate_task_submission" };
  }
  if (mutation.method === "GET" && /^\/api\/workbench\/projects\/[^/]+\/artifacts\/[^/]+\/package$/.test(mutation.pathname)) {
    return { allowed: true, kind: "final_download" };
  }
  return { allowed: false, reasonCode: "runner_mutation_not_allowed" };
}

function assertManifest(value) {
  if (!value || value.schemaVersion !== V1_9_RUN_MANIFEST_VERSION) {
    throw new Error("v1_9_run_manifest_invalid");
  }
  requiredText(value.runId, "runId");
  normalizeRelativeRunRoot(value.relativeRunRoot);
  if (!/^[a-f0-9]{64}$/.test(value.promptDigest)) throw new Error("v1_9_run_manifest_prompt_digest_invalid");
  if (!Array.isArray(value.mutations) || !Array.isArray(value.violations)) {
    throw new Error("v1_9_run_manifest_ledger_invalid");
  }
  requiredNonNegativeInteger(value.taskSubmissionCount, "taskSubmissionCount");
  requiredNonNegativeInteger(value.finalDownloadCount ?? 0, "finalDownloadCount");
  if (value.skillLock !== null) normalizeSkillLock(value.skillLock);
  if (value.providerLock != null) normalizeProviderLock(value.providerLock);
  if (value.providerLockHistory != null && !Array.isArray(value.providerLockHistory)) throw new Error("v1_9_provider_lock_history_invalid");
  if (value.recovery != null) normalizeRecovery(value.recovery);
}

function normalizeRecovery(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("v1_9_recovery_invalid");
  requiredText(value.reasonCode, "recovery.reasonCode");
  optionalText(value.checkpointId);
  optionalUniqueText(value.observationRefs);
  if (value.healthEvidenceNotBefore !== undefined) requiredTimestamp(value.healthEvidenceNotBefore, "recovery.healthEvidenceNotBefore");
  const turnJobId = value.turnJobId === undefined ? null : optionalText(value.turnJobId);
  const teacherMessageId = value.teacherMessageId === undefined ? null : optionalText(value.teacherMessageId);
  if (Boolean(turnJobId) !== Boolean(teacherMessageId)) throw new Error("v1_9_recovery_turn_binding_invalid");
}

function normalizeProviderLock(value) {
  if (!value || value.schemaVersion !== "v1-9-provider-lock.v1") {
    throw new Error("v1_9_provider_lock_invalid");
  }
  const channel = requiredText(value.channel, "providerLock.channel");
  if (!["primary", "third", "fallback"].includes(channel)) throw new Error("v1_9_provider_lock_channel_invalid");
  const endpointCategory = requiredText(value.endpointCategory, "providerLock.endpointCategory");
  if (endpointCategory !== "openai_compatible_responses") throw new Error("v1_9_provider_lock_endpoint_invalid");
  const reasoningEffort = requiredText(value.reasoningEffort, "providerLock.reasoningEffort");
  if (!["low", "medium", "high", "xhigh"].includes(reasoningEffort)) throw new Error("v1_9_provider_lock_reasoning_invalid");
  const credentialSource = requiredText(value.credentialSource, "providerLock.credentialSource");
  if (!["ledger_private_env", "deployment_secret"].includes(credentialSource)) throw new Error("v1_9_provider_lock_credential_source_invalid");
  return {
    schemaVersion: "v1-9-provider-lock.v1",
    channel,
    model: requiredText(value.model, "providerLock.model"),
    endpointCategory,
    reasoningEffort,
    credentialSource,
    configDigest: requiredDigest(value.configDigest, "providerLock.configDigest"),
  };
}

function normalizeSkillLock(value) {
  if (!value || value.schemaVersion !== "v1-9-skill-lock.v1") {
    throw new Error("v1_9_skill_lock_invalid");
  }
  const projectionLockDigest = requiredDigest(value.projectionLockDigest, "skillLock.projectionLockDigest");
  const bindingPolicyDigest = requiredDigest(value.bindingPolicyDigest, "skillLock.bindingPolicyDigest");
  if (!Array.isArray(value.activeSkills) || value.activeSkills.length === 0) {
    throw new Error("v1_9_skill_lock_active_skills_invalid");
  }
  const activeSkills = value.activeSkills.map((entry) => {
    const name = requiredText(entry?.name, "skillLock.activeSkill.name");
    const version = requiredText(entry?.version, "skillLock.activeSkill.version");
    if (!/^shanhai-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || !/^\d+\.\d+$/.test(version)) {
      throw new Error("v1_9_skill_lock_active_skill_invalid");
    }
    return { name, version };
  }).sort((left, right) => left.name.localeCompare(right.name));
  if (new Set(activeSkills.map((skill) => skill.name)).size !== activeSkills.length) {
    throw new Error("v1_9_skill_lock_active_skills_duplicate");
  }
  return {
    schemaVersion: "v1-9-skill-lock.v1",
    projectionLockDigest,
    bindingPolicyDigest,
    activeSkills,
  };
}

function normalizeSkillLockStrict(value) {
  const lock = requiredRecord(value, "skill_lock");
  assertOnlyFields(lock, ["schemaVersion", "projectionLockDigest", "bindingPolicyDigest", "activeSkills"], "skill_lock");
  if (!Array.isArray(lock.activeSkills)) throw new Error("v1_9_skill_lock_active_skills_invalid");
  for (const entryValue of lock.activeSkills) {
    const entry = requiredRecord(entryValue, "skill_lock_active_skill");
    assertOnlyFields(entry, ["name", "version"], "skill_lock_active_skill");
  }
  return normalizeSkillLock(lock);
}

function normalizeAgentBrain(value) {
  const agentBrain = requiredRecord(value, "agent_brain");
  assertOnlyFields(agentBrain, ["providerLock"], "agent_brain");
  return { providerLock: normalizeProviderLockStrict(agentBrain.providerLock) };
}

function normalizeProviderLockStrict(value) {
  const lock = requiredRecord(value, "provider_lock");
  assertOnlyFields(lock, [
    "schemaVersion",
    "channel",
    "model",
    "endpointCategory",
    "reasoningEffort",
    "credentialSource",
    "configDigest",
  ], "provider_lock");
  return normalizeProviderLock(lock);
}

function normalizeProviderRuntimeLocks(value) {
  if (!Array.isArray(value)) throw new Error("v1_9_provider_runtime_locks_invalid");
  const locks = value.map((entryValue) => {
    const entry = requiredRecord(entryValue, "provider_runtime_lock");
    assertOnlyFields(entry, ["capability", "credentialSource", "configDigest"], "provider_runtime_lock");
    const capability = requiredText(entry.capability, "providerRuntimeLock.capability");
    if (!providerRuntimeCapabilities.has(capability)) {
      throw new Error("v1_9_provider_runtime_capability_invalid");
    }
    const credentialSource = requiredText(entry.credentialSource, "providerRuntimeLock.credentialSource");
    if (!providerCredentialSources.has(credentialSource)) {
      throw new Error("v1_9_provider_runtime_credential_source_invalid");
    }
    return {
      capability,
      credentialSource,
      configDigest: requiredDigest(entry.configDigest, `providerRuntimeLocks.${capability}.configDigest`),
    };
  }).sort((left, right) => left.capability.localeCompare(right.capability));
  if (new Set(locks.map((lock) => lock.capability)).size !== locks.length) {
    throw new Error("v1_9_provider_runtime_capability_duplicate");
  }
  for (const capability of requiredProviderRuntimeCapabilities) {
    if (!locks.some((lock) => lock.capability === capability)) {
      throw new Error(`v1_9_provider_runtime_capability_missing:${capability}`);
    }
  }
  return locks;
}

function normalizePredecessor(value) {
  if (value === null) return null;
  const predecessor = requiredRecord(value, "predecessor");
  assertOnlyFields(predecessor, ["runId", "relativeRunRoot", "manifestSha256", "disposition"], "predecessor");
  const runId = requiredRunId(predecessor.runId, "predecessor.runId");
  const relativeRunRoot = normalizeRelativeRunRoot(predecessor.relativeRunRoot);
  assertRunRootMatchesRunId(relativeRunRoot, runId, "predecessor_run_root");
  const disposition = requiredText(predecessor.disposition, "predecessor.disposition");
  if (!predecessorDispositions.has(disposition)) throw new Error("v1_9_predecessor_disposition_invalid");
  return {
    runId,
    relativeRunRoot,
    manifestSha256: requiredDigest(predecessor.manifestSha256, "predecessor.manifestSha256"),
    disposition,
  };
}

function normalizeRunIdentity(value) {
  const identity = requiredRecord(value, "run_identity");
  assertOnlyFields(identity, ["actorUserId", "projectId", "taskId", "intentEpoch"], "run_identity");
  const actorIsNull = identity.actorUserId === null;
  const projectIsNull = identity.projectId === null;
  const taskIsNull = identity.taskId === null;
  const epochIsNull = identity.intentEpoch === null;
  if (actorIsNull !== projectIsNull || taskIsNull !== epochIsNull || (actorIsNull && !taskIsNull)) {
    throw new Error("v1_9_run_identity_partial");
  }
  if (actorIsNull) {
    return { actorUserId: null, projectId: null, taskId: null, intentEpoch: null };
  }
  const base = {
    actorUserId: requiredSafeId(identity.actorUserId, "actorUserId"),
    projectId: requiredSafeId(identity.projectId, "projectId"),
  };
  if (taskIsNull) return { ...base, taskId: null, intentEpoch: null };
  return {
    ...base,
    taskId: requiredSafeId(identity.taskId, "taskId"),
    intentEpoch: requiredNonNegativeInteger(identity.intentEpoch, "intentEpoch"),
  };
}

function normalizeRunCheckpoint(value) {
  const checkpoint = requiredRecord(value, "run_checkpoint");
  assertOnlyFields(
    checkpoint,
    ["checkpointId", "planRevision", "observationRefs", "recordedAt"],
    "run_checkpoint",
  );
  return {
    checkpointId: requiredSafeId(checkpoint.checkpointId, "checkpointId"),
    planRevision: requiredNonNegativeInteger(checkpoint.planRevision, "checkpoint.planRevision"),
    observationRefs: uniqueText(checkpoint.observationRefs),
    recordedAt: requiredTimestamp(checkpoint.recordedAt, "checkpoint.recordedAt"),
  };
}

function normalizeRunPendingDecision(value) {
  const decision = requiredRecord(value, "run_pending_decision");
  assertOnlyFields(decision, ["kind", "actionId", "reasonCode"], "run_pending_decision");
  const kind = requiredText(decision.kind, "pendingDecision.kind");
  if (!pendingDecisionKinds.has(kind)) throw new Error("v1_9_pending_decision_kind_invalid");
  return {
    kind,
    actionId: requiredText(decision.actionId, "pendingDecision.actionId"),
    reasonCode: requiredText(decision.reasonCode, "pendingDecision.reasonCode"),
  };
}

function normalizeRunRecovery(value) {
  const recovery = requiredRecord(value, "run_recovery");
  assertOnlyFields(recovery, [
    "reasonCode",
    "checkpointId",
    "observationRefs",
    "healthEvidenceNotBefore",
    "turnJobId",
    "teacherMessageId",
  ], "run_recovery");
  const turnJobId = optionalText(recovery.turnJobId);
  const teacherMessageId = optionalText(recovery.teacherMessageId);
  if (Boolean(turnJobId) !== Boolean(teacherMessageId)) throw new Error("v1_9_recovery_turn_binding_invalid");
  return {
    reasonCode: requiredText(recovery.reasonCode, "recovery.reasonCode"),
    checkpointId: optionalText(recovery.checkpointId),
    observationRefs: uniqueText(recovery.observationRefs),
    healthEvidenceNotBefore: requiredTimestamp(
      recovery.healthEvidenceNotBefore,
      "recovery.healthEvidenceNotBefore",
    ),
    turnJobId,
    teacherMessageId,
  };
}

function normalizeRunTermination(value) {
  const termination = requiredRecord(value, "run_termination");
  assertOnlyFields(
    termination,
    ["reasonCode", "successorRunId", "driftedFields", "recoveryEntry", "terminatedAt"],
    "run_termination",
  );
  const successorRunId = requiredRunId(termination.successorRunId, "termination.successorRunId");
  const recoveryEntry = requiredText(termination.recoveryEntry, "termination.recoveryEntry")
    .replaceAll("\\", "/");
  if (recoveryEntry !== `test-results/${successorRunId}/run-state.json`) {
    throw new Error("v1_9_run_state_termination_recovery_entry_invalid");
  }
  return {
    reasonCode: requiredSafeId(termination.reasonCode, "termination.reasonCode"),
    successorRunId,
    driftedFields: uniqueText(termination.driftedFields),
    recoveryEntry,
    terminatedAt: requiredTimestamp(termination.terminatedAt, "termination.terminatedAt"),
  };
}

function normalizePackageAcceptance(value) {
  const acceptance = requiredRecord(value, "package_acceptance");
  assertOnlyFields(acceptance, [
    "packageArtifactId",
    "packageArtifactVersion",
    "packageVersion",
    "packageSha256",
    "turnJobId",
    "teacherMessageId",
    "downloadedAt",
    "rounds",
    "currentRepair",
    "acceptedAt",
  ], "package_acceptance");
  if (!Array.isArray(acceptance.rounds)) throw new Error("v1_9_external_acceptance_rounds_invalid");
  const rounds = acceptance.rounds.map((round, index) => {
    const normalized = normalizeExternalAcceptanceRound(round);
    if (normalized.auditRound !== index + 1) throw new Error("v1_9_external_acceptance_round_invalid");
    return normalized;
  });
  const currentRepair = acceptance.currentRepair === null ? null : normalizeCurrentRepair(acceptance.currentRepair);
  const acceptedAt = acceptance.acceptedAt === null
    ? null
    : requiredTimestamp(acceptance.acceptedAt, "externalAcceptance.acceptedAt");
  const downloadedAt = requiredTimestamp(acceptance.downloadedAt, "package.downloadedAt");
  if (acceptedAt !== null && Date.parse(acceptedAt) < Date.parse(downloadedAt)) {
    throw new Error("v1_9_external_acceptance_timestamp_invalid");
  }
  const latestRound = rounds.at(-1);
  if (currentRepair !== null) {
    const expectedRepair = latestRound?.outcome === "repair_required"
      ? {
          reportDigest: latestRound.reportDigest,
          repairHandoffPath: latestRound.repairHandoffPath,
          repairHandoffDigest: latestRound.repairHandoffDigest,
          openP0FindingIds: latestRound.openP0FindingIds,
          responsibilityLayers: [...new Set(
            latestRound.repairFeedback.map((item) => item.responsibilityLayer),
          )].sort(),
          affectedUnits: latestRound.affectedUnits,
          feedback: latestRound.repairFeedback,
        }
      : null;
    if (expectedRepair === null || JSON.stringify(currentRepair) !== JSON.stringify(expectedRepair)) {
      throw new Error("v1_9_external_acceptance_repair_state_invalid");
    }
  }
  if (acceptedAt !== null && (latestRound?.outcome !== "accepted" || latestRound.generatedAt !== acceptedAt)) {
    throw new Error("v1_9_external_acceptance_completion_mismatch");
  }
  return {
    packageArtifactId: requiredSafeId(acceptance.packageArtifactId, "packageArtifactId"),
    packageArtifactVersion: requiredPositiveInteger(acceptance.packageArtifactVersion, "packageArtifactVersion"),
    packageVersion: requiredSafeId(acceptance.packageVersion, "packageVersion"),
    packageSha256: requiredDigest(acceptance.packageSha256, "packageSha256"),
    turnJobId: requiredSafeId(acceptance.turnJobId, "turnJobId"),
    teacherMessageId: requiredSafeId(acceptance.teacherMessageId, "teacherMessageId"),
    downloadedAt,
    rounds,
    currentRepair,
    acceptedAt,
  };
}

function packageAcceptanceMatchesLatestRound(acceptance) {
  const latestRound = acceptance?.rounds.at(-1);
  return Boolean(latestRound) &&
    acceptance.packageArtifactId === latestRound.packageArtifactId &&
    acceptance.packageArtifactVersion === latestRound.packageArtifactVersion &&
    acceptance.packageVersion === latestRound.packageVersion &&
    acceptance.packageSha256 === latestRound.packageSha256;
}

function normalizeExternalAcceptanceRound(value) {
  const round = requiredRecord(value, "external_acceptance_round");
  assertOnlyFields(round, [
    "auditRound", "reportId", "reportPath", "reportDigest", "packageArtifactId",
    "packageArtifactVersion", "packageVersion", "packageSha256", "outcome",
    "reviewedFindingIds", "openP0FindingIds", "affectedUnits", "repairFeedback",
    "repairHandoffPath", "repairHandoffDigest", "generatedAt",
  ], "external_acceptance_round");
  const auditRound = requiredPositiveInteger(round.auditRound, "auditRound");
  const outcome = requiredText(round.outcome, "externalAcceptance.outcome");
  if (!['repair_required', 'accepted'].includes(outcome)) throw new Error("v1_9_external_acceptance_outcome_invalid");
  const reviewedFindingIds = requiredSafeIdArray(round.reviewedFindingIds, "reviewedFindingIds");
  const openP0FindingIds = requiredSafeIdArray(round.openP0FindingIds, "openP0FindingIds");
  const affectedUnits = normalizeExternalAuditAffectedUnits(round.affectedUnits);
  const repairFeedback = normalizeExternalAuditRepairFeedback(round.repairFeedback);
  const repairHandoffPath = round.repairHandoffPath === null
    ? null : requiredAuditRoundPath(round.repairHandoffPath, auditRound, "repair-handoff.json");
  const repairHandoffDigest = round.repairHandoffDigest === null
    ? null : requiredDigest(round.repairHandoffDigest, "repairHandoffDigest");
  if (outcome === "repair_required") {
    if (openP0FindingIds.length === 0 || affectedUnits.length === 0 ||
        repairHandoffPath === null || repairHandoffDigest === null ||
        !sameTextSet(openP0FindingIds, repairFeedback.map((item) => item.findingId))) {
      throw new Error("v1_9_external_acceptance_repair_state_invalid");
    }
  } else if (openP0FindingIds.length !== 0 || affectedUnits.length !== 0 || repairFeedback.length !== 0 ||
      repairHandoffPath !== null || repairHandoffDigest !== null) {
    throw new Error("v1_9_external_acceptance_completion_mismatch");
  }
  return {
    auditRound,
    reportId: requiredSafeId(round.reportId, "reportId"),
    reportPath: requiredAuditRoundPath(round.reportPath, auditRound, "report.json"),
    reportDigest: requiredDigest(round.reportDigest, "reportDigest"),
    packageArtifactId: requiredSafeId(round.packageArtifactId, "packageArtifactId"),
    packageArtifactVersion: requiredPositiveInteger(round.packageArtifactVersion, "packageArtifactVersion"),
    packageVersion: requiredSafeId(round.packageVersion, "packageVersion"),
    packageSha256: requiredDigest(round.packageSha256, "packageSha256"),
    outcome,
    reviewedFindingIds,
    openP0FindingIds,
    affectedUnits,
    repairFeedback,
    repairHandoffPath,
    repairHandoffDigest,
    generatedAt: requiredTimestamp(round.generatedAt, "externalAcceptance.generatedAt"),
  };
}

function normalizeCurrentRepair(value) {
  const repair = requiredRecord(value, "external_acceptance_current_repair");
  assertOnlyFields(repair, [
    "reportDigest", "repairHandoffPath", "repairHandoffDigest", "openP0FindingIds",
    "responsibilityLayers", "affectedUnits", "feedback",
  ], "external_acceptance_current_repair");
  const openP0FindingIds = requiredSafeIdArray(repair.openP0FindingIds, "openP0FindingIds");
  const feedback = normalizeExternalAuditRepairFeedback(repair.feedback);
  if (openP0FindingIds.length === 0 || !sameTextSet(openP0FindingIds, feedback.map((item) => item.findingId))) {
    throw new Error("v1_9_external_acceptance_repair_state_invalid");
  }
  return {
    reportDigest: requiredDigest(repair.reportDigest, "reportDigest"),
    repairHandoffPath: requiredText(repair.repairHandoffPath, "repairHandoffPath").replaceAll("\\", "/"),
    repairHandoffDigest: requiredDigest(repair.repairHandoffDigest, "repairHandoffDigest"),
    openP0FindingIds,
    responsibilityLayers: requiredSafeIdArray(repair.responsibilityLayers, "responsibilityLayers"),
    affectedUnits: normalizeExternalAuditAffectedUnits(repair.affectedUnits),
    feedback,
  };
}

function normalizeExternalAuditAffectedUnits(value) {
  if (!Array.isArray(value)) throw new Error("v1_9_external_acceptance_affected_units_invalid");
  return value.map((unitValue) => {
    const unit = requiredRecord(unitValue, "external_acceptance_affected_unit");
    assertOnlyFields(unit, [
      "unitId", "kind", "artifactRole", "artifactId", "artifactVersion",
      "pageNumber", "shotId", "packageEntry",
    ], "external_acceptance_affected_unit");
    const kind = requiredText(unit.kind, "affectedUnit.kind");
    if (!['page', 'shot', 'package_entry', 'artifact_version'].includes(kind)) {
      throw new Error("v1_9_external_acceptance_affected_unit_invalid");
    }
    return {
      unitId: requiredSafeId(unit.unitId, "affectedUnit.unitId"),
      kind,
      artifactRole: requiredSafeId(unit.artifactRole, "affectedUnit.artifactRole"),
      artifactId: requiredSafeId(unit.artifactId, "affectedUnit.artifactId"),
      artifactVersion: requiredSafeId(unit.artifactVersion, "affectedUnit.artifactVersion"),
      pageNumber: unit.pageNumber === null ? null : requiredPositiveInteger(unit.pageNumber, "affectedUnit.pageNumber"),
      shotId: unit.shotId === null ? null : requiredSafeId(unit.shotId, "affectedUnit.shotId"),
      packageEntry: unit.packageEntry === null ? null : requiredText(unit.packageEntry, "affectedUnit.packageEntry").replaceAll("\\", "/"),
    };
  }).sort((left, right) => left.unitId.localeCompare(right.unitId));
}

function normalizeExternalAuditRepairFeedback(value) {
  if (!Array.isArray(value)) throw new Error("v1_9_external_acceptance_feedback_invalid");
  return value.map((feedbackValue) => {
    const feedback = requiredRecord(feedbackValue, "external_acceptance_feedback");
    assertOnlyFields(feedback, [
      "findingId", "responsibilityLayer", "category", "design", "vulnerability", "engineering",
    ], "external_acceptance_feedback");
    const design = optionalText(feedback.design);
    const vulnerability = optionalText(feedback.vulnerability);
    if (design === null && vulnerability === null) throw new Error("v1_9_external_acceptance_feedback_invalid");
    return {
      findingId: requiredSafeId(feedback.findingId, "feedback.findingId"),
      responsibilityLayer: requiredSafeId(feedback.responsibilityLayer, "feedback.responsibilityLayer"),
      category: requiredSafeId(feedback.category, "feedback.category"),
      design,
      vulnerability,
      engineering: requiredText(feedback.engineering, "feedback.engineering"),
    };
  }).sort((left, right) => left.findingId.localeCompare(right.findingId));
}

function normalizeTaskContractLock(value) {
  const lock = requiredRecord(value, "task_contract_lock");
  assertOnlyFields(lock, [
    "schemaVersion",
    "actorAuthMode",
    "teacherMessageId",
    "turnJobId",
    "taskBriefDigest",
    "intentEpoch",
    "intensity",
    "intentGrantDigest",
    "budgetDigest",
    "initialPlanRevision",
  ], "task_contract_lock");
  if (lock.schemaVersion !== V1_9_TASK_CONTRACT_LOCK_VERSION) {
    throw new Error("v1_9_task_contract_lock_version_invalid");
  }
  const intensity = requiredText(lock.intensity, "taskContract.intensity");
  if (!generationIntensities.has(intensity)) throw new Error("v1_9_task_contract_intensity_invalid");
  return {
    schemaVersion: V1_9_TASK_CONTRACT_LOCK_VERSION,
    actorAuthMode: requiredAuthMode(lock.actorAuthMode),
    teacherMessageId: requiredSafeId(lock.teacherMessageId, "taskContract.teacherMessageId"),
    turnJobId: requiredSafeId(lock.turnJobId, "taskContract.turnJobId"),
    taskBriefDigest: requiredDigest(lock.taskBriefDigest, "taskContract.taskBriefDigest"),
    intentEpoch: requiredNonNegativeInteger(lock.intentEpoch, "intentEpoch"),
    intensity,
    intentGrantDigest: requiredDigest(lock.intentGrantDigest, "taskContract.intentGrantDigest"),
    budgetDigest: requiredDigest(lock.budgetDigest, "taskContract.budgetDigest"),
    initialPlanRevision: requiredNonNegativeInteger(lock.initialPlanRevision, "initialPlanRevision"),
  };
}

function normalizeRunLedger(value, taskContractLock) {
  const ledger = requiredRecord(value, "run_ledger");
  assertOnlyFields(ledger, [
    "schemaVersion",
    "currentPlanRevision",
    "planRevisionHistory",
    "taskSubmissionCount",
    "finalDownloadCount",
    "externalCodexOrchestrationCount",
    "mutations",
    "violations",
  ], "run_ledger");
  if (ledger.schemaVersion !== V1_9_RUN_LEDGER_VERSION) throw new Error("v1_9_run_ledger_version_invalid");
  const currentPlanRevision = ledger.currentPlanRevision === null
    ? null
    : requiredNonNegativeInteger(ledger.currentPlanRevision, "currentPlanRevision");
  const planRevisionHistory = normalizePlanRevisionHistory(ledger.planRevisionHistory);
  if (currentPlanRevision === null && planRevisionHistory.length !== 0) {
    throw new Error("v1_9_plan_revision_history_invalid");
  }
  if (currentPlanRevision !== null && (
    planRevisionHistory.length === 0 ||
    planRevisionHistory.at(-1).revision !== currentPlanRevision
  )) {
    throw new Error("v1_9_plan_revision_history_invalid");
  }
  if (taskContractLock && (
    currentPlanRevision === null ||
    currentPlanRevision < taskContractLock.initialPlanRevision ||
    planRevisionHistory[0]?.revision !== taskContractLock.initialPlanRevision
  )) {
    throw new Error("v1_9_plan_revision_contract_mismatch");
  }
  const mutations = normalizeRunLedgerEntries(ledger.mutations, false);
  const violations = normalizeRunLedgerEntries(ledger.violations, true);
  const externalCodexOrchestrationCount = requiredNonNegativeInteger(
    ledger.externalCodexOrchestrationCount,
    "externalCodexOrchestrationCount",
  );
  if (externalCodexOrchestrationCount !== violations.filter((entry) => entry.orchestrationImpact).length) {
    throw new Error("v1_9_external_orchestration_count_mismatch");
  }
  return {
    schemaVersion: V1_9_RUN_LEDGER_VERSION,
    currentPlanRevision,
    planRevisionHistory,
    taskSubmissionCount: requiredNonNegativeInteger(ledger.taskSubmissionCount, "taskSubmissionCount"),
    finalDownloadCount: requiredNonNegativeInteger(ledger.finalDownloadCount, "finalDownloadCount"),
    externalCodexOrchestrationCount,
    mutations,
    violations,
  };
}

function normalizePlanRevisionHistory(value) {
  if (!Array.isArray(value)) throw new Error("v1_9_plan_revision_history_invalid");
  let previousRevision = -1;
  let previousTimestamp = -Infinity;
  return value.map((entryValue) => {
    const entry = requiredRecord(entryValue, "plan_revision_history_entry");
    assertOnlyFields(entry, ["revision", "recordedAt"], "plan_revision_history_entry");
    const revision = requiredNonNegativeInteger(entry.revision, "planRevisionHistory.revision");
    const recordedAt = requiredTimestamp(entry.recordedAt, "planRevisionHistory.recordedAt");
    if (revision <= previousRevision || Date.parse(recordedAt) < previousTimestamp) {
      throw new Error("v1_9_plan_revision_history_not_monotonic");
    }
    previousRevision = revision;
    previousTimestamp = Date.parse(recordedAt);
    return { revision, recordedAt };
  });
}

function normalizeRunLedgerEntries(value, violation) {
  if (!Array.isArray(value)) throw new Error("v1_9_run_ledger_entries_invalid");
  return value.map((entryValue) => {
    const entry = requiredRecord(entryValue, violation ? "run_violation" : "run_mutation");
    const fields = violation
      ? ["method", "pathname", "source", "reasonCode", "orchestrationImpact"]
      : ["method", "pathname", "source"];
    assertOnlyFields(entry, fields, violation ? "run_violation" : "run_mutation");
    const method = requiredText(entry.method, "ledger.method").toUpperCase();
    if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      throw new Error("v1_9_run_ledger_method_invalid");
    }
    const source = requiredText(entry.source, "ledger.source");
    if (!["ui", "runner"].includes(source)) throw new Error("v1_9_run_ledger_source_invalid");
    const normalized = {
      method,
      pathname: requiredApiPath(entry.pathname),
      source,
    };
    if (!violation) return normalized;
    if (typeof entry.orchestrationImpact !== "boolean") {
      throw new Error("v1_9_run_violation_orchestration_impact_invalid");
    }
    return {
      ...normalized,
      reasonCode: requiredText(entry.reasonCode, "violation.reasonCode"),
      orchestrationImpact: entry.orchestrationImpact,
    };
  });
}

function requiredRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`v1_9_${label}_invalid`);
  }
  return value;
}

function assertOnlyFields(value, allowedFields, label) {
  const allowed = new Set(allowedFields);
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) throw new Error(`v1_9_${label}_unknown_field:${field}`);
  }
}

function requiredRunId(value, field) {
  const normalized = requiredText(value, field);
  if (!/^v1-9-[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(normalized)) {
    throw new Error(`v1_9_${field}_invalid`);
  }
  return normalized;
}

function requiredSafeId(value, field) {
  const normalized = requiredText(value, field);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(normalized)) {
    throw new Error(`v1_9_${field}_invalid`);
  }
  return normalized;
}

function requiredGitCommit(value, field) {
  const normalized = requiredText(value, field).toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(normalized)) throw new Error(`v1_9_${field}_invalid`);
  return normalized;
}

function requiredApiPath(value) {
  const normalized = requiredText(value, "ledger.pathname");
  if (!normalized.startsWith("/api/") || normalized.includes("?") || normalized.includes("#") ||
      normalized.includes("\\") || normalized.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new Error("v1_9_run_ledger_path_invalid");
  }
  return normalized;
}

function assertRunRootMatchesRunId(relativeRunRoot, runId, label) {
  if (relativeRunRoot !== `test-results/${runId}`) throw new Error(`v1_9_${label}_mismatch`);
}

function requiredDigest(value, field) {
  const normalized = requiredText(value, field).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`v1_9_${field}_invalid`);
  return normalized;
}

function normalizeRelativeRunRoot(value) {
  const normalized = requiredText(value, "relativeRunRoot").replaceAll("\\", "/");
  if (!/^test-results\/v1-9-[a-z0-9._-]+$/i.test(normalized) || normalized.includes("..")) {
    throw new Error("v1_9_run_root_invalid");
  }
  return normalized;
}

function normalizePathname(value) {
  const normalized = requiredText(value, "mutation.pathname");
  const url = new URL(normalized, "http://127.0.0.1");
  return url.pathname;
}

function requiredTimestamp(value, field) {
  const normalized = requiredText(value, field);
  if (!Number.isFinite(Date.parse(normalized))) throw new Error(`v1_9_${field}_invalid`);
  return new Date(normalized).toISOString();
}

function transitionTimestamp(state, value, field) {
  const timestamp = requiredTimestamp(value, field);
  if (Date.parse(timestamp) < Date.parse(state.updatedAt)) {
    throw new Error(`v1_9_${field}_before_current_state`);
  }
  return timestamp;
}

function requiredText(value, field) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`v1_9_${field}_required`);
  return normalized;
}

function optionalText(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function requiredNonNegativeInteger(value, field) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`v1_9_${field}_invalid`);
  return value;
}

function requiredPositiveInteger(value, field) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`v1_9_${field}_invalid`);
  return value;
}

function requiredAuthMode(value) {
  if (!["local", "password", "oauth", "sso"].includes(value)) {
    throw new Error("v1_9_taskContract.actorAuthMode_invalid");
  }
  return value;
}

function requiredSafeIdArray(value, field) {
  if (!Array.isArray(value)) throw new Error(`v1_9_${field}_invalid`);
  const items = value.map((item) => requiredSafeId(item, field));
  if (new Set(items).size !== items.length) throw new Error(`v1_9_${field}_invalid`);
  return items.sort();
}

function sameTextSet(left, right) {
  return JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
}

function requiredAuditRoundPath(value, auditRound, fileName) {
  const normalized = requiredText(value, "externalAcceptance.path").replaceAll("\\", "/");
  const expected = `external-acceptance/round-${String(auditRound).padStart(4, "0")}/${fileName}`;
  if (normalized !== expected) throw new Error("v1_9_external_acceptance_path_invalid");
  return normalized;
}

function uniqueText(value) {
  if (!Array.isArray(value)) throw new Error("v1_9_recovery_observation_refs_invalid");
  return [...new Set(value.map((item) => requiredText(item, "recovery.observationRef")))];
}

function optionalUniqueText(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((item) => {
    const normalized = typeof item === "string" ? item.trim() : "";
    return normalized ? [normalized] : [];
  }))];
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
