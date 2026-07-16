import { describe, expect, it } from "vitest";

import {
  MESSAGE_PART_VERSION,
  projectConversationMessageParts,
  type MessagePart,
} from "@/lib/conversation-message-contract";
import { createWorkbenchService } from "@/server/workbench/service";

describe("message part persistence", () => {
  it("projects server-owned plan, Tool, Artifact, HumanGate and recovery facts into typed parts", () => {
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
            planId: "plan-1",
            revision: 3,
            title: "完成百分数课件",
            steps: [{ id: "outline", title: "形成逐页大纲", status: "succeeded" }],
          },
          pendingDecision: {
            decisionId: "decision-1",
            actionId: "action-1",
            question: "是否允许发布到外部平台？",
            options: [{ id: "confirm", label: "允许发布", recommended: false }],
          },
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
      "plan",
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

    expect(saved.parts.map((part) => part.type)).toEqual([
      "text",
      "plan",
      "artifact-ref",
      "quality-summary",
    ]);

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
