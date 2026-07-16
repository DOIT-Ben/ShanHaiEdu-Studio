import { describe, expect, it } from "vitest";

import {
  MESSAGE_PART_VERSION,
  legacyContentToMessageParts,
  normalizeMessageParts,
  projectMessagePartsToAssistantUi,
  type MessagePart,
} from "@/lib/conversation-message-contract";

describe("conversation message contract", () => {
  it("supports all teacher-visible message part variants as a versioned discriminated union", () => {
    const parts: MessagePart[] = [
      { type: "text", schemaVersion: MESSAGE_PART_VERSION, text: "**教学目标**", format: "markdown" },
      { type: "activity", schemaVersion: MESSAGE_PART_VERSION, activityId: "activity-1", label: "正在整理教案", status: "running", evidenceRefs: [] },
      { type: "plan", schemaVersion: MESSAGE_PART_VERSION, planId: "plan-1", revision: 2, title: "备课计划", steps: [{ id: "step-1", title: "整理需求", status: "completed" }] },
      { type: "tool-status", schemaVersion: MESSAGE_PART_VERSION, invocationId: "inv-1", label: "已整理需求", status: "succeeded", observationId: "obs-1" },
      { type: "artifact-ref", schemaVersion: MESSAGE_PART_VERSION, artifactId: "artifact-1", version: 3, digest: "a".repeat(64), title: "百分数教案", summary: "已形成结构化教案。" },
      { type: "quality-summary", schemaVersion: MESSAGE_PART_VERSION, artifactId: "artifact-1", version: 3, outcome: "passed", summary: "结构完整。", findingLocators: [] },
      { type: "human-input", schemaVersion: MESSAGE_PART_VERSION, decisionId: "decision-1", actionId: "action-1", question: "是否允许发布？", options: [{ id: "confirm", label: "允许" }, { id: "cancel", label: "暂不发布" }] },
      { type: "next-actions", schemaVersion: MESSAGE_PART_VERSION, actions: [{ id: "open-artifact", label: "查看教案", kind: "open_artifact", artifactId: "artifact-1" }] },
      { type: "error-recovery", schemaVersion: MESSAGE_PART_VERSION, errorId: "ERR-1", reasonCode: "timeout", summary: "生成超时。", recovery: { kind: "resume", label: "从上次进度继续", checkpointId: "checkpoint-1" } },
    ];

    expect(normalizeMessageParts(parts)).toEqual(parts);
    expect(projectMessagePartsToAssistantUi({ id: "message-1", role: "assistant", parts }).content.length).toBeGreaterThan(0);
  });

  it("maps legacy content to one text part without guessing business state", () => {
    expect(legacyContentToMessageParts("## 已完成\n请查看。"))
      .toEqual([{ type: "text", schemaVersion: MESSAGE_PART_VERSION, text: "## 已完成\n请查看。", format: "markdown" }]);
  });

  it("rejects untrusted or malformed business references instead of dropping the whole message", () => {
    const malformed = [{ type: "artifact-ref", schemaVersion: MESSAGE_PART_VERSION, artifactId: "artifact-1", version: 1, digest: "forged" }];
    const normalized = normalizeMessageParts(malformed);
    expect(normalized).toEqual([expect.objectContaining({ type: "error-recovery", reasonCode: "invalid_message_part" })]);
  });
});
