import { describe, expect, it } from "vitest";

import {
  MESSAGE_PART_VERSION,
  legacyContentToMessageParts,
  normalizeMessageParts,
  projectConversationMessageParts,
  projectMessagePartsToAssistantUi,
  type MessagePart,
} from "@/lib/conversation-message-contract";

describe("conversation message contract", () => {
  it("supports all ten teacher-visible message part variants as a versioned discriminated union", () => {
    const parts: MessagePart[] = [
      { type: "text", schemaVersion: MESSAGE_PART_VERSION, text: "**教学目标**", format: "markdown" },
      { type: "activity", schemaVersion: MESSAGE_PART_VERSION, activityId: "activity-1", label: "正在整理教案", status: "running", evidenceRefs: [] },
      { type: "plan", schemaVersion: MESSAGE_PART_VERSION, planId: "plan-1", revision: 2, title: "备课计划", steps: [{ id: "step-1", title: "整理需求", status: "completed" }] },
      { type: "tool-status", schemaVersion: MESSAGE_PART_VERSION, invocationId: "inv-1", label: "已整理需求", status: "succeeded", observationId: "obs-1" },
      { type: "artifact-ref", schemaVersion: MESSAGE_PART_VERSION, artifactId: "artifact-1", version: 3, digest: "a".repeat(64), title: "百分数教案", summary: "已形成结构化教案。" },
      { type: "quality-summary", schemaVersion: MESSAGE_PART_VERSION, artifactId: "artifact-1", version: 3, outcome: "passed", summary: "结构完整。", findingLocators: [] },
      { type: "human-input", schemaVersion: MESSAGE_PART_VERSION, decisionId: "decision-1", actionId: "action-1", question: "是否允许发布？", options: [{ id: "confirm", label: "允许" }, { id: "cancel", label: "暂不发布" }] },
      { type: "dialogue-checkpoint", schemaVersion: MESSAGE_PART_VERSION, checkpointId: "checkpoint-dialogue-1", question: "继续做教案还是改做PPT？", understandingSummary: "当前交付方向尚未确定。", impactSummary: "不同选择会改变后续工具范围。", options: [{ id: "lesson", label: "继续教案", description: "保持当前交付范围", recommended: true }, { id: "ppt", label: "改做PPT", description: "切换到课件设计", recommended: false }], allowFreeText: true },
      { type: "next-actions", schemaVersion: MESSAGE_PART_VERSION, actions: [{ id: "open-artifact", label: "查看教案", kind: "open_artifact", artifactId: "artifact-1" }] },
      { type: "error-recovery", schemaVersion: MESSAGE_PART_VERSION, errorId: "ERR-1", reasonCode: "timeout", summary: "生成超时。", recovery: { kind: "resume", label: "从上次进度继续", checkpointId: "checkpoint-1" } },
    ];

    expect(normalizeMessageParts(parts)).toEqual(parts);
    expect(projectMessagePartsToAssistantUi({ id: "message-1", role: "assistant", parts }).content.length).toBeGreaterThan(0);
  });

  it("keeps the original runtime export surface stable", async () => {
    expect(Object.keys(await import("@/lib/conversation-message-contract")).sort()).toEqual([
      "MESSAGE_PART_VERSION",
      "legacyContentToMessageParts",
      "normalizeMessageParts",
      "projectConversationMessageParts",
      "projectMessagePartsToAssistantUi",
      "toDialogueCheckpointPart",
    ]);
  });

  it("maps legacy content to one text part without guessing business state", () => {
    expect(legacyContentToMessageParts("## 已完成\n请查看。"))
      .toEqual([{ type: "text", schemaVersion: MESSAGE_PART_VERSION, text: "## 已完成\n请查看。", format: "markdown" }]);
  });

  it("ignores legacy delivery-plan metadata and projects only a direct pending decision", () => {
    const parts = projectConversationMessageParts({
      role: "assistant",
      content: "请确认是否继续。",
      metadata: {
        pendingDeliveryPlan: {
          status: "pending",
          toolPlan: { capabilityId: "lesson_plan" },
          deliveryPlan: {
            planId: "legacy-plan",
            revision: 1,
            title: "旧计划",
            steps: [{ id: "lesson", title: "生成教案", status: "pending" }],
          },
          pendingDecision: {
            decisionId: "legacy-decision",
            actionId: "legacy-action",
            question: "是否继续旧计划？",
            options: [{ id: "continue", label: "继续" }],
          },
        },
        pendingDecision: {
          decisionId: "decision-1",
          actionId: "action-1",
          question: "是否允许外发？",
          options: [{ id: "decline", label: "暂不外发", recommended: true }],
        },
      },
    });

    expect(parts.map((part) => part.type)).toEqual(["text", "human-input", "next-actions"]);
    expect(parts).not.toContainEqual(expect.objectContaining({ type: "plan" }));
    expect(parts).toContainEqual(expect.objectContaining({
      type: "human-input",
      decisionId: "decision-1",
      actionId: "action-1",
    }));
  });

  it("keeps valid PendingDecision options when a sibling option is malformed", () => {
    const parts = projectConversationMessageParts({
      role: "assistant",
      content: "请选择后续方向。",
      metadata: {
        pendingDecision: {
          decisionId: "decision-1",
          actionId: "action-1",
          question: "继续教案还是改做PPT？",
          options: [
            { id: "lesson", label: "继续教案", recommended: true },
            { id: "broken-option" },
          ],
        },
      },
    });

    expect(parts).toContainEqual(expect.objectContaining({
      type: "human-input",
      options: [{ id: "lesson", label: "继续教案", recommended: true }],
    }));
    expect(parts).toContainEqual(expect.objectContaining({
      type: "next-actions",
      actions: [expect.objectContaining({ id: "decision:decision-1:lesson" })],
    }));
  });

  it("rejects untrusted or malformed business references instead of dropping the whole message", () => {
    const malformed = [{ type: "artifact-ref", schemaVersion: MESSAGE_PART_VERSION, artifactId: "artifact-1", version: 1, digest: "forged" }];
    const normalized = normalizeMessageParts(malformed);
    expect(normalized).toEqual([expect.objectContaining({ type: "error-recovery", reasonCode: "invalid_message_part" })]);
  });

  it("removes unknown sensitive fields from otherwise valid message parts", () => {
    const normalized = normalizeMessageParts([{
      type: "activity",
      schemaVersion: MESSAGE_PART_VERSION,
      activityId: "activity-1",
      label: "正在整理教案",
      status: "running",
      evidenceRefs: [],
      provider: "private-provider",
      apiKey: "secret-value",
    }]);

    expect(normalized).toEqual([{
      type: "activity",
      schemaVersion: MESSAGE_PART_VERSION,
      activityId: "activity-1",
      label: "正在整理教案",
      status: "running",
      evidenceRefs: [],
    }]);
    expect(JSON.stringify(projectMessagePartsToAssistantUi({ id: "message-safe", role: "assistant", parts: normalized })))
      .not.toMatch(/private-provider|secret-value/);
  });
});
