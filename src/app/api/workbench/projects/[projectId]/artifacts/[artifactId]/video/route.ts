import { NextResponse } from "next/server";
import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
import { buildStoredVideoDownload, videoDownloadHeaders } from "@/server/video-generation/artifact-video";
import { generateVideoFromArtifact } from "@/server/video-generation/video-generation-run";

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
    try {
      const { projectId, artifactId } = await context.params;
      const [project, sourceArtifact] = await Promise.all([service.getProject(projectId), service.getArtifact(projectId, artifactId)]);
      if (sourceArtifact.nodeKey !== "intro_video_plan" || sourceArtifact.kind !== "intro_video_plan") {
        return NextResponse.json({ error: "这个方案暂时不能生成导入视频。" }, { status: 400 });
      }

      const generated = await generateVideoFromArtifact({ project, artifact: sourceArtifact });
      const artifact = await service.saveArtifact(projectId, {
        nodeKey: "intro_video_plan",
        kind: "intro_video_plan",
        title: "真实导入视频",
        status: "needs_review",
        summary: "已生成一段本地导入视频，请播放后核对画面、节奏和课堂锚点。",
        markdownContent: [
          "# 真实导入视频",
          "",
          "已基于当前导入视频方案生成一段本地 MP4。",
          "",
          "正式授课前请核对画面质量、节奏、课堂锚点、学生理解成本和是否提前讲解知识点。",
        ].join("\n"),
        structuredContent: {
          storage: {
            videoAsset: {
              localOutput: generated.localOutput,
              fileName: generated.fileName,
              bytes: generated.bytes,
              sha256: generated.sha256,
              mime: generated.mime,
              generationMode: "video_generated",
              sourceArtifactId: sourceArtifact.id,
            },
          },
          文件状态: "真实导入视频已生成",
          文件大小: `${generated.bytes} bytes`,
          文件类型: generated.mime,
        },
      });

      return NextResponse.json({ artifact });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Video generation failed";
      const status = message.includes("not found") ? 404 : 400;
      return NextResponse.json({ error: "导入视频暂时没有生成成功，请稍后再试。" }, { status });
    }
  });
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);
  return arrayBuffer;
}
