import { describe, expect, it } from "vitest";

import {
  MESSAGE_PART_VERSION,
  projectConversationMessageParts,
  type MessagePart,
} from "@/lib/conversation-message-contract";
import { createWorkbenchService } from "@/server/workbench/service";

describe("message part persistence", () => {
  it("projects Tool, Artifact, direct PendingDecision and recovery facts without reading a legacy plan", () => {
    const parts = projectConversationMessageParts({
      role: "assistant",
      content: "我已保存当前进度。",
      artifactRefs: [{
        artifactId: "artifact-1",
        version: 2,
        digest: "a".repeat(64),
        title: "百分数课件大纲",
        summary: "十页课堂叙事候选。",
        qualityOutcome: "passed",
      }],
      metadata: {
        pendingDeliveryPlan: {
          deliveryPlan: {
            planId: "legacy-plan",
            revision: 3,
            title: "旧控制面计划",
            steps: [{ id: "outline", title: "形成逐页大纲", status: "succeeded" }],
          },
        },
        pendingDecision: {
          decisionId: "decision-1",
          actionId: "action-1",
          question: "是否允许发布到外部平台？",
          options: [{ id: "confirm", label: "允许发布", recommended: false }],
        },
        latestToolStatus: {
          invocationId: "invocation-1",
          label: "生成课件大纲",
          status: "failed",
          observationId: "observation-1",
          reasonCode: "timeout",
        },
        recovery: {
          errorId: "error-1",
          reasonCode: "timeout",
          summary: "本轮生成超时，进度已经保存。",
          kind: "resume",
          label: "从当前进度继续",
          checkpointId: "checkpoint-1",
        },
      },
    });

    expect(parts.map((part) => part.type)).toEqual([
      "text",
      "tool-status",
      "artifact-ref",
      "quality-summary",
      "human-input",
      "next-actions",
      "error-recovery",
    ]);
  });

  it("round-trips typed parts while preserving legacy content", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "消息Part持久化" });
    const parts: MessagePart[] = [
      { type: "text", schemaVersion: MESSAGE_PART_VERSION, text: "## 教学目标\n理解百分数。", format: "markdown" },
      { type: "activity", schemaVersion: MESSAGE_PART_VERSION, activityId: "activity-1", label: "正在整理", status: "running", evidenceRefs: [] },
      { type: "plan", schemaVersion: MESSAGE_PART_VERSION, planId: "plan-1", revision: 1, title: "备课事实投影", steps: [{ id: "goal", title: "确认教学目标", status: "completed" }] },
      { type: "tool-status", schemaVersion: MESSAGE_PART_VERSION, invocationId: "invocation-1", label: "已整理需求", status: "succeeded", observationId: "observation-1" },
      { type: "artifact-ref", schemaVersion: MESSAGE_PART_VERSION, artifactId: "artifact-1", version: 1, digest: "a".repeat(64), title: "教案", summary: "已形成候选。" },
      { type: "quality-summary", schemaVersion: MESSAGE_PART_VERSION, artifactId: "artifact-1", version: 1, outcome: "passed", summary: "结构完整。", findingLocators: [] },
      { type: "human-input", schemaVersion: MESSAGE_PART_VERSION, decisionId: "decision-1", actionId: "action-1", question: "是否继续？", options: [{ id: "continue", label: "继续" }] },
      { type: "dialogue-checkpoint", schemaVersion: MESSAGE_PART_VERSION, checkpointId: "dialogue-1", question: "继续教案还是改做PPT？", understandingSummary: "交付方向待确认。", impactSummary: "选择会改变后续工具范围。", options: [{ id: "lesson", label: "继续教案", description: "保持当前范围", recommended: true }, { id: "ppt", label: "改做PPT", description: "切换交付方向", recommended: false }], allowFreeText: true },
      { type: "next-actions", schemaVersion: MESSAGE_PART_VERSION, actions: [{ id: "open", label: "查看教案", kind: "open_artifact", artifactId: "artifact-1" }] },
      { type: "error-recovery", schemaVersion: MESSAGE_PART_VERSION, errorId: "ERR-1", reasonCode: "timeout", summary: "生成超时。", recovery: { kind: "resume", label: "继续", checkpointId: "checkpoint-1" } },
    ];

    const saved = await service.addMessage(project.id, {
      role: "assistant",
      content: "## 教学目标\n理解百分数。",
      parts,
    });
    const [restored] = await service.getMessages(project.id);

    expect(saved.parts).toEqual(parts);
    expect(restored?.parts).toEqual(parts);
    expect(restored?.content).toBe("## 教学目标\n理解百分数。");
  });

  it("does not duplicate a failed activity as a second Tool status before the single recovery entry", () => {
    const parts = projectConversationMessageParts({
      role: "assistant",
      content: "PPT 大纲未通过结构检查。",
      metadata: {
        agentActivities: [{
          type: "activity",
          schemaVersion: MESSAGE_PART_VERSION,
          activityId: "tool-outline",
          label: "PPT 大纲未通过结构检查",
          status: "failed",
          evidenceRefs: ["observation-outline"],
          activityKind: "tool",
          reasonCode: "outline_invalid",
        }],
        latestToolStatus: {
          invocationId: "invocation-outline",
          label: "PPT 大纲未通过结构检查",
          status: "failed",
          observationId: "observation-outline",
          reasonCode: "outline_invalid",
        },
        recovery: {
          errorId: "observation-outline",
          reasonCode: "outline_invalid",
          summary: "PPT 大纲未通过结构检查。",
          kind: "resume",
          label: "从当前进度继续",
          checkpointId: "checkpoint-outline",
        },
      },
    });

    expect(parts.filter((part) => part.type === "activity")).toHaveLength(1);
    expect(parts.filter((part) => part.type === "tool-status")).toHaveLength(0);
    expect(parts.filter((part) => part.type === "error-recovery")).toHaveLength(1);
  });

  it("retains final assistant content when it is not a prefix extension of streamed timeline text", () => {
    const parts = projectConversationMessageParts({
      role: "assistant",
      content: "最终经过校正的回复。",
      metadata: {
        agentTimeline: [{
          type: "text",
          schemaVersion: MESSAGE_PART_VERSION,
          text: "流式期间的回复。",
          format: "plain",
          sourceEventIds: ["event-text-1"],
          sourceSequence: 1,
          sourceSequenceEnd: 1,
        }],
      },
    });

    expect(parts.filter((part) => part.type === "text").map((part) => part.text)).toEqual([
      "流式期间的回复。",
      "最终经过校正的回复。",
    ]);
  });

  it("persists server projections when assistant metadata or Artifact refs change", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: `消息投影-${crypto.randomUUID()}` });
    const artifact = await service.saveArtifact(project.id, {
      nodeKey: "ppt_draft",
      kind: "ppt_draft",
      title: "百分数课件大纲",
      status: "needs_review",
      summary: "十页逐页大纲。",
      markdownContent: "# 百分数课件大纲",
      structuredContent: {
        artifactQualityState: {
          validationStatus: "passed",
          reviewStatus: "passed",
          downstreamEligibility: "eligible",
        },
      },
    });
    const saved = await service.addMessage(project.id, {
      role: "assistant",
      content: "课件大纲已经形成。",
      artifactRefs: [artifact.id],
      metadata: {
        pendingDeliveryPlan: {
          deliveryPlan: {
            planId: "plan-1",
            revision: 1,
            title: "完成课件",
            steps: [{ id: "outline", title: "形成课件大纲", status: "succeeded" }],
          },
        },
      },
    });

    expect(saved.parts.map((part) => part.type)).toEqual(["text", "artifact-ref", "quality-summary"]);

    const updated = await service.updateMessageMetadata(project.id, saved.id, {
      agentObservations: [{
        observationId: "observation-1",
        status: "failed",
        reasonCodes: ["timeout"],
        teacherSafeSummary: "本轮生成超时，进度已经保存。",
      }],
      agentRunCheckpoint: { checkpointId: "checkpoint-1" },
    });
    expect(updated.parts.map((part) => part.type)).toEqual([
      "text",
      "tool-status",
      "artifact-ref",
      "quality-summary",
      "error-recovery",
    ]);
  });

  it("projects legacy rows to one text part without rewriting history", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "旧消息兼容" });
    await service.addMessage(project.id, { role: "teacher", content: "只做视频脚本" });

    const [restored] = await service.getMessages(project.id);
    expect(restored?.parts).toEqual([
      { type: "text", schemaVersion: MESSAGE_PART_VERSION, text: "只做视频脚本", format: "markdown" },
    ]);
  });
});
