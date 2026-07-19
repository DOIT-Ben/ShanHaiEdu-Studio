import { describe, expect, it } from "vitest";
import { buildConversationContextPackage, contextPackageToMainAgentConversationContext } from "@/server/conversation/conversation-context-builder";
import { buildSemanticContextSnapshot } from "@/server/conversation/context-semantic-snapshot";
import { createTaskBrief, type PendingDecision } from "@/server/conversation/task-contract";
import type { ArtifactRecord, ConversationMessageRecord, ProjectRecord } from "@/server/workbench/types";

describe("conversation-context-builder", () => {
  it("builds a bounded ContextPackage from real project state for the main agent", () => {
    const project = projectRecord();
    const messages = Array.from({ length: 10 }, (_, index) => messageRecord(index));
    const contextPackage = buildConversationContextPackage({
      project,
      messages,
      artifacts: [artifactRecord("artifact-approved", "requirement_spec", "approved", true), artifactRecord("artifact-draft", "ppt_draft", "needs_review", false)],
      maxInputTokens: 12_000,
    });

    expect(contextPackage.project).toEqual({
      id: project.id,
      title: project.title,
      grade: project.grade,
      subject: project.subject,
      textbookVersion: project.textbookVersion,
      lessonTopic: project.lessonTopic,
    });
    expect(contextPackage.recentMessages).toHaveLength(8);
    expect(contextPackage.recentMessages[0].content).toBe("消息 2");
    expect(contextPackage.artifacts).toEqual([
      expect.objectContaining({ id: "artifact-approved", isApproved: true }),
      expect.objectContaining({ id: "artifact-draft", isApproved: false, status: "needs_review" }),
    ]);
    expect(Object.keys(contextPackage).sort()).toEqual([
      "artifacts",
      "guardrails",
      "mode",
      "project",
      "recentMessages",
      "sessionSummary",
      "summaryValidation",
      "tokenEstimate",
    ]);
    expect(contextPackage.guardrails.join("\n")).toContain("不得把未完成产物描述为已完成");
    expect(contextPackage.summaryValidation).toEqual({ status: "passed", errors: [] });
    expect(contextPackage.tokenEstimate).toBeGreaterThan(0);
  });

  it("passes real messages, artifacts and the direct PendingDecision semantic snapshot to the main agent", () => {
    const taskBrief = taskBriefRecord();
    const pendingDecision = pendingDecisionRecord({
      projectId: taskBrief.projectId,
      taskId: taskBrief.taskId,
      intentEpoch: taskBrief.intentEpoch,
    });
    const semanticSnapshot = buildSemanticContextSnapshot({
      taskBrief,
      plan: { planId: pendingDecision.planId, revision: 1, status: "paused" },
      pendingDecision,
      trustedArtifactRefs: [],
      observationRefs: [],
      recentMessages: [{ role: "teacher", content: "消息 2" }],
    });
    const contextPackage = buildConversationContextPackage({
      project: projectRecord(),
      messages: [messageRecord(1, "assistant"), messageRecord(2, "teacher")],
      artifacts: [artifactRecord("artifact-real", "requirement_spec", "needs_review", false)],
    });

    const conversationContext = contextPackageToMainAgentConversationContext(
      contextPackage,
      undefined,
      undefined,
      semanticSnapshot,
    );

    expect(conversationContext.recentMessages).toEqual([
      { role: "assistant", content: "消息 1" },
      { role: "teacher", content: "消息 2" },
    ]);
    expect(conversationContext.latestAssistantContent).toBe("消息 1");
    expect(conversationContext.contextPackage.artifacts).toEqual([
      expect.objectContaining({ id: "artifact-real", status: "needs_review" }),
    ]);
    expect(conversationContext.semanticSnapshot).toEqual(semanticSnapshot);
    expect(conversationContext.semanticSnapshot?.pendingDecision).toEqual(pendingDecision);
    expect(Object.keys(conversationContext).sort()).toEqual([
      "agentWorldState",
      "capabilityAvailability",
      "contextPackage",
      "latestAssistantContent",
      "recentMessages",
      "semanticSnapshot",
    ]);
    expect(conversationContext.contextPackage.guardrails).toContain("只有教师已批准，或已通过内部验证与审查并标记为下游可用的 artifact，才可作为下游可信输入；教师签收保持独立。");
  });

  it("keeps only artifacts bound to the active TaskBrief", () => {
    const taskBrief = taskBriefRecord();
    const contextPackage = buildConversationContextPackage({
      project: projectRecord(),
      messages: [],
      taskBrief,
      artifacts: [
        artifactRecord("artifact-current", "requirement_spec", "needs_review", false, {
          taskId: taskBrief.taskId,
          taskBriefDigest: taskBrief.digest,
          intentEpoch: taskBrief.intentEpoch,
          origin: "tool_result",
        }),
        artifactRecord("artifact-previous-task", "lesson_plan", "approved", true, {
          taskId: "task-previous",
          taskBriefDigest: "f".repeat(64),
          intentEpoch: taskBrief.intentEpoch,
          origin: "tool_result",
        }),
      ],
    });

    expect(contextPackage.artifacts.map((artifact) => artifact.id)).toEqual(["artifact-current"]);
    expect(JSON.stringify(contextPackage)).not.toContain("artifact-previous-task");
  });
});

