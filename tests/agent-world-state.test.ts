import { describe, expect, it } from "vitest";
import { createToolObservation } from "@/server/capabilities/tool-observation";
import { buildAgentWorldState } from "@/server/conversation/agent-world-state";
import type {
  ArtifactRecord,
  ConversationTurnJobRecord,
  GenerationJobRecord,
  ProjectRecord,
  WorkflowNodeRecord,
} from "@/server/workbench/types";

describe("AgentWorldState", () => {
  it("separates approved artifacts as trusted inputs and non-approved artifacts as drafts", () => {
    const state = buildAgentWorldState({
      project: projectRecord(),
      workflowNodes: [nodeRecord({ key: "requirement_spec", status: "approved" })],
      artifacts: [
        artifactRecord({ id: "artifact-approved", title: "已确认需求", status: "approved", isApproved: true }),
        artifactRecord({ id: "artifact-review", nodeKey: "ppt_draft", kind: "ppt_draft", title: "待审 PPT 大纲", status: "needs_review", isApproved: false }),
        artifactRecord({ id: "artifact-mismatch", title: "状态已确认但未被教师确认", status: "approved", isApproved: false }),
      ],
      generationJobs: [],
      turnJobs: [],
      contextPackage: contextPackage(),
      pendingPlan: null,
    });

    expect(state.currentNodeKey).toBe("ppt_draft");
    expect(state.trustedInputs).toEqual([
      expect.objectContaining({ id: "artifact-approved", title: "已确认需求", status: "approved", isApproved: true }),
    ]);
    expect(state.draftArtifacts.map((artifact) => artifact.id)).toEqual(["artifact-review", "artifact-mismatch"]);
    expect(JSON.stringify(state.draftArtifacts)).not.toMatch(/completed/i);
  });

  it("reports failed jobs with teacher-readable sanitized fields", () => {
    const state = buildAgentWorldState({
      project: projectRecord(),
      workflowNodes: [],
      artifacts: [],
      generationJobs: [
        generationJobRecord({
          id: "gen-1",
          kind: "pptx",
          errorMessage: "provider schema storage local path debug token timeout at C:/secret/out.pptx",
        }),
      ],
      turnJobs: [
        turnJobRecord({
          id: "turn-1",
          errorCode: "PROVIDER_SCHEMA_DEBUG",
          errorMessage: "debug provider token leaked local path D:/tmp/file",
        }),
      ],
      contextPackage: contextPackage(),
      pendingPlan: null,
    });

    expect(state.failedJobs).toHaveLength(2);
    expect(state.failedJobs).toEqual([
      expect.objectContaining({ id: "gen-1", kind: "PPTX 文件生成", status: "failed" }),
      expect.objectContaining({ id: "turn-1", kind: "对话处理", status: "failed" }),
    ]);
    expect(JSON.stringify(state.failedJobs)).not.toMatch(/provider|schema|storage|local path|debug|token|C:\/|D:\//i);
  });

  it("keeps blocked or failed nodes in blocked items and stale nodes in next risks", () => {
    const state = buildAgentWorldState({
      project: projectRecord(),
      workflowNodes: [
        nodeRecord({ key: "pptx_artifact", title: "生成 PPTX 文件", status: "blocked" }),
        nodeRecord({ key: "video_segment_generate", title: "生成分镜视频片段", status: "failed" }),
        nodeRecord({ key: "lesson_plan", title: "公开课教案", status: "stale", staleReason: "上游需求已更新，需要重新核对。" }),
      ],
      artifacts: [],
      generationJobs: [],
      turnJobs: [],
      contextPackage: contextPackage(),
      pendingPlan: null,
    });

    expect(state.blockedItems.map((item) => item.nodeKey)).toEqual(["pptx_artifact", "video_segment_generate"]);
    expect(state.nextRisks).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeKey: "lesson_plan", title: "公开课教案", status: "stale", reason: "上游需求已更新，需要重新核对。" }),
    ]));
  });

  it("sanitizes blocked and stale node reasons before they enter world state", () => {
    const state = buildAgentWorldState({
      project: projectRecord(),
      workflowNodes: [
        nodeRecord({ key: "pptx_artifact", title: "生成 PPTX 文件", status: "blocked", staleReason: "OPENAI_API_KEY missing" }),
        nodeRecord({ key: "lesson_plan", title: "公开课教案", status: "stale", staleReason: "COZE_API_TOKEN missing" }),
      ],
      artifacts: [],
      generationJobs: [],
      turnJobs: [],
      contextPackage: contextPackage(),
      pendingPlan: null,
    });

    expect(JSON.stringify(state.blockedItems)).not.toMatch(/OPENAI_API_KEY/i);
    expect(JSON.stringify(state.nextRisks)).not.toMatch(/COZE_API_TOKEN/i);
  });

  it("keeps only the safe pending plan fields", () => {
    const state = buildAgentWorldState({
      project: projectRecord(),
      workflowNodes: [],
      artifacts: [],
      generationJobs: [],
      turnJobs: [],
      contextPackage: contextPackage(),
      pendingPlan: {
        status: "pending",
        teacherRequest: "帮我做五年级数学百分数 PPT",
        actionId: "action-secret-ish",
        runtimeKind: "openai",
        toolPlan: {
          planId: "requirement_spec:test",
          capabilityId: "requirement_spec",
          reasonForUser: "我可以先整理需求。",
          internalReason: "do-not-leak-internal-reason",
          inputDraft: { provider: "do-not-leak" },
          missingInputs: [],
          upstreamPlan: [],
          nextSuggestedCapabilities: ["lesson_plan"],
          requiresConfirmation: true,
          expectedArtifactKind: "requirement_spec",
        },
      },
    });

    expect(state.pendingPlan).toEqual({
      teacherRequest: "帮我做五年级数学百分数 PPT",
      capabilityId: "requirement_spec",
      expectedArtifactKind: "requirement_spec",
      hasActionId: true,
    });
    expect(JSON.stringify(state.pendingPlan)).not.toMatch(/internalReason|do-not-leak|action-secret-ish|provider/i);
  });

  it("keeps active tool observations visible to the model without turning them into trusted inputs", () => {
    const observation = createToolObservation({
      projectId: "project-1",
      capabilityId: "coze_ppt",
      expectedArtifactKind: "pptx_artifact",
      kind: "provider_unavailable",
      teacherSafeSummary: "真实 PPTX 暂时没有生成成功，我没有保存占位成果。",
      internalReasonSanitized: "provider debug local path C:\\secret\\out.pptx token=abc",
    });

    const state = buildAgentWorldState({
      project: projectRecord(),
      workflowNodes: [],
      artifacts: [],
      generationJobs: [],
      turnJobs: [],
      contextPackage: contextPackage(),
      pendingPlan: null,
      toolObservations: [observation, { ...observation, observationId: "resolved", status: "resolved" }],
    });

    expect(state.toolObservations).toEqual([
      expect.objectContaining({
        capabilityId: "coze_ppt",
        kind: "provider_unavailable",
        status: "active",
        artifactCreated: false,
      }),
    ]);
    expect(state.trustedInputs).toEqual([]);
    expect(state.draftArtifacts).toEqual([]);
    expect(JSON.stringify(state.toolObservations)).not.toMatch(/provider debug|local path|C:\\|token/i);
  });
});

