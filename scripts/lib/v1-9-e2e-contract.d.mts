export const V1_9_RUN_MANIFEST_VERSION: "v1-9-run-manifest.v1";
export const V1_9_RUN_MANIFEST_V2_VERSION: "v1-9-run-manifest.v2";
export const V1_9_BASELINE_LOCK_VERSION: "v1-9-baseline-lock.v2";
export const V1_9_LEGACY_BASELINE_LOCK_VERSION: "v1-9-baseline-lock.v1";
export const V1_9_RUN_STATE_VERSION: "v1-9-run-state.v2";
export const V1_9_RUN_LEDGER_VERSION: "v1-9-run-ledger.v1";
export const V1_9_TASK_CONTRACT_LOCK_VERSION: "v1-9-task-contract-lock.v1";
export const V1_9_FROZEN_PROMPT: string;
export const V1_9_FROZEN_PROMPT_DIGEST: string;

export type V1_9Mutation = {
  method: string;
  pathname: string;
  source: "ui" | "runner";
};

export type V1_9PendingDecisionSummary = {
  kind: string;
  actionId: string;
  reasonCode: string;
};

export type V1_9RunManifest = {
  schemaVersion: "v1-9-run-manifest.v1";
  runId: string;
  status: string;
  relativeRunRoot: string;
  promptDigest: string;
  skillLock: V1_9SkillLock | null;
  providerLock: V1_9ProviderLock | null;
  providerLockHistory?: Array<{
    schemaVersion: "v1-9-provider-lock-history.v1";
    revision: number;
    providerLock: V1_9ProviderLock;
    failureEvidenceId: string;
    reasonCode: "authorization_config_repair";
    rotatedAt: string;
  }>;
  projectId: string | null;
  taskId: string | null;
  intentEpoch: number | null;
  checkpointId: string | null;
  taskSubmissionCount: number;
  finalDownloadCount: number;
  externalCodexOrchestrationCount: number;
  pendingDecision: V1_9PendingDecisionSummary | null;
  recovery: {
    reasonCode: string;
    checkpointId: string | null;
    observationRefs: string[];
    healthEvidenceNotBefore?: string;
    turnJobId?: string | null;
    teacherMessageId?: string | null;
  } | null;
  mutations: Array<V1_9Mutation>;
  violations: Array<V1_9Mutation & { reasonCode: string; orchestrationImpact?: boolean }>;
  createdAt: string;
  updatedAt: string;
};

export type V1_9SkillLock = {
  schemaVersion: "v1-9-skill-lock.v1";
  projectionLockDigest: string;
  bindingPolicyDigest: string;
  activeSkills: Array<{ name: string; version: string }>;
};

export type V1_9ProviderLock = {
  schemaVersion: "v1-9-provider-lock.v1";
  channel: "primary" | "third" | "fallback";
  model: string;
  endpointCategory: "openai_compatible_responses";
  reasoningEffort: "low" | "medium" | "high" | "xhigh";
  credentialSource: "ledger_private_env" | "deployment_secret";
  configDigest: string;
};

export type V1_9GenerationIntensity = "standard" | "enhanced" | "deep" | "extreme";

export type V1_9LegacyBaselineLock = {
  schemaVersion: "v1-9-baseline-lock.v1";
  branch: "main";
  gitHead: string;
  generationIntensity: "standard";
  runtimeSourceDigest: string;
  requirementsBaselineDigest: string;
  registryDigest: string;
  projectionRegistryDigest: string;
  providerLedgerManifestDigest: string;
  projectionId: string;
};

export type V1_9BaselineLockV2 = Omit<V1_9LegacyBaselineLock, "schemaVersion"> & {
  schemaVersion: "v1-9-baseline-lock.v2";
  verificationManifestSha256: string;
  workingTreeDigest: string;
  policySha256: string;
  stageSha256: string;
  providerContinuityManifestSha256: string;
  providerContinuityReceiptSha256: string;
  providerContinuityEvidenceRootDigest: string;
  providerContinuitySubjectDigest: string;
};

export type V1_9BaselineLock = V1_9LegacyBaselineLock | V1_9BaselineLockV2;

export type V1_9ProviderRuntimeCapability =
  | "agent_brain"
  | "coze_ppt"
  | "image_generation"
  | "text_llm"
  | "tts_minimax"
  | "video_generation";

