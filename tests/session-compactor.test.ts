import { describe, expect, it } from "vitest";
import { buildDeterministicSessionSummary, compactSessionWithValidation } from "@/server/conversation/session-compactor";

describe("SessionCompactor", () => {
  it("builds a deterministic summary with required sections and artifact state", () => {
    const summary = buildDeterministicSessionSummary({
      teacherGoal: "制作五年级数学百分数公开课材料。",
      recentMessages: [
        { role: "teacher", content: "帮我做百分数公开课。" },
        { role: "assistant", content: "先整理需求。" },
      ],
      artifacts: [{ title: "PPT设计稿", kind: "ppt_design_draft", status: "needs_review", isApproved: false }],
    });

    expect(summary).toContain("## Objective");
    expect(summary).toContain("## Workflow State");
    expect(summary).toContain("## Artifact State");
    expect(summary).toContain("PPT设计稿");
    expect(summary).toContain("needs_review");
    expect(summary).toContain("## Open Decisions");
    expect(summary).toContain("## Guardrails");
    expect(summary).toContain("不得把未完成产物写成已完成");
  });

  it("returns generated summary with passed validation when required guardrails are embedded", () => {
    const result = compactSessionWithValidation({
      teacherGoal: "制作五年级数学百分数公开课材料。",
      recentMessages: [{ role: "teacher", content: "帮我做百分数公开课。" }],
      artifacts: [],
      guardrails: ["不得伪造真实文件"],
    });

    expect(result.summary).toContain("## Guardrails");
    expect(result.summary).toContain("不得伪造真实文件");
    expect(result.validation.status).toBe("passed");
    expect(result.validation.errors).toEqual([]);
  });
});
