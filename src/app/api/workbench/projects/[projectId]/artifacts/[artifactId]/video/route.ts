import { NextResponse } from "next/server";
import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
import { buildStoredVideoDownload, videoDownloadHeaders } from "@/server/video-generation/artifact-video";
import { assertVideoProviderPreconditions } from "@/server/video-generation/video-generation-run";
import { routeToolCall } from "@/server/tools/tool-router";
import { isVerifiedProviderToolSuccess } from "@/server/tools/tool-types";
import type { ArtifactKind, WorkflowNodeKey } from "@/server/workbench/types";
import { runWithProjectExecutionLease } from "@/server/execution/project-execution-runner";
import {
  assertRouteLevelGenerationConfirmation,
  readConfirmedActionId,
  readRouteGenerationBody,
  routeLevelGenerationConfirmationStatus,
} from "@/server/guards/route-level-generation-gate";

type RouteContext = {
  params: Promise<{ projectId: string; artifactId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  return withLocalWorkbenchActor(request, async ({ service }) => {
    try {
      const { projectId, artifactId } = await context.params;
      const artifact = await service.getArtifact(projectId, artifactId);
      const download = buildStoredVideoDownload(artifact);
      return new Response(toArrayBuffer(download.buffer), {
        status: 200,
        headers: videoDownloadHeaders(download.filename),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Video download failed";
      const status = message.includes("not found") ? 404 : 400;
      return NextResponse.json({ error: "这个导入视频暂时不能下载，请稍后再试。" }, { status });
    }
  });
}

export async function POST(request: Request, context: RouteContext) {
  return withLocalWorkbenchActor(request, async ({ service: baseService, executionIdentity }) => {
    const params = await context.params;
    try {
      return await runWithProjectExecutionLease({
        service: baseService,
        projectId: params.projectId,
        executionIdentity,
        holderPrefix: "video-route",
        task: async (service) => {
          let jobId: string | null = null;
          try {
            const { projectId, artifactId } = params;
            const body = await readRouteGenerationBody(request);
            const [project, sourceArtifact] = await Promise.all([service.getProject(projectId), service.getArtifact(projectId, artifactId)]);
            const upstreamArtifacts = await service.getApprovedInputs(projectId, "video_segment_plan");
            try {
              assertVideoProviderPreconditions({ artifact: sourceArtifact, upstreamArtifacts });
            } catch {
              return NextResponse.json({ error: "这个方案暂时不能生成导入视频。" }, { status: 400 });
            }
            assertRouteLevelGenerationConfirmation({
              projectId,
              capabilityId: "video_segment_generate",
              sourceArtifact,
              confirmedActionId: readConfirmedActionId(body),
            });
            const queuedJob = await service.createGenerationJob(projectId, {
              kind: "video",
              sourceArtifactId: sourceArtifact.id,
              capabilityId: "video_segment_generate",
              sourceArtifactIds: [sourceArtifact.id, ...upstreamArtifacts.map((artifact) => artifact.id)],
              inputSnapshot: {
                source: snapshotArtifact(sourceArtifact),
                upstream: upstreamArtifacts.map(snapshotArtifact),
              },
            });
            jobId = queuedJob.id;
            if (queuedJob.status === "succeeded" && queuedJob.resultArtifactId) {
              const artifact = await service.getArtifact(projectId, queuedJob.resultArtifactId);
              return NextResponse.json({ artifact, job: queuedJob, reused: true });
            }
            const recovered = await service.resumeStagedGenerationResult(projectId, jobId);
            if (recovered) {
              return NextResponse.json({ ...recovered, reused: true, recovered: true });
            }
            const execution = await service.startGenerationJobForExecution(projectId, jobId);
            const runningJob = execution.job;
            if (runningJob.status === "submission_unknown") {
              jobId = null;
              return NextResponse.json({ error: "视频任务恢复信息需要核对，系统没有自动重复提交。" }, { status: 409 });
            }

            const result = await routeToolCall({
              capabilityId: "video_segment_generate",
              projectId,
              project,
              artifactRefs: [sourceArtifact, ...upstreamArtifacts].map((artifact) => ({
                kind: artifact.kind,
                artifactId: artifact.id,
                title: artifact.title,
                summary: artifact.summary,
                markdownContent: artifact.markdownContent,
                structuredContent: artifact.structuredContent,
              })),
              resolvedArtifacts: [sourceArtifact, ...upstreamArtifacts],
              executionInputHash: runningJob.inputHash ?? undefined,
              executionIntentEpoch: runningJob.intentEpoch,
              generationTaskLifecycle: {
                providerTaskId: execution.providerTaskId,
                onTaskAccepted: async (providerTaskId) => {
                  await service.recordGenerationProviderTask(projectId, runningJob.id, { providerTaskId });
                },
                onPoll: async () => {
                  await service.recordGenerationPoll(projectId, runningJob.id);
                },
              },
            });
            if (!isVerifiedProviderToolSuccess(result)) {
              const teacherSafeError = result.status === "succeeded"
                ? "分镜视频没有通过交付校验，我没有保存这份结果。"
                : result.observation.teacherSafeSummary;
              if ("errorCategory" in result && result.errorCategory === "submission_unknown") {
                await service.markGenerationSubmissionUnknown(projectId, jobId, teacherSafeError);
              } else {
                await service.failGenerationJob(projectId, jobId, { errorMessage: teacherSafeError });
              }
              jobId = null;
              return NextResponse.json({ error: teacherSafeError }, { status: 400 });
            }

            const committingJobId = jobId;
            jobId = null;
            const committed = await service.commitGenerationResult(projectId, committingJobId, {
              nodeKey: result.artifactDraft.nodeKey as WorkflowNodeKey,
              kind: result.artifactDraft.kind as ArtifactKind,
              title: result.artifactDraft.title,
              status: "needs_review",
              summary: result.artifactDraft.summary,
              markdownContent: result.artifactDraft.markdownContent ?? "",
              structuredContent: result.artifactDraft.structuredContent,
              validationReport: result.validationReport,
            });
            return NextResponse.json(committed);
          } catch (error) {
            if (jobId) {
              await service.failGenerationJob(params.projectId, jobId, { errorMessage: "Video generation failed" }).catch(() => null);
            }
            const message = error instanceof Error ? error.message : "Video generation failed";
            const confirmationStatus = routeLevelGenerationConfirmationStatus(error);
            const status = confirmationStatus ?? (message.includes("not found") ? 404 : 400);
            return NextResponse.json({ error: "导入视频暂时没有生成成功，请稍后再试。" }, { status });
          }
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Video generation failed";
      const status = message.includes("lease") ? 409 : 400;
      return NextResponse.json({ error: "导入视频暂时没有生成成功，请稍后再试。" }, { status });
    }
  });
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);
  return arrayBuffer;
}

function snapshotArtifact(artifact: { id: string; kind: string; nodeKey: string; version: number; updatedAt: string }) {
  return { id: artifact.id, kind: artifact.kind, nodeKey: artifact.nodeKey, version: artifact.version, updatedAt: artifact.updatedAt };
}
