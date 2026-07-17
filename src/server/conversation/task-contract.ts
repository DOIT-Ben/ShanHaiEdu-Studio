import { createHash } from "node:crypto";

import type { GenerationIntensity } from "@/server/generation-intensity/generation-intensity-policy";

export const TASK_BRIEF_VERSION = "task-brief.v1" as const;
export const INTENT_GRANT_VERSION = "intent-grant.v1" as const;
export const AGENT_EVENT_ENVELOPE_VERSION = "agent-event-envelope.v1" as const;
export const PENDING_DECISION_VERSION = "pending-decision.v1" as const;

export const TASK_REQUESTED_OUTPUTS = [
  "requirement_spec",
  "textbook_evidence",
  "lesson_plan",
  "interactive_courseware_spec",
  "ppt_outline",
  "ppt_design",
  "ppt_sample_assets",
  "ppt_key_samples",
  "ppt_full_assets",
  "ppt",
  "knowledge_anchor",
  "creative_theme",
  "video_script",
  "storyboard",
  "asset_brief",
  "video_assets",
  "video_segment_plan",
  "video_narration",
  "video_shot",
  "image",
  "video",
  "package",
] as const;

export type TaskRequestedOutput = typeof TASK_REQUESTED_OUTPUTS[number];

export type TaskContext = {
  grade: string | null;
  subject: string | null;
  textbookVersion: string | null;
  lessonTopic: string | null;
};

export type TaskInputArtifactRef = {
  artifactId: string;
  version: number;
  digest: string;
};

export type TaskBrief = {
  schemaVersion: typeof TASK_BRIEF_VERSION;
  taskId: string;
  projectId: string;
  intentEpoch: number;
  goal: string;
  requestedOutputs: TaskRequestedOutput[];
  constraints: string[];
  excludedOutputs: TaskRequestedOutput[];
  context?: TaskContext;
  inputArtifactRefs?: TaskInputArtifactRef[];
  qualityTargets?: string[];
  generationIntensity: GenerationIntensity;
  sourceMessageId: string;
  digest: string;
};

export type IntentGrant = {
  schemaVersion: typeof INTENT_GRANT_VERSION;
  taskId: string;
  projectId: string;
  intentEpoch: number;
  standardWorkAuthorized: boolean;
  intensity: GenerationIntensity;
  budgetPolicyVersion: string | null;
  maxCostCredits: number | null;
  maxExternalProviderCalls: number | null;
  requiredCheckpoints: string[];
  expiresAt: string | null;
};

export type ExecutionEnvelope = {
  actorUserId: string;
  projectId: string;
  taskId: string;
  intentEpoch: number;
  taskBriefDigest: string;
  planRevision: number;
  intensity: GenerationIntensity;
  intentGrant: IntentGrant;
  actionDigest: string;
  idempotencyKey: string;
};

export type ExecutionEnvelopeAction = {
  toolName: string;
  arguments: Record<string, unknown>;
};

export type PendingDecisionKind =
  | "authorization"
  | "budget_disclosure"
  | "budget_upgrade"
  | "highest_intensity"
  | "publish"
  | "permission_change"
  | "destructive"
  | "material_choice";

export type PendingDecisionStatus = "pending" | "confirmed" | "canceled" | "superseded" | "expired";

export type PendingDecision = {
  schemaVersion: typeof PENDING_DECISION_VERSION;
  decisionId: string;
  status: PendingDecisionStatus;
  kind: PendingDecisionKind;
  reasonCode: string;
  question: string;
  impactSummary: string;
  options: Array<{ id: "confirm" | "cancel"; label: string; recommended: boolean }>;
  actorUserId: string;
  projectId: string;
  taskId: string;
  intentEpoch: number;
  planId: string;
  actionId: string;
  budgetPolicyVersion: string | null;
  maxCostCredits: number | null;
  maxExternalProviderCalls: number | null;
  expiresAt: string | null;
};

