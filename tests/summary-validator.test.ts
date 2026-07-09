import { describe, expect, it } from "vitest";
import { buildDeterministicSessionSummary } from "@/server/conversation/session-compactor";
import { validateSessionSummary } from "@/server/conversation/summary-validator";

describe("SummaryValidator", () => {
  it("rejects summaries that claim unfinished artifacts are completed", () => {
    const result = validateSessionSummary({
      summaryMarkdown: "## Artifact State\n- PPTX 已完成并可下载。",
      artifacts: [{ id: "a1", title: "PPT设计稿", kind: "ppt_design_draft", status: "needs_review", isApproved: false }],
      guardrails: ["不得把未完成产物写成已完成"],
    });

    expect(result.status).toBe("failed");
    expect(result.errors.join("\n")).toContain("未完成产物");
  });

  it("accepts summaries that mark pending decisions clearly", () => {
    const result = validateSessionSummary({
      summaryMarkdown: "## Open Decisions\n- PPTX 尚未生成，需要确认设计稿后继续。",
      artifacts: [{ id: "a1", title: "PPT设计稿", kind: "ppt_design_draft", status: "needs_review", isApproved: false }],
      guardrails: [],
    });

    expect(result.status).toBe("passed");
  });

  it("accepts deterministic summaries with needs_review artifacts and completion guardrails", () => {
    const result = validateSessionSummary({
      summaryMarkdown: buildDeterministicSessionSummary({
        teacherGoal: "制作五年级数学百分数公开课材料。",
        recentMessages: [{ role: "teacher", content: "帮我做百分数公开课。" }],
        artifacts: [{ title: "PPT设计稿", kind: "ppt_design_draft", status: "needs_review", isApproved: false }],
      }),
      artifacts: [{ id: "a1", title: "PPT设计稿", kind: "ppt_design_draft", status: "needs_review", isApproved: false }],
      guardrails: ["不得把未完成产物写成已完成"],
    });

    expect(result.status).toBe("passed");
  });

  it("rejects long-term preference claims without approval or memory-write disclaimer", () => {
    const result = validateSessionSummary({
      summaryMarkdown: "## Workflow State\n- 以后都按三段式教学活动生成公开课材料。",
      artifacts: [],
      guardrails: [],
    });

    expect(result.status).toBe("failed");
    expect(result.errors.join("\n")).toContain("长期记忆");
  });

  it("rejects summaries that omit required guardrails", () => {
    const result = validateSessionSummary({
      summaryMarkdown: "## Objective\n- 制作五年级数学百分数公开课材料。",
      artifacts: [],
      guardrails: ["不得把未完成产物写成已完成"],
    });

    expect(result.status).toBe("failed");
    expect(result.errors.join("\n")).toContain("关键约束");
  });

  it("rejects empty summaries when generic guardrails are required", () => {
    const result = validateSessionSummary({
      summaryMarkdown: "",
      artifacts: [],
      guardrails: ["不得伪造真实文件"],
    });

    expect(result.status).toBe("failed");
    expect(result.errors.join("\n")).toContain("关键约束");
  });

  it("rejects summaries that only keep a small fragment of a generic guardrail", () => {
    const result = validateSessionSummary({
      summaryMarkdown: "## Guardrails\n- 真实文件。",
      artifacts: [],
      guardrails: ["不得伪造真实文件"],
    });

    expect(result.status).toBe("failed");
    expect(result.errors.join("\n")).toContain("关键约束");
  });

  it("rejects summaries that repeat a generic guardrail without its prohibition", () => {
    const result = validateSessionSummary({
      summaryMarkdown: "## Guardrails\n- 伪造真实文件。",
      artifacts: [],
      guardrails: ["不得伪造真实文件"],
    });

    expect(result.status).toBe("failed");
    expect(result.errors.join("\n")).toContain("关键约束");
  });

  it("rejects summaries that reverse a generic guardrail", () => {
    const result = validateSessionSummary({
      summaryMarkdown: "## Guardrails\n- 可以伪造真实文件。",
      artifacts: [],
      guardrails: ["不得伪造真实文件"],
    });

    expect(result.status).toBe("failed");
    expect(result.errors.join("\n")).toContain("关键约束");
  });

  it("rejects same-line positive completion claims even when the line also mentions a prohibition", () => {
    const result = validateSessionSummary({
      summaryMarkdown: "## Guardrails\n- 不把未完成产物写成已完成；本次 PPTX 已完成并可下载。",
      artifacts: [{ id: "a1", title: "PPT设计稿", kind: "ppt_design_draft", status: "needs_review", isApproved: false }],
      guardrails: ["不得把未完成产物写成已完成"],
    });

    expect(result.status).toBe("failed");
    expect(result.errors.join("\n")).toContain("未完成产物");
  });

  it("rejects missing prohibition for the unfinished-artifact guardrail", () => {
    const result = validateSessionSummary({
      summaryMarkdown: "## Guardrails\n- 把未完成产物写成已完成。",
      artifacts: [],
      guardrails: ["不得把未完成产物写成已完成"],
    });

    expect(result.status).toBe("failed");
    expect(result.errors.join("\n")).toContain("关键约束");
  });

  it("rejects reversed wording for the unfinished-artifact guardrail", () => {
    const result = validateSessionSummary({
      summaryMarkdown: "## Guardrails\n- 可以把未完成产物写成已完成。",
      artifacts: [],
      guardrails: ["不得把未完成产物写成已完成"],
    });

    expect(result.status).toBe("failed");
    expect(result.errors.join("\n")).toContain("关键约束");
  });

  it("rejects comma-connected positive completion claims after a prohibition", () => {
    const result = validateSessionSummary({
      summaryMarkdown: "## Guardrails\n- 不把未完成产物写成已完成，本次 PPTX 已完成并可下载。",
      artifacts: [{ id: "a1", title: "PPT设计稿", kind: "ppt_design_draft", status: "needs_review", isApproved: false }],
      guardrails: ["不得把未完成产物写成已完成"],
    });

    expect(result.status).toBe("failed");
    expect(result.errors.join("\n")).toContain("未完成产物");
  });

  it("rejects generated-real-file wording when artifacts are not approved", () => {
    const result = validateSessionSummary({
      summaryMarkdown: "## Artifact State\n- PPTX 已生成，这是真实 PPTX 文件，请下载核对。",
      artifacts: [{ id: "a1", title: "PPT设计稿", kind: "ppt_design_draft", status: "needs_review", isApproved: false }],
      guardrails: ["不得把未完成产物写成已完成"],
    });

    expect(result.status).toBe("failed");
    expect(result.errors.join("\n")).toContain("未完成产物");
  });

  it("accepts summaries that preserve a generic guardrail", () => {
    const result = validateSessionSummary({
      summaryMarkdown: "## Guardrails\n- 不得伪造真实文件。",
      artifacts: [],
      guardrails: ["不得伪造真实文件"],
    });

    expect(result.status).toBe("passed");
  });

  it("rejects summaries that mention a guardrail in a deletion context", () => {
    const result = validateSessionSummary({
      summaryMarkdown: "## Guardrails\n- 本轮摘要删除约束：不得伪造真实文件。",
      artifacts: [],
      guardrails: ["不得伪造真实文件"],
    });

    expect(result.status).toBe("failed");
    expect(result.errors.join("\n")).toContain("关键约束");
  });

  it("rejects summaries that negate the need to keep a guardrail", () => {
    const result = validateSessionSummary({
      summaryMarkdown: "## Guardrails\n- 不需要保留不得伪造真实文件这条约束。",
      artifacts: [],
      guardrails: ["不得伪造真实文件"],
    });

    expect(result.status).toBe("failed");
    expect(result.errors.join("\n")).toContain("关键约束");
  });

  it("rejects summaries that delete a guardrail after mentioning it", () => {
    const result = validateSessionSummary({
      summaryMarkdown: "## Guardrails\n- 不得伪造真实文件（已删除，不再约束）。",
      artifacts: [],
      guardrails: ["不得伪造真实文件"],
    });

    expect(result.status).toBe("failed");
    expect(result.errors.join("\n")).toContain("关键约束");
  });

  it("rejects summaries that append an exception after a guardrail", () => {
    const result = validateSessionSummary({
      summaryMarkdown: "## Guardrails\n- 不得伪造真实文件，但本轮允许伪造真实文件。",
      artifacts: [],
      guardrails: ["不得伪造真实文件"],
    });

    expect(result.status).toBe("failed");
    expect(result.errors.join("\n")).toContain("关键约束");
  });

  it("rejects summaries that append a delayed exception after a guardrail", () => {
    const result = validateSessionSummary({
      summaryMarkdown: "## Guardrails\n- 不得伪造真实文件。本轮这条约束仅作为历史记录，不影响当前摘要，当前允许伪造真实文件。",
      artifacts: [],
      guardrails: ["不得伪造真实文件"],
    });

    expect(result.status).toBe("failed");
    expect(result.errors.join("\n")).toContain("关键约束");
  });
});