export type V1_9ProviderRuntimeLock = {
  capability: V1_9ProviderRuntimeCapability;
  credentialSource: "ledger_private_env" | "deployment_secret";
  configDigest: string;
};

export type V1_9RunPredecessor = {
  runId: string;
  relativeRunRoot: string;
  manifestSha256: string;
  disposition: "historical_failed" | "terminated_contract_upgrade" | "completed";
};

export type V1_9RunManifestV2 = {
  schemaVersion: "v1-9-run-manifest.v2";
  runId: string;
  relativeRunRoot: string;
  createdAt: string;
  promptDigest: string;
  baselineLock: V1_9BaselineLockV2;
  skillLock: V1_9SkillLock;
  agentBrain: { providerLock: V1_9ProviderLock };
  providerRuntimeLocks: V1_9ProviderRuntimeLock[];
  predecessor: V1_9RunPredecessor | null;
};

export type V1_9ReadOnlyRunManifestV2 = Omit<V1_9RunManifestV2, "baselineLock"> & {
  baselineLock: V1_9BaselineLock;
};

export type V1_9TaskContractLock = {
  schemaVersion: "v1-9-task-contract-lock.v1";
  actorAuthMode: "local" | "password" | "oauth" | "sso";
  teacherMessageId: string;
  turnJobId: string;
  taskBriefDigest: string;
  intentEpoch: number;
  intensity: V1_9GenerationIntensity;
  intentGrantDigest: string;
  budgetDigest: string;
  initialPlanRevision: number;
};

export type V1_9RunIdentity =
  | { actorUserId: null; projectId: null; taskId: null; intentEpoch: null }
  | { actorUserId: string; projectId: string; taskId: null; intentEpoch: null }
  | { actorUserId: string; projectId: string; taskId: string; intentEpoch: number };

export type V1_9RunCheckpoint = {
  checkpointId: string;
  planRevision: number;
  observationRefs: string[];
  recordedAt: string;
};

export type V1_9RunRecovery = {
  reasonCode: string;
  checkpointId: string | null;
  observationRefs: string[];
  healthEvidenceNotBefore: string;
  turnJobId: string | null;
  teacherMessageId: string | null;
};

export type V1_9RunTermination = {
  reasonCode: string;
  successorRunId: string;
  driftedFields: string[];
  recoveryEntry: string;
  terminatedAt: string;
};

export type V1_9ExternalAuditAffectedUnit = {
  unitId: string;
  kind: "page" | "shot" | "package_entry" | "artifact_version";
  artifactRole: string;
  artifactId: string;
  artifactVersion: string;
  pageNumber: number | null;
  shotId: string | null;
  packageEntry: string | null;
};

export type V1_9ExternalAuditRepairFeedback = {
  findingId: string;
  responsibilityLayer: string;
  category: string;
  design: string | null;
  vulnerability: string | null;
  engineering: string;
};

export type V1_9ExternalAcceptanceRoundState = {
  auditRound: number;
  reportId: string;
  reportPath: string;
  reportDigest: string;
  packageArtifactId: string;
  packageArtifactVersion: number;
  packageVersion: string;
  packageSha256: string;
  outcome: "repair_required" | "accepted";
  reviewedFindingIds: string[];
  openP0FindingIds: string[];
  affectedUnits: V1_9ExternalAuditAffectedUnit[];
  repairFeedback: V1_9ExternalAuditRepairFeedback[];
  repairHandoffPath: string | null;
  repairHandoffDigest: string | null;
  generatedAt: string;
};

export type V1_9ExternalAcceptanceCurrentRepair = {
  reportDigest: string;
  repairHandoffPath: string;
  repairHandoffDigest: string;
  openP0FindingIds: string[];
  responsibilityLayers: string[];
  affectedUnits: V1_9ExternalAuditAffectedUnit[];
  feedback: V1_9ExternalAuditRepairFeedback[];
};

export type V1_9PackageAcceptance = {
  packageArtifactId: string;
  packageArtifactVersion: number;
  packageVersion: string;
  packageSha256: string;
  turnJobId: string;
  teacherMessageId: string;
  downloadedAt: string;
  rounds: V1_9ExternalAcceptanceRoundState[];
  currentRepair: V1_9ExternalAcceptanceCurrentRepair | null;
  acceptedAt: string | null;
};

