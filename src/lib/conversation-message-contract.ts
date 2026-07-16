export const MESSAGE_PART_VERSION = "message-part.v1" as const;

type MessagePartBase<TType extends string> = {
  type: TType;
  schemaVersion: typeof MESSAGE_PART_VERSION;
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

export type AssistantUiCompatibleMessage = {
  id: string;
  role: "assistant" | "user" | "system";
  content: Array<
    | { type: "text"; text: string }
    | { type: "data"; name: `shanhai.${Exclude<MessagePart["type"], "text">}`; data: Exclude<MessagePart, TextMessagePart> }
  >;
};

export type ConversationMessageArtifactProjection = {
  artifactId: string;
  version: number;
  digest: string;
  title: string;
  summary: string;
  qualityOutcome?: QualitySummaryMessagePart["outcome"];
  findingLocators?: string[];
};

export function projectConversationMessageParts(input: {
  role: "assistant" | "teacher" | "user" | "system";
  content: string;
  artifactRefs?: ConversationMessageArtifactProjection[];
  metadata?: Record<string, unknown>;
}): MessagePart[] {
  const parts: MessagePart[] = legacyContentToMessageParts(input.content);
  if (input.role !== "assistant") return parts;

  const metadata = isRecord(input.metadata) ? input.metadata : {};
  const persistentActivities = toPersistentActivityParts(metadata.agentActivities);
  if (persistentActivities.length) parts.unshift(...persistentActivities);
  const dialogueCheckpoint = toDialogueCheckpointPart(metadata.dialogueCheckpoint);
  if (dialogueCheckpoint) parts.push(dialogueCheckpoint);
  const pendingPlan = isRecord(metadata.pendingDeliveryPlan) ? metadata.pendingDeliveryPlan : undefined;
  const deliveryPlan = isRecord(pendingPlan?.deliveryPlan) ? pendingPlan.deliveryPlan : undefined;
  const planPart = toPlanPart(deliveryPlan);
  if (planPart) parts.push(planPart);

  const toolStatus = toToolStatusPart(metadata.latestToolStatus)
    ?? toToolStatusPartFromObservation(latestRecord(metadata.agentObservations));
  if (toolStatus && !persistentActivities.some((activity) =>
    Boolean(toolStatus.observationId && activity.evidenceRefs.includes(toolStatus.observationId)) ||
    Boolean(toolStatus.reasonCode && activity.reasonCode === toolStatus.reasonCode && activity.activityKind === "tool")
  )) parts.push(toolStatus);

  for (const artifact of input.artifactRefs ?? []) {
    const artifactPart: ArtifactRefMessagePart = {
      type: "artifact-ref",
      schemaVersion: MESSAGE_PART_VERSION,
      artifactId: artifact.artifactId,
      version: artifact.version,
      digest: artifact.digest,
      title: artifact.title,
      summary: artifact.summary,
    };
    if (isMessagePart(artifactPart)) parts.push(artifactPart);
    if (artifact.qualityOutcome) {
      const qualityPart: QualitySummaryMessagePart = {
        type: "quality-summary",
        schemaVersion: MESSAGE_PART_VERSION,
        artifactId: artifact.artifactId,
        version: artifact.version,
        outcome: artifact.qualityOutcome,
        summary: qualitySummaryFor(artifact.qualityOutcome),
        findingLocators: uniqueStrings(artifact.findingLocators ?? []),
      };
      if (isMessagePart(qualityPart)) parts.push(qualityPart);
    }
  }

  const pendingDecision = isRecord(pendingPlan?.pendingDecision) ? pendingPlan.pendingDecision : undefined;
  const humanInput = toHumanInputPart(pendingDecision);
  if (humanInput) {
    parts.push(humanInput);
    parts.push({
      type: "next-actions",
      schemaVersion: MESSAGE_PART_VERSION,
      actions: humanInput.options.map((option) => ({
        id: `decision:${humanInput.decisionId}:${option.id}`,
        label: option.label,
        kind: "human_decision",
        actionId: humanInput.actionId,
        recommended: option.recommended,
      })),
    });
  }

  const recovery = toErrorRecoveryPart(metadata.recovery)
    ?? toErrorRecoveryPartFromCheckpoint(metadata.agentRunCheckpoint, latestRecord(metadata.agentObservations));
  if (recovery) parts.push(recovery);
  return parts;
}

export function legacyContentToMessageParts(content: string): MessagePart[] {
  if (!content) return [];
  return [{ type: "text", schemaVersion: MESSAGE_PART_VERSION, text: content, format: "markdown" }];
}

export function normalizeMessageParts(value: unknown): MessagePart[] {
  if (!Array.isArray(value)) return [invalidMessagePart(0)];
  return value.map((part, index) => isMessagePart(part) ? part : invalidMessagePart(index));
}

export function projectMessagePartsToAssistantUi(input: {
  id: string;
  role: "assistant" | "teacher" | "user" | "system";
  parts: unknown;
}): AssistantUiCompatibleMessage {
  const role = input.role === "teacher" ? "user" : input.role;
  const content = normalizeMessageParts(input.parts).map((part) => {
    if (part.type === "text") return { type: "text" as const, text: part.text };
    return {
      type: "data" as const,
      name: `shanhai.${part.type}` as const,
      data: part,
    };
  });
  return { id: input.id, role, content };
}

function isMessagePart(value: unknown): value is MessagePart {
  if (!isRecord(value) || value.schemaVersion !== MESSAGE_PART_VERSION || typeof value.type !== "string") return false;
  switch (value.type) {
    case "text":
      return isNonEmptyString(value.text) && (value.format === "plain" || value.format === "markdown");
    case "activity":
      return isNonEmptyString(value.activityId)
        && isNonEmptyString(value.label)
        && isOneOf(value.status, ["queued", "running", "waiting", "paused", "completed", "succeeded", "failed", "blocked", "canceled"])
        && isStringArray(value.evidenceRefs)
        && (value.activityKind === undefined || isOneOf(value.activityKind, ["response", "tool", "artifact", "quality", "decision", "task"]))
        && isOptionalNonEmptyString(value.reasonCode)
        && (value.artifactRefs === undefined || isStringArray(value.artifactRefs))
        && isOptionalNonEmptyString(value.purpose)
        && (value.inputSummary === undefined || isStringArray(value.inputSummary))
        && isOptionalNonEmptyString(value.expectedOutput)
        && isOptionalNonEmptyString(value.observationSummary)
        && isOptionalDate(value.startedAt)
        && isOptionalDate(value.finishedAt)
        && (value.durationMs === undefined || isNonNegativeNumber(value.durationMs));
    case "plan":
      return isNonEmptyString(value.planId)
        && isNonNegativeInteger(value.revision)
        && isNonEmptyString(value.title)
        && Array.isArray(value.steps)
        && value.steps.every(isPlanStep);
    case "tool-status":
      return isNonEmptyString(value.invocationId)
        && isNonEmptyString(value.label)
        && isOneOf(value.status, ["queued", "running", "succeeded", "failed", "blocked", "canceled"])
        && isOptionalNonEmptyString(value.observationId)
        && isOptionalNonEmptyString(value.reasonCode);
    case "artifact-ref":
      return isNonEmptyString(value.artifactId)
        && isPositiveInteger(value.version)
        && isSha256(value.digest)
        && isNonEmptyString(value.title)
        && typeof value.summary === "string";
    case "quality-summary":
      return isNonEmptyString(value.artifactId)
        && isPositiveInteger(value.version)
        && isOneOf(value.outcome, ["pending", "passed", "needs_repair", "blocked", "failed"])
        && isNonEmptyString(value.summary)
        && isStringArray(value.findingLocators);
    case "human-input":
      return isNonEmptyString(value.decisionId)
        && isNonEmptyString(value.actionId)
        && isNonEmptyString(value.question)
        && Array.isArray(value.options)
        && value.options.length > 0
        && value.options.every(isHumanInputOption)
        && hasUniqueIds(value.options);
    case "dialogue-checkpoint":
      return isNonEmptyString(value.checkpointId)
        && isNonEmptyString(value.question)
        && isNonEmptyString(value.understandingSummary)
        && isNonEmptyString(value.impactSummary)
        && Array.isArray(value.options)
        && value.options.length >= 2
        && value.options.length <= 4
        && value.options.every(isDialogueCheckpointOption)
        && hasUniqueIds(value.options)
        && typeof value.allowFreeText === "boolean";
    case "next-actions":
      return Array.isArray(value.actions)
        && value.actions.length > 0
        && value.actions.every(isNextAction)
        && hasUniqueIds(value.actions);
    case "error-recovery":
      return isNonEmptyString(value.errorId)
        && isNonEmptyString(value.reasonCode)
        && isNonEmptyString(value.summary)
        && isRecovery(value.recovery);
    default:
      return false;
  }
}

function isPlanStep(value: unknown) {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.title)
    && isOneOf(value.status, ["pending", "running", "waiting", "completed", "succeeded", "failed", "blocked", "skipped", "canceled"]);
}

