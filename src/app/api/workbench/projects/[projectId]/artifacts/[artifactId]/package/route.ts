import { NextResponse } from "next/server";
import { buildFinalMaterialPackageDownload, materialPackageDownloadHeaders } from "@/server/package/artifact-package";
import { buildStoredOrGeneratedArtifactPptxDownload } from "@/server/pptx/artifact-pptx";
import { buildStoredVideoDownload } from "@/server/video-generation/artifact-video";
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
    const pptx = await buildStoredOrGeneratedArtifactPptxDownload(pptArtifact);
    const video = await getLatestVideoDownload(projectId);
    const download = await buildFinalMaterialPackageDownload({ finalDelivery, pptx, video });

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

async function getLatestVideoDownload(projectId: string) {
  const artifacts = await service.getArtifacts(projectId);
  const videoArtifacts = artifacts.filter((artifact) => artifact.nodeKey === "intro_video_plan" && hasVideoAsset(artifact));
  const approved = videoArtifacts.filter((artifact) => artifact.isApproved);
  const candidates = approved.length ? approved : videoArtifacts;
  const latest = candidates.sort((left, right) => right.version - left.version)[0];
  if (!latest) {
    return null;
  }
  return buildStoredVideoDownload(latest);
}

function hasVideoAsset(artifact: { structuredContent: Record<string, unknown> }) {
  const storage = artifact.structuredContent.storage;
  if (!storage || typeof storage !== "object" || Array.isArray(storage)) {
    return false;
  }
  const videoAsset = (storage as { videoAsset?: unknown }).videoAsset;
  return Boolean(videoAsset && typeof videoAsset === "object" && !Array.isArray(videoAsset));
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);
  return arrayBuffer;
}
