import { AGENT_EVENT_ENVELOPE_VERSION } from "./task-contract";

export const AGENT_EVENT_VERSION = AGENT_EVENT_ENVELOPE_VERSION;

export type AgentEventVisibility = "teacher" | "internal";

export type AgentEventKind =
  | "task_created"
  | "task_updated"
  | "run_started"
  | "run_completed"
  | "run_failed"
  | "text_started"
  | "text_delta"
  | "text_completed"
  | "activity_updated"
  | "tool_started"
  | "tool_observed"
  | "decision_pending"
  | "artifact_committed"
  | "quality_updated"
  | "task_failed";

export type AgentEventEnvelope = {
  schemaVersion: typeof AGENT_EVENT_VERSION;
  eventId: string;
  projectId: string;
  taskId: string;
  runId: string;
  intentEpoch: number;
  sequence: number;
  kind: AgentEventKind;
  visibility: AgentEventVisibility;
  occurredAt: string;
  payload: Record<string, unknown>;
};

export type AgentEventStreamState = {
  projectId: string;
  lastSequence: number;
  eventIds: string[];
  events: AgentEventEnvelope[];
};

export function appendAgentEvent(
  state: AgentEventStreamState | undefined,
  event: AgentEventEnvelope,
): AgentEventStreamState {
  assertAgentEvent(event);

  if (state?.eventIds.includes(event.eventId)) {
    throw new Error(`Agent event duplicate eventId: ${event.eventId}`);
  }
  if (state && state.projectId !== event.projectId) {
    throw new Error("Agent event project does not match the event stream.");
  }

  const expectedSequence = (state?.lastSequence ?? 0) + 1;
  if (event.sequence !== expectedSequence) {
    throw new Error(`Agent event sequence must be ${expectedSequence}.`);
  }

  const storedEvent = cloneEvent(event);
  return {
    projectId: state?.projectId ?? storedEvent.projectId,
    lastSequence: storedEvent.sequence,
    eventIds: [...(state?.eventIds ?? []), storedEvent.eventId],
    events: [...(state?.events ?? []), storedEvent],
  };
}

export function replayAgentEvents(
  events: AgentEventEnvelope[],
  input: { projectId: string; afterSequence?: number },
): AgentEventEnvelope[] {
  const projectId = requireText(input.projectId, "projectId");
  const afterSequence = input.afterSequence ?? 0;
  if (!Number.isInteger(afterSequence) || afterSequence < 0) {
    throw new Error("Agent event replay afterSequence must be a non-negative integer.");
  }

  let previousSequence = 0;
  const eventIds = new Set<string>();
  const replay: AgentEventEnvelope[] = [];
  for (const event of events) {
    assertAgentEvent(event);
    if (event.projectId !== projectId) continue;
    if (eventIds.has(event.eventId)) throw new Error(`Agent event duplicate eventId: ${event.eventId}`);
    if (event.sequence <= previousSequence) throw new Error("Agent event replay sequence is out of order.");
    eventIds.add(event.eventId);
    previousSequence = event.sequence;
    if (event.sequence > afterSequence) replay.push(cloneEvent(event));
  }
  return replay;
}

function assertAgentEvent(event: AgentEventEnvelope): void {
  if (!event || typeof event !== "object") throw new Error("Agent event is required.");
  if (event.schemaVersion !== AGENT_EVENT_VERSION) throw new Error("Agent event schema version is invalid.");
  requireText(event.eventId, "eventId");
  requireText(event.projectId, "projectId");
  requireText(event.taskId, "taskId");
  requireText(event.runId, "runId");
  if (!Number.isInteger(event.intentEpoch) || event.intentEpoch < 0) {
    throw new Error("Agent event intentEpoch must be a non-negative integer.");
  }
  if (!Number.isInteger(event.sequence) || event.sequence < 1) {
    throw new Error("Agent event sequence must be a positive integer.");
  }
  if (!isAgentEventKind(event.kind)) throw new Error("Agent event kind is invalid.");
  if (event.visibility !== "teacher" && event.visibility !== "internal") {
    throw new Error("Agent event visibility is invalid.");
  }
  if (!Number.isFinite(Date.parse(event.occurredAt))) throw new Error("Agent event occurredAt is invalid.");
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) {
    throw new Error("Agent event payload must be an object.");
  }
}

function isAgentEventKind(value: string): value is AgentEventKind {
  return [
    "task_created",
    "task_updated",
    "run_started",
    "run_completed",
    "run_failed",
    "text_started",
    "text_delta",
    "text_completed",
    "activity_updated",
    "tool_started",
    "tool_observed",
    "decision_pending",
    "artifact_committed",
    "quality_updated",
    "task_failed",
  ].includes(value);
}

function cloneEvent(event: AgentEventEnvelope): AgentEventEnvelope {
  return structuredClone(event);
}

function requireText(value: string, field: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Agent event ${field} is required.`);
  return normalized;
}
