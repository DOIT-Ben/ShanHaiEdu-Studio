"use client";

import { useEffect, useState } from "react";

import {
  appendTeacherAgentEvent,
  parseTeacherAgentEvent,
  type TeacherAgentEvent,
} from "@/lib/teacher-agent-events";
import {
  buildProjectAgentEventStreamUrl,
  confirmProjectAgentEventCursor,
  readProjectAgentEventCursor,
  resolveProjectAgentEventReplayCursor,
} from "@/lib/project-agent-event-cursor";
import { createBoundedStreamCorrection } from "@/lib/project-agent-event-sync";

type ProjectEventState = {
  projectId: string;
  events: TeacherAgentEvent[];
};

export function useProjectAgentEvents(
  projectId: string,
  onEvent?: (event: TeacherAgentEvent) => Promise<number | null>,
  onStreamError?: () => void | Promise<void>,
) {
  const [state, setState] = useState<ProjectEventState>({ projectId: "", events: [] });

  useEffect(() => {
    setState({ projectId, events: [] });
    if (!projectId || typeof EventSource === "undefined") return;

    let acceptedEvents: TeacherAgentEvent[] = [];
    const durableCursor = readCursor(projectId);
    const replayCursor = resolveProjectAgentEventReplayCursor(durableCursor);
    const source = new EventSource(buildProjectAgentEventStreamUrl(projectId, replayCursor));
    const correction = createBoundedStreamCorrection({
      maxAttempts: 3,
      correct: async () => { await onStreamError?.(); },
    });
    source.onopen = correction.onOpen;
    source.onerror = () => { void correction.onError(); };
    source.onmessage = (message) => {
      try {
        const event = parseTeacherAgentEvent(message.data, projectId);
        if (event.sequence <= replayCursor || event.sequence <= (acceptedEvents.at(-1)?.sequence ?? replayCursor)) return;
        acceptedEvents = appendTeacherAgentEvent(acceptedEvents, event, projectId);
        setState({ projectId, events: acceptedEvents });
        if (event.sequence > durableCursor) void confirmCursorAfterSnapshot(projectId, event, onEvent);
      } catch {
        // Malformed, duplicate-conflicting, or cross-project events never enter the UI projection.
      }
    };

    return () => source.close();
  }, [onEvent, onStreamError, projectId]);

  return state.projectId === projectId ? state.events : [];
}

function readCursor(projectId: string) {
  try {
    return readProjectAgentEventCursor(window.localStorage, projectId);
  } catch {
    return 0;
  }
}

async function confirmCursorAfterSnapshot(
  projectId: string,
  event: TeacherAgentEvent,
  onEvent?: (event: TeacherAgentEvent) => Promise<number | null>,
) {
  if (!onEvent) return;
  try {
    await confirmProjectAgentEventCursor({
      storage: window.localStorage,
      projectId,
      eventSequence: event.sequence,
      confirmSnapshot: () => onEvent(event),
    });
  } catch {
    // A failed Snapshot confirmation deliberately leaves the durable cursor unchanged.
  }
}
