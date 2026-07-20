import { legacyContentToMessageParts, type MessagePart } from "./conversation-message-parts";
import type { TeacherAgentEvent } from "./teacher-agent-event-contract";
import { buildTeacherAgentTimeline } from "./teacher-agent-event-timeline";
import type { ChatMessage } from "./types";

export function mergeTeacherAgentEventsIntoMessages(
  messages: ChatMessage[],
  events: TeacherAgentEvent[],
): ChatMessage[] {
  const orderedEvents = [...events].sort((left, right) => left.sequence - right.sequence);
  const runIds = new Set<string>();
  for (const event of orderedEvents) runIds.add(event.runId);

  const runs = [...runIds]
    .map((runId) => ({ runId, runEvents: orderedEvents.filter((event) => event.runId === runId) }))
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
      const projectionKind = timeline.some((part) => part.type === "activity")
        ? "agent-activity" as const
        : "agent-response" as const;
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

export function hasCurrentTurnAgentProjection(messages: ChatMessage[], events: TeacherAgentEvent[]) {
  const currentTeacherMessage = [...messages].reverse().find((message) =>
    message.speaker === "teacher" && (message.turnStatus === "queued" || message.turnStatus === "running"),
  );
  if (!currentTeacherMessage) return false;
  return buildTeacherAgentTimeline(events.filter((event) =>
    event.runId === `turn:${currentTeacherMessage.id}`,
  )).length > 0;
}

export function shouldRefreshSnapshotForAgentEvent(event: TeacherAgentEvent) {
  return event.kind !== "text_started" && event.kind !== "text_delta";
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

function hasPersistedAssistantResponse(messages: ChatMessage[], runId: string) {
  const sourceMessageId = teacherMessageIdFromRun(runId);
  return Boolean(sourceMessageId) && messages.some((message) =>
    message.speaker === "assistant" && message.turnSourceMessageId === sourceMessageId && !message.projectionKind,
  );
}

function teacherMessageIdFromRun(runId: string) {
  return runId.startsWith("turn:") ? runId.slice("turn:".length) : "";
}

function formatEventTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
