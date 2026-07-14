import { createHash } from "node:crypto";

import type { GenerationIntensity } from "@/server/generation-intensity/generation-intensity-policy";

export const TASK_BRIEF_VERSION = "task-brief.v1" as const;
export const INTENT_GRANT_VERSION = "intent-grant.v1" as const;
export const AGENT_EVENT_ENVELOPE_VERSION = "agent-event-envelope.v1" as const;
export const PENDING_DECISION_VERSION = "pending-decision.v1" as const;

export type MessagePart =
  | { type: "text"; text: string }
  | { type: "artifact_ref"; artifactId: string; version: number };

export type TaskBrief = {
  schemaVersion: typeof TASK_BRIEF_VERSION;
  taskId: string;
  projectId: string;
  intentEpoch: number;
  goal: string;
  requestedOutputs: string[];
  constraints: string[];
  excludedOutputs: string[];
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

export type AgentEventEnvelope = {
  schemaVersion: typeof AGENT_EVENT_ENVELOPE_VERSION;
  eventId: string;
  projectId: string;
  taskId: string;
  intentEpoch: number;
  kind: "task_created" | "task_updated" | "tool_observed" | "decision_pending" | "task_failed";
  occurredAt: string;
  payload: Record<string, unknown>;
};

export function createTaskBrief(input: Omit<TaskBrief, "schemaVersion" | "digest">): TaskBrief {
  const normalized = {
    ...input,
    goal: requireText(input.goal, "goal"),
    requestedOutputs: uniqueText(input.requestedOutputs),
    constraints: uniqueText(input.constraints),
    excludedOutputs: uniqueText(input.excludedOutputs),
  };
  if (!normalized.requestedOutputs.length) throw new Error("TaskBrief requires requestedOutputs.");
  return { ...normalized, schemaVersion: TASK_BRIEF_VERSION, digest: digest(normalized) };
}

export function hasValidTaskBrief(brief: TaskBrief): boolean {
  return brief.schemaVersion === TASK_BRIEF_VERSION && brief.digest === digest({
    taskId: brief.taskId, projectId: brief.projectId, intentEpoch: brief.intentEpoch, goal: brief.goal,
    requestedOutputs: uniqueText(brief.requestedOutputs), constraints: uniqueText(brief.constraints),
    excludedOutputs: uniqueText(brief.excludedOutputs), generationIntensity: brief.generationIntensity, sourceMessageId: brief.sourceMessageId,
  });
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

function uniqueText(values: string[]) {
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