function toPlanPart(value: Record<string, unknown> | undefined): PlanMessagePart | undefined {
  if (!value || !isNonEmptyString(value.planId) || !isNonNegativeInteger(value.revision)
      || !isNonEmptyString(value.title) || !Array.isArray(value.steps)) return undefined;
  const part: PlanMessagePart = {
    type: "plan",
    schemaVersion: MESSAGE_PART_VERSION,
    planId: value.planId,
    revision: value.revision,
    title: value.title,
    steps: value.steps.filter(isPlanStep).map((step) => ({
      id: step.id as string,
      title: step.title as string,
      status: step.status as PlanMessagePart["steps"][number]["status"],
    })),
  };
  return isMessagePart(part) ? part : undefined;
}

function toPersistentActivityParts(value: unknown): ActivityMessagePart[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((part) =>
    isMessagePart(part) && part.type === "activity" ? [structuredClone(part)] : [],
  );
}

export function toDialogueCheckpointPart(value: unknown): DialogueCheckpointMessagePart | undefined {
  if (!isRecord(value) || value.schemaVersion !== "dialogue-checkpoint.v1" || value.status !== "pending" || !Array.isArray(value.options)) {
    return undefined;
  }
  const part: DialogueCheckpointMessagePart = {
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
  };
  return isMessagePart(part) ? part : undefined;
}

