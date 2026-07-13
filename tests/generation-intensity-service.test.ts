import { describe, expect, it } from "vitest";

import {
  createGenerationIntensityConfirmationAction,
  isValidGenerationIntensityConfirmationAction,
} from "@/server/generation-intensity/generation-intensity-confirmation";

describe("V1-5 generation intensity confirmation", () => {
  it("binds extreme confirmation to project, version and target", () => {
    const actionId = createGenerationIntensityConfirmationAction({ projectId: "project-a", expectedVersion: 2, target: "extreme" });
    expect(isValidGenerationIntensityConfirmationAction({ actionId, projectId: "project-a", expectedVersion: 2, target: "extreme" })).toBe(true);
    expect(isValidGenerationIntensityConfirmationAction({ actionId, projectId: "project-b", expectedVersion: 2, target: "extreme" })).toBe(false);
    expect(isValidGenerationIntensityConfirmationAction({ actionId, projectId: "project-a", expectedVersion: 3, target: "extreme" })).toBe(false);
  });
});
