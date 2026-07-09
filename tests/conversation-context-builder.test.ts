import { describe, expect, it } from "vitest";
import { buildConversationContextPackage, contextPackageToMainAgentConversationContext } from "@/server/conversation/conversation-context-builder";
import type { ArtifactRecord, ConversationMessageRecord, ProjectRecord, WorkflowNodeRecord } from "@/server/workbench/types";

describe("conversation-context-builder", () => {
  it("builds a bounded ContextPackage from real project state for the main agent", () => {
    const project = projectRecord();
    const messages = Array.from({ length: 10 }, (_, index) => messageRecord(index));
    const contextPackage = buildConversationContextPackage({
      project,
      messages,
      workflowNodes: [nodeRecord("requirement_spec", "approved"), nodeRecord("ppt_draft", "needs_review")],
      artifacts: [artifactRecord("artifact-approved", "requirement_spec", "approved", true), artifactRecord("artifact-draft", "ppt_draft", "needs_review", false)],
      maxInputTokens: 12_000,
    });

    expect(contextPackage.project).toMatchObject({ id: project.id, currentNodeKey: "requirement_spec" });
    expect(contextPackage.recentMessages).toHaveLength(8);
    expect(contextPackage.recentMessages[0].content).toBe("消息 2");
    expect(contextPackage.workflowNodes).toEqual([
      expect.objectContaining({ key: "requirement_spec", status: "approved" }),
      expect.objectContaining({ key: "ppt_draft", status: "needs_review" }),
    ]);
    expect(contextPackage.artifacts).toEqual([
      expect.objectContaining({ id: "artifact-approved", isApproved: true }),
      expect.objectContaining({ id: "artifact-draft", isApproved: false, status: "needs_review" }),
    ]);
    expect(contextPackage.guardrails.join("\n")).toContain("不得把未完成产物描述为已完成");
    expect(contextPackage.summaryValidation).toEqual({ status: "passed", errors: [] });
    expect(contextPackage.tokenEstimate).toBeGreaterThan(0);
  });

  it("converts ContextPackage pending plan into the existing main-agent conversation contract", () => {
    const contextPackage = buildConversationContextPackage({
      project: projectRecord(),
      messages: [messageRecord(1, "assistant"), messageRecord(2, "teacher")],
      workflowNodes: [nodeRecord("requirement_spec", "needs_review")],
      artifacts: [],
    });

    const conversationContext = contextPackageToMainAgentConversationContext(contextPackage, {
      teacherRequest: "帮我做百分数 PPT",
      toolPlan: {
        planId: "plan-context-test",
        capabilityId: "requirement_spec",
        reasonForUser: "先整理需求。",
        internalReason: "测试上下文转换。",
        inputDraft: {},
        missingInputs: [],
        upstreamPlan: [],
        nextSuggestedCapabilities: [],
        requiresConfirmation: true,
        expectedArtifactKind: "requirement_spec",
      },
    });

    expect(conversationContext.recentMessages).toEqual([
      { role: "assistant", content: "消息 1" },
      { role: "teacher", content: "消息 2" },
    ]);
    expect(conversationContext.latestAssistantContent).toBe("消息 1");
    expect(conversationContext.pendingDeliveryPlan).toMatchObject({ teacherRequest: "帮我做百分数 PPT" });
    expect(conversationContext.contextPackage.workflowNodes).toEqual([expect.objectContaining({ key: "requirement_spec", status: "needs_review" })]);
    expect(conversationContext.contextPackage.guardrails).toContain("只有 approved artifact 可作为下游可信输入。");
  });
});

function projectRecord(): ProjectRecord {
  return {
    id: "project-context",
    title: "五年级百分数公开课",
    status: "active",
    currentNodeKey: "requirement_spec",
    grade: "五年级",
    subject: "数学",
    textbookVersion: null,
    lessonTopic: "百分数",
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
    artifactRefs: [],
    metadata: {},
    createdAt: `2026-07-09T00:00:${String(index).padStart(2, "0")}.000Z`,
  };
}

function nodeRecord(key: WorkflowNodeRecord["key"], status: WorkflowNodeRecord["status"]): WorkflowNodeRecord {
  return {
    id: `node-${key}`,
    projectId: "project-context",
    key,
    title: key,
    status,
    order: 1,
    upstreamNodeKeys: [],
    approvedArtifactId: status === "approved" ? `artifact-${key}` : null,
    staleReason: null,
    updatedAt: "2026-07-09T00:00:00.000Z",
  };
}

function artifactRecord(id: string, nodeKey: ArtifactRecord["nodeKey"], status: ArtifactRecord["status"], isApproved: boolean): ArtifactRecord {
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
  };
}
