import { createHash } from "node:crypto";

import type { TaskBrief } from "./task-contract";

export const SEMANTIC_CONTEXT_SNAPSHOT_VERSION = "semantic-context-snapshot.v1" as const;
const RECENT_MESSAGE_LIMIT = 8;

export type SemanticContextPlan = {
  planId: string;
  revision: number;
  status: string;
};

export type SemanticContextArtifactRef = {
  artifactId: string;
  kind: string;
  version: number;
  digest: string;
  taskId?: string;
  taskBriefDigest?: string;
  intentEpoch?: number;
  bindingSource?: "tool_execution" | "current_intent_teacher_input" | "current_intent_compatibility";
};

export type SemanticContextObservationRef = {
  observationId: string;
  reasonCodes: string[];
  intentEpoch?: number;
};

export type SemanticContextState = {
  taskBrief: TaskBrief;
  plan: SemanticContextPlan;
  pendingDecision: Record<string, unknown> | null;
  trustedArtifactRefs: SemanticContextArtifactRef[];
  observationRefs: SemanticContextObservationRef[];
  recentMessages: Array<{ role: string; content: string }>;
};

export type SemanticContextSnapshot = SemanticContextState & {
  schemaVersion: typeof SEMANTIC_CONTEXT_SNAPSHOT_VERSION;
  snapshotDigest: string;
};

export function buildSemanticContextSnapshot(input: SemanticContextState): SemanticContextSnapshot {
  const state = normalizeSemanticContextState(input);
  return {
    schemaVersion: SEMANTIC_CONTEXT_SNAPSHOT_VERSION,
    ...state,
    snapshotDigest: digest(state),
  };
}

export function restoreSemanticContextSnapshot(snapshot: SemanticContextSnapshot): SemanticContextState {
  if (!snapshot || snapshot.schemaVersion !== SEMANTIC_CONTEXT_SNAPSHOT_VERSION) {
    throw new Error("Semantic context snapshot version is invalid.");
  }
  const { schemaVersion: _schemaVersion, snapshotDigest, ...rawState } = snapshot;
  const state = normalizeSemanticContextState(rawState);
  if (snapshotDigest !== digest(state)) {
    throw new Error("Semantic context snapshot digest does not match its content.");
  }
  return structuredClone(state);
}

function normalizeSemanticContextState(input: SemanticContextState): SemanticContextState {
  if (!input || typeof input !== "object") throw new Error("Semantic context state is required.");
  const taskBrief = normalizeTaskBrief(input.taskBrief);
  const currentEpoch = taskBrief.intentEpoch;
  return {
    taskBrief,
    plan: normalizePlan(input.plan),
    pendingDecision: normalizePendingDecision(input.pendingDecision, currentEpoch),
    trustedArtifactRefs: normalizeArtifactRefs(input.trustedArtifactRefs)
      .filter((ref) => ref.intentEpoch === currentEpoch &&
        ref.taskId === taskBrief.taskId && ref.taskBriefDigest === taskBrief.digest),
    observationRefs: normalizeObservationRefs(input.observationRefs)
      .filter((ref) => ref.intentEpoch === undefined || ref.intentEpoch === currentEpoch),
    recentMessages: normalizeRecentMessages(input.recentMessages).slice(-RECENT_MESSAGE_LIMIT),
  };
}

function normalizeTaskBrief(taskBrief: TaskBrief): TaskBrief {
  if (!taskBrief || taskBrief.schemaVersion !== "task-brief.v1") {
    throw new Error("Semantic context requires a TaskBrief.");
  }
  const taskId = requireText(taskBrief.taskId, "taskBrief.taskId");
  const projectId = requireText(taskBrief.projectId, "taskBrief.projectId");
  const goal = requireText(taskBrief.goal, "taskBrief.goal");
  const sourceMessageId = requireText(taskBrief.sourceMessageId, "taskBrief.sourceMessageId");
  if (!Number.isInteger(taskBrief.intentEpoch) || taskBrief.intentEpoch < 0) {
    throw new Error("Semantic context TaskBrief intentEpoch is invalid.");
  }
  if (!/^[a-f0-9]{64}$/i.test(taskBrief.digest)) {
    throw new Error("Semantic context TaskBrief digest is invalid.");
  }
  return {
    ...structuredClone(taskBrief),
    taskId,
    projectId,
    goal,
    sourceMessageId,
    requestedOutputs: normalizeTextArray(taskBrief.requestedOutputs, "taskBrief.requestedOutputs") as TaskBrief["requestedOutputs"],
    constraints: normalizeTextArray(taskBrief.constraints, "taskBrief.constraints"),
    excludedOutputs: normalizeTextArray(taskBrief.excludedOutputs, "taskBrief.excludedOutputs") as TaskBrief["excludedOutputs"],
    digest: taskBrief.digest.toLowerCase(),
  };
}

