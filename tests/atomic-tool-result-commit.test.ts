import { describe, expect, it } from "vitest";

import { commitToolResultAtomically } from "@/server/execution/tool-result-commit";

describe("atomic tool result commit", () => {
  it("rolls back artifact, observation and event when any commit member fails", async () => {
    const state = { artifacts: [] as string[], observations: [] as string[], events: [] as string[] };
    await expect(commitToolResultAtomically({
      transaction: async (commit) => {
        const snapshot = structuredClone(state);
        try {
          return await commit({
            saveArtifact: async () => { state.artifacts.push("artifact-1"); return "artifact-1"; },
            saveObservation: async () => { throw new Error("injected observation failure"); },
            saveEvent: async () => { state.events.push("event-1"); },
          });
        } catch (error) {
          Object.assign(state, snapshot);
          throw error;
        }
      },
      artifact: { id: "artifact-1" },
      observation: { id: "observation-1" },
      event: { id: "event-1" },
    })).rejects.toThrow(/injected observation failure/);

    expect(state).toEqual({ artifacts: [], observations: [], events: [] });
  });
});
