import {
  MESSAGE_PART_VERSION,
  type ActivityMessagePart,
  type DialogueCheckpointMessagePart,
  type MessagePart,
  type TextMessagePart,
} from "./conversation-message-parts";
import type { TeacherAgentEvent } from "./teacher-agent-event-contract";
import {
  isBusinessActivityEvent,
  isSubstantiveActivityEvent,
  isTextEvent,
  projectTeacherAgentEvent,
} from "./teacher-agent-event-projection";
import type { AgentEventEnvelope } from "@/server/conversation/agent-event-envelope";

export function teacherAgentEventToActivityPart(event: TeacherAgentEvent): ActivityMessagePart {
  return {
    type: "activity",
    schemaVersion: MESSAGE_PART_VERSION,
    ...structuredClone(event.payload.activity),
    sourceEventIds: [event.eventId],
    sourceSequence: event.sequence,
    sourceSequenceEnd: event.sequence,
  };
}

export function teacherAgentEventToMessageParts(event: TeacherAgentEvent): MessagePart[] {
  return [
    teacherAgentEventToActivityPart(event),
    ...(event.payload.dialogueCheckpoint ? [sourceBoundCheckpoint(event.payload.dialogueCheckpoint, event)] : []),
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
      if (event.kind === "text_started") {
        flushText();
        sawText = false;
      }
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

function sourceBoundCheckpoint(
  checkpoint: DialogueCheckpointMessagePart,
  event: TeacherAgentEvent,
): DialogueCheckpointMessagePart {
  return {
    ...structuredClone(checkpoint),
    sourceEventIds: [event.eventId],
    sourceSequence: event.sequence,
    sourceSequenceEnd: event.sequence,
  };
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

function isDuplicateTerminalFailure(event: TeacherAgentEvent, timeline: MessagePart[]) {
  const genericTerminalFailure = event.kind === "run_failed" || event.kind === "task_failed"
    || (event.kind === "activity_updated" && event.payload.activity.status === "failed" && event.payload.activity.activityKind !== "tool");
  if (!genericTerminalFailure) return false;
  const reasonCode = event.payload.activity.reasonCode;
  const evidence = [...event.payload.activity.evidenceRefs].sort();
  if (!reasonCode || !evidence.length) return false;
  return timeline.some((part) => part.type === "activity"
    && (part.status === "failed" || part.status === "blocked")
    && part.reasonCode === reasonCode && sameStrings([...part.evidenceRefs].sort(), evidence));
}

function sameStrings(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