function toToolStatusPart(value: unknown): ToolStatusMessagePart | undefined {
  if (!isRecord(value)) return undefined;
  const part: ToolStatusMessagePart = {
    type: "tool-status",
    schemaVersion: MESSAGE_PART_VERSION,
    invocationId: typeof value.invocationId === "string" ? value.invocationId : "",
    label: typeof value.label === "string" ? value.label : "",
    status: value.status as ToolStatusMessagePart["status"],
    ...(typeof value.observationId === "string" ? { observationId: value.observationId } : {}),
    ...(typeof value.reasonCode === "string" ? { reasonCode: value.reasonCode } : {}),
  };
  return isMessagePart(part) ? part : undefined;
}

function toToolStatusPartFromObservation(value: unknown): ToolStatusMessagePart | undefined {
  if (!isRecord(value) || !isNonEmptyString(value.observationId) || !isNonEmptyString(value.teacherSafeSummary)) {
    return undefined;
  }
  const status = observationStatus(value.status);
  if (!status) return undefined;
  const reasonCodes = Array.isArray(value.reasonCodes) ? value.reasonCodes.filter(isNonEmptyString) : [];
  return {
    type: "tool-status",
    schemaVersion: MESSAGE_PART_VERSION,
    invocationId: value.observationId,
    label: value.teacherSafeSummary,
    status,
    observationId: value.observationId,
    ...(reasonCodes[0] ? { reasonCode: reasonCodes[0] } : {}),
  };
}

function toHumanInputPart(value: Record<string, unknown> | undefined): HumanInputMessagePart | undefined {
  if (!value || !Array.isArray(value.options)) return undefined;
  const part: HumanInputMessagePart = {
    type: "human-input",
    schemaVersion: MESSAGE_PART_VERSION,
    decisionId: typeof value.decisionId === "string" ? value.decisionId : "",
    actionId: typeof value.actionId === "string" ? value.actionId : "",
    question: typeof value.question === "string" ? value.question : "",
    options: value.options.filter(isHumanInputOption).map((option) => ({
      id: option.id as string,
      label: option.label as string,
      ...(typeof option.recommended === "boolean" ? { recommended: option.recommended } : {}),
    })),
  };
  return isMessagePart(part) ? part : undefined;
}

