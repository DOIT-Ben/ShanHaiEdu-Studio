import { NextResponse } from "next/server";
import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
import { buildStoredImageDownload, imageDownloadHeaders } from "@/server/image-generation/artifact-image";
import {
  claimArtifactRouteToolExecution,
  commitArtifactRouteToolFailure,
  commitArtifactRouteToolReplay,
  commitArtifactRouteToolSuccess,
  type ArtifactRouteToolExecutionClaim,
} from "@/server/tools/artifact-route-tool-execution";
import { routeToolCall } from "@/server/tools/tool-router";
import { isVerifiedProviderToolSuccess } from "@/server/tools/tool-types";
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
      const download = buildStoredImageDownload(artifact);
      return new Response(toArrayBuffer(download.buffer), {
        status: 200,
        headers: imageDownloadHeaders({ filename: download.filename, mime: download.mime }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Image download failed";
      const status = message.includes("not found") ? 404 : 400;
      return NextResponse.json({ error: "这张课堂视觉图暂时不能下载，请稍后再试。" }, { status });
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
        holderPrefix: "image-route",
        task: async (service) => {
          let jobId: string | null = null;
          let executionClaim: ArtifactRouteToolExecutionClaim | null = null;
          try {
            const { projectId, artifactId } = params;
            const body = await readRouteGenerationBody(request);
            const [project, sourceArtifact] = await Promise.all([service.getProject(projectId), service.getArtifact(projectId, artifactId)]);
            if (sourceArtifact.nodeKey !== "ppt_draft" || sourceArtifact.kind !== "ppt_draft") {
              return NextResponse.json({ error: "这个 PPT 暂时不能生成课堂视觉图。" }, { status: 400 });
            }
            assertRouteLevelGenerationConfirmation({
              projectId,
              capabilityId: "image_asset",
              sourceArtifact,
              confirmedActionId: readConfirmedActionId(body),
            });
            const actionArguments = {
              sourceArtifactId: sourceArtifact.id,
              sourceArtifactVersion: sourceArtifact.version,
            };
            executionClaim = await claimArtifactRouteToolExecution({
              project,
              actorUserId: executionIdentity.actorUserId,
              toolName: "generate_classroom_image",
              arguments: actionArguments,
              sourceArtifacts: [sourceArtifact],
            });
            const queuedJob = await service.createGenerationJob(projectId, {
              kind: "image",
              sourceArtifactId: sourceArtifact.id,
              capabilityId: "image_asset",
              inputSnapshot: { source: snapshotArtifact(sourceArtifact) },
            });
            jobId = queuedJob.id;
            if (queuedJob.status === "succeeded" && queuedJob.resultArtifactId) {
              const artifact = await service.getArtifact(projectId, queuedJob.resultArtifactId);
              await commitArtifactRouteToolReplay({
                claim: executionClaim,
                artifactId: artifact.id,
                generationJobId: queuedJob.id,
              });
              executionClaim = null;
              jobId = null;
              return NextResponse.json({ artifact, job: queuedJob, reused: true });
            }
            const runningJob = (await service.startGenerationJobForExecution(projectId, jobId)).job;
            if (runningJob.status === "submission_unknown") {
              await commitArtifactRouteToolFailure({
                claim: executionClaim,
                generationJobId: jobId,
                teacherSafeSummary: "图片任务状态需要核对，系统没有自动重复提交。",
                reasonCodes: ["submission_unknown"],
                errorCategory: "submission_unknown",
              });
              executionClaim = null;
              jobId = null;
              return NextResponse.json({ error: "图片任务状态需要核对，系统没有自动重复提交。" }, { status: 409 });
            }

            const result = await routeToolCall({
              toolName: "generate_classroom_image",
              projectId,
              project,
              toolInput: actionArguments,
              artifactRefs: [{
                kind: sourceArtifact.kind,
                artifactId: sourceArtifact.id,
                title: sourceArtifact.title,
                summary: sourceArtifact.summary,
                markdownContent: sourceArtifact.markdownContent,
                structuredContent: sourceArtifact.structuredContent,
              }],
              resolvedArtifacts: [sourceArtifact],
              executionInputHash: runningJob.inputHash ?? undefined,
              executionIntentEpoch: runningJob.intentEpoch,
              executionEnvelope: executionClaim.executionEnvelope,
            });
            if (!isVerifiedProviderToolSuccess(result)) {
              const teacherSafeError = result.status === "succeeded"
                ? "课堂视觉图没有通过交付校验，我没有保存这份结果。"
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
            const committed = await commitArtifactRouteToolSuccess({
              claim: executionClaim,
              generationJobId: committingJobId,
              result,
            });
            const artifact = await service.getArtifact(projectId, committed.artifact.id);
            const job = (await service.getGenerationJobs(projectId)).find((candidate) => candidate.id === committingJobId);
            if (!job) throw new Error("Committed image GenerationJob was not found.");
            executionClaim = null;
            jobId = null;
            return NextResponse.json({ artifact, job });
          } catch (error) {
            if (executionClaim) {
              await commitArtifactRouteToolFailure({
                claim: executionClaim,
                ...(jobId ? { generationJobId: jobId } : {}),
                teacherSafeSummary: "课堂视觉图暂时没有生成成功，请稍后再试。",
                reasonCodes: ["artifact_route_execution_failed"],
                errorCategory: "artifact_route_execution_failed",
              }).catch(() => null);
            }
            const message = error instanceof Error ? error.message : "Image generation failed";
            const confirmationStatus = routeLevelGenerationConfirmationStatus(error);
            const status = confirmationStatus ?? (message.includes("not found") ? 404 : 400);
            return NextResponse.json({ error: "课堂视觉图暂时没有生成成功，请稍后再试。" }, { status });
          }
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Image generation failed";
      const status = message.includes("lease") ? 409 : 400;
      return NextResponse.json({ error: "课堂视觉图暂时没有生成成功，请稍后再试。" }, { status });
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