export function createTaskBrief(input: Omit<TaskBrief, "schemaVersion" | "digest" | "requestedOutputs" | "excludedOutputs"> & {
  requestedOutputs: readonly string[];
  excludedOutputs: readonly string[];
}): TaskBrief {
  const normalized = {
    taskId: requireText(input.taskId, "taskId"),
    projectId: requireText(input.projectId, "projectId"),
    intentEpoch: input.intentEpoch,
    goal: requireText(input.goal, "goal"),
    requestedOutputs: normalizeTaskRequestedOutputs(input.requestedOutputs, "requestedOutputs"),
    constraints: uniqueText(input.constraints),
    excludedOutputs: normalizeTaskRequestedOutputs(input.excludedOutputs, "excludedOutputs"),
    generationIntensity: input.generationIntensity,
    sourceMessageId: requireText(input.sourceMessageId, "sourceMessageId"),
    context: normalizeTaskContext(input.context),
    inputArtifactRefs: normalizeTaskInputArtifactRefs(input.inputArtifactRefs),
    qualityTargets: uniqueText(input.qualityTargets ?? []),
  };
  if (!Number.isInteger(normalized.intentEpoch) || normalized.intentEpoch < 0) throw new Error("TaskBrief intentEpoch is invalid.");
  if (!normalized.requestedOutputs.length) throw new Error("TaskBrief requires requestedOutputs.");
  return { ...normalized, schemaVersion: TASK_BRIEF_VERSION, digest: digest(normalized) };
}

export function isTaskRequestedOutput(value: unknown): value is TaskRequestedOutput {
  return typeof value === "string" && (TASK_REQUESTED_OUTPUTS as readonly string[]).includes(value);
}

export function isTaskBrief(value: unknown): value is TaskBrief {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<TaskBrief>;
  return candidate.schemaVersion === TASK_BRIEF_VERSION && typeof candidate.taskId === "string" &&
    typeof candidate.projectId === "string" && typeof candidate.intentEpoch === "number" &&
    typeof candidate.goal === "string" && Array.isArray(candidate.requestedOutputs) &&
    Array.isArray(candidate.constraints) && Array.isArray(candidate.excludedOutputs) &&
    typeof candidate.sourceMessageId === "string" && typeof candidate.digest === "string" &&
    hasValidTaskBrief(candidate as TaskBrief);
}

export function hasValidTaskBrief(brief: TaskBrief): boolean {
  try {
    if (!brief || typeof brief !== "object" || brief.schemaVersion !== TASK_BRIEF_VERSION ||
        !brief.taskId?.trim() || !brief.projectId?.trim() || !brief.goal?.trim() || !brief.sourceMessageId?.trim() ||
        !Number.isInteger(brief.intentEpoch) || brief.intentEpoch < 0 ||
        !Array.isArray(brief.requestedOutputs) || !Array.isArray(brief.constraints) || !Array.isArray(brief.excludedOutputs) ||
        !brief.requestedOutputs.every(isTaskRequestedOutput) || !brief.excludedOutputs.every(isTaskRequestedOutput)) return false;
    const legacyProjection = {
      taskId: brief.taskId, projectId: brief.projectId, intentEpoch: brief.intentEpoch, goal: brief.goal,
      requestedOutputs: uniqueText(brief.requestedOutputs), constraints: uniqueText(brief.constraints),
      excludedOutputs: uniqueText(brief.excludedOutputs), generationIntensity: brief.generationIntensity, sourceMessageId: brief.sourceMessageId,
    };
    const contextFields = [brief.context, brief.inputArtifactRefs, brief.qualityTargets];
    if (contextFields.every((value) => value === undefined)) return brief.digest === digest(legacyProjection);
    if (contextFields.some((value) => value === undefined)) return false;
    return brief.digest === digest({
      ...legacyProjection,
      context: normalizeTaskContext(brief.context),
      inputArtifactRefs: normalizeTaskInputArtifactRefs(brief.inputArtifactRefs),
      qualityTargets: uniqueText(brief.qualityTargets ?? []),
    });
  } catch {
    return false;
  }
}

