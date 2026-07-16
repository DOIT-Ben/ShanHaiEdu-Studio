import { describe, expect, it } from "vitest";

import {
  notifyProjectAgentEvent,
  waitForProjectAgentEvent,
} from "@/server/conversation/agent-event-notifier";

describe("agent event notifier", () => {
  it("wakes a matching project stream as soon as a newer committed sequence is announced", async () => {
    const waiting = waitForProjectAgentEvent({ projectId: "project-live", afterSequence: 3, fallbackMs: 5_000 });
    notifyProjectAgentEvent("project-other", 9);
    notifyProjectAgentEvent("project-live", 4);
    await expect(waiting).resolves.toBe("event");
  });

  it("closes cleanly on abort and does not treat the notifier as durable state", async () => {
    const controller = new AbortController();
    const waiting = waitForProjectAgentEvent({
      projectId: "project-abort",
      afterSequence: 0,
      fallbackMs: 5_000,
      signal: controller.signal,
    });
    controller.abort();
    await expect(waiting).resolves.toBe("aborted");
  });
});
