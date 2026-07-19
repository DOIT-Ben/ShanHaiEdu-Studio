import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { POST as postImage } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/image/route";
import { createToolObservation } from "@/server/capabilities/tool-observation";
import { createControlPlaneStore } from "@/server/conversation/control-plane-store";
import { readOrchestrationAuthoritySummary } from "@/server/conversation/orchestration-authority-summary";
import { createTaskBrief, type IntentGrant } from "@/server/conversation/task-contract";
import { prisma } from "@/server/db/client";
import { createHumanGateActionId } from "@/server/guards/human-gate";
import { routeToolCall } from "@/server/tools/tool-router";
import type { ToolExecutionResult } from "@/server/tools/tool-types";
import { createWorkbenchService } from "@/server/workbench/service";
import type { ArtifactRecord } from "@/server/workbench/types";

const root = process.cwd();
const originalFetch = globalThis.fetch;
const originalImageEnv = {
  IMAGE_PROVIDER_CHANNEL: process.env.IMAGE_PROVIDER_CHANNEL,
  MINIMAX_API_KEY: process.env.MINIMAX_API_KEY,
  MINIMAX_BASE_URL: process.env.MINIMAX_BASE_URL,
  MINIMAX_IMAGE_MODEL: process.env.MINIMAX_IMAGE_MODEL,
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalImageEnv)) restoreEnv(key, value);
});