const legacyTaskRequestedOutputAliases: Readonly<Record<string, TaskRequestedOutput>> = {
  "需求规格": "requirement_spec",
  "教材证据": "textbook_evidence",
  "教案": "lesson_plan",
  "互动课件规格": "interactive_courseware_spec",
  "PPT": "ppt",
  "课堂PPT": "ppt",
  "PPT 大纲": "ppt_outline",
  "PPT大纲": "ppt_outline",
  "PPT 设计候选": "ppt_design",
  "PPT设计候选": "ppt_design",
  "PPT 设计包": "ppt_design",
  "导入视频方案": "video",
  "视频": "video",
  "视频成片": "video",
  "完整材料包": "package",
  "最终交付清单": "package",
};

function normalizeTaskRequestedOutputs(values: readonly string[], field: string): TaskRequestedOutput[] {
  const normalized = uniqueText(values).map((value) => legacyTaskRequestedOutputAliases[value] ?? value);
  const invalid = normalized.filter((value) => !isTaskRequestedOutput(value));
  if (invalid.length > 0) throw new Error(`TaskBrief ${field} contains unsupported outputs: ${invalid.join(", ")}`);
  return [...new Set(normalized)] as TaskRequestedOutput[];
}

function normalizeTaskContext(value?: TaskContext): TaskContext {
  return {
    grade: optionalText(value?.grade),
    subject: optionalText(value?.subject),
    textbookVersion: optionalText(value?.textbookVersion),
    lessonTopic: optionalText(value?.lessonTopic),
  };
}

