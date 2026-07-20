import { MESSAGE_PART_VERSION, parseMessagePart, type ActivityMessagePart, type DialogueCheckpointMessagePart } from "./conversation-message-parts";
import type { AgentEventEnvelope } from "@/server/conversation/agent-event-envelope";

export const TEACHER_AGENT_EVENT_VERSION = "agent-event-envelope.v1" as const;

export type TeacherAgentActivity = Omit<
  ActivityMessagePart,
  "type" | "schemaVersion" | "sourceEventIds" | "sourceSequence" | "sourceSequenceEnd"
>;

export type TeacherAgentEvent = Omit<AgentEventEnvelope, "visibility" | "payload"> & {
  schemaVersion: typeof TEACHER_AGENT_EVENT_VERSION;
  visibility: "teacher";
  payload: {
    activity: TeacherAgentActivity;
    text?: string;
    dialogueCheckpoint?: DialogueCheckpointMessagePart;
  };
};

export function parseTeacherAgentEvent(serialized: string, expectedProjectId: string): TeacherAgentEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("Teacher agent event is not valid JSON.");
  }
  const normalized = normalizeTeacherAgentEvent(parsed);
  if (!normalized) throw new Error("Teacher agent event is invalid.");
  if (normalized.projectId !== expectedProjectId) throw new Error("Teacher agent event project does not match.");
  return normalized;
}

export function appendTeacherAgentEvent(
  events: TeacherAgentEvent[],
  event: TeacherAgentEvent,
  expectedProjectId: string,
): TeacherAgentEvent[] {
  const normalized = normalizeTeacherAgentEvent(event);
  if (!normalized) throw new Error("Teacher agent event is invalid.");
  if (normalized.projectId !== expectedProjectId) throw new Error("Teacher agent event project does not match.");
  const duplicate = events.find((candidate) =>
    candidate.eventId === normalized.eventId || candidate.sequence === normalized.sequence,
  );
  if (duplicate) {
    if (duplicate.eventId === normalized.eventId && duplicate.sequence === normalized.sequence
      && sameValue(duplicate, normalized)) return events;
    if (duplicate.sequence === normalized.sequence && duplicate.eventId !== normalized.eventId) {
      throw new Error("Teacher agent event sequence conflicts with an existing event.");
    }
    throw new Error("Teacher agent event identity conflicts with an existing event.");
  }
  const previous = events.at(-1);
  if (previous && normalized.sequence <= previous.sequence) {
    throw new Error("Teacher agent event sequence is out of order.");
  }
  return [...events, normalized];
}

export function normalizeTeacherAgentEvent(value: unknown): TeacherAgentEvent | undefined {
  if (!isRecord(value) || value.schemaVersion !== TEACHER_AGENT_EVENT_VERSION || value.visibility !== "teacher") return undefined;
  if (!isEnvelopeShape(value)) return undefined;
  const payload = value.payload;
  if (!isRecord(payload) || !isRecord(payload.activity)) return undefined;
  const activity = normalizeTeacherActivity(payload.activity);
  if (!activity) return undefined;
  if (payload.text !== undefined && (typeof payload.text !== "string" || !isTextEvent(value.kind))) return undefined;
  const dialogueCheckpoint = payload.dialogueCheckpoint === undefined
    ? undefined
    : normalizeDialogueCheckpoint(payload.dialogueCheckpoint);
  if (payload.dialogueCheckpoint !== undefined && (!dialogueCheckpoint || value.kind !== "decision_pending")) return undefined;
  return {
    schemaVersion: TEACHER_AGENT_EVENT_VERSION,
    eventId: value.eventId,
    projectId: value.projectId,
    taskId: value.taskId,
    runId: value.runId,
    intentEpoch: value.intentEpoch,
    sequence: value.sequence,
    kind: value.kind,
    visibility: "teacher",
    occurredAt: value.occurredAt,
    payload: {
      activity,
      ...(payload.text !== undefined ? { text: payload.text } : {}),
      ...(dialogueCheckpoint ? { dialogueCheckpoint } : {}),
    },
  };
}

function normalizeTeacherActivity(value: Record<string, unknown>): TeacherAgentActivity | undefined {
  if (["sourceEventIds", "sourceSequence", "sourceSequenceEnd"].some((key) =>
    Object.prototype.hasOwnProperty.call(value, key))) return undefined;
  const parsed = parseMessagePart({ type: "activity", schemaVersion: MESSAGE_PART_VERSION, ...value });
  if (parsed?.type !== "activity") return undefined;
  return {
    activityId: parsed.activityId,
    label: parsed.label,
    status: parsed.status,
    evidenceRefs: [...parsed.evidenceRefs],
    ...(parsed.activityKind ? { activityKind: parsed.activityKind } : {}),
    ...(parsed.reasonCode ? { reasonCode: parsed.reasonCode } : {}),
    ...(parsed.artifactRefs ? { artifactRefs: [...parsed.artifactRefs] } : {}),
    ...(parsed.purpose ? { purpose: parsed.purpose } : {}),
    ...(parsed.inputSummary ? { inputSummary: [...parsed.inputSummary] } : {}),
    ...(parsed.expectedOutput ? { expectedOutput: parsed.expectedOutput } : {}),
    ...(parsed.observationSummary ? { observationSummary: parsed.observationSummary } : {}),
    ...(parsed.startedAt ? { startedAt: parsed.startedAt } : {}),
    ...(parsed.finishedAt ? { finishedAt: parsed.finishedAt } : {}),
    ...(parsed.durationMs !== undefined ? { durationMs: parsed.durationMs } : {}),
  };
}

function normalizeDialogueCheckpoint(value: unknown) {
  const parsed = parseMessagePart(value);
  return parsed?.type === "dialogue-checkpoint" ? parsed : undefined;
}

function isEnvelopeShape(value: Record<string, unknown>): value is Record<string, unknown> & {
  eventId: string;
  projectId: string;
  taskId: string;
  runId: string;
  intentEpoch: number;
  sequence: number;
  kind: TeacherAgentEvent["kind"];
  occurredAt: string;
  payload: Record<string, unknown>;
} {
  return isText(value.eventId) && isText(value.projectId) && isText(value.taskId) && isText(value.runId)
    && isNonNegativeInteger(value.intentEpoch) && isPositiveInteger(value.sequence)
    && isEventKind(value.kind) && typeof value.occurredAt === "string"
    && Number.isFinite(Date.parse(value.occurredAt)) && isRecord(value.payload);
}

function isEventKind(value: unknown): value is TeacherAgentEvent["kind"] {
  return [
    "task_created", "task_updated", "run_started", "run_completed", "run_failed",
    "text_started", "text_delta", "text_completed", "activity_updated", "tool_started",
    "tool_observed", "decision_pending", "artifact_committed", "quality_updated", "task_failed",
  ].includes(String(value));
}

function isTextEvent(kind: TeacherAgentEvent["kind"]) {
  return kind === "text_started" || kind === "text_delta" || kind === "text_completed";
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => sameValue(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) =>
    key === rightKeys[index] && sameValue(left[key], right[key]),
  );
}

function isText(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
