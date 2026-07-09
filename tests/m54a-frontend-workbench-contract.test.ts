import { describe, expect, it } from "vitest";
import {
  applyQuickReplyToDraft,
  buildComposerAttachmentCard,
  getGeneratingLabel,
  getComposerAttachmentKind,
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

  it("preserves model quick reply order and keeps replies non-sending", () => {
    const replies = normalizeQuickReplies([
      { label: "普通", prompt: "普通" },
      { label: "推荐", prompt: "推荐", recommended: true },
      { label: "补充", prompt: "补充" },
      { label: "多余", prompt: "多余" },
      { label: "第五条", prompt: "第五条" },
    ]);

    expect(replies).toHaveLength(5);
    expect(replies.map((reply) => reply.label)).toEqual(["普通", "推荐", "补充", "多余", "第五条"]);
    expect(applyQuickReplyToDraft("确认开始")).toEqual({ draft: "确认开始", shouldSend: false });
  });

  it("does not present local attachments as parsed before real parsing", () => {
    expect(normalizeAttachmentStatus("pending_parse").teacherLabel).toContain("待解析");
    expect(normalizeAttachmentStatus("parse_failed").teacherLabel).toContain("解析失败");
    expect(normalizeAttachmentStatus("readable")).toMatchObject({
      teacherLabel: "已读取，可作为材料参考",
      understood: true,
    });
    expect(normalizeAttachmentStatus("parsed").teacherLabel).not.toContain("已解析");
  });

  it("builds teacher-facing attachment cards with file name, type, status, and no engineering words", () => {
    expect(getComposerAttachmentKind({ name: "lesson-plan.md", type: "text/markdown" })).toBe("markdown");
    expect(getComposerAttachmentKind({ name: "scan.pdf", type: "application/pdf" })).toBe("unsupported");

    const card = buildComposerAttachmentCard({
      fileName: "lesson-plan.md",
      mimeType: "text/markdown",
      status: "readable",
    });

    expect(card).toMatchObject({
      fileName: "lesson-plan.md",
      fileTypeLabel: "Markdown 文本",
      teacherLabel: "已读取，可作为材料参考",
      canUseAsReference: true,
    });
    expect(`${card.fileTypeLabel} ${card.teacherLabel}`).not.toMatch(/schema|manifest|provider|node_id|storage|API|debug|local path|已解析/i);
  });

  it("labels generating states without faking token streaming", () => {
    expect(getGeneratingLabel("generating")).toBe("正在生成回复");
    expect(getGeneratingLabel("streaming")).toBe("正在继续写出回复");
    expect(getGeneratingLabel("saving_artifact")).toBe("正在保存成果");
  });
});