function projectRecord(): ProjectRecord {
  return {
    id: "project-context",
    title: "五年级百分数公开课",
    status: "active",
    grade: "五年级",
    subject: "数学",
    textbookVersion: null,
    lessonTopic: "百分数",
    lifecycleState: "active",
    lifecycleVersion: 0,
    archivedAt: null,
    deletedAt: null,
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
  };
}

function messageRecord(index: number, role: ConversationMessageRecord["role"] = index % 2 === 0 ? "teacher" : "assistant"): ConversationMessageRecord {
  return {
    id: `message-${index}`,
    projectId: "project-context",
    role,
    content: `消息 ${index}`,
    parts: [],
    artifactRefs: [],
    metadata: {},
    createdAt: `2026-07-09T00:00:${String(index).padStart(2, "0")}.000Z`,
  };
}

function artifactRecord(
  id: string,
  nodeKey: ArtifactRecord["nodeKey"],
  status: ArtifactRecord["status"],
  isApproved: boolean,
  overrides: Partial<ArtifactRecord> = {},
): ArtifactRecord {
  return {
    id,
    projectId: "project-context",
    nodeKey,
    kind: nodeKey,
    title: id,
    status,
    summary: `${id} summary`,
    markdownContent: `# ${id}`,
    structuredContent: {},
    version: 1,
    isApproved,
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
    ...overrides,
  };
}

function taskBriefRecord() {
  return createTaskBrief({
    taskId: "task-context",
    projectId: "project-context",
    intentEpoch: 2,
    goal: "制作百分数需求规格",
    requestedOutputs: ["requirement_spec"],
    constraints: ["五年级数学"],
    excludedOutputs: ["lesson_plan", "ppt", "image", "video", "package"],
    generationIntensity: "standard",
    sourceMessageId: "message-task-context",
  });
}

function pendingDecisionRecord(overrides: Partial<PendingDecision> = {}): PendingDecision {
  return {
    schemaVersion: "pending-decision.v1",
    decisionId: "decision-context",
    status: "pending",
    kind: "material_choice",
    reasonCode: "material_choice_required",
    question: "是否继续生成？",
    impactSummary: "确认后将继续当前任务。",
    options: [
      { id: "confirm", label: "继续", recommended: true },
      { id: "cancel", label: "取消", recommended: false },
    ],
    actorUserId: "teacher-context",
    projectId: "project-context",
    taskId: "task-context",
    intentEpoch: 2,
    planId: "plan-context",
    actionId: "action-context",
    budgetPolicyVersion: null,
    maxCostCredits: null,
    maxExternalProviderCalls: null,
    expiresAt: null,
    ...overrides,
  };
}
