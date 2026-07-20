import {
  legacyContentToMessageParts,
  MESSAGE_PART_VERSION,
  normalizeMessageParts,
  parseMessagePart,
  toDialogueCheckpointPart,
  type ActivityMessagePart,
  type ErrorRecoveryMessagePart,
  type HumanInputMessagePart,
  type MessagePart,
  type QualitySummaryMessagePart,
  type TextMessagePart,
  type ToolStatusMessagePart,
} from "./conversation-message-parts";

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
  const metadata = isRecord(input.metadata) ? input.metadata : {};
  const persistentTimeline = toPersistentTimelineParts(metadata.agentTimeline);
  const parts: MessagePart[] = persistentTimeline.length
    ? appendUnprojectedContent(persistentTimeline, input.content)
    : legacyContentToMessageParts(input.content);
  if (input.role !== "assistant") return parts;

  const persistentActivities = persistentTimeline.length ? [] : toPersistentActivityParts(metadata.agentActivities);
  if (persistentActivities.length) parts.unshift(...persistentActivities);
  const dialogueCheckpoint = toDialogueCheckpointPart(metadata.dialogueCheckpoint);
  if (dialogueCheckpoint && !parts.some((part) =>
    part.type === "dialogue-checkpoint" && part.checkpointId === dialogueCheckpoint.checkpointId
  )) parts.push(dialogueCheckpoint);

  const toolStatus = toToolStatusPart(metadata.latestToolStatus)
    ?? toToolStatusPartFromObservation(latestRecord(metadata.agentObservations));
  if (toolStatus && !persistentActivities.some((activity) =>
    Boolean(toolStatus.observationId && activity.evidenceRefs.includes(toolStatus.observationId))
    || Boolean(toolStatus.reasonCode && activity.reasonCode === toolStatus.reasonCode && activity.activityKind === "tool")
  )) parts.push(toolStatus);

  for (const artifact of input.artifactRefs ?? []) {
    const artifactPart = parseMessagePart({
      type: "artifact-ref",
      schemaVersion: MESSAGE_PART_VERSION,
      artifactId: artifact.artifactId,
      version: artifact.version,
      digest: artifact.digest,
      title: artifact.title,
      summary: artifact.summary,
    });
    if (artifactPart?.type === "artifact-ref") parts.push(artifactPart);
    if (artifact.qualityOutcome) {
      const qualityPart = parseMessagePart({
        type: "quality-summary",
        schemaVersion: MESSAGE_PART_VERSION,
        artifactId: artifact.artifactId,
        version: artifact.version,
        outcome: artifact.qualityOutcome,
        summary: qualitySummaryFor(artifact.qualityOutcome),
        findingLocators: uniqueStrings(artifact.findingLocators ?? []),
      });
      if (qualityPart?.type === "quality-summary") parts.push(qualityPart);
    }
  }

  const pendingDecision = isRecord(metadata.pendingDecision) ? metadata.pendingDecision : undefined;
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

export function projectMessagePartsToAssistantUi(input: {
  id: string;
  role: "assistant" | "teacher" | "user" | "system";
  parts: unknown;
}): AssistantUiCompatibleMessage {
  const role = input.role === "teacher" ? "user" : input.role;
  const content = normalizeMessageParts(input.parts).map((part) => {
    if (part.type === "text") return { type: "text" as const, text: part.text };
    return { type: "data" as const, name: `shanhai.${part.type}` as const, data: part };
  });
  return { id: input.id, role, content };
}

function toPersistentActivityParts(value: unknown): ActivityMessagePart[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((part) => {
    const parsed = parseMessagePart(part);
    return parsed?.type === "activity" ? [parsed] : [];
  });
}

function toPersistentTimelineParts(value: unknown): MessagePart[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((part) => {
    const parsed = parseMessagePart(part);
    return parsed && (parsed.type === "text" || parsed.type === "activity" || parsed.type === "dialogue-checkpoint")
      && parsed.sourceEventIds?.length ? [parsed] : [];
  });
}