function toErrorRecoveryPart(value: unknown): ErrorRecoveryMessagePart | undefined {
  if (!isRecord(value)) return undefined;
  const recovery = {
    kind: value.kind,
    label: value.label,
    ...(typeof value.checkpointId === "string" ? { checkpointId: value.checkpointId } : {}),
    ...(typeof value.actionId === "string" ? { actionId: value.actionId } : {}),
  };
  const part: ErrorRecoveryMessagePart = {
    type: "error-recovery",
    schemaVersion: MESSAGE_PART_VERSION,
    errorId: typeof value.errorId === "string" ? value.errorId : "",
    reasonCode: typeof value.reasonCode === "string" ? value.reasonCode : "",
    summary: typeof value.summary === "string" ? value.summary : "",
    recovery: recovery as ErrorRecoveryMessagePart["recovery"],
  };
  return isMessagePart(part) ? part : undefined;
}

function toErrorRecoveryPartFromCheckpoint(checkpointValue: unknown, observationValue: unknown): ErrorRecoveryMessagePart | undefined {
  if (!isRecord(checkpointValue) || !isNonEmptyString(checkpointValue.checkpointId)) return undefined;
  if (checkpointValue.reason === "dialogue_checkpoint_required") return undefined;
  const observation = isRecord(observationValue) ? observationValue : undefined;
  const reasonCodes = Array.isArray(observation?.reasonCodes) ? observation.reasonCodes.filter(isNonEmptyString) : [];
  const part: ErrorRecoveryMessagePart = {
    type: "error-recovery",
    schemaVersion: MESSAGE_PART_VERSION,
    errorId: isNonEmptyString(observation?.observationId) ? observation.observationId : checkpointValue.checkpointId,
    reasonCode: reasonCodes[0] ?? "task_paused",
    summary: isNonEmptyString(observation?.teacherSafeSummary)
      ? observation.teacherSafeSummary
      : "当前进度已经保存，可以稍后继续。",
    recovery: {
      kind: "resume",
      label: "从当前进度继续",
      checkpointId: checkpointValue.checkpointId,
    },
  };
  return isMessagePart(part) ? part : undefined;
}

function latestRecord(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return [...value].reverse().find(isRecord);
}

function observationStatus(value: unknown): ToolStatusMessagePart["status"] | undefined {
  if (value === "succeeded") return "succeeded";
  if (value === "failed") return "failed";
  if (value === "blocked" || value === "needs_input" || value === "inconclusive" || value === "repair") return "blocked";
  return undefined;
}

function qualitySummaryFor(outcome: QualitySummaryMessagePart["outcome"]) {
  if (outcome === "passed") return "这份成果已通过当前内部检查。";
  if (outcome === "needs_repair") return "这份成果需要按定位结果调整。";
  if (outcome === "blocked") return "这份成果暂时不能继续用于下一步。";
  if (outcome === "failed") return "这份成果没有通过当前检查。";
  return "正在检查这份成果。";
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isHumanInputOption(value: unknown) {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.label)
    && (value.recommended === undefined || typeof value.recommended === "boolean");
}

function isDialogueCheckpointOption(value: unknown) {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.label)
    && isNonEmptyString(value.description)
    && typeof value.recommended === "boolean";
}

function isNextAction(value: unknown) {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.label)
    && isNonEmptyString(value.kind)
    && isOptionalNonEmptyString(value.actionId)
    && isOptionalNonEmptyString(value.artifactId)
    && isOptionalNonEmptyString(value.prompt)
    && (value.recommended === undefined || typeof value.recommended === "boolean");
}

function isRecovery(value: unknown) {
  if (!isRecord(value)
    || !isOneOf(value.kind, ["reload", "retry", "resume", "change_direction", "request_input"])
    || !isNonEmptyString(value.label)
    || !isOptionalNonEmptyString(value.checkpointId)
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
