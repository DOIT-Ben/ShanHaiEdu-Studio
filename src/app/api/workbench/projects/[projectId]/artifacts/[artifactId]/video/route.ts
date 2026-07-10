import { NextResponse } from "next/server";
import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
import { buildStoredVideoDownload, videoDownloadHeaders } from "@/server/video-generation/artifact-video";
import { assertVideoProviderPreconditions } from "@/server/video-generation/video-generation-run";
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
  return withLocalWorkbenchActor(request, async ({ service }) => {
    let projectId = "";
    let jobId: string | null = null;
    try {
      const params = await context.params;
      projectId = params.projectId;
      const { artifactId } = params;
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
      });
      jobId = queuedJob.id;
      await service.startGenerationJob(projectId, jobId);

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
      });
      if (!isVerifiedProviderToolSuccess(result)) {
        const teacherSafeError = result.status === "succeeded"
          ? "分镜视频没有通过交付校验，我没有保存这份结果。"
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
        await service.failGenerationJob(projectId, jobId, { errorMessage: "Video generation failed" }).catch(() => null);
      }
      const message = error instanceof Error ? error.message : "Video generation failed";
      const confirmationStatus = routeLevelGenerationConfirmationStatus(error);
      const status = confirmationStatus ?? (message.includes("not found") ? 404 : 400);
      return NextResponse.json({ error: "导入视频暂时没有生成成功，请稍后再试。" }, { status });
    }
  });
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);
  return arrayBuffer;
}
