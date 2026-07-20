export const MESSAGE_PART_VERSION = "message-part.v1" as const;

type MessagePartBase<TType extends string> = {
  type: TType;
  schemaVersion: typeof MESSAGE_PART_VERSION;
  sourceEventIds?: string[];
  sourceSequence?: number;
  sourceSequenceEnd?: number;
};

export type TextMessagePart = MessagePartBase<"text"> & {
  text: string;
  format: "plain" | "markdown";
};

export type ActivityMessagePart = MessagePartBase<"activity"> & {
  activityId: string;
  label: string;
  status: "queued" | "running" | "waiting" | "paused" | "completed" | "succeeded" | "failed" | "blocked" | "canceled";
  evidenceRefs: string[];
  activityKind?: "response" | "tool" | "artifact" | "quality" | "decision" | "task";
  reasonCode?: string;
  artifactRefs?: string[];
  purpose?: string;
  inputSummary?: string[];
  expectedOutput?: string;
  observationSummary?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
};

export type PlanMessagePart = MessagePartBase<"plan"> & {
  planId: string;
  revision: number;
  title: string;
  steps: Array<{
    id: string;
    title: string;
    status: "pending" | "running" | "waiting" | "completed" | "succeeded" | "failed" | "blocked" | "skipped" | "canceled";
  }>;
};

export type ToolStatusMessagePart = MessagePartBase<"tool-status"> & {
  invocationId: string;
  label: string;
  status: "queued" | "running" | "succeeded" | "failed" | "blocked" | "canceled";
  observationId?: string;
  reasonCode?: string;
};

export type ArtifactRefMessagePart = MessagePartBase<"artifact-ref"> & {
  artifactId: string;
  version: number;
  digest: string;
  title: string;
  summary: string;
};

export type QualitySummaryMessagePart = MessagePartBase<"quality-summary"> & {
  artifactId: string;
  version: number;
  outcome: "pending" | "passed" | "needs_repair" | "blocked" | "failed";
  summary: string;
  findingLocators: string[];
};

export type HumanInputMessagePart = MessagePartBase<"human-input"> & {
  decisionId: string;
  actionId: string;
  question: string;
  options: Array<{
    id: string;
    label: string;
    recommended?: boolean;
  }>;
};

export type DialogueCheckpointMessagePart = MessagePartBase<"dialogue-checkpoint"> & {
  checkpointId: string;
  question: string;
  understandingSummary: string;
  impactSummary: string;
  options: Array<{
    id: string;
    label: string;
    description: string;
    recommended: boolean;
  }>;
  allowFreeText: boolean;
};

export type NextActionsMessagePart = MessagePartBase<"next-actions"> & {
  actions: Array<{
    id: string;
    label: string;
    kind: string;
    actionId?: string;
    artifactId?: string;
    prompt?: string;
    recommended?: boolean;
  }>;
};

export type ErrorRecoveryMessagePart = MessagePartBase<"error-recovery"> & {
  errorId: string;
  reasonCode: string;
  summary: string;
  recovery: {
    kind: "reload" | "retry" | "resume" | "change_direction" | "request_input";
    label: string;
    checkpointId?: string;
    actionId?: string;
  };
};

export type MessagePart =
  | TextMessagePart
  | ActivityMessagePart
  | PlanMessagePart
  | ToolStatusMessagePart
  | ArtifactRefMessagePart
  | QualitySummaryMessagePart
  | HumanInputMessagePart
  | DialogueCheckpointMessagePart
  | NextActionsMessagePart
  | ErrorRecoveryMessagePart;

export function legacyContentToMessageParts(content: string): MessagePart[] {
  if (!content) return [];
  return [{ type: "text", schemaVersion: MESSAGE_PART_VERSION, text: content, format: "markdown" }];
}

export function normalizeMessageParts(value: unknown): MessagePart[] {
  if (!Array.isArray(value)) return [invalidMessagePart(0)];
  return value.map((part, index) => parseMessagePart(part) ?? invalidMessagePart(index));
}

export function toDialogueCheckpointPart(value: unknown): DialogueCheckpointMessagePart | undefined {
  if (!isRecord(value) || value.schemaVersion !== "dialogue-checkpoint.v1" || value.status !== "pending" || !Array.isArray(value.options)) {
    return undefined;
  }
  const part = parseMessagePart({
    type: "dialogue-checkpoint",
    schemaVersion: MESSAGE_PART_VERSION,
    checkpointId: typeof value.checkpointId === "string" ? value.checkpointId : "",
    question: typeof value.question === "string" ? value.question : "",
    understandingSummary: typeof value.understandingSummary === "string" ? value.understandingSummary : "",
    impactSummary: typeof value.impactSummary === "string" ? value.impactSummary : "",
    options: value.options.filter(isDialogueCheckpointOption).map((option) => ({
      id: option.id as string,
      label: option.label as string,
      description: option.description as string,
      recommended: option.recommended === true,
    })),
    allowFreeText: value.allowFreeText === true,
  });
  return part?.type === "dialogue-checkpoint" ? part : undefined;
}

