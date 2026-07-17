import {
  legacyContentToMessageParts,
  MESSAGE_PART_VERSION,
  type ActivityMessagePart,
  type DialogueCheckpointMessagePart,
  type MessagePart,
  type TextMessagePart,
  toDialogueCheckpointPart,
} from "@/lib/conversation-message-contract";
import type { ChatMessage } from "@/lib/types";
import type { AgentEventEnvelope, AgentEventKind } from "@/server/conversation/agent-event-envelope";

export const TEACHER_AGENT_EVENT_VERSION = "agent-event-envelope.v1" as const;

export type TeacherAgentEvent = Omit<AgentEventEnvelope, "visibility" | "payload"> & {
  schemaVersion: typeof TEACHER_AGENT_EVENT_VERSION;
  visibility: "teacher";
  payload: {
    activity: Omit<ActivityMessagePart, "type" | "schemaVersion">;
    text?: string;
    dialogueCheckpoint?: DialogueCheckpointMessagePart;
  };
};

export function projectTeacherAgentEvent(event: AgentEventEnvelope): TeacherAgentEvent | null {
  if (!isEnvelopeShape(event)) return null;
  if (event.visibility !== "teacher") return null;
  const activity = activityFromEvent(event);
  if (!activity) return null;
  const text = event.visibility === "teacher" && isTextEvent(event.kind)
    ? teacherSafeEventText(event.payload.text)
    : undefined;
  const dialogueCheckpoint = event.kind === "decision_pending"
    ? toDialogueCheckpointPart(event.payload.dialogueCheckpoint)
    : undefined;
  return {
    schemaVersion: TEACHER_AGENT_EVENT_VERSION,
    eventId: event.eventId,
    projectId: event.projectId,
    taskId: event.taskId,
    runId: event.runId,
    intentEpoch: event.intentEpoch,
    sequence: event.sequence,
    kind: event.kind,
    visibility: "teacher",
    occurredAt: event.occurredAt,
    payload: {
      activity,
      ...(text ? { text } : {}),
      ...(dialogueCheckpoint ? { dialogueCheckpoint } : {}),
    },
  };
}

export function parseTeacherAgentEvent(serialized: string, expectedProjectId: string): TeacherAgentEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("Teacher agent event is not valid JSON.");
  }
  if (!isTeacherAgentEvent(parsed)) throw new Error("Teacher agent event is invalid.");
  if (parsed.projectId !== expectedProjectId) throw new Error("Teacher agent event project does not match.");
  return structuredClone(parsed);
}

export function appendTeacherAgentEvent(
  events: TeacherAgentEvent[],
  event: TeacherAgentEvent,
  expectedProjectId: string,
): TeacherAgentEvent[] {
  if (event.projectId !== expectedProjectId) throw new Error("Teacher agent event project does not match.");
  const duplicate = events.find((candidate) => candidate.eventId === event.eventId || candidate.sequence === event.sequence);
  if (duplicate) {
    if (duplicate.eventId === event.eventId && duplicate.sequence === event.sequence) return events;
    throw new Error("Teacher agent event sequence conflicts with an existing event.");
  }
  const previous = events.at(-1);
  if (previous && event.sequence <= previous.sequence) {
    throw new Error("Teacher agent event sequence is out of order.");
  }
  return [...events, structuredClone(event)];
}

export function teacherAgentEventToActivityPart(event: TeacherAgentEvent): ActivityMessagePart {
  return {
    type: "activity",
    schemaVersion: MESSAGE_PART_VERSION,
    sourceEventIds: [event.eventId],
    sourceSequence: event.sequence,
    sourceSequenceEnd: event.sequence,
    ...structuredClone(event.payload.activity),
  };
}

export function teacherAgentEventToMessageParts(event: TeacherAgentEvent): MessagePart[] {
  return [
    teacherAgentEventToActivityPart(event),
    ...(event.payload.dialogueCheckpoint ? [structuredClone(event.payload.dialogueCheckpoint)] : []),
  ];
}

export function collectPersistentTeacherActivityParts(
  events: AgentEventEnvelope[],
  runId: string,
): ActivityMessagePart[] {
  return collectPersistentTeacherMessageParts(events, runId)
    .filter((part): part is ActivityMessagePart => part.type === "activity");
}

export function collectPersistentTeacherMessageParts(
  events: AgentEventEnvelope[],
  runId: string,
): MessagePart[] {
  return buildTeacherAgentTimeline(events
    .filter((event) => event.runId === runId)
    .map(projectTeacherAgentEvent)
    .filter((event): event is TeacherAgentEvent => Boolean(event)));
}

