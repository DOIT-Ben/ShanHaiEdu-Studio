import { describe, expect, it, vi } from "vitest";

import { runOrchestratedTurn } from "@/server/conversation/orchestrator-runtime";

describe("single orchestrator runtime", () => {
  it("never delegates next-tool ownership to legacy outer or nested runtime loops", async () => {
    const selectAndRun = vi.fn(async () => ({ status: "paused" as const, checkpointId: "checkpoint-1" }));
    const legacyOuterLoop = vi.fn();
    const nestedRuntimeLoop = vi.fn();

    const result = await runOrchestratedTurn({ selectAndRun, legacyOuterLoop, nestedRuntimeLoop });

    expect(result).toEqual({ status: "paused", checkpointId: "checkpoint-1" });
    expect(selectAndRun).toHaveBeenCalledOnce();
    expect(legacyOuterLoop).not.toHaveBeenCalled();
    expect(nestedRuntimeLoop).not.toHaveBeenCalled();
  });
});
