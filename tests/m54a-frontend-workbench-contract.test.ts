import { describe, expect, it } from "vitest";
import {
  applyQuickReplyToDraft,
  buildWelcomePromptSuggestions,
  buildComposerAttachmentCard,
  getGeneratingLabel,
  getComposerAttachmentKind,
  getComposerToolMenuItems,
  getTextareaHeightPlan,
  hasCompletedComposerAttachmentSubmission,
  normalizeAttachmentStatus,
  normalizeQuickReplies,
} from "@/components/conversation/composer/composer-contracts";
import {
  resolveBoundConfirmationActionId,
} from "@/hooks/useWorkbenchController";
import {
  buildClientMessageSignature,
  clearRetrySafeMessageIdempotencyKey,
  getRetrySafeMessageIdempotencyKey,
} from "@/lib/workbench-message-idempotency";

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
    expect(getComposerAttachmentKind({ name: "archive.zip", type: "application/zip" })).toBe("unsupported");

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

  it("labels pasted images and rich documents without pretending they are parsed", () => {
    expect(getComposerAttachmentKind({ name: "blackboard.png", type: "image/png" })).toBe("image_reference");
    expect(getComposerAttachmentKind({ name: "teaching-plan.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })).toBe("rich_document");
    expect(getComposerAttachmentKind({ name: "scan.pdf", type: "application/pdf" })).toBe("rich_document");
    expect(getComposerAttachmentKind({ name: "blackboard.png", type: "text/plain" })).toBe("image_reference");
    expect(getComposerAttachmentKind({ name: "teaching-plan.docx", type: "text/plain" })).toBe("rich_document");
    expect(getComposerAttachmentKind({ name: "scan.pdf", type: "text/plain" })).toBe("rich_document");

    const imageCard = buildComposerAttachmentCard({
      fileName: "blackboard.png",
      mimeType: "image/png",
      status: "visual_reference",
    });
    const docCard = buildComposerAttachmentCard({
      fileName: "teaching-plan.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      status: "needs_manual_summary",
    });

    expect(imageCard).toMatchObject({
      fileTypeLabel: "图片参考",
      teacherLabel: "截图已记录，请在输入框补充可见文字或画面要点",
      canUseAsReference: false,
    });
    expect(docCard).toMatchObject({
      fileTypeLabel: "文档资料",
      teacherLabel: "请摘取关键内容或另存为文本后使用",
      canUseAsReference: false,
    });
    expect(`${imageCard.teacherLabel} ${docCard.teacherLabel}`).not.toMatch(/OCR|已解析|作为材料参考|schema|manifest|provider|node_id|storage|API|debug|local path/i);
  });

  it("does not restore an attachment after its submitted draft has been consumed", () => {
    const snapshot = { value: "请参考这张图", reference: null };

    expect(hasCompletedComposerAttachmentSubmission({
      snapshot,
      value: snapshot.value,
      reference: snapshot.reference,
      composerSubmitting: false,
    })).toBe(false);
    expect(hasCompletedComposerAttachmentSubmission({
      snapshot,
      value: "",
      reference: null,
      composerSubmitting: true,
    })).toBe(false);
    expect(hasCompletedComposerAttachmentSubmission({
      snapshot,
      value: "",
      reference: null,
      composerSubmitting: false,
    })).toBe(true);
    expect(hasCompletedComposerAttachmentSubmission({
      snapshot,
      value: "下一轮要求",
      reference: null,
      composerSubmitting: false,
    })).toBe(true);
  });

  it("offers welcome prompts that fill the composer but never auto-send", () => {
    const suggestions = buildWelcomePromptSuggestions();

    expect(suggestions).toHaveLength(4);
    expect(suggestions.every((suggestion) => suggestion.label.trim().length > 0)).toBe(true);
    expect(suggestions.every((suggestion) => suggestion.prompt.includes("请"))).toBe(true);
    expect(suggestions.every((suggestion) => applyQuickReplyToDraft(suggestion.prompt).shouldSend === false)).toBe(true);
    expect(suggestions.map((suggestion) => suggestion.label)).toEqual(["公开课目标", "教案和课件", "导入视频", "检查优化"]);
  });

  it("separates available composer tools from disabled future capabilities", () => {
    const items = getComposerToolMenuItems();

    expect(items.filter((item) => item.enabled).map((item) => item.label)).toEqual(["添加文本资料"]);
    expect(items.filter((item) => item.enabled).every((item) => Boolean(item.action))).toBe(true);
    expect(items.filter((item) => !item.enabled).map((item) => item.label)).toEqual(["粘贴截图参考", "继续排队生成", "自动读取 PDF/DOCX", "实时逐字输出"]);
    expect(items.map((item) => `${item.label} ${item.description}`).join(" ")).not.toMatch(/schema|manifest|provider|node_id|storage|API|debug|local path/i);
  });

  it("labels generating states without faking token streaming", () => {
    expect(getGeneratingLabel("generating")).toBe("正在生成回复");
    expect(getGeneratingLabel("streaming")).toBe("正在继续写出回复");
    expect(getGeneratingLabel("saving_artifact")).toBe("正在保存成果");
  });

  it("reuses message idempotency keys for the same failed send retry only", () => {
    const store = { current: new Map<string, string>() };
    const firstSignature = buildClientMessageSignature("project-a", "继续生成教案", "资料《lesson.md》", null);
    const secondSignature = buildClientMessageSignature("project-a", "继续生成教案，补充活动", "资料《lesson.md》", null);

    const firstKey = getRetrySafeMessageIdempotencyKey(store, firstSignature);
    const retryKey = getRetrySafeMessageIdempotencyKey(store, firstSignature);
    const changedKey = getRetrySafeMessageIdempotencyKey(store, secondSignature);

    expect(retryKey).toBe(firstKey);
    expect(changedKey).not.toBe(firstKey);
  });

  it("keeps failed Artifact and composer retries isolated when their requests interleave", () => {
    const store = { current: new Map<string, string>() };
    const artifactSignature = buildClientMessageSignature("project-a", "重新生成需求规格", null, null, "pragmatic", ["artifact-a"]);
    const composerSignature = buildClientMessageSignature("project-a", "补充课堂活动", null, null);
    const artifactKey = getRetrySafeMessageIdempotencyKey(store, artifactSignature);
    const composerKey = getRetrySafeMessageIdempotencyKey(store, composerSignature);

    clearRetrySafeMessageIdempotencyKey(store, composerSignature);

    expect(getRetrySafeMessageIdempotencyKey(store, artifactSignature)).toBe(artifactKey);
    expect(getRetrySafeMessageIdempotencyKey(store, composerSignature)).not.toBe(composerKey);
    clearRetrySafeMessageIdempotencyKey(store, artifactSignature);
    expect(getRetrySafeMessageIdempotencyKey(store, artifactSignature)).not.toBe(artifactKey);
  });

  it("keeps a HumanGate action only for the unchanged bound quick reply", () => {
    const bound = {
      submittedActionId: "action-1",
      pendingActionId: "action-1",
      boundBody: "确认开始",
    };

    expect(resolveBoundConfirmationActionId({ ...bound, submittedBody: "确认开始" })).toBe("action-1");
    expect(resolveBoundConfirmationActionId({ ...bound, submittedBody: "确认开始吧" })).toBeNull();
    expect(resolveBoundConfirmationActionId({
      ...bound,
      submittedActionId: "action-stale",
      submittedBody: "确认开始",
    })).toBeNull();
  });
});