function normalizeTaskInputArtifactRefs(values: readonly TaskInputArtifactRef[] = []): TaskInputArtifactRef[] {
  if (!Array.isArray(values)) throw new Error("TaskBrief inputArtifactRefs must be an array.");
  const normalized = values.map((value) => {
    if (!value || typeof value !== "object") throw new Error("TaskBrief inputArtifactRef is invalid.");
    const artifactId = requireText(value.artifactId, "inputArtifactRefs.artifactId");
    if (!Number.isInteger(value.version) || value.version < 1) throw new Error("TaskBrief inputArtifactRef version is invalid.");
    if (!/^[a-f0-9]{64}$/i.test(value.digest)) throw new Error("TaskBrief inputArtifactRef digest is invalid.");
    return { artifactId, version: value.version, digest: value.digest.toLowerCase() };
  });
  const unique = new Map(normalized.map((value) => [`${value.artifactId}:${value.version}:${value.digest}`, value]));
  return [...unique.values()].sort((left, right) =>
    left.artifactId.localeCompare(right.artifactId) || left.version - right.version || left.digest.localeCompare(right.digest));
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function createExecutionEnvelope(input: {
  actorUserId: string;
  taskBrief: TaskBrief;
  planRevision: number;
  intensity: GenerationIntensity;
  intentGrant: IntentGrant;
  action: ExecutionEnvelopeAction;
}): ExecutionEnvelope {
  if (!hasValidTaskBrief(input.taskBrief)) throw new Error("ExecutionEnvelope requires a valid TaskBrief.");
  if (!input.actorUserId.trim()) throw new Error("ExecutionEnvelope actorUserId is required.");
  if (!Number.isInteger(input.planRevision) || input.planRevision < 0) {
    throw new Error("ExecutionEnvelope planRevision must be a non-negative integer.");
  }
  const actionDigest = digest(normalizeExecutionAction(input.action));
  const envelopeWithoutKey = {
    actorUserId: input.actorUserId.trim(),
    projectId: input.taskBrief.projectId,
    taskId: input.taskBrief.taskId,
    intentEpoch: input.taskBrief.intentEpoch,
    taskBriefDigest: input.taskBrief.digest,
    planRevision: input.planRevision,
    intensity: input.intensity,
    intentGrant: structuredClone(input.intentGrant),
    actionDigest,
  };
  const envelope = {
    ...envelopeWithoutKey,
    idempotencyKey: digest(envelopeWithoutKey),
  };
  if (!hasValidExecutionEnvelope(envelope)) {
    throw new Error("ExecutionEnvelope scope does not match TaskBrief and IntentGrant.");
  }
  return envelope;
}

export function hasValidExecutionEnvelope(value: ExecutionEnvelope): boolean {
  if (!value || typeof value !== "object") return false;
  if (!value.actorUserId.trim() || !value.projectId.trim() || !value.taskId.trim()) return false;
  if (!Number.isInteger(value.intentEpoch) || value.intentEpoch < 0) return false;
  if (!Number.isInteger(value.planRevision) || value.planRevision < 0) return false;
  if (!/^[a-f0-9]{64}$/.test(value.taskBriefDigest) || !/^[a-f0-9]{64}$/.test(value.actionDigest)) return false;
  if (!hasMatchingIntentGrant(value)) return false;
  const { idempotencyKey, ...signedFields } = value;
  return idempotencyKey === digest(signedFields);
}

export function isPendingDecision(value: unknown): value is PendingDecision {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<PendingDecision>;
  return candidate.schemaVersion === PENDING_DECISION_VERSION
    && typeof candidate.decisionId === "string" && Boolean(candidate.decisionId.trim())
    && isPendingDecisionStatus(candidate.status)
    && isPendingDecisionKind(candidate.kind)
    && typeof candidate.reasonCode === "string" && Boolean(candidate.reasonCode.trim())
    && typeof candidate.question === "string" && Boolean(candidate.question.trim())
    && typeof candidate.impactSummary === "string" && Boolean(candidate.impactSummary.trim())
    && Array.isArray(candidate.options) && candidate.options.length === 2
    && typeof candidate.actorUserId === "string" && Boolean(candidate.actorUserId.trim())
    && typeof candidate.projectId === "string" && Boolean(candidate.projectId.trim())
    && typeof candidate.taskId === "string" && Boolean(candidate.taskId.trim())
    && typeof candidate.intentEpoch === "number" && Number.isInteger(candidate.intentEpoch) && candidate.intentEpoch >= 0
    && typeof candidate.planId === "string" && Boolean(candidate.planId.trim())
    && typeof candidate.actionId === "string" && Boolean(candidate.actionId.trim())
    && (candidate.budgetPolicyVersion === null || typeof candidate.budgetPolicyVersion === "string")
    && (candidate.maxCostCredits === null || (typeof candidate.maxCostCredits === "number" && candidate.maxCostCredits >= 0))
    && (candidate.maxExternalProviderCalls === undefined || candidate.maxExternalProviderCalls === null || (
      typeof candidate.maxExternalProviderCalls === "number" && Number.isInteger(candidate.maxExternalProviderCalls) && candidate.maxExternalProviderCalls >= 0
    ))
    && (candidate.expiresAt === null || typeof candidate.expiresAt === "string");
}

export function withPendingDecisionStatus(decision: PendingDecision, status: PendingDecisionStatus): PendingDecision {
  return { ...decision, status };
}

function isPendingDecisionKind(value: unknown): value is PendingDecisionKind {
  return value === "authorization" || value === "budget_disclosure" || value === "budget_upgrade"
    || value === "highest_intensity" || value === "publish" || value === "permission_change"
    || value === "destructive" || value === "material_choice";
}

function isPendingDecisionStatus(value: unknown): value is PendingDecisionStatus {
  return value === "pending" || value === "confirmed" || value === "canceled"
    || value === "superseded" || value === "expired";
}

function uniqueText(values: readonly string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function hasMatchingIntentGrant(envelope: ExecutionEnvelope) {
  const grant = envelope.intentGrant;
  return grant.schemaVersion === INTENT_GRANT_VERSION
    && grant.taskId === envelope.taskId
    && grant.projectId === envelope.projectId
    && grant.intentEpoch === envelope.intentEpoch
    && grant.intensity === envelope.intensity;
}

function normalizeExecutionAction(action: ExecutionEnvelopeAction) {
  const toolName = action.toolName.trim();
  if (!toolName) throw new Error("ExecutionEnvelope action toolName is required.");
  return { toolName, arguments: action.arguments };
}

function requireText(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`TaskBrief ${field} is required.`);
  return normalized;
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
