import { NextResponse } from "next/server";
import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
import { buildStoredImageDownload, imageDownloadHeaders } from "@/server/image-generation/artifact-image";
import { routeToolCall } from "@/server/tools/tool-router";
import { isVerifiedProviderToolSuccess } from "@/server/tools/tool-types";
import type { ArtifactKind, WorkflowNodeKey } from "@/server/workbench/types";
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
  return withLocalWorkbenchActor(request, async ({ service }) => {
    let projectId = "";
    let jobId: string | null = null;
    try {
      const params = await context.params;
      projectId = params.projectId;
      const { artifactId } = params;
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
      });
      jobId = queuedJob.id;
      await service.startGenerationJob(projectId, jobId);

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
      });
      if (!isVerifiedProviderToolSuccess(result)) {
        const teacherSafeError = result.status === "succeeded"
          ? "课堂视觉图没有通过交付校验，我没有保存这份结果。"
          : result.observation.teacherSafeSummary;
        await service.failGenerationJob(projectId, jobId, { errorMessage: teacherSafeError });
        jobId = null;
        return NextResponse.json({ error: teacherSafeError }, { status: 400 });
      }

      const artifact = await service.saveArtifact(projectId, {
        nodeKey: result.artifactDraft.nodeKey as WorkflowNodeKey,
        kind: result.artifactDraft.kind as ArtifactKind,
        title: result.artifactDraft.title,
        status: "needs_review",
        summary: result.artifactDraft.summary,
        markdownContent: result.artifactDraft.markdownContent ?? "",
        structuredContent: result.artifactDraft.structuredContent,
      });
      const job = await service.finishGenerationJob(projectId, jobId, { resultArtifactId: artifact.id });

      return NextResponse.json({ artifact, job });
    } catch (error) {
      if (projectId && jobId) {
        await service.failGenerationJob(projectId, jobId, { errorMessage: "Image generation failed" }).catch(() => null);
      }
      const message = error instanceof Error ? error.message : "Image generation failed";
      const confirmationStatus = routeLevelGenerationConfirmationStatus(error);
      const status = confirmationStatus ?? (message.includes("not found") ? 404 : 400);
      return NextResponse.json({ error: "课堂视觉图暂时没有生成成功，请稍后再试。" }, { status });
    }
  });
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);
  return arrayBuffer;
}
