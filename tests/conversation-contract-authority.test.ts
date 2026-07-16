import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("conversation contract authority", () => {
  it("keeps MessagePart and AgentEventEnvelope in their dedicated authoritative modules", () => {
    const taskContract = readFileSync("src/server/conversation/task-contract.ts", "utf8");
    expect(taskContract).not.toMatch(/export type MessagePart\b/);
    expect(taskContract).not.toMatch(/export type AgentEventEnvelope\b/);
  });
});
