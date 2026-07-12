import { NextResponse } from "next/server";
import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
import { buildStoredImageDownload, imageDownloadHeaders } from "@/server/image-generation/artifact-image";
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
            const queuedJob = await service.createGenerationJob(projectId, {
              kind: "image",
              sourceArtifactId: sourceArtifact.id,
              capabilityId: "image_asset",
              inputSnapshot: { source: snapshotArtifact(sourceArtifact) },
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
            const runningJob = (await service.startGenerationJobForExecution(projectId, jobId)).job;
            if (runningJob.status === "submission_unknown") {
              jobId = null;
              return NextResponse.json({ error: "图片任务状态需要核对，系统没有自动重复提交。" }, { status: 409 });
            }

            const result = await routeToolCall({
              capabilityId: "image_asset",
              projectId,
              project,
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
            });
            if (!isVerifiedProviderToolSuccess(result)) {
              const teacherSafeError = result.status === "succeeded"
                ? "课堂视觉图没有通过交付校验，我没有保存这份结果。"
                : result.observation.teacherSafeSummary;
              await service.failGenerationJob(projectId, jobId, { errorMessage: teacherSafeError });
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
              await service.failGenerationJob(params.projectId, jobId, { errorMessage: "Image generation failed" }).catch(() => null);
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