function normalizePlan(plan: SemanticContextPlan): SemanticContextPlan {
  if (!plan || typeof plan !== "object") throw new Error("Semantic context plan is required.");
  if (!Number.isInteger(plan.revision) || plan.revision < 0) {
    throw new Error("Semantic context plan revision must be a non-negative integer.");
  }
  return {
    planId: requireText(plan.planId, "plan.planId"),
    revision: plan.revision,
    status: requireText(plan.status, "plan.status"),
  };
}

function normalizePendingDecision(value: Record<string, unknown> | null, currentEpoch: number) {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Semantic context pendingDecision must be an object or null.");
  }
  if (typeof value.intentEpoch === "number" && value.intentEpoch !== currentEpoch) return null;
  return structuredClone(value);
}

function normalizeArtifactRefs(refs: SemanticContextArtifactRef[]): SemanticContextArtifactRef[] {
  if (!Array.isArray(refs)) throw new Error("Semantic context trustedArtifactRefs must be an array.");
  return refs.map((ref) => {
    if (!ref || typeof ref !== "object") throw new Error("Semantic context artifact ref is invalid.");
    if (!Number.isInteger(ref.version) || ref.version < 1) throw new Error("Semantic context artifact version is invalid.");
    if (!/^[a-f0-9]{64}$/i.test(ref.digest)) throw new Error("Semantic context artifact digest is invalid.");
    if (ref.intentEpoch !== undefined && (!Number.isInteger(ref.intentEpoch) || ref.intentEpoch < 0)) {
      throw new Error("Semantic context artifact intentEpoch is invalid.");
    }
    if (ref.taskBriefDigest !== undefined && !/^[a-f0-9]{64}$/i.test(ref.taskBriefDigest)) {
      throw new Error("Semantic context artifact TaskBrief digest is invalid.");
    }
    if (ref.bindingSource !== undefined && ref.bindingSource !== "tool_execution" &&
        ref.bindingSource !== "current_intent_teacher_input" && ref.bindingSource !== "current_intent_compatibility") {
      throw new Error("Semantic context artifact binding source is invalid.");
    }
    return {
      artifactId: requireText(ref.artifactId, "trustedArtifactRefs.artifactId"),
      kind: requireText(ref.kind, "trustedArtifactRefs.kind"),
      version: ref.version,
      digest: ref.digest.toLowerCase(),
      ...(ref.taskId === undefined ? {} : { taskId: requireText(ref.taskId, "trustedArtifactRefs.taskId") }),
      ...(ref.taskBriefDigest === undefined ? {} : { taskBriefDigest: ref.taskBriefDigest.toLowerCase() }),
      ...(ref.intentEpoch === undefined ? {} : { intentEpoch: ref.intentEpoch }),
      ...(ref.bindingSource === undefined ? {} : { bindingSource: ref.bindingSource }),
    };
  });
}

function normalizeObservationRefs(refs: SemanticContextObservationRef[]): SemanticContextObservationRef[] {
  if (!Array.isArray(refs)) throw new Error("Semantic context observationRefs must be an array.");
  return refs.map((ref) => {
    if (!ref || typeof ref !== "object") throw new Error("Semantic context observation ref is invalid.");
    if (ref.intentEpoch !== undefined && (!Number.isInteger(ref.intentEpoch) || ref.intentEpoch < 0)) {
      throw new Error("Semantic context observation intentEpoch is invalid.");
    }
    return {
      observationId: requireText(ref.observationId, "observationRefs.observationId"),
      reasonCodes: normalizeTextArray(ref.reasonCodes, "observationRefs.reasonCodes"),
      ...(ref.intentEpoch === undefined ? {} : { intentEpoch: ref.intentEpoch }),
    };
  });
}

function normalizeRecentMessages(messages: Array<{ role: string; content: string }>) {
  if (!Array.isArray(messages)) throw new Error("Semantic context recentMessages must be an array.");
  return messages.map((message) => {
    if (!message || typeof message !== "object") throw new Error("Semantic context recent message is invalid.");
    return {
      role: requireText(message.role, "recentMessages.role"),
      content: requireText(message.content, "recentMessages.content"),
    };
  });
}

function normalizeTextArray(value: string[], field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Semantic context ${field} must be a string array.`);
  }
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

function requireText(value: string, field: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Semantic context ${field} is required.`);
  return normalized;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
