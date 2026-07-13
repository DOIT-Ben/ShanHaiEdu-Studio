import { describe, expect, it, vi } from "vitest";

import { createMainAgentToolLoopOptions } from "@/server/conversation/main-agent-tool-loop-config";
import { readAgentObservationsFromMessages } from "@/server/conversation/react-control";
import { readAgentToolReportsFromMessages } from "@/server/tools/agent-tool-report";
import { createWorkbenchService } from "@/server/workbench/service";
import { createWorkbenchActor } from "@/server/auth/actor";
import { hashArtifactDraft } from "@/server/contracts/contract-validator";
import { videoCourseAnchorHardGateIds } from "@/server/tools/video-course-anchor-gate";

describe("V1-3 Main Agent Agent Tool loop config", () => {
  it("persists a signed Agent Tool report and observation under the active project lease", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `V1-3-loop-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "请规划PPT样张。" });
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    expect(lease).not.toBeNull();
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    const executor = vi.fn(async (envelope) => ({
      status: "succeeded" as const,
      toolId: "ppt_director.plan_or_repair" as const,
      invocationId: envelope.invocationId,
      structuredOutput: {
        decision: "plan",
        summary: "先确定关键样张。",
        targetLocators: [],
        nextToolIntents: ["assemble_ppt_key_samples"],
        assumptions: [],
        stopConditions: ["sample_review"],
      },
      assistantSummary: "已形成样张规划。",
      artifactCreated: false as const,
    }));

    try {
      const config = createMainAgentToolLoopOptions({
        service,
        project,
        triggerMessage: message,
        artifacts: [],
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null },
        fence,
        executor,
      });
      expect(config?.allowedToolNames).toContain("ppt_director_plan_or_repair");
      const result = await config!.dispatch({
        callId: "call-1",
        toolName: "ppt_director_plan_or_repair",
        arguments: { goal: "规划课件", stage: "sample_plan", targetPageIds: [], focus: null },
      });

      expect(result).toMatchObject({ status: "succeeded", observationId: expect.any(String) });
      const messages = await service.getMessages(project.id);
      expect(readAgentToolReportsFromMessages(messages)).toEqual([
        expect.objectContaining({ projectId: project.id, toolId: "ppt_director.plan_or_repair", status: "succeeded" }),
      ]);
      expect(readAgentObservationsFromMessages(messages)).toEqual([
        expect.objectContaining({ projectId: project.id, actionKey: "ppt_director.plan_or_repair", status: "succeeded" }),
      ]);
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("does not execute or persist an Agent Tool after IntentEpoch changes", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `V1-3-stale-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "请规划PPT样张。" });
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    const executor = vi.fn();
    try {
      const config = createMainAgentToolLoopOptions({
        service,
        project,
        triggerMessage: message,
        artifacts: [],
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null },
        fence,
        executor,
      });
      await service.advanceProjectIntentEpoch(project.id, project.intentEpoch ?? 0);
      const result = await config!.dispatch({
        callId: "call-2",
        toolName: "ppt_director_plan_or_repair",
        arguments: { goal: "规划课件", stage: "sample_plan", targetPageIds: [], focus: null },
      });
      expect(result).toMatchObject({ status: "inconclusive", modelOutput: { reason: "intent_changed" } });
      expect(executor).not.toHaveBeenCalled();
      expect(readAgentToolReportsFromMessages(await service.getMessages(project.id))).toEqual([]);
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("persists a course-anchor Critic review without approving the concept", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `V1-7-anchor-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "审查当前视频创意。" });
    const concept = await service.saveArtifact(project.id, {
      nodeKey: "creative_theme_generate", kind: "creative_theme_generate", title: "独立创意候选",
      status: "needs_review", summary: "等待课程锚点审查。", markdownContent: "# 独立创意候选",
      structuredContent: { conceptSelection: { selectedConceptId: "concept-a" } },
    });
    const digest = hashArtifactDraft({
      nodeKey: concept.nodeKey, kind: concept.kind, title: concept.title, summary: concept.summary,
      markdownContent: concept.markdownContent, structuredContent: concept.structuredContent,
    });
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    const executor = vi.fn(async (envelope) => ({
      status: "succeeded" as const, toolId: "delivery_critic.review" as const, invocationId: envelope.invocationId,
      structuredOutput: {
        recommendation: "pass", summary: "六个硬门全部通过。", findings: [],
        targetLocators: [{ kind: "artifact", artifactKind: concept.kind, artifactId: concept.id }],
        responsibleStage: "video_concept_selection", minimalFix: "无需返修。", inconclusiveReasons: [],
        hardGateResults: videoCourseAnchorHardGateIds.map((gateId) => ({ gateId, status: "passed", evidenceRefs: [`evidence:${gateId}`], rationale: "证据满足。", findingIds: [] })),
      },
      assistantSummary: "课程锚点审查通过。", artifactCreated: false as const,
    }));

    try {
      const artifacts = [concept];
      const config = createMainAgentToolLoopOptions({
        service, project, triggerMessage: message, artifacts,
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null }, fence, executor,
      });
      const result = await config!.dispatch({
        callId: "call-anchor", toolName: "delivery_critic_review",
        arguments: {
          domain: "video", stage: "course_anchor",
          targetLocators: [{ kind: "artifact", artifactKind: concept.kind, artifactId: concept.id }],
          reviewFocus: null, courseAnchorRef: { artifactId: concept.id, version: concept.version, digest },
          rubricRef: { id: "video-course-anchor", version: "v1", digest: "b".repeat(64) },
          generatorInvocationId: "generator-a",
        },
      });

      expect(result).toMatchObject({ status: "succeeded", modelOutput: { persistedReviewKind: "creative_theme_generate" } });
      const reviewed = artifacts.at(-1)!;
      expect(reviewed).toMatchObject({ status: "needs_review", isApproved: false, structuredContent: { videoCourseAnchorReview: { overallStatus: "passed" } } });
      await expect(service.approveArtifact(project.id, reviewed.id)).resolves.toMatchObject({ status: "approved" });
      expect(readAgentToolReportsFromMessages(await service.getMessages(project.id))).toHaveLength(1);
      expect(readAgentObservationsFromMessages(await service.getMessages(project.id))).toHaveLength(1);
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });
});