export type V1_9RunLedger = {
  schemaVersion: "v1-9-run-ledger.v1";
  currentPlanRevision: number | null;
  planRevisionHistory: Array<{ revision: number; recordedAt: string }>;
  taskSubmissionCount: number;
  finalDownloadCount: number;
  externalCodexOrchestrationCount: number;
  mutations: V1_9Mutation[];
  violations: Array<V1_9Mutation & { reasonCode: string; orchestrationImpact: boolean }>;
};

export type V1_9RunState = {
  schemaVersion: "v1-9-run-state.v2";
  runId: string;
  manifestSha256: string;
  status:
    | "prepared"
    | "running"
    | "paused_pending_decision"
    | "paused_recovery"
    | "failed"
    | "terminated_contract_upgrade"
    | "package_ready_for_external_acceptance"
    | "external_acceptance_repair_required"
    | "completed";
  identity: V1_9RunIdentity;
  taskContractLock: V1_9TaskContractLock | null;
  checkpoint: V1_9RunCheckpoint | null;
  pendingDecision: V1_9PendingDecisionSummary | null;
  recovery: V1_9RunRecovery | null;
  termination: V1_9RunTermination | null;
  packageAcceptance: V1_9PackageAcceptance | null;
  ledger: V1_9RunLedger;
  createdAt: string;
  updatedAt: string;
};

export function createV1_9RunManifest(input: {
  runId: string;
  relativeRunRoot: string;
  prompt: string;
  createdAt: string;
}): V1_9RunManifest;

export function createV1_9RunManifestV2(input: {
  runId: string;
  relativeRunRoot: string;
  createdAt: string;
  baselineLock: V1_9BaselineLockV2;
  skillLock: V1_9SkillLock;
  agentBrain: { providerLock: V1_9ProviderLock };
  providerRuntimeLocks: V1_9ProviderRuntimeLock[];
  predecessor: V1_9RunPredecessor | null;
}): V1_9RunManifestV2;

export function normalizeV1_9RunManifestV2(value: unknown): V1_9RunManifestV2;

export function normalizeV1_9RunManifestV2ReadOnly(value: unknown): V1_9ReadOnlyRunManifestV2;

export function normalizeV1_9BaselineLock(value: unknown): V1_9BaselineLock;

export function createV1_9BaselineLockDigest(value: V1_9BaselineLock): string;

export function assertV1_9BaselineLockDigest(
  value: V1_9BaselineLock,
  expectedDigest: string,
): V1_9BaselineLock;

export function createV1_9RunManifestV2Digest(value: V1_9RunManifestV2): string;

export function assertV1_9RunManifestV2Digest(
  value: V1_9RunManifestV2,
  expectedDigest: string,
): V1_9RunManifestV2;

export function createV1_9RunState(input: {
  manifest: V1_9RunManifestV2;
  createdAt: string;
}): V1_9RunState;

export function assertV1_9InterruptedRunningResumeState(value: unknown): V1_9RunState;

export function normalizeV1_9RunState(value: unknown): V1_9RunState;

export function bindV1_9RunStateProjectIdentity(state: V1_9RunState, input: {
  actorUserId: string;
  projectId: string;
  boundAt: string;
}): V1_9RunState;

export function bindV1_9TaskContractLock(state: V1_9RunState, input: {
  actorUserId: string;
  projectId: string;
  taskId: string;
  actorAuthMode: "local" | "password" | "oauth" | "sso";
  teacherMessageId: string;
  turnJobId: string;
  taskBriefDigest: string;
  intentEpoch: number;
  intensity: V1_9GenerationIntensity;
  intentGrantDigest: string;
  budgetDigest: string;
  initialPlanRevision: number;
  boundAt: string;
}): V1_9RunState;

export function advanceV1_9PlanRevision(state: V1_9RunState, input: {
  nextPlanRevision: number;
  advancedAt: string;
}): V1_9RunState;

export function recordV1_9RunStateMutation(state: V1_9RunState, input: V1_9Mutation & {
  recordedAt: string;
}): V1_9RunState;

export function updateV1_9RunStateCheckpoint(state: V1_9RunState, input: {
  checkpointId: string;
  planRevision: number;
  observationRefs: string[];
  recordedAt: string;
}): V1_9RunState;

export function markV1_9RunStatePendingDecision(state: V1_9RunState, input: V1_9PendingDecisionSummary & {
  stoppedAt: string;
}): V1_9RunState;

