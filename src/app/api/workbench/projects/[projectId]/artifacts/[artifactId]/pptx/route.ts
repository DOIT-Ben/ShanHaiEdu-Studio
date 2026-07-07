import { NextResponse } from "next/server";
import { buildStoredOrGeneratedArtifactPptxDownload, pptxDownloadHeaders } from "@/server/pptx/artifact-pptx";
import { createWorkbenchService } from "@/server/workbench/service";

const service = createWorkbenchService();

type RouteContext = {
  params: Promise<{ projectId: string; artifactId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { projectId, artifactId } = await context.params;
    const artifact = await service.getArtifact(projectId, artifactId);
    const download = await buildStoredOrGeneratedArtifactPptxDownload(artifact);
    return new Response(toArrayBuffer(download.buffer), {
      status: 200,
      headers: pptxDownloadHeaders(download.filename),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "PPTX download failed";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: "这个 PPT 文件暂时没有生成成功，请稍后再试。" }, { status });
  }
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);
  return arrayBuffer;
}
