import { NextResponse } from "next/server";
import { buildFinalMaterialPackageDownload, materialPackageDownloadHeaders } from "@/server/package/artifact-package";
import { buildArtifactPptxDownload, toPptxDownloadableArtifact } from "@/server/pptx/artifact-pptx";
import { createWorkbenchService } from "@/server/workbench/service";

const service = createWorkbenchService();

type RouteContext = {
  params: Promise<{ projectId: string; artifactId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { projectId, artifactId } = await context.params;
    const finalDelivery = await service.getArtifact(projectId, artifactId);
    const pptArtifact = await getLatestPptArtifact(projectId);
    const pptx = await buildArtifactPptxDownload(toPptxDownloadableArtifact(pptArtifact));
    const download = await buildFinalMaterialPackageDownload({ finalDelivery, pptx });

    return new Response(toArrayBuffer(download.buffer), {
      status: 200,
      headers: materialPackageDownloadHeaders(download.filename),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Material package download failed";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: "这个材料包暂时没有生成成功，请稍后再试。" }, { status });
  }
}

async function getLatestPptArtifact(projectId: string) {
  const artifacts = await service.getArtifacts(projectId);
  const pptArtifacts = artifacts.filter((artifact) => artifact.nodeKey === "ppt_draft");
  const approved = pptArtifacts.filter((artifact) => artifact.isApproved);
  const candidates = approved.length ? approved : pptArtifacts;
  const latest = candidates.sort((left, right) => right.version - left.version)[0];
  if (!latest) {
    throw new Error("PPT outline artifact not found");
  }
  return latest;
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);
  return arrayBuffer;
}
