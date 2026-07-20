import { NextResponse } from "next/server";

import type { AuthenticatedWorkbenchRequest } from "@/server/auth/workbench-route";
import {
  assertRouteLevelGenerationConfirmation,
  readConfirmedActionId,
  readRouteGenerationBody,
  routeLevelGenerationConfirmationStatus,
} from "@/server/guards/route-level-generation-gate";
import {
  claimArtifactRouteToolExecution,
  commitArtifactRouteToolFailure,
  commitArtifactRouteToolReplay,
  commitArtifactRouteToolSuccess,
  resolveArtifactRouteTaskContext,
  type ArtifactRouteToolExecutionClaim,
} from "@/server/tools/artifact-route-tool-execution";
import { routeToolCall } from "@/server/tools/tool-router";
import { isVerifiedProviderToolSuccess } from "@/server/tools/tool-types";
import { assertVideoProviderPreconditions } from "@/server/video-generation/video-generation-run";

type VideoRouteGenerationInput = {
  request: Request;
  service: AuthenticatedWorkbenchRequest["service"];
  projectId: string;
  artifactId: string;
  actorUserId: string;
};

export async function executeVideoArtifactGeneration(input: VideoRouteGenerationInput) {
  let jobId: string | null = null;
  let executionClaim: ArtifactRouteToolExecutionClaim | null = null;
  try {
    const body = await readRouteGenerationBody(input.request);
    const [project, sourceArtifact] = await Promise.all([
      input.service.getProject(input.projectId),
      input.service.getArtifact(input.projectId, input.artifactId),
    ]);
    assertRouteLevelGenerationConfirmation({
      projectId: input.projectId,
      capabilityId: "video_segment_generate",
      sourceArtifact,
      confirmedActionId: readConfirmedActionId(body),
    });
    const taskContext = await resolveArtifactRouteTaskContext({ project });
    const upstreamArtifacts = await input.service.getApprovedInputs(
      input.projectId,
      "video_segment_plan",
      taskContext.aggregate.taskBrief,
    );
    try {
      assertVideoProviderPreconditions({ artifact: sourceArtifact, upstreamArtifacts });
    } catch {
      return NextResponse.json({ error: "这个方案暂时不能生成导入视频。" }, { status: 400 });
    }
    const shotId = readVideoRouteShotId(body);
    const actionArguments = {
      sourceArtifactId: sourceArtifact.id,
      sourceArtifactVersion: sourceArtifact.version,
      upstreamArtifactIds: upstreamArtifacts.map((artifact) => artifact.id),
      shotIds: [shotId],
    };
    executionClaim = await claimArtifactRouteToolExecution({
      project,
      actorUserId: input.actorUserId,
      toolName: "generate_video_segment",
      arguments: actionArguments,
      sourceArtifacts: [sourceArtifact, ...upstreamArtifacts],
      taskContext,
    });
    const queuedJob = await input.service.createGenerationJob(input.projectId, {
      kind: "video",
      sourceArtifactId: sourceArtifact.id,
      unitId: shotId,
      capabilityId: "video_segment_generate",
      sourceArtifactIds: [sourceArtifact.id, ...upstreamArtifacts.map((artifact) => artifact.id)],
      inputSnapshot: {
        source: snapshotArtifact(sourceArtifact),
        upstream: upstreamArtifacts.map(snapshotArtifact),
      },
    });
    jobId = queuedJob.id;
    if (queuedJob.status === "succeeded" && queuedJob.resultArtifactId) {
      const artifact = await input.service.getArtifact(input.projectId, queuedJob.resultArtifactId);
      await commitArtifactRouteToolReplay({ claim: executionClaim, artifactId: artifact.id, generationJobId: queuedJob.id });
      executionClaim = null;
      jobId = null;
      return NextResponse.json({ artifact, job: queuedJob, reused: true });
    }
    const execution = await input.service.startGenerationJobForExecution(input.projectId, jobId);
    const runningJob = execution.job;
    if (runningJob.status === "submission_unknown") {
      await commitArtifactRouteToolFailure({
        claim: executionClaim,
        generationJobId: jobId,
        teacherSafeSummary: "视频任务恢复信息需要核对，系统没有自动重复提交。",
        reasonCodes: ["submission_unknown"],
        errorCategory: "submission_unknown",
      });
      executionClaim = null;
      jobId = null;
      return NextResponse.json({ error: "视频任务恢复信息需要核对，系统没有自动重复提交。" }, { status: 409 });
    }

    const result = await executeVideoRouteTool({ input, project, sourceArtifact, upstreamArtifacts, executionClaim, runningJob, providerTaskId: execution.providerTaskId });
    if (!isVerifiedProviderToolSuccess(result)) {
      const teacherSafeError = result.status === "succeeded"
        ? "分镜视频没有通过交付校验，我没有保存这份结果。"
        : result.observation.teacherSafeSummary;
      await commitArtifactRouteToolFailure({
        claim: executionClaim,
        generationJobId: jobId,
        ...(result.status === "succeeded"
          ? { teacherSafeSummary: teacherSafeError, reasonCodes: ["quality_gate_failed"], errorCategory: "quality_gate_failed" }
          : { result }),
      });
      executionClaim = null;
      jobId = null;
      return NextResponse.json({ error: teacherSafeError }, { status: 400 });
    }

    const committingJobId = jobId;
    const committed = await commitArtifactRouteToolSuccess({ claim: executionClaim, generationJobId: committingJobId, result });
    const artifact = await input.service.getArtifact(input.projectId, committed.artifact.id);
    const job = (await input.service.getGenerationJobs(input.projectId)).find((candidate) => candidate.id === committingJobId);
    if (!job) throw new Error("Committed video GenerationJob was not found.");
    executionClaim = null;
    jobId = null;
    return NextResponse.json({ artifact, job });
  } catch (error) {
    if (executionClaim) {
      await commitArtifactRouteToolFailure({
        claim: executionClaim,
        ...(jobId ? { generationJobId: jobId } : {}),
        teacherSafeSummary: "导入视频暂时没有生成成功，请稍后再试。",
        reasonCodes: ["artifact_route_execution_failed"],
        errorCategory: "artifact_route_execution_failed",
      }).catch(() => null);
    }
    const message = error instanceof Error ? error.message : "Video generation failed";
    const confirmationStatus = routeLevelGenerationConfirmationStatus(error);
    const status = confirmationStatus ?? (message.includes("not found") ? 404 : 400);
    return NextResponse.json({ error: "导入视频暂时没有生成成功，请稍后再试。" }, { status });
  }
}

