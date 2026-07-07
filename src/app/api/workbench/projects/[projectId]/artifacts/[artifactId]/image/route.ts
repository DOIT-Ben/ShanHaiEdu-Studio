import { NextResponse } from "next/server";
import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
import { buildStoredImageDownload, imageDownloadHeaders } from "@/server/image-generation/artifact-image";
import { generateImageFromArtifact } from "@/server/image-generation/image-generation-run";

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
    try {
      const { projectId, artifactId } = await context.params;
      const [project, sourceArtifact] = await Promise.all([service.getProject(projectId), service.getArtifact(projectId, artifactId)]);
      if (sourceArtifact.nodeKey !== "ppt_draft" || sourceArtifact.kind !== "ppt_draft") {
        return NextResponse.json({ error: "这个 PPT 暂时不能生成课堂视觉图。" }, { status: 400 });
      }

      const generated = await generateImageFromArtifact({ project, artifact: sourceArtifact });
      const artifact = await service.saveArtifact(projectId, {
        nodeKey: "ppt_draft",
        kind: "ppt_draft",
        title: "真实课堂视觉图",
        status: "needs_review",
        summary: "已生成一张可用于课件导入页的本地课堂视觉图，请下载或接入前继续核对画面内容。",
        markdownContent: [
          "# 真实课堂视觉图",
          "",
          "已基于当前 PPT 大纲生成一张本地课堂视觉图。",
          "",
          "正式授课前请核对画面是否贴合教材、课题、课堂问题和学生认知水平。",
        ].join("\n"),
        structuredContent: {
          storage: {
            imageAsset: {
              localOutput: generated.localOutput,
              fileName: generated.fileName,
              bytes: generated.bytes,
              sha256: generated.sha256,
              mime: generated.mime,
              generationMode: "image_generated",
              sourceArtifactId: sourceArtifact.id,
            },
          },
          文件状态: "真实课堂视觉图已生成",
          文件大小: `${generated.bytes} bytes`,
          文件类型: generated.mime,
        },
      });

      return NextResponse.json({ artifact });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Image generation failed";
      const status = message.includes("not found") ? 404 : 400;
      return NextResponse.json({ error: "课堂视觉图暂时没有生成成功，请稍后再试。" }, { status });
    }
  });
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);
  return arrayBuffer;
}