export function parseMessagePart(value: unknown): MessagePart | undefined {
  if (!isRecord(value) || value.schemaVersion !== MESSAGE_PART_VERSION || typeof value.type !== "string") return undefined;
  const source = sourceFields(value);
  if (!source) return undefined;
  switch (value.type) {
    case "text":
      return isNonEmptyString(value.text) && isOneOf(value.format, ["plain", "markdown"])
        ? { type: "text", schemaVersion: MESSAGE_PART_VERSION, ...source, text: value.text, format: value.format }
        : undefined;
    case "activity":
      return parseActivityPart(value, source);
    case "plan":
      return parsePlanPart(value, source);
    case "tool-status":
      return parseToolStatusPart(value, source);
    case "artifact-ref":
      return isNonEmptyString(value.artifactId) && isPositiveInteger(value.version) && isSha256(value.digest)
        && isNonEmptyString(value.title) && typeof value.summary === "string"
        ? { type: "artifact-ref", schemaVersion: MESSAGE_PART_VERSION, ...source, artifactId: value.artifactId, version: value.version, digest: value.digest, title: value.title, summary: value.summary }
        : undefined;
    case "quality-summary":
      return isNonEmptyString(value.artifactId) && isPositiveInteger(value.version)
        && isOneOf(value.outcome, ["pending", "passed", "needs_repair", "blocked", "failed"])
        && isNonEmptyString(value.summary) && isStringArray(value.findingLocators)
        ? { type: "quality-summary", schemaVersion: MESSAGE_PART_VERSION, ...source, artifactId: value.artifactId, version: value.version, outcome: value.outcome, summary: value.summary, findingLocators: [...value.findingLocators] }
        : undefined;
    case "human-input":
      return parseHumanInputPart(value, source);
    case "dialogue-checkpoint":
      return parseDialogueCheckpointMessagePart(value, source);
    case "next-actions":
      return parseNextActionsPart(value, source);
    case "error-recovery":
      return parseErrorRecoveryPart(value, source);
    default:
      return undefined;
  }
}

type SourceFields = Pick<MessagePartBase<string>, "sourceEventIds" | "sourceSequence" | "sourceSequenceEnd">;

function sourceFields(value: Record<string, unknown>): SourceFields | undefined {
  if ((value.sourceEventIds !== undefined && !isStringArray(value.sourceEventIds))
    || (value.sourceSequence !== undefined && !isPositiveInteger(value.sourceSequence))
    || (value.sourceSequenceEnd !== undefined && !isPositiveInteger(value.sourceSequenceEnd))) return undefined;
  return {
    ...(value.sourceEventIds !== undefined ? { sourceEventIds: [...value.sourceEventIds as string[]] } : {}),
    ...(value.sourceSequence !== undefined ? { sourceSequence: value.sourceSequence as number } : {}),
    ...(value.sourceSequenceEnd !== undefined ? { sourceSequenceEnd: value.sourceSequenceEnd as number } : {}),
  };
}