export function markV1_9RunStateRecoveryStop(state: V1_9RunState, input: {
  reasonCode: string;
  checkpointId: string | null;
  observationRefs: string[];
  turnJobId?: string | null;
  teacherMessageId?: string | null;
  stoppedAt: string;
}): V1_9RunState;

export function markV1_9RunStateContractUpgradeTermination(state: V1_9RunState, input: {
  reasonCode: string;
  successorRunId: string;
  driftedFields?: string[];
  recoveryEntry: string;
  terminatedAt: string;
}): V1_9RunState;

export function markV1_9RunStatePackageReady(state: V1_9RunState, input: {
  packageArtifactId: string;
  packageArtifactVersion: number;
  packageVersion: string;
  packageSha256: string;
  turnJobId: string;
  teacherMessageId: string;
  downloadedAt: string;
}): V1_9RunState;

export function recordV1_9ExternalAcceptanceRound(state: V1_9RunState, input: {
  auditRound: number;
  reportId: string;
  reportPath: string;
  reportDigest: string;
  packageArtifactId: string;
  packageArtifactVersion: number;
  packageVersion: string;
  packageSha256: string;
  outcome: "repair_required" | "accepted";
  reviewedFindingIds: string[];
  openP0FindingIds: string[];
  affectedUnits: V1_9ExternalAuditAffectedUnit[];
  repairFeedback: V1_9ExternalAuditRepairFeedback[];
  repairHandoffPath: string | null;
  repairHandoffDigest: string | null;
  generatedAt: string;
}): V1_9RunState;

export function bindV1_9SkillLock(manifest: V1_9RunManifest, skillLock: V1_9SkillLock): V1_9RunManifest;

export function bindV1_9ProviderLock(manifest: V1_9RunManifest, providerLock: V1_9ProviderLock): V1_9RunManifest;

export function rotateV1_9ProviderLockForRecovery(manifest: V1_9RunManifest, input: {
  nextProviderLock: V1_9ProviderLock;
  failureEvidenceId: string;
  rotatedAt: string;
}): V1_9RunManifest;

export function assertV1_9ResumeIdentity(
  manifest: V1_9RunManifest,
  expected: Partial<Pick<V1_9RunManifest, "runId" | "projectId" | "taskId" | "intentEpoch">>,
): V1_9RunManifest;

export function bindV1_9ProjectIdentity(manifest: V1_9RunManifest, projectId: string): V1_9RunManifest;

export function bindV1_9TaskIdentity(
  manifest: V1_9RunManifest,
  identity: Pick<V1_9RunManifest, "projectId" | "taskId" | "intentEpoch" | "checkpointId">,
): V1_9RunManifest;

export function updateV1_9Checkpoint(manifest: V1_9RunManifest, checkpointId: string | null): V1_9RunManifest;

export function markV1_9PendingDecision(
  manifest: V1_9RunManifest,
  decision: V1_9PendingDecisionSummary,
): V1_9RunManifest;

export function markV1_9RecoveryStop(
  manifest: V1_9RunManifest,
  recovery: {
    reasonCode: string;
    checkpointId: string | null;
    observationRefs: string[];
    turnJobId?: string | null;
    teacherMessageId?: string | null;
  },
): V1_9RunManifest;

export function markV1_9Completed(manifest: V1_9RunManifest): V1_9RunManifest;

export function recordV1_9UiMutation(manifest: V1_9RunManifest, mutation: V1_9Mutation): V1_9RunManifest;

export function deriveV1_9ExternalCodexOrchestrationCount(manifest: V1_9RunManifest): number;

export function deriveV1_9RecoveryObservationRefs(
  snapshot: { messages?: Array<{ metadata?: { agentObservations?: unknown } }> },
  checkpointObservationRefs: unknown,
): string[];

export function deriveV1_9RecoveryStop(
  snapshot: {
    messages?: Array<{ metadata?: { agentObservations?: unknown } }>;
    turnJobs?: Array<{ status?: string; errorCode?: string | null }>;
  },
  checkpoint: {
    status: string | null;
    reasonCode: string | null;
    checkpointId: string | null;
    observationRefs: string[];
  },
): {
  reasonCode: string;
  checkpointId: string | null;
  observationRefs: string[];
  turnJobId?: string;
  teacherMessageId?: string;
} | null;
