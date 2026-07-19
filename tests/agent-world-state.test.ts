import { describe, expect, it } from "vitest";
import { createToolObservation } from "@/server/capabilities/tool-observation";
import { buildAgentWorldState } from "@/server/conversation/agent-world-state";
import { createAgentObservation, createRunCheckpoint } from "@/server/conversation/react-control";
import { createTaskBrief, type PendingDecision } from "@/server/conversation/task-contract";
import type {
  ArtifactRecord,
  ConversationTurnJobRecord,
  GenerationJobRecord,
  ProjectRecord,
} from "@/server/workbench/types";

describe("AgentWorldState", () => {
  it("separates teacher-approved or internally eligible artifacts from untrusted drafts", () => {
    const state = buildAgentWorldState({
      project: projectRecord(),
      taskBrief: null,
      taskPlanRevision: null,
      artifacts: [
        artifactRecord({ id: "artifact-approved", title: "已确认需求", status: "approved", isApproved: true }),
        artifactRecord({
          id: "artifact-internally-eligible",
          title: "内部审查通过的需求",
          status: "needs_review",
          isApproved: false,
          structuredContent: {
            artifactQualityState: {
              validationStatus: "passed",
              reviewStatus: "passed",
              downstreamEligibility: "eligible",
            },
          },
        }),
        artifactRecord({ id: "artifact-review", nodeKey: "ppt_draft", kind: "ppt_draft", title: "待审 PPT 大纲", status: "needs_review", isApproved: false }),
        artifactRecord({ id: "artifact-mismatch", title: "状态已确认但未被教师确认", status: "approved", isApproved: false }),
      ],
      generationJobs: [],
      turnJobs: [],
      pendingDecision: null,
    });

    expect(state.trustedInputs).toEqual([
      expect.objectContaining({ id: "artifact-approved", title: "已确认需求", status: "approved", isApproved: true }),
      expect.objectContaining({ id: "artifact-internally-eligible", status: "needs_review", isApproved: false, downstreamEligible: true }),
    ]);
    expect(state.draftArtifacts.map((artifact) => artifact.id)).toEqual(["artifact-review", "artifact-mismatch"]);
    expect(JSON.stringify(state.draftArtifacts)).not.toMatch(/completed/i);
  });

  it("reports failed jobs with teacher-readable sanitized fields", () => {
    const state = buildAgentWorldState({
      project: projectRecord(),
      taskBrief: null,
      taskPlanRevision: null,
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
      pendingDecision: null,
    });

    expect(state.failedJobs).toHaveLength(2);
    expect(state.failedJobs).toEqual([
      expect.objectContaining({ id: "gen-1", kind: "PPTX 文件生成", status: "failed" }),
      expect.objectContaining({ id: "turn-1", kind: "对话处理", status: "failed" }),
    ]);
    expect(JSON.stringify(state.failedJobs)).not.toMatch(/provider|schema|storage|local path|debug|token|C:\/|D:\//i);
  });

  it("derives blocked items and stale risks directly from artifact facts", () => {
    const state = buildAgentWorldState({
      project: projectRecord(),
      taskBrief: null,
      taskPlanRevision: null,
      artifacts: [
        artifactRecord({ nodeKey: "pptx_artifact", kind: "pptx_artifact", title: "生成 PPTX 文件", status: "blocked" }),
        artifactRecord({ nodeKey: "video_segment_generate", kind: "video_segment_generate", title: "生成分镜视频片段", status: "failed" }),
        artifactRecord({ nodeKey: "lesson_plan", kind: "lesson_plan", title: "公开课教案", status: "stale" }),
      ],
      generationJobs: [],
      turnJobs: [],
      pendingDecision: null,
    });

    expect(state.blockedItems.map((item) => item.artifactKind)).toEqual(["pptx_artifact", "video_segment_generate"]);
    expect(state.nextRisks).toEqual(expect.arrayContaining([
      expect.objectContaining({ artifactKind: "lesson_plan", title: "公开课教案", status: "stale" }),
    ]));
    expect(JSON.stringify(state.blockedItems)).not.toContain("nodeKey");
    expect(JSON.stringify(state.nextRisks)).not.toContain("nodeKey");
  });

  it("does not promote artifact summaries into blocked or stale reasons", () => {
    const state = buildAgentWorldState({
      project: projectRecord(),
      taskBrief: null,
      taskPlanRevision: null,
      artifacts: [
        artifactRecord({ kind: "pptx_artifact", status: "blocked", summary: "OPENAI_API_KEY missing" }),
        artifactRecord({ id: "artifact-stale", kind: "lesson_plan", status: "stale", summary: "COZE_API_TOKEN missing" }),
      ],
      generationJobs: [],
      turnJobs: [],
      pendingDecision: null,
    });

    expect(JSON.stringify(state.blockedItems)).not.toMatch(/OPENAI_API_KEY/i);
    expect(JSON.stringify(state.nextRisks)).not.toMatch(/COZE_API_TOKEN/i);
  });

  it("projects only teacher-safe fields from a direct PendingDecision", () => {
    const pendingDecision = pendingDecisionRecord({
      actionId: "action-secret-ish",
      reasonCode: "material_choice_required",
      question: "是否继续生成 PPTX？",
      impactSummary: "确认后会调用外部生成服务。",
    });
    const state = buildAgentWorldState({
      project: projectRecord(),
      taskBrief: null,
      taskPlanRevision: null,
      artifacts: [],
      generationJobs: [],
      turnJobs: [],
      pendingDecision,
    });

    expect(state.pendingDecision).toEqual({
      decisionId: pendingDecision.decisionId,
      status: "pending",
      kind: "material_choice",
      reasonCode: "material_choice_required",
      question: "是否继续生成 PPTX？",
      impactSummary: "确认后会调用外部生成服务。",
      hasActionId: true,
    });
    expect(JSON.stringify(state.pendingDecision)).not.toMatch(/action-secret-ish|actorUserId|maxCostCredits|options/i);
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
      taskBrief: null,
      taskPlanRevision: null,
      artifacts: [],
      generationJobs: [],
      turnJobs: [],
      pendingDecision: null,
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

  it("exposes trusted ReAct observations and a paused checkpoint for restart recovery", () => {
    const taskBrief = createTaskBrief({
      taskId: "task-checkpoint",
      projectId: "project-1",
      intentEpoch: 0,
      goal: "继续当前备课任务",
      requestedOutputs: ["ppt"],
      constraints: [],
      excludedOutputs: [],
      generationIntensity: "standard",
      sourceMessageId: "message-checkpoint",
    });
    const observation = createAgentObservation({
      projectId: "project-1",
      source: "quality",
      status: "repair",
      actionKey: "review_ppt",
      inputHash: "quality-input",
      reasonCodes: ["critic_major_present"],
      reportRefs: [],
      targetLocators: [{ kind: "page", pageId: "page-5", parentArtifactId: "ppt-1" }],
      minimalNextAction: "repair_unit",
      teacherSafeSummary: "第 5 页需要局部调整。",
    });
    const checkpoint = createRunCheckpoint({
      projectId: "project-1",
      planVersion: 4,
      reason: "budget_exhausted",
      observationRefs: [observation.observationId],
    });
    const state = buildAgentWorldState({
      project: projectRecord(),
      taskBrief,
      taskPlanRevision: 4,
      artifacts: [],
      generationJobs: [],
      turnJobs: [],
      pendingDecision: null,
      agentObservations: [observation],
      runCheckpoint: checkpoint,
    });

    expect(state.agentObservations).toEqual([expect.objectContaining({
      observationId: observation.observationId,
      status: "repair",
      minimalNextAction: "repair_unit",
      targetLocators: [{ kind: "page", pageId: "page-5", parentArtifactId: "ppt-1" }],
    })]);
    expect(state.runCheckpoint).toMatchObject({ status: "paused", reason: "budget_exhausted", planVersion: 4 });
  });

  it("keeps task A artifacts and checkpoint out of task B world state after a redirect", () => {
    const taskA = createTaskBrief({
      taskId: "task-a-ppt",
      projectId: "project-1",
      intentEpoch: 0,
      goal: "制作百分数 PPT",
      requestedOutputs: ["ppt"],
      constraints: [],
      excludedOutputs: [],
      generationIntensity: "standard",
      sourceMessageId: "message-task-a",
    });
    const taskB = createTaskBrief({
      taskId: "task-b-video-script",
      projectId: "project-1",
      intentEpoch: 1,
      goal: "改为只做独立创意短片的视频脚本",
      requestedOutputs: ["video_script"],
      constraints: ["保留唯一最小课程锚点"],
      excludedOutputs: ["ppt", "image", "video", "package"],
      generationIntensity: "standard",
      sourceMessageId: "message-task-b",
    });
    const taskACheckpoint = createRunCheckpoint({
      projectId: "project-1",
      planVersion: 3,
      reason: "repeated_failure",
      observationRefs: [],
    });

    const state = buildAgentWorldState({
      project: projectRecord({ intentEpoch: taskB.intentEpoch }),
      taskBrief: taskB,
      taskPlanRevision: 0,
      artifacts: [
        artifactRecord({
          id: "task-a-approved-ppt",
          nodeKey: "ppt_draft",
          kind: "ppt_draft",
          status: "approved",
          isApproved: true,
          taskId: taskA.taskId,
          taskBriefDigest: taskA.digest,
          intentEpoch: taskA.intentEpoch,
        }),
        artifactRecord({
          id: "task-b-video-script",
          nodeKey: "video_script_generate",
          kind: "video_script_generate",
          status: "approved",
          isApproved: true,
          taskId: taskB.taskId,
          taskBriefDigest: taskB.digest,
          intentEpoch: taskB.intentEpoch,
        }),
      ],
      generationJobs: [],
      turnJobs: [],
      pendingDecision: null,
      runCheckpoint: taskACheckpoint,
    });

    expect(state.trustedInputs.map((artifact) => artifact.id)).toEqual(["task-b-video-script"]);
    expect(state.draftArtifacts).toEqual([]);
    expect(state.runCheckpoint).toBeNull();
    expect(JSON.stringify(state)).not.toContain("task-a-approved-ppt");
  });
});

function projectRecord(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: "project-1",
    title: "五年级数学百分数公开课",
    status: "active",
    grade: "五年级",
    subject: "数学",
    textbookVersion: "人教版",
    lessonTopic: "百分数",
    lifecycleState: "active",
    lifecycleVersion: 0,
    archivedAt: null,
    deletedAt: null,
    createdAt: "2026-07-09T00:00:00.000Z",
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

function pendingDecisionRecord(overrides: Partial<PendingDecision> = {}): PendingDecision {
  return {
    schemaVersion: "pending-decision.v1",
    decisionId: "decision-material-choice",
    status: "pending",
    kind: "material_choice",
    reasonCode: "material_choice_required",
    question: "是否继续？",
    impactSummary: "确认后继续执行。",
    options: [
      { id: "confirm", label: "继续", recommended: true },
      { id: "cancel", label: "取消", recommended: false },
    ],
    actorUserId: "teacher-1",
    projectId: "project-1",
    taskId: "task-decision",
    intentEpoch: 0,
    planId: "plan-decision",
    actionId: "action-decision",
    budgetPolicyVersion: null,
    maxCostCredits: null,
    maxExternalProviderCalls: null,
    expiresAt: null,
    ...overrides,
  };
}

function generationJobRecord(overrides: Partial<GenerationJobRecord>): GenerationJobRecord {
  return {
    id: overrides.id ?? "gen-1",
    projectId: "project-1",
    kind: overrides.kind ?? "pptx",
    sourceArtifactId: "artifact-1",
    intentEpoch: 0,
    inputHash: null,
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
    actorUserId: null,
    actorAuthMode: null,
    authSessionId: null,
    fencingToken: null,
    lockedBy: null,
    lockedUntil: null,
    errorCode: overrides.errorCode ?? null,
    errorMessage: overrides.errorMessage ?? "对话处理失败",
    failureCategory: overrides.failureCategory ?? null,
    failureRetryability: overrides.failureRetryability ?? null,
    failureEvidenceDigest: overrides.failureEvidenceDigest ?? null,
    recoveryEvidenceDigest: overrides.recoveryEvidenceDigest ?? null,
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
    startedAt: "2026-07-09T00:00:00.000Z",
    finishedAt: "2026-07-09T00:01:00.000Z",
    ...overrides,
  };
}
