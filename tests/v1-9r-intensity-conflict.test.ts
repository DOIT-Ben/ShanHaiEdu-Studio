import { describe, expect, it, vi } from "vitest";

import { updateGenerationIntensityWithRecovery } from "@/hooks/workbench-generation-intensity-recovery";

describe("generation intensity conflict recovery", () => {
  it("reloads the authoritative project after a version conflict and rethrows the error", async () => {
    const reload = vi.fn(async () => undefined);
    const apply = vi.fn();
    const conflict = Object.assign(new Error("version conflict"), { status: 409 });

    await expect(updateGenerationIntensityWithRecovery({
      projectId: "project-1", intensity: "deep", expectedVersion: 3,
      update: vi.fn(async () => { throw conflict; }), apply, reload,
    })).rejects.toBe(conflict);
    expect(reload).toHaveBeenCalledWith("project-1");
    expect(apply).not.toHaveBeenCalled();
  });

  it("applies successful updates without reloading", async () => {
    const reload = vi.fn(async () => undefined);
    const apply = vi.fn();
    const result = { projectId: "project-1", intensity: "deep" };

    await expect(updateGenerationIntensityWithRecovery({
      projectId: "project-1", intensity: "deep", expectedVersion: 3,
      update: vi.fn(async () => result), apply, reload,
    })).resolves.toBe(result);
    expect(apply).toHaveBeenCalledWith(result);
    expect(reload).not.toHaveBeenCalled();
  });
});
