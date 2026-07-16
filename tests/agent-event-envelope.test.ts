import { describe, expect, it } from "vitest";

import {
  AGENT_EVENT_VERSION,
  appendAgentEvent,
  replayAgentEvents,
  type AgentEventEnvelope,
} from "@/server/conversation/agent-event-envelope";

describe("agent event envelope", () => {
  it("rejects duplicate, out-of-order and cross-project events while preserving resumable sequence", () => {
    const first = event({ eventId: "event-1", sequence: 1 });
    const second = event({ eventId: "event-2", sequence: 2 });
    const state = appendAgentEvent(appendAgentEvent(undefined, first), second);

    expect(() => appendAgentEvent(state, second)).toThrow(/duplicate/i);
    expect(() => appendAgentEvent(state, event({ eventId: "event-3", sequence: 4 }))).toThrow(/sequence/i);
    expect(() => appendAgentEvent(state, event({ eventId: "event-4", sequence: 3, projectId: "project-b" }))).toThrow(/project/i);
    expect(replayAgentEvents([first, second], { projectId: "project-a", afterSequence: 1 })).toEqual([second]);
  });
});

function event(overrides: Partial<AgentEventEnvelope>): AgentEventEnvelope {
  return {
    schemaVersion: AGENT_EVENT_VERSION,
    eventId: "event-1",
    projectId: "project-a",
    taskId: "task-a",
    runId: "run-a",
    intentEpoch: 2,
    sequence: 1,
    kind: "tool_observed",
    visibility: "teacher",
    occurredAt: "2026-07-14T00:00:00.000Z",
    payload: { observationId: "obs-1" },
    ...overrides,
  };
}