function projectRecord(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: "project-1",
    title: "五年级数学百分数公开课",
    status: "active",
    currentNodeKey: "ppt_draft",
    grade: "五年级",
    subject: "数学",
    textbookVersion: "人教版",
    lessonTopic: "百分数",
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
    ...overrides,
  };
}

function nodeRecord(overrides: Partial<WorkflowNodeRecord>): WorkflowNodeRecord {
  return {
    id: `node-${overrides.key ?? "requirement_spec"}`,
    projectId: "project-1",
    key: overrides.key ?? "requirement_spec",
    title: overrides.title ?? "备课节点",
    status: overrides.status ?? "not_started",
    order: 1,
    upstreamNodeKeys: [],
    approvedArtifactId: null,
    staleReason: null,
    updatedAt: "2026-07-09T00:00:00.000Z",
    ...overrides,
  };
}

function artifactRecord(overrides: Partial<ArtifactRecord>): ArtifactRecord {
  return {
    id: overrides.id ?? "artifact-1",
    projectId: "project-1",
    nodeKey: overrides.nodeKey ?? "requirement_spec",
    title: overrides.title ?? "备课产物",
    kind: overrides.kind ?? "requirement_spec",
    status: overrides.status ?? "needs_review",
    summary: "教师可读摘要",
    markdownContent: "# 备课产物",
    structuredContent: {},
    version: 1,
    isApproved: overrides.isApproved ?? false,
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
    ...overrides,
  };
}

function generationJobRecord(overrides: Partial<GenerationJobRecord>): GenerationJobRecord {
  return {
    id: overrides.id ?? "gen-1",
    projectId: "project-1",
    kind: overrides.kind ?? "pptx",
    sourceArtifactId: "artifact-1",
    status: "failed",
    attempts: 2,
    maxAttempts: 3,
    resultArtifactId: null,
    errorMessage: overrides.errorMessage ?? "服务暂时不可用",
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
    startedAt: "2026-07-09T00:00:00.000Z",
    finishedAt: "2026-07-09T00:01:00.000Z",
    ...overrides,
  };
}

function turnJobRecord(overrides: Partial<ConversationTurnJobRecord>): ConversationTurnJobRecord {
  return {
    id: overrides.id ?? "turn-1",
    projectId: "project-1",
    teacherMessageId: "message-teacher",
    assistantMessageId: null,
    status: "failed",
    attempts: 1,
    maxAttempts: 2,
    idempotencyKey: null,
    lockedBy: null,
    lockedUntil: null,
    errorCode: overrides.errorCode ?? null,
    errorMessage: overrides.errorMessage ?? "对话处理失败",
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
    startedAt: "2026-07-09T00:00:00.000Z",
    finishedAt: "2026-07-09T00:01:00.000Z",
    ...overrides,
  };
}

function contextPackage() {
  return {
    mode: "snapshot" as const,
    project: {
      id: "project-1",
      title: "五年级数学百分数公开课",
      grade: "五年级",
      subject: "数学",
      textbookVersion: "人教版",
      lessonTopic: "百分数",
      currentNodeKey: "ppt_draft" as const,
    },
    workflowNodes: [],
    recentMessages: [],
    artifacts: [],
    guardrails: [],
    summaryValidation: { status: "passed" as const, errors: [] },
    tokenEstimate: 100,
  };
}