export function buildTeacherAgentTimeline(events: TeacherAgentEvent[]): MessagePart[] {
  const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
  const includeSuccessfulTerminal = ordered.some((event) => isSubstantiveActivityEvent(event.kind));
  const timeline: MessagePart[] = [];
  let pendingText: TextMessagePart | undefined;
  let sawText = false;

  const flushText = () => {
    if (pendingText?.text) timeline.push(pendingText);
    pendingText = undefined;
  };

  for (const event of ordered) {
    if (isTextEvent(event.kind)) {
      const text = event.payload.text ?? "";
      if (event.kind === "text_started") flushText();
      if (text && (event.kind !== "text_completed" || !sawText)) {
        if (!pendingText) pendingText = textEventPart(text, event);
        else {
          pendingText.text += text;
          pendingText.sourceEventIds = [...(pendingText.sourceEventIds ?? []), event.eventId];
          pendingText.sourceSequenceEnd = event.sequence;
        }
        sawText = true;
      } else if (event.kind === "text_completed" && pendingText) {
        pendingText.sourceEventIds = [...(pendingText.sourceEventIds ?? []), event.eventId];
        pendingText.sourceSequenceEnd = event.sequence;
      }
      continue;
    }
    if (!isBusinessActivityEvent(event.kind) || (event.kind === "run_completed" && !includeSuccessfulTerminal)) continue;
    flushText();
    if (isDuplicateTerminalFailure(event, timeline)) continue;
    const eventParts = teacherAgentEventToMessageParts(event);
    if (event.kind === "tool_observed") {
      const nextActivity = eventParts.find((part): part is ActivityMessagePart => part.type === "activity");
      const existingIndex = nextActivity ? timeline.findIndex((part) =>
        part.type === "activity" && part.activityId === nextActivity.activityId && part.activityKind === "tool",
      ) : -1;
      if (nextActivity && existingIndex >= 0) {
        const existing = timeline[existingIndex] as ActivityMessagePart;
        timeline[existingIndex] = {
          ...nextActivity,
          sourceEventIds: [...(existing.sourceEventIds ?? []), ...(nextActivity.sourceEventIds ?? [])],
          sourceSequence: existing.sourceSequence,
          sourceSequenceEnd: nextActivity.sourceSequenceEnd,
        };
        continue;
      }
    }
    timeline.push(...eventParts);
  }
  flushText();
  return timeline;
}

export function mergeTeacherAgentEventsIntoMessages(
  messages: ChatMessage[],
  events: TeacherAgentEvent[],
): ChatMessage[] {
  const orderedEvents = [...events].sort((left, right) => left.sequence - right.sequence);
  const runIds = new Set<string>();
  for (const event of orderedEvents) runIds.add(event.runId);

  const runs = [...runIds]
    .map((runId) => ({
      runId,
      runEvents: orderedEvents.filter((event) => event.runId === runId),
    }))
    .map((run) => ({ ...run, timeline: buildTeacherAgentTimeline(run.runEvents) }))
    .sort((left, right) => (left.runEvents[0]?.sequence ?? 0) - (right.runEvents[0]?.sequence ?? 0));
  const timelineByTeacherMessageId = new Map<string, MessagePart[]>();
  for (const run of runs) {
    const teacherMessageId = teacherMessageIdFromRun(run.runId);
    if (!teacherMessageId || !run.timeline.length) continue;
    timelineByTeacherMessageId.set(teacherMessageId, run.timeline);
  }
  const messagesWithSettledActivities = messages.map((message) => {
    if (message.speaker !== "assistant" || !message.turnSourceMessageId) return message;
    const timeline = timelineByTeacherMessageId.get(message.turnSourceMessageId);
    if (!timeline?.length) return message;
    return {
      ...message,
      parts: mergeTimelineParts(
        timeline,
        message.parts?.length ? message.parts : legacyContentToMessageParts(message.body),
        message.body,
      ),
    };
  });
  const activities = runs
    .filter(({ runId }) => !hasPersistedAssistantResponse(messages, runId))
    .slice(-8)
    .flatMap<ChatMessage>(({ runId, timeline, runEvents }) => {
      const text = timeline.flatMap((part) => part.type === "text" ? [part.text] : []).join("");
      if (!timeline.length) return [];
      const latest = runEvents.at(-1)!;
      const projectionKind = timeline.some((part) => part.type === "activity") ? "agent-activity" as const : "agent-response" as const;
      return [{
        id: `${projectionKind}:${runId}`,
        speaker: "assistant",
        body: text,
        parts: timeline,
        projectionKind,
        timeLabel: formatEventTime(latest.occurredAt),
      }];
    });

  return activities.length ? [...messagesWithSettledActivities, ...activities] : messagesWithSettledActivities;
}