function parseActivityPart(value: Record<string, unknown>, source: SourceFields): ActivityMessagePart | undefined {
  if (!isNonEmptyString(value.activityId) || !isNonEmptyString(value.label)
    || !isOneOf(value.status, ["queued", "running", "waiting", "paused", "completed", "succeeded", "failed", "blocked", "canceled"])
    || !isStringArray(value.evidenceRefs)
    || (value.activityKind !== undefined && !isOneOf(value.activityKind, ["response", "tool", "artifact", "quality", "decision", "task"]))
    || !isOptionalNonEmptyString(value.reasonCode)
    || (value.artifactRefs !== undefined && !isStringArray(value.artifactRefs))
    || !isOptionalNonEmptyString(value.purpose)
    || (value.inputSummary !== undefined && !isStringArray(value.inputSummary))
    || !isOptionalNonEmptyString(value.expectedOutput)
    || !isOptionalNonEmptyString(value.observationSummary)
    || !isOptionalDate(value.startedAt) || !isOptionalDate(value.finishedAt)
    || (value.durationMs !== undefined && !isNonNegativeNumber(value.durationMs))) return undefined;
  return {
    type: "activity",
    schemaVersion: MESSAGE_PART_VERSION,
    ...source,
    activityId: value.activityId,
    label: value.label,
    status: value.status,
    evidenceRefs: [...value.evidenceRefs],
    ...(value.activityKind !== undefined ? { activityKind: value.activityKind } : {}),
    ...(value.reasonCode !== undefined ? { reasonCode: value.reasonCode as string } : {}),
    ...(value.artifactRefs !== undefined ? { artifactRefs: [...value.artifactRefs] } : {}),
    ...(value.purpose !== undefined ? { purpose: value.purpose as string } : {}),
    ...(value.inputSummary !== undefined ? { inputSummary: [...value.inputSummary] } : {}),
    ...(value.expectedOutput !== undefined ? { expectedOutput: value.expectedOutput as string } : {}),
    ...(value.observationSummary !== undefined ? { observationSummary: value.observationSummary as string } : {}),
    ...(value.startedAt !== undefined ? { startedAt: value.startedAt as string } : {}),
    ...(value.finishedAt !== undefined ? { finishedAt: value.finishedAt as string } : {}),
    ...(value.durationMs !== undefined ? { durationMs: value.durationMs as number } : {}),
  };
}

function parsePlanPart(value: Record<string, unknown>, source: SourceFields): PlanMessagePart | undefined {
  if (!isNonEmptyString(value.planId) || !isNonNegativeInteger(value.revision) || !isNonEmptyString(value.title)
    || !Array.isArray(value.steps) || !value.steps.every(isPlanStep)) return undefined;
  return {
    type: "plan",
    schemaVersion: MESSAGE_PART_VERSION,
    ...source,
    planId: value.planId,
    revision: value.revision,
    title: value.title,
    steps: value.steps.map((step) => ({
      id: (step as Record<string, unknown>).id as string,
      title: (step as Record<string, unknown>).title as string,
      status: (step as Record<string, unknown>).status as PlanMessagePart["steps"][number]["status"],
    })),
  };
}

function parseToolStatusPart(value: Record<string, unknown>, source: SourceFields): ToolStatusMessagePart | undefined {
  if (!isNonEmptyString(value.invocationId) || !isNonEmptyString(value.label)
    || !isOneOf(value.status, ["queued", "running", "succeeded", "failed", "blocked", "canceled"])
    || !isOptionalNonEmptyString(value.observationId) || !isOptionalNonEmptyString(value.reasonCode)) return undefined;
  return {
    type: "tool-status",
    schemaVersion: MESSAGE_PART_VERSION,
    ...source,
    invocationId: value.invocationId,
    label: value.label,
    status: value.status,
    ...(value.observationId !== undefined ? { observationId: value.observationId as string } : {}),
    ...(value.reasonCode !== undefined ? { reasonCode: value.reasonCode as string } : {}),
  };
}

function parseHumanInputPart(value: Record<string, unknown>, source: SourceFields): HumanInputMessagePart | undefined {
  if (!isNonEmptyString(value.decisionId) || !isNonEmptyString(value.actionId) || !isNonEmptyString(value.question)
    || !Array.isArray(value.options) || value.options.length === 0
    || !value.options.every(isHumanInputOption) || !hasUniqueIds(value.options)) return undefined;
  return {
    type: "human-input",
    schemaVersion: MESSAGE_PART_VERSION,
    ...source,
    decisionId: value.decisionId,
    actionId: value.actionId,
    question: value.question,
    options: value.options.map((option) => {
      const record = option as Record<string, unknown>;
      return { id: record.id as string, label: record.label as string, ...(record.recommended !== undefined ? { recommended: record.recommended as boolean } : {}) };
    }),
  };
}

function parseDialogueCheckpointMessagePart(value: Record<string, unknown>, source: SourceFields): DialogueCheckpointMessagePart | undefined {
  if (!isNonEmptyString(value.checkpointId) || !isNonEmptyString(value.question)
    || !isNonEmptyString(value.understandingSummary) || !isNonEmptyString(value.impactSummary)
    || !Array.isArray(value.options) || value.options.length < 2 || value.options.length > 4
    || !value.options.every(isDialogueCheckpointOption) || !hasUniqueIds(value.options)
    || typeof value.allowFreeText !== "boolean") return undefined;
  return {
    type: "dialogue-checkpoint",
    schemaVersion: MESSAGE_PART_VERSION,
    ...source,
    checkpointId: value.checkpointId,
    question: value.question,
    understandingSummary: value.understandingSummary,
    impactSummary: value.impactSummary,
    options: value.options.map((option) => {
      const record = option as Record<string, unknown>;
      return { id: record.id as string, label: record.label as string, description: record.description as string, recommended: record.recommended as boolean };
    }),
    allowFreeText: value.allowFreeText,
  };
}

