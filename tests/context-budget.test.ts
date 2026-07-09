import { describe, expect, it } from "vitest";
import { estimateContextTokens, resolveContextBudgetMode } from "@/server/conversation/context-budget";
import type { ContextPackageMode } from "@/server/conversation/context-package";

const contextPackageModes: ContextPackageMode[] = ["full", "snapshot", "fallback"];

describe("ContextBudgetManager", () => {
  it("keeps small contexts in full mode", () => {
    const estimate = estimateContextTokens({
      systemRules: "你是主控 Agent",
      messages: ["你好", "帮我做五年级数学 PPT"],
      artifacts: [],
      snapshot: "",
    });

    expect(estimate).toBeGreaterThan(0);
    expect(resolveContextBudgetMode({ estimate, maxInputTokens: 10_000 })).toBe("full");
  });

  it("requests async compaction when context is medium sized", () => {
    expect(resolveContextBudgetMode({ estimate: 5_500, maxInputTokens: 10_000 })).toBe("precompact_async");
  });

  it("requires blocking compaction when context is too large", () => {
    expect(resolveContextBudgetMode({ estimate: 7_500, maxInputTokens: 10_000 })).toBe("compact_required");
  });

  it("uses async precompaction at the exact 0.4 budget ratio boundary", () => {
    expect(resolveContextBudgetMode({ estimate: 4_000, maxInputTokens: 10_000 })).toBe("precompact_async");
  });

  it("requires compaction at the exact 0.7 budget ratio boundary", () => {
    expect(resolveContextBudgetMode({ estimate: 7_000, maxInputTokens: 10_000 })).toBe("compact_required");
  });

  it("returns the minimum token estimate for empty input", () => {
    expect(estimateContextTokens({ systemRules: "", messages: [], artifacts: [], snapshot: "" })).toBe(1);
  });

  it("estimates message tokens from character length", () => {
    expect(estimateContextTokens({ systemRules: "", messages: ["abcd"], artifacts: [], snapshot: "" })).toBe(2);
  });

  it("keeps ContextPackageMode focused on actual package shape", () => {
    expect(contextPackageModes).toEqual(["full", "snapshot", "fallback"]);
  });
});