function mergeTimelineParts(timeline: MessagePart[], messageParts: MessagePart[], messageBody: string) {
  const liveEventIds = new Set(timeline.flatMap((part) => part.sourceEventIds ?? []));
  const persistedTimeline = messageParts.filter((part) => part.sourceEventIds?.length);
  const missingPersisted = persistedTimeline.filter((part) =>
    !(part.sourceEventIds ?? []).some((eventId) => liveEventIds.has(eventId)),
  );
  const sequenced = [...missingPersisted, ...timeline]
    .sort((left, right) => (left.sourceSequence ?? Number.MAX_SAFE_INTEGER) - (right.sourceSequence ?? Number.MAX_SAFE_INTEGER));
  const liveText = sequenced.flatMap((part) => part.type === "text" ? [part.text] : []).join("");
  const unsequenced = messageParts.filter((part) => !part.sourceEventIds?.length)
    .filter((part) => part.type !== "text" || (liveText !== messageBody && part.text !== liveText));
  return [...sequenced, ...unsequenced];
}

export function hasCurrentTurnAgentProjection(messages: ChatMessage[], events: TeacherAgentEvent[]) {
  const currentTeacherMessage = [...messages].reverse().find((message) =>
    message.speaker === "teacher" && (message.turnStatus === "queued" || message.turnStatus === "running"),
  );
  if (!currentTeacherMessage) return false;
  return buildTeacherAgentTimeline(events.filter((event) => event.runId === `turn:${currentTeacherMessage.id}`)).length > 0;
}

export function shouldRefreshSnapshotForAgentEvent(event: TeacherAgentEvent) {
  return event.kind !== "text_started" && event.kind !== "text_delta";
}

function textEventPart(text: string, event: TeacherAgentEvent): TextMessagePart {
  return {
    type: "text",
    schemaVersion: MESSAGE_PART_VERSION,
    text,
    format: "plain",
    sourceEventIds: [event.eventId],
    sourceSequence: event.sequence,
    sourceSequenceEnd: event.sequence,
  };
}

function activityFromEvent(event: AgentEventEnvelope): TeacherAgentEvent["payload"]["activity"] | null {
  if (event.kind === "activity_updated" && event.visibility === "teacher") {
    const activityId = optionalText(event.payload.activityId) ?? event.runId;
    const label = teacherSafeText(event.payload.label) ?? eventLabel(event.kind);
    const status = activityStatus(event.kind, event.payload.status, event.payload.control);
    return activityProjection(event, activityId, label, status);
  }
  if (event.kind === "tool_started" || event.kind === "tool_observed") {
    const activityId = optionalText(event.payload.activityId) ?? event.runId;
    const label = teacherSafeText(event.payload.label) ?? eventLabel(event.kind);
    return activityProjection(event, activityId, label, activityStatus(event.kind, event.payload.status, event.payload.control));
  }
  return activityProjection(
    event,
    event.runId,
    teacherSafeText(event.payload.label) ?? eventLabel(event.kind),
    activityStatus(event.kind, event.payload.status, event.payload.control),
  );
}

function activityProjection(
  event: AgentEventEnvelope,
  activityId: string,
  label: string,
  status: ActivityMessagePart["status"],
): TeacherAgentEvent["payload"]["activity"] {
  const reasonCode = optionalText(event.payload.reasonCode);
  const artifactRefs = artifactRefsFromPayload(event.payload);
  return {
    activityId,
    label,
    status,
    evidenceRefs: evidenceRefs(event.payload),
    activityKind: activityKind(event.kind),
    ...(reasonCode ? { reasonCode } : {}),
    ...(artifactRefs.length ? { artifactRefs } : {}),
    ...(teacherSafeText(event.payload.purpose) ? { purpose: teacherSafeText(event.payload.purpose) } : {}),
    ...(teacherSafeTextArray(event.payload.inputSummary).length ? { inputSummary: teacherSafeTextArray(event.payload.inputSummary) } : {}),
    ...(teacherSafeText(event.payload.expectedOutput) ? { expectedOutput: teacherSafeText(event.payload.expectedOutput) } : {}),
    ...(teacherSafeText(event.payload.observationSummary) ? { observationSummary: teacherSafeText(event.payload.observationSummary) } : {}),
    ...(validEventDate(event.payload.startedAt) ? { startedAt: String(event.payload.startedAt) } : {}),
    ...(validEventDate(event.payload.finishedAt) ? { finishedAt: String(event.payload.finishedAt) } : {}),
    ...(isNonNegativeNumber(event.payload.durationMs) ? { durationMs: event.payload.durationMs } : {}),
  };
}

