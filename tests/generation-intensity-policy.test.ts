import { describe, expect, it } from "vitest";

import {
  canSuggestGenerationIntensityUpgrade,
  deriveGenerationIntensitySuggestion,
  resolveGenerationIntensityStrategy,
} from "@/server/generation-intensity/generation-intensity-policy";

describe("V1-5 generation intensity policy", () => {
  it.each([
    ["standard", "gpt-5.6-terra", "medium"],
    ["enhanced", "gpt-5.6-terra", "high"],
    ["deep", "gpt-5.6-terra", "xhigh"],
    ["extreme", "gpt-5.6-sol", "high"],
  ] as const)("maps %s to its server-only strategy", (intensity, model, effort) => {
    expect(resolveGenerationIntensityStrategy(intensity)).toMatchObject({ model, reasoningEffort: effort });
  });

  it("only suggests the next level after auditable signals", () => {
    expect(canSuggestGenerationIntensityUpgrade({ current: "standard", consecutiveUnresolvedCount: 1 })).toMatchObject({ allowed: false });
    expect(canSuggestGenerationIntensityUpgrade({ current: "standard", consecutiveUnresolvedCount: 2 })).toMatchObject({ allowed: true, target: "enhanced" });
    expect(canSuggestGenerationIntensityUpgrade({ current: "deep", consecutiveUnresolvedCount: 2 })).toMatchObject({ allowed: false });
    expect(canSuggestGenerationIntensityUpgrade({ current: "deep", consecutiveUnresolvedCount: 3 })).toMatchObject({ allowed: true, target: "extreme" });
  });

  it("derives one stable next-level suggestion from persisted consecutive failures", () => {
    expect(deriveGenerationIntensitySuggestion({
      current: "standard",
      intentEpoch: 4,
      recentJobs: [
        { status: "succeeded" },
        { status: "failed", errorCode: "quality_unresolved" },
        { status: "failed", errorCode: "quality_unresolved" },
      ],
    })).toEqual({ target: "enhanced", reason: "repeated_unresolved", signature: "4:quality_unresolved" });
    expect(deriveGenerationIntensitySuggestion({
      current: "deep",
      intentEpoch: 4,
      recentJobs: [{ status: "failed" }, { status: "failed" }],
    })).toBeNull();
  });
});
