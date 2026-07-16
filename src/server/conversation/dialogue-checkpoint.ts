import { randomUUID } from "node:crypto";

export const DIALOGUE_CHECKPOINT_VERSION = "dialogue-checkpoint.v1" as const;

export type DialogueCheckpointOption = {
  id: string;
  label: string;
  description: string;
  recommended: boolean;
};

export type DialogueCheckpoint = {
  schemaVersion: typeof DIALOGUE_CHECKPOINT_VERSION;
  checkpointId: string;
  kind: "semantic_boundary";
  status: "pending" | "answered" | "superseded";
  projectId: string;
  taskId: string;
  intentEpoch: number;
  planRevision: number;
  sourceMessageId: string;
  question: string;
  understandingSummary: string;
  impactSummary: string;
  options: DialogueCheckpointOption[];
  allowFreeText: boolean;
  requestedAt: string;
  responseMessageId?: string;
  responseText?: string;
  answeredAt?: string;
};

export function createDialogueCheckpoint(input: {
  projectId: string;
  taskId: string;
  intentEpoch: number;
  planRevision: number;
  sourceMessageId: string;
  question: string;
  understandingSummary: string;
  impactSummary: string;
  options: DialogueCheckpointOption[];
  allowFreeText: boolean;
  checkpointId?: string;
  requestedAt?: string;
}): DialogueCheckpoint {
  const checkpoint: DialogueCheckpoint = {
    schemaVersion: DIALOGUE_CHECKPOINT_VERSION,
    checkpointId: requireText(input.checkpointId ?? randomUUID(), "checkpointId"),
    kind: "semantic_boundary",
    status: "pending",
    projectId: requireText(input.projectId, "projectId"),
    taskId: requireText(input.taskId, "taskId"),
    intentEpoch: requireNonNegativeInteger(input.intentEpoch, "intentEpoch"),
    planRevision: requireNonNegativeInteger(input.planRevision, "planRevision"),
    sourceMessageId: requireText(input.sourceMessageId, "sourceMessageId"),
    question: requireText(input.question, "question"),
    understandingSummary: requireText(input.understandingSummary, "understandingSummary"),
    impactSummary: requireText(input.impactSummary, "impactSummary"),
    options: normalizeOptions(input.options),
    allowFreeText: input.allowFreeText === true,
    requestedAt: validDate(input.requestedAt ?? new Date().toISOString(), "requestedAt"),
  };
  return checkpoint;
}

export function answerDialogueCheckpoint(
  checkpoint: DialogueCheckpoint,
  input: { responseMessageId: string; responseText: string; answeredAt?: string },
): DialogueCheckpoint {
  if (!isDialogueCheckpoint(checkpoint) || checkpoint.status !== "pending") {
    throw new Error("DialogueCheckpoint must be pending before it can be answered.");
  }
  return {
    ...structuredClone(checkpoint),
    status: "answered",
    responseMessageId: requireText(input.responseMessageId, "responseMessageId"),
    responseText: requireText(input.responseText, "responseText"),
    answeredAt: validDate(input.answeredAt ?? new Date().toISOString(), "answeredAt"),
  };
}

export function isDialogueCheckpoint(value: unknown): value is DialogueCheckpoint {
  if (!isRecord(value) || value.schemaVersion !== DIALOGUE_CHECKPOINT_VERSION || value.kind !== "semantic_boundary") return false;
  if (!isOneOf(value.status, ["pending", "answered", "superseded"])) return false;
  if (![value.checkpointId, value.projectId, value.taskId, value.sourceMessageId, value.question, value.understandingSummary, value.impactSummary, value.requestedAt]
      .every(isText)) return false;
  if (!isNonNegativeInteger(value.intentEpoch) || !isNonNegativeInteger(value.planRevision)) return false;
  if (typeof value.allowFreeText !== "boolean" || !Array.isArray(value.options) || value.options.length < 2 || value.options.length > 4) return false;
  if (!value.options.every(isDialogueOption) || new Set(value.options.map((option) => option.id)).size !== value.options.length) return false;
  if (!Number.isFinite(Date.parse(value.requestedAt as string))) return false;
  if (value.status === "answered") {
    return isText(value.responseMessageId) && isText(value.responseText) && isText(value.answeredAt)
      && Number.isFinite(Date.parse(value.answeredAt));
  }
  return value.responseMessageId === undefined && value.responseText === undefined && value.answeredAt === undefined;
}

function normalizeOptions(options: DialogueCheckpointOption[]) {
  if (!Array.isArray(options) || options.length < 2 || options.length > 4) {
    throw new Error("DialogueCheckpoint requires two to four options.");
  }
  const normalized = options.map((option) => ({
    id: requireText(option.id, "options.id"),
    label: requireText(option.label, "options.label"),
    description: requireText(option.description, "options.description"),
    recommended: option.recommended === true,
  }));
  if (new Set(normalized.map((option) => option.id)).size !== normalized.length) {
    throw new Error("DialogueCheckpoint option ids must be unique.");
  }
  if (normalized.filter((option) => option.recommended).length > 1) {
    throw new Error("DialogueCheckpoint supports at most one recommended option.");
  }
  return normalized;
}

function isDialogueOption(value: unknown): value is DialogueCheckpointOption {
  return isRecord(value) && isText(value.id) && isText(value.label) && isText(value.description)
    && typeof value.recommended === "boolean";
}

function requireText(value: string, field: string) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`DialogueCheckpoint ${field} is required.`);
  return normalized;
}

function requireNonNegativeInteger(value: number, field: string) {
  if (!isNonNegativeInteger(value)) throw new Error(`DialogueCheckpoint ${field} must be a non-negative integer.`);
  return value;
}

function validDate(value: string, field: string) {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`DialogueCheckpoint ${field} is invalid.`);
  return value;
}

function isText(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