function executeVideoRouteTool(input: {
  input: VideoRouteGenerationInput;
  project: Awaited<ReturnType<VideoRouteGenerationInput["service"]["getProject"]>>;
  sourceArtifact: Awaited<ReturnType<VideoRouteGenerationInput["service"]["getArtifact"]>>;
  upstreamArtifacts: Awaited<ReturnType<VideoRouteGenerationInput["service"]["getApprovedInputs"]>>;
  executionClaim: ArtifactRouteToolExecutionClaim;
  runningJob: Awaited<ReturnType<VideoRouteGenerationInput["service"]["startGenerationJob"]>>;
  providerTaskId: string | null;
}) {
  const { projectId, service } = input.input;
  const resolvedArtifacts = [input.sourceArtifact, ...input.upstreamArtifacts];
  return routeToolCall({
    toolName: "generate_video_segment",
    projectId,
    project: input.project,
    toolInput: { ...input.executionClaim.arguments, taskBrief: input.executionClaim.aggregate.taskBrief },
    artifactRefs: resolvedArtifacts.map((artifact) => ({
      kind: artifact.kind,
      artifactId: artifact.id,
      title: artifact.title,
      summary: artifact.summary,
      markdownContent: artifact.markdownContent,
      structuredContent: artifact.structuredContent,
    })),
    resolvedArtifacts,
    executionInputHash: input.runningJob.inputHash ?? undefined,
    executionIntentEpoch: input.runningJob.intentEpoch,
    executionEnvelope: input.executionClaim.executionEnvelope,
    generationTaskLifecycle: {
      providerTaskId: input.providerTaskId,
      onTaskAccepted: (providerTaskId) => service.recordGenerationProviderTask(projectId, input.runningJob.id, { providerTaskId }).then(() => undefined),
      onPoll: () => service.recordGenerationPoll(projectId, input.runningJob.id).then(() => undefined),
    },
  });
}

export function readVideoRouteShotId(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("video_route_shot_required");
  const record = body as Record<string, unknown>;
  const scalar = typeof record.shotId === "string" ? record.shotId.trim() : "";
  const array = Array.isArray(record.shotIds) && record.shotIds.length === 1 && typeof record.shotIds[0] === "string"
    ? record.shotIds[0].trim()
    : "";
  const shotId = scalar || array;
  if (!/^shot_[A-Za-z0-9_-]+$/.test(shotId) || (scalar && array && scalar !== array)) {
    throw new Error("video_route_shot_required");
  }
  return shotId;
}

function snapshotArtifact(artifact: { id: string; kind: string; nodeKey: string; version: number; updatedAt: string }) {
  return { id: artifact.id, kind: artifact.kind, nodeKey: artifact.nodeKey, version: artifact.version, updatedAt: artifact.updatedAt };
}
