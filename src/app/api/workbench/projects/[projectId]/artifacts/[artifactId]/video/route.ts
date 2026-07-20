import { NextResponse } from "next/server";
import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
import { buildStoredVideoDownload, videoDownloadHeaders } from "@/server/video-generation/artifact-video";
import { runWithProjectExecutionLease } from "@/server/execution/project-execution-runner";
import { executeVideoArtifactGeneration } from "./video-route-generation";

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
        task: (service) => executeVideoArtifactGeneration({
          request,
          service,
          projectId: params.projectId,
          artifactId: params.artifactId,
          actorUserId: executionIdentity.actorUserId,
        }),
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
