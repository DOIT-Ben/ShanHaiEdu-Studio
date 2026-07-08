import { describe, expect, it } from "vitest";
import {
  applyQuickReplyToDraft,
  getGeneratingLabel,
  getTextareaHeightPlan,
  normalizeAttachmentStatus,
  normalizeQuickReplies,
} from "@/components/conversation/composer/composer-contracts";

describe("M54-A frontend workbench contracts", () => {
  it("plans textarea height with a stable max threshold", () => {
    expect(getTextareaHeightPlan("短句")).toMatchObject({ rows: 1, overflowY: "hidden" });

    const longText = Array.from({ length: 20 }, (_, index) => `第 ${index + 1} 行`).join("\n");
    const plan = getTextareaHeightPlan(longText);

    expect(plan.rows).toBeLessThanOrEqual(plan.maxRows);
    expect(plan.overflowY).toBe("auto");
  });

  it("keeps quick replies short, recommended-first, and non-sending", () => {
    const replies = normalizeQuickReplies([
      { label: "普通", prompt: "普通" },
      { label: "推荐", prompt: "推荐", recommended: true },
      { label: "补充", prompt: "补充" },
      { label: "多余", prompt: "多余" },
    ]);

    expect(replies).toHaveLength(3);
    expect(replies[0]).toMatchObject({ label: "推荐", recommended: true });
    expect(applyQuickReplyToDraft("确认开始")).toEqual({ draft: "确认开始", shouldSend: false });
  });

  it("does not present unparsed attachments as understood", () => {
    expect(normalizeAttachmentStatus("pending_parse").teacherLabel).toContain("待解析");
    expect(normalizeAttachmentStatus("parse_failed").teacherLabel).toContain("解析失败");
    expect(normalizeAttachmentStatus("parsed").teacherLabel).toContain("已解析");
  });

  it("labels generating states without faking token streaming", () => {
    expect(getGeneratingLabel("generating")).toBe("正在生成回复");
    expect(getGeneratingLabel("streaming")).toBe("正在继续写出回复");
    expect(getGeneratingLabel("saving_artifact")).toBe("正在保存成果");
  });
});