function appendUnprojectedContent(timeline: MessagePart[], content: string): MessagePart[] {
  if (!content) return timeline;
  const projectedText = timeline.flatMap((part) => part.type === "text" ? [part.text] : []).join("");
  if (projectedText === content) return timeline;
  if (projectedText && content.startsWith(projectedText)) {
    return [...timeline, ...legacyContentToMessageParts(content.slice(projectedText.length))];
  }
  return [...timeline, ...legacyContentToMessageParts(content)];
}

function toToolStatusPart(value: unknown): ToolStatusMessagePart | undefined {
  if (!isRecord(value)) return undefined;
  const part = parseMessagePart({
    type: "tool-status",
    schemaVersion: MESSAGE_PART_VERSION,
    invocationId: typeof value.invocationId === "string" ? value.invocationId : "",
    label: typeof value.label === "string" ? value.label : "",
    status: value.status,
    ...(typeof value.observationId === "string" ? { observationId: value.observationId } : {}),
    ...(typeof value.reasonCode === "string" ? { reasonCode: value.reasonCode } : {}),
  });
  return part?.type === "tool-status" ? part : undefined;
}

function toToolStatusPartFromObservation(value: unknown): ToolStatusMessagePart | undefined {
  if (!isRecord(value) || !isNonEmptyString(value.observationId) || !isNonEmptyString(value.teacherSafeSummary)) return undefined;
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
  if (!value || (typeof value.status === "string" && value.status !== "pending") || !Array.isArray(value.options)) return undefined;
  const options = value.options.filter(isHumanInputOption).map((option) => ({
    id: option.id,
    label: option.label,
    ...(option.recommended !== undefined ? { recommended: option.recommended } : {}),
  }));
  const part = parseMessagePart({
    type: "human-input",
    schemaVersion: MESSAGE_PART_VERSION,
    decisionId: typeof value.decisionId === "string" ? value.decisionId : "",
    actionId: typeof value.actionId === "string" ? value.actionId : "",
    question: typeof value.question === "string" ? value.question : "",
    options,
  });
  return part?.type === "human-input" ? part : undefined;
}

function toErrorRecoveryPart(value: unknown): ErrorRecoveryMessagePart | undefined {
  if (!isRecord(value)) return undefined;
  const part = parseMessagePart({
    type: "error-recovery",
    schemaVersion: MESSAGE_PART_VERSION,
    errorId: typeof value.errorId === "string" ? value.errorId : "",
    reasonCode: typeof value.reasonCode === "string" ? value.reasonCode : "",
    summary: typeof value.summary === "string" ? value.summary : "",
    recovery: {
      kind: value.kind,
      label: value.label,
      ...(typeof value.checkpointId === "string" ? { checkpointId: value.checkpointId } : {}),
      ...(typeof value.actionId === "string" ? { actionId: value.actionId } : {}),
    },
  });
  return part?.type === "error-recovery" ? part : undefined;
}

function toErrorRecoveryPartFromCheckpoint(checkpointValue: unknown, observationValue: unknown): ErrorRecoveryMessagePart | undefined {
  if (!isRecord(checkpointValue) || !isNonEmptyString(checkpointValue.checkpointId)) return undefined;
  if (checkpointValue.reason === "dialogue_checkpoint_required") return undefined;
  const observation = isRecord(observationValue) ? observationValue : undefined;
  const reasonCodes = Array.isArray(observation?.reasonCodes) ? observation.reasonCodes.filter(isNonEmptyString) : [];
  return {
    type: "error-recovery",
    schemaVersion: MESSAGE_PART_VERSION,
    errorId: isNonEmptyString(observation?.observationId) ? observation.observationId : checkpointValue.checkpointId,
    reasonCode: reasonCodes[0] ?? "task_paused",
    summary: isNonEmptyString(observation?.teacherSafeSummary) ? observation.teacherSafeSummary : "当前进度已经保存，可以稍后继续。",
    recovery: { kind: "resume", label: "从当前进度继续", checkpointId: checkpointValue.checkpointId },
  };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function isHumanInputOption(value: unknown): value is { id: string; label: string; recommended?: boolean } {
  return isRecord(value) && isNonEmptyString(value.id) && isNonEmptyString(value.label)
    && (value.recommended === undefined || typeof value.recommended === "boolean");
}