function parseNextActionsPart(value: Record<string, unknown>, source: SourceFields): NextActionsMessagePart | undefined {
  if (!Array.isArray(value.actions) || value.actions.length === 0
    || !value.actions.every(isNextAction) || !hasUniqueIds(value.actions)) return undefined;
  return {
    type: "next-actions",
    schemaVersion: MESSAGE_PART_VERSION,
    ...source,
    actions: value.actions.map((action) => {
      const record = action as Record<string, unknown>;
      return {
        id: record.id as string,
        label: record.label as string,
        kind: record.kind as string,
        ...(record.actionId !== undefined ? { actionId: record.actionId as string } : {}),
        ...(record.artifactId !== undefined ? { artifactId: record.artifactId as string } : {}),
        ...(record.prompt !== undefined ? { prompt: record.prompt as string } : {}),
        ...(record.recommended !== undefined ? { recommended: record.recommended as boolean } : {}),
      };
    }),
  };
}

function parseErrorRecoveryPart(value: Record<string, unknown>, source: SourceFields): ErrorRecoveryMessagePart | undefined {
  if (!isNonEmptyString(value.errorId) || !isNonEmptyString(value.reasonCode) || !isNonEmptyString(value.summary)
    || !isRecovery(value.recovery)) return undefined;
  return {
    type: "error-recovery",
    schemaVersion: MESSAGE_PART_VERSION,
    ...source,
    errorId: value.errorId,
    reasonCode: value.reasonCode,
    summary: value.summary,
    recovery: {
      kind: value.recovery.kind,
      label: value.recovery.label,
      ...(value.recovery.checkpointId !== undefined ? { checkpointId: value.recovery.checkpointId } : {}),
      ...(value.recovery.actionId !== undefined ? { actionId: value.recovery.actionId } : {}),
    },
  };
}

function isPlanStep(value: unknown) {
  return isRecord(value) && isNonEmptyString(value.id) && isNonEmptyString(value.title)
    && isOneOf(value.status, ["pending", "running", "waiting", "completed", "succeeded", "failed", "blocked", "skipped", "canceled"]);
}

function isHumanInputOption(value: unknown) {
  return isRecord(value) && isNonEmptyString(value.id) && isNonEmptyString(value.label)
    && (value.recommended === undefined || typeof value.recommended === "boolean");
}

function isDialogueCheckpointOption(value: unknown) {
  return isRecord(value) && isNonEmptyString(value.id) && isNonEmptyString(value.label)
    && isNonEmptyString(value.description) && typeof value.recommended === "boolean";
}

function isNextAction(value: unknown) {
  return isRecord(value) && isNonEmptyString(value.id) && isNonEmptyString(value.label) && isNonEmptyString(value.kind)
    && isOptionalNonEmptyString(value.actionId) && isOptionalNonEmptyString(value.artifactId)
    && isOptionalNonEmptyString(value.prompt) && (value.recommended === undefined || typeof value.recommended === "boolean");
}

function isRecovery(value: unknown): value is ErrorRecoveryMessagePart["recovery"] {
  if (!isRecord(value) || !isOneOf(value.kind, ["reload", "retry", "resume", "change_direction", "request_input"])
    || !isNonEmptyString(value.label) || !isOptionalNonEmptyString(value.checkpointId)
    || !isOptionalNonEmptyString(value.actionId)) return false;
  return value.kind !== "resume" || isNonEmptyString(value.checkpointId);
}

function invalidMessagePart(index: number): ErrorRecoveryMessagePart {
  return {
    type: "error-recovery",
    schemaVersion: MESSAGE_PART_VERSION,
    errorId: `invalid-message-part-${index + 1}`,
    reasonCode: "invalid_message_part",
    summary: "这部分消息无法安全显示，请重新加载后继续。",
    recovery: { kind: "reload", label: "重新加载消息" },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function isOptionalNonEmptyString(value: unknown) {
  return value === undefined || isNonEmptyString(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isOptionalDate(value: unknown) {
  return value === undefined || (typeof value === "string" && Number.isFinite(Date.parse(value)));
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === "string" && options.includes(value as T);
}

function hasUniqueIds(values: unknown[]) {
  const ids = values.map((value) => isRecord(value) ? value.id : undefined);
  return ids.every(isNonEmptyString) && new Set(ids).size === ids.length;
}