function activityKind(kind: AgentEventKind): NonNullable<ActivityMessagePart["activityKind"]> {
  if (kind === "tool_started" || kind === "tool_observed") return "tool";
  if (kind === "artifact_committed") return "artifact";
  if (kind === "quality_updated") return "quality";
  if (kind === "decision_pending") return "decision";
  if (kind === "text_started" || kind === "text_delta" || kind === "text_completed") return "response";
  return "task";
}

function eventLabel(kind: AgentEventKind) {
  const labels: Record<AgentEventKind, string> = {
    task_created: "正在理解你的备课要求",
    task_updated: "已保存任务变化，正在重新安排",
    run_started: "正在推进这项任务",
    run_completed: "本轮任务已经完成",
    run_failed: "本轮没有完成，进度已经保存",
    text_started: "正在组织回复",
    text_delta: "正在组织回复",
    text_completed: "回复已经整理完成",
    activity_updated: "正在更新任务进度",
    tool_started: "正在执行当前步骤",
    tool_observed: "已读取当前步骤结果，正在决定下一步",
    decision_pending: "需要你做一个选择",
    artifact_committed: "已保存当前成果，正在决定下一步",
    quality_updated: "正在检查当前成果",
    task_failed: "任务暂时无法继续，进度已经保存",
  };
  return labels[kind];
}

function activityStatus(
  kind: AgentEventKind,
  rawStatus: unknown,
  control: unknown,
): ActivityMessagePart["status"] {
  if (kind === "task_updated" && control === "pause") return "paused";
  if (kind === "task_updated" && control === "cancel") return "canceled";
  if (["task_created", "run_started", "text_started", "text_delta", "tool_started"].includes(kind)) return "running";
  if (kind === "run_completed" || kind === "text_completed") return "completed";
  if (kind === "run_failed" && rawStatus === "blocked") return "blocked";
  if (kind === "run_failed" || kind === "task_failed") return "failed";
  if (kind === "decision_pending") return "waiting";
  if (rawStatus === "failed") return "failed";
  if (rawStatus === "succeeded") return "succeeded";
  if (rawStatus === "completed") return "completed";
  if (rawStatus === "blocked" || rawStatus === "needs_input" || rawStatus === "repair") return "blocked";
  if (rawStatus === "paused") return "paused";
  if (rawStatus === "canceled") return "canceled";
  return "running";
}

function evidenceRefs(payload: Record<string, unknown>) {
  const refs = ["observationId", "artifactId", "decisionId", "messageId", "checkpointId"]
    .flatMap((key) => optionalText(payload[key]) ? [String(payload[key]).trim()] : []);
  return [...new Set(refs)];
}

function artifactRefsFromPayload(payload: Record<string, unknown>) {
  const refs = Array.isArray(payload.artifactRefs) ? payload.artifactRefs : [];
  return [...new Set(refs.flatMap((value) => {
    if (typeof value === "string" && value.trim()) return [value.trim()];
    if (isRecord(value) && optionalText(value.artifactId)) return [String(value.artifactId).trim()];
    return [];
  }))];
}

function hasPersistedAssistantResponse(messages: ChatMessage[], runId: string) {
  const sourceMessageId = teacherMessageIdFromRun(runId);
  return Boolean(sourceMessageId) && messages.some((message) =>
    message.speaker === "assistant" && message.turnSourceMessageId === sourceMessageId && !message.projectionKind);
}

function teacherMessageIdFromRun(runId: string) {
  return runId.startsWith("turn:") ? runId.slice("turn:".length) : "";
}

function isBusinessActivityEvent(kind: AgentEventKind) {
  return [
    "activity_updated",
    "tool_started",
    "tool_observed",
    "decision_pending",
    "artifact_committed",
    "quality_updated",
    "run_completed",
    "run_failed",
    "task_failed",
  ].includes(kind);
}

function isSubstantiveActivityEvent(kind: AgentEventKind) {
  return isBusinessActivityEvent(kind) && kind !== "run_completed" && kind !== "run_failed" && kind !== "task_failed";
}

