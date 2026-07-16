import { describe, expect, it } from "vitest";

import { MESSAGE_PART_VERSION, type MessagePart } from "@/lib/conversation-message-contract";
import { chatMessageToAssistantUi } from "@/components/conversation/assistant-ui/message-adapter";

describe("assistant-ui message adapter", () => {
  it("projects all nine project message parts in order without inventing business state", () => {
    const parts: MessagePart[] = [
      { type: "text", schemaVersion: MESSAGE_PART_VERSION, text: "**教学目标**", format: "markdown" },
      { type: "activity", schemaVersion: MESSAGE_PART_VERSION, activityId: "activity-1", label: "正在整理", status: "running", evidenceRefs: [] },
      { type: "plan", schemaVersion: MESSAGE_PART_VERSION, planId: "plan-1", revision: 1, title: "备课计划", steps: [] },
      { type: "tool-status", schemaVersion: MESSAGE_PART_VERSION, invocationId: "inv-1", label: "整理需求", status: "succeeded", observationId: "obs-1" },
      { type: "artifact-ref", schemaVersion: MESSAGE_PART_VERSION, artifactId: "artifact-1", version: 1, digest: "a".repeat(64), title: "教案", summary: "已形成候选。" },
      { type: "quality-summary", schemaVersion: MESSAGE_PART_VERSION, artifactId: "artifact-1", version: 1, outcome: "passed", summary: "结构完整。", findingLocators: [] },
      { type: "human-input", schemaVersion: MESSAGE_PART_VERSION, decisionId: "decision-1", actionId: "action-1", question: "是否允许外发？", options: [{ id: "no", label: "暂不外发" }] },
      { type: "next-actions", schemaVersion: MESSAGE_PART_VERSION, actions: [{ id: "open", label: "查看教案", kind: "open_artifact", artifactId: "artifact-1" }] },
      { type: "error-recovery", schemaVersion: MESSAGE_PART_VERSION, errorId: "error-1", reasonCode: "timeout", summary: "本轮超时。", recovery: { kind: "resume", label: "从上次进度继续", checkpointId: "checkpoint-1" } },
    ];

    const projected = chatMessageToAssistantUi({
      id: "message-1",
      speaker: "assistant",
      body: "fallback body",
      parts,
      artifactRefs: ["artifact-1"],
      reaction: "helpful",
    });

    expect(projected.role).toBe("assistant");
    if (!Array.isArray(projected.content)) throw new Error("assistant-ui content must be structured");
    expect(projected.content.map((part) => part.type === "data" ? part.name : part.type)).toEqual([
      "text",
      "shanhai.activity",
      "shanhai.plan",
      "shanhai.tool-status",
      "shanhai.artifact-ref",
      "shanhai.quality-summary",
      "shanhai.human-input",
      "shanhai.next-actions",
      "shanhai.error-recovery",
    ]);
    expect(projected.metadata?.custom).toMatchObject({
      projectMessageId: "message-1",
      artifactRefs: ["artifact-1"],
      reaction: "helpful",
    });
  });

  it("keeps a malformed part visible as a safe recovery part instead of dropping the message", () => {
    const projected = chatMessageToAssistantUi({
      id: "message-2",
      speaker: "assistant",
      body: "fallback body",
      parts: [{ type: "artifact-ref", schemaVersion: MESSAGE_PART_VERSION, artifactId: "forged" }] as never,
    });

    expect(projected.content).toEqual([
      expect.objectContaining({ type: "data", name: "shanhai.error-recovery" }),
    ]);
  });
});
