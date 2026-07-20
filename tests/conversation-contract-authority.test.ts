import { describe, expect, it } from "vitest";

import { MESSAGE_PART_VERSION, normalizeMessageParts, type MessagePart } from "@/lib/conversation-message-contract";
import { AGENT_EVENT_VERSION, replayAgentEvents, type AgentEventEnvelope } from "@/server/conversation/agent-event-envelope";

describe("conversation contract authority", () => {
  it("keeps message normalization and event replay as independent versioned contracts", () => {
    const parts: MessagePart[] = [{
      type: "text",
      schemaVersion: MESSAGE_PART_VERSION,
      text: "先整理教学目标。",
      format: "plain",
    }];
    const events: AgentEventEnvelope[] = [{
      schemaVersion: AGENT_EVENT_VERSION,
      eventId: "event-1",
      projectId: "project-1",
      taskId: "task-1",
      runId: "run-1",
      intentEpoch: 0,
      sequence: 1,
      kind: "task_created",
      visibility: "teacher",
      occurredAt: "2026-07-20T00:00:00.000Z",
      payload: {},
    }];

    expect(normalizeMessageParts(parts)).toEqual(parts);
    expect(replayAgentEvents(events, { projectId: "project-1" })).toEqual(events);
  });
});