function isTeacherAgentEvent(value: unknown): value is TeacherAgentEvent {
  if (!isRecord(value) || value.schemaVersion !== TEACHER_AGENT_EVENT_VERSION || value.visibility !== "teacher") return false;
  if (!isEnvelopeShape(value as unknown as AgentEventEnvelope)) return false;
  if (!isRecord(value.payload) || !isRecord(value.payload.activity)) return false;
  const activity = value.payload.activity;
  return Boolean(optionalText(activity.activityId))
    && Boolean(optionalText(activity.label))
    && isActivityStatus(activity.status)
    && Array.isArray(activity.evidenceRefs)
    && activity.evidenceRefs.every((item) => Boolean(optionalText(item)))
    && (activity.activityKind === undefined || ["response", "tool", "artifact", "quality", "decision", "task"].includes(String(activity.activityKind)))
    && (activity.reasonCode === undefined || Boolean(optionalText(activity.reasonCode)))
    && (activity.artifactRefs === undefined || (Array.isArray(activity.artifactRefs) && activity.artifactRefs.every((item) => Boolean(optionalText(item)))))
    && (value.payload.text === undefined || typeof value.payload.text === "string")
    && (value.payload.dialogueCheckpoint === undefined || Boolean(toDialogueCheckpointPart(value.payload.dialogueCheckpoint)));
}

function isEnvelopeShape(value: AgentEventEnvelope) {
  return value?.schemaVersion === TEACHER_AGENT_EVENT_VERSION
    && Boolean(optionalText(value.eventId))
    && Boolean(optionalText(value.projectId))
    && Boolean(optionalText(value.taskId))
    && Boolean(optionalText(value.runId))
    && Number.isInteger(value.intentEpoch) && value.intentEpoch >= 0
    && Number.isInteger(value.sequence) && value.sequence > 0
    && isEventKind(value.kind)
    && (value.visibility === "teacher" || value.visibility === "internal")
    && Number.isFinite(Date.parse(value.occurredAt))
    && isRecord(value.payload);
}

function isEventKind(value: unknown): value is AgentEventKind {
  return [
    "task_created", "task_updated", "run_started", "run_completed", "run_failed",
    "text_started", "text_delta", "text_completed", "activity_updated", "tool_started",
    "tool_observed", "decision_pending", "artifact_committed", "quality_updated", "task_failed",
  ].includes(String(value));
}

function isActivityStatus(value: unknown): value is ActivityMessagePart["status"] {
  return ["queued", "running", "waiting", "paused", "completed", "succeeded", "failed", "blocked", "canceled"].includes(String(value));
}

function isTextEvent(kind: AgentEventKind) {
  return kind === "text_started" || kind === "text_delta" || kind === "text_completed";
}

function teacherSafeText(value: unknown) {
  const text = optionalText(value);
  if (!text) return undefined;
  return sanitizeTeacherVisibleText(text).slice(0, 500);
}

function teacherSafeEventText(value: unknown) {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return sanitizeTeacherVisibleText(value).slice(0, 500);
}

function sanitizeTeacherVisibleText(value: string) {
  return value
    .replace(/Observation\.reasonCodes|reasonCodes/gi, "上一步结果中的具体问题")
    .replace(/ExecutionEnvelope/gi, "当前执行范围")
    .replace(/TaskBrief/gi, "当前任务说明")
    .replace(/IntentEpoch/gi, "当前任务版本")
    .replace(/Director/gi, "设计审查")
    .replace(/repairIssues/gi, "待修正项")
    .replace(/Artifact/gi, "成果")
    .replace(/schema/gi, "结构要求")
    .replace(/manifest|provider|node_id|storage|debug|local\s+path|capabilityId|runtimeKind|providerStatus|placeholder/gi, "任务信息")
    .replace(/\bAPI(?:\s*key)?\b/gi, "服务信息");
}

function teacherSafeTextArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => teacherSafeText(item) ? [teacherSafeText(item)!] : []).slice(0, 6);
}

function validEventDate(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isDuplicateTerminalFailure(event: TeacherAgentEvent, timeline: MessagePart[]) {
  const genericTerminalFailure = event.kind === "run_failed" || event.kind === "task_failed" ||
    (event.kind === "activity_updated" && event.payload.activity.status === "failed" && event.payload.activity.activityKind !== "tool");
  if (!genericTerminalFailure) return false;
  const reasonCode = event.payload.activity.reasonCode;
  const evidence = [...event.payload.activity.evidenceRefs].sort();
  if (!reasonCode || !evidence.length) return false;
  return timeline.some((part) => part.type === "activity"
    && (part.status === "failed" || part.status === "blocked")
    && part.reasonCode === reasonCode
    && sameStrings([...part.evidenceRefs].sort(), evidence));
}

function sameStrings(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatEventTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
