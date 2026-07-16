import { describe, expect, it } from "vitest";

import {
  buildProjectAgentEventStreamUrl,
  confirmProjectAgentEventCursor,
  readProjectAgentEventCursor,
  resolveProjectAgentEventReplayCursor,
  writeProjectAgentEventCursor,
} from "@/lib/project-agent-event-cursor";

describe("assistant-ui project event cursor", () => {
  it("persists the last accepted sequence and resumes after it", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };

    expect(readProjectAgentEventCursor(storage, "project-a")).toBe(0);
    writeProjectAgentEventCursor(storage, "project-a", 17);

    const cursor = readProjectAgentEventCursor(storage, "project-a");
    expect(cursor).toBe(17);
    expect(buildProjectAgentEventStreamUrl("project-a", cursor))
      .toBe("/api/workbench/projects/project-a/events?afterSequence=17");
  });

  it("replays a bounded window so an in-flight turn survives a page refresh", () => {
    expect(resolveProjectAgentEventReplayCursor(0)).toBe(0);
    expect(resolveProjectAgentEventReplayCursor(17)).toBe(0);
    expect(resolveProjectAgentEventReplayCursor(100)).toBe(36);
  });

  it("isolates projects and rejects malformed or decreasing cursor writes", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };

    writeProjectAgentEventCursor(storage, "project-a", 8);
    writeProjectAgentEventCursor(storage, "project-a", 3);
    expect(readProjectAgentEventCursor(storage, "project-a")).toBe(8);
    expect(readProjectAgentEventCursor(storage, "project-b")).toBe(0);
    expect(() => writeProjectAgentEventCursor(storage, "project-a", -1)).toThrow(/sequence/i);
  });

  it("commits an event cursor only after a snapshot confirms that sequence", async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };

    await expect(confirmProjectAgentEventCursor({
      storage,
      projectId: "project-a",
      eventSequence: 7,
      confirmSnapshot: async () => 6,
    })).resolves.toBe(false);
    expect(readProjectAgentEventCursor(storage, "project-a")).toBe(0);

    await expect(confirmProjectAgentEventCursor({
      storage,
      projectId: "project-a",
      eventSequence: 7,
      confirmSnapshot: async () => 7,
    })).resolves.toBe(true);
    expect(readProjectAgentEventCursor(storage, "project-a")).toBe(7);

    await expect(confirmProjectAgentEventCursor({
      storage,
      projectId: "project-a",
      eventSequence: 8,
      confirmSnapshot: async () => { throw new Error("snapshot unavailable"); },
    })).rejects.toThrow(/snapshot unavailable/i);
    expect(readProjectAgentEventCursor(storage, "project-a")).toBe(7);
  });
});