describe("A17 artifact route ExecutionEnvelope", () => {
  it("fails ToolRouter closed before any executor when ExecutionEnvelope is missing", async () => {
    const providerExecutor = vi.fn(async (): Promise<ToolExecutionResult> => ({
      status: "retryable_failed",
      toolId: "generate_classroom_image",
      capabilityId: "image_asset",
      provider: "minimax",
      observation: createToolObservation({
        projectId: "project-a",
        capabilityId: "image_asset",
        kind: "provider_unavailable",
        teacherSafeSummary: "不应执行。",
        internalReasonSanitized: "executor_should_not_run",
        retryPolicy: { retryable: false, nextAction: "do_not_retry_automatically" },
      }),
      artifactCreated: false,
      errorCategory: "provider_unavailable",
      budgetEvent: {
        capabilityId: "image_asset",
        actionKey: "generate_classroom_image:image_prompts",
        status: "retryable_failed",
        kind: "provider_unavailable",
        createdAt: new Date().toISOString(),
      },
    }));
    const source = approvedArtifact("ppt_draft", "artifact-ppt-draft-a");

    const result = await routeToolCall({
      capabilityId: "image_asset",
      projectId: source.projectId,
      project: projectRecord(source.projectId),
      artifactRefs: [{ kind: source.kind, artifactId: source.id }],
      resolvedArtifacts: [source],
      executionIntentEpoch: 0,
    }, { providerExecutor });

    expect(result).toMatchObject({
      status: "failed",
      errorCategory: "execution_envelope_required",
      observation: {
        internalReasonSanitized: "ExecutionEnvelope is required.",
        retryPolicy: { retryable: false, nextAction: "skip_or_replan" },
      },
    });
    expect(providerExecutor).not.toHaveBeenCalled();
  });

  it("does not create a GenerationJob or call a Provider when the route has no current TaskAggregate", async () => {
    const providerFetch = vi.fn();
    globalThis.fetch = providerFetch;
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "A17 missing TaskAggregate" });
    const source = await service.saveArtifact(project.id, {
      nodeKey: "ppt_draft",
      kind: "ppt_draft",
      title: "PPT 大纲",
      status: "needs_review",
      summary: "缺少任务控制面",
      markdownContent: "# 缺少任务控制面",
    });
    await service.approveArtifact(project.id, source.id);
    const confirmedActionId = createHumanGateActionId({
      projectId: project.id,
      capabilityId: "image_asset",
      messageId: source.id,
    });

    const response = await postImage(routeRequest({ confirmedActionId }), routeContext(project.id, source.id));
    const [snapshot, invocationCount] = await Promise.all([
      service.getProjectSnapshot(project.id),
      prisma.toolInvocationRecord.count({ where: { projectId: project.id } }),
    ]);

    expect(response.status).toBe(400);
    expect(providerFetch).not.toHaveBeenCalled();
    expect(snapshot.generationJobs).toHaveLength(0);
    expect(snapshot.artifacts).toHaveLength(1);
    expect(invocationCount).toBe(0);
  });

  it("persists the offline image route result as one Invocation/Observation/Artifact/Event transaction", async () => {
    process.env.IMAGE_PROVIDER_CHANNEL = "minimax";
    process.env.MINIMAX_API_KEY = "offline-fixture-key";
    process.env.MINIMAX_BASE_URL = "https://offline-minimax.invalid";
    process.env.MINIMAX_IMAGE_MODEL = "image-01";
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      data: { image_base64: [validPngBase64()] },
      base_resp: { status_code: 0 },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const service = createWorkbenchService();
    const project = await service.createProject({ title: "A17 offline image route" });
    const brief = createTaskBrief({
      taskId: `task:${project.id}`,
      projectId: project.id,
      intentEpoch: project.intentEpoch ?? 0,
      goal: "为现有大纲生成一张课堂视觉图",
      requestedOutputs: ["image"],
      constraints: ["offline_fixture_only"],
      excludedOutputs: [],
      generationIntensity: project.generationIntensity ?? "standard",
      sourceMessageId: `message:${project.id}`,
    });
    const grant: IntentGrant = {
      schemaVersion: "intent-grant.v1",
      taskId: brief.taskId,
      projectId: brief.projectId,
      intentEpoch: brief.intentEpoch,
      standardWorkAuthorized: true,
      intensity: brief.generationIntensity,
      budgetPolicyVersion: "offline-fixture.v1",
      maxCostCredits: 0,
      maxExternalProviderCalls: 1,
      requiredCheckpoints: [],
      expiresAt: null,
    };
    await createControlPlaneStore().upsertTaskAggregate({
      taskBrief: brief,
      intentGrant: grant,
      plan: { planId: `plan:${project.id}`, revision: 0, status: "active" },
      checkpoint: null,
    });
    const turn = await prisma.conversationTurnJob.create({
      data: {
        projectId: project.id,
        teacherMessageId: brief.sourceMessageId,
        status: "running",
        actorUserId: "local-test-user",
        actorAuthMode: "local",
      },
    });
    const source = await service.saveArtifact(project.id, {
      nodeKey: "ppt_draft",
      kind: "ppt_draft",
      title: "PPT 大纲",
      status: "needs_review",
      summary: "离线 fixture 大纲",
      markdownContent: "# 离线 fixture 大纲",
    });
    await service.approveArtifact(project.id, source.id);
    const confirmedActionId = createHumanGateActionId({
      projectId: project.id,
      capabilityId: "image_asset",
      messageId: source.id,
    });

    const response = await postImage(routeRequest({ confirmedActionId }), routeContext(project.id, source.id));
    expect(response.status).toBe(200);

    const [snapshot, invocations, observations, events, jobs, toolAudits] = await Promise.all([
      service.getProjectSnapshot(project.id),
      prisma.toolInvocationRecord.findMany({ where: { projectId: project.id } }),
      prisma.observationRecord.findMany({ where: { projectId: project.id } }),
      prisma.agentEventRecord.findMany({ where: { projectId: project.id } }),
      service.getGenerationJobs(project.id),
      prisma.orchestrationAuditEvent.findMany({
        where: { resolvedProjectId: project.id, operationKind: "tool_invocation" },
        orderBy: { sequence: "asc" },
      }),
    ]);
    const generated = snapshot.artifacts.find((artifact) => artifact.id !== source.id);

    expect(generated).toMatchObject({ kind: "image_prompts", status: "needs_review" });
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({
      toolName: "generate_classroom_image",
      status: "succeeded",
      artifactId: generated?.id,
      observationId: observations[0]?.observationId,
    });
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({ artifactId: generated?.id, status: "succeeded" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "artifact_committed", taskId: brief.taskId });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: "succeeded", resultArtifactId: generated?.id });
    expect(toolAudits).toHaveLength(2);
    expect(toolAudits).toEqual([
      expect.objectContaining({
        recordType: "attempted",
        authority: "artifact_route",
        turnJobId: turn.id,
        teacherMessageId: brief.sourceMessageId,
        toolInvocationId: invocations[0].invocationId,
        toolOrdinal: 1,
        planId: `plan:${project.id}`,
        planRevision: 0,
        invocationStatus: "running",
        observationId: null,
      }),
      expect.objectContaining({
        recordType: "resolved",
        authority: "artifact_route",
        turnJobId: turn.id,
        teacherMessageId: brief.sourceMessageId,
        toolInvocationId: invocations[0].invocationId,
        toolOrdinal: 1,
        planId: `plan:${project.id}`,
        planRevision: 0,
        invocationStatus: "succeeded",
        observationId: observations[0].observationId,
      }),
    ]);
    expect(toolAudits[1].actionDigest).toBe(toolAudits[0].actionDigest);
    expect(toolAudits[1].requestDigest).toBe(toolAudits[0].requestDigest);
    expect(JSON.stringify(toolAudits)).not.toContain(source.id);
    expect(JSON.stringify(toolAudits)).not.toContain(validPngBase64());

    const reusedResponse = await postImage(routeRequest({ confirmedActionId }), routeContext(project.id, source.id));
    const reusedPayload = await reusedResponse.json();
    expect({ status: reusedResponse.status, payload: reusedPayload }).toMatchObject({
      status: 200,
      payload: { reused: true },
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    const [reusedInvocations, reusedEvents, reusedJobs] = await Promise.all([
      prisma.toolInvocationRecord.findMany({ where: { projectId: project.id }, orderBy: { startedAt: "asc" } }),
      prisma.agentEventRecord.findMany({ where: { projectId: project.id }, orderBy: { sequence: "asc" } }),
      service.getGenerationJobs(project.id),
    ]);
    expect(reusedInvocations).toHaveLength(2);
    expect(reusedEvents).toHaveLength(2);
    expect(reusedEvents[1]).toMatchObject({ kind: "artifact_committed", taskId: brief.taskId });
    expect(reusedJobs).toHaveLength(1);

    const replayedInvocation = reusedInvocations[1];
    const terminalReplay = await createControlPlaneStore().startArtifactRouteToolInvocation({
      invocationId: `${replayedInvocation.invocationId}:retry`,
      envelope: JSON.parse(replayedInvocation.executionEnvelopeJson),
      toolName: replayedInvocation.toolName,
      request: JSON.parse(replayedInvocation.requestJson),
    });
    expect(terminalReplay).toMatchObject({
      kind: "terminal_replay",
      invocation: { invocationId: replayedInvocation.invocationId, status: "succeeded" },
    });
    const authoritySummary = await readOrchestrationAuthoritySummary({
      projectId: project.id,
      actor: { userId: "local-test-user" },
    });
    for (const violation of [
      "tool_event_kind_invalid",
      "tool_artifact_binding_invalid",
      "tool_artifact_reverse_binding_invalid",
      "tool_artifact_generation_binding_invalid",
      "tool_generation_binding_invalid",
    ]) {
      expect(authoritySummary.violationReasonCodes).not.toContain(violation);
    }
    expect(new Set(authoritySummary.violationReasonCodes)).toEqual(new Set([
      "teacher_task_submission_missing",
      "tool_selector_authority_invalid",
    ]));
    expect(authoritySummary).toMatchObject({ complete: false, readyEligible: false });
  });

  it("keeps all three artifact routes on the shared gateway and atomic result boundary", () => {
    const routePaths = [
      "src/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/image/route.ts",
      "src/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/video/route.ts",
      "src/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/coze-ppt/route.ts",
    ];
    for (const relativePath of routePaths) {
      const source = readFileSync(path.join(root, relativePath), "utf8");
      expect(source).toContain("claimArtifactRouteToolExecution");
      expect(source).toContain("commitArtifactRouteToolSuccess");
      expect(source).toContain("commitArtifactRouteToolFailure");
      expect(source).not.toContain("commitGenerationResult");
      expect(source).not.toContain("resumeStagedGenerationResult");
    }

    const boundary = readFileSync(path.join(root, "src/server/tools/artifact-route-tool-execution.ts"), "utf8");
    expect(boundary).toContain("executeThroughToolGateway");
    expect(boundary).toContain("createExecutionEnvelope");
    expect(boundary).toContain("startArtifactRouteToolInvocation");
    expect(boundary).toContain("commitToolResult");
  });
});

function approvedArtifact(kind: ArtifactRecord["kind"], id: string): ArtifactRecord {
  return {
    id,
    projectId: "project-a",
    nodeKey: kind,
    kind,
    status: "approved",
    title: "已确认来源",
    summary: "已确认来源",
    markdownContent: "# 已确认来源",
    structuredContent: {},
    version: 1,
    isApproved: true,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
  };
}

function projectRecord(projectId: string) {
  return {
    id: projectId,
    title: "A17",
    status: "active" as const,
    currentNodeKey: "ppt_draft" as const,
    grade: null,
    subject: null,
    textbookVersion: null,
    lessonTopic: null,
    lifecycleState: "active" as const,
    lifecycleVersion: 0,
    intentEpoch: 0,
    generationIntensity: "standard" as const,
    archivedAt: null,
    deletedAt: null,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
  };
}

function routeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/workbench/projects/project/artifacts/artifact/image", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function routeContext(projectId: string, artifactId: string) {
  return { params: Promise.resolve({ projectId, artifactId }) };
}

function validPngBase64() {
  return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAEElEQVR42mP8z8BQDwAFgwJ/luzjmgAAAABJRU5ErkJggg==";
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
