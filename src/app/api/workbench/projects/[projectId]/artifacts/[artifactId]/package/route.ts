import { NextResponse } from "next/server";
import { withLocalWorkbenchActor, type AuthenticatedWorkbenchRequest } from "@/server/auth/workbench-route";
import { buildStoredImageDownload } from "@/server/image-generation/artifact-image";
import { buildFinalMaterialPackageDownload, materialPackageDownloadHeaders } from "@/server/package/artifact-package";
import { buildStoredArtifactPptxDownload } from "@/server/pptx/artifact-pptx";
import { buildStoredVideoDownload } from "@/server/video-generation/artifact-video";

type RouteContext = {
  params: Promise<{ projectId: string; artifactId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  return withLocalWorkbenchActor(request, async ({ service }) => {
    try {
      const { projectId, artifactId } = await context.params;
      const finalDelivery = await service.getArtifact(projectId, artifactId);
      const pptArtifact = await getLatestPptArtifact(projectId, service);
      const pptx = await buildStoredArtifactPptxDownload(pptArtifact);
      const image = await getLatestImageDownload(projectId, service);
      const video = await getLatestVideoDownload(projectId, service);
      const download = await buildFinalMaterialPackageDownload({ finalDelivery, pptx, image, video });

      return new Response(toArrayBuffer(download.buffer), {
        status: 200,
        headers: materialPackageDownloadHeaders(download.filename),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Material package download failed";
      const status = message.includes("not found") ? 404 : 400;
      return NextResponse.json({ error: "这个材料包暂时没有生成成功，请稍后再试。" }, { status });
    }
  });
}

async function getLatestPptArtifact(projectId: string, service: AuthenticatedWorkbenchRequest["service"]) {
  const artifacts = await service.getArtifacts(projectId);
  const pptArtifacts = artifacts.filter((artifact) => artifact.nodeKey === "ppt_draft" && hasPptxAsset(artifact));
  const approved = pptArtifacts.filter((artifact) => artifact.isApproved);
  const candidates = approved.length ? approved : pptArtifacts;
  const latest = candidates.sort((left, right) => right.version - left.version)[0];
  if (!latest) {
    throw new Error("PPT outline artifact not found");
  }
  return latest;
}

async function getLatestVideoDownload(projectId: string, service: AuthenticatedWorkbenchRequest["service"]) {
  const artifacts = await service.getArtifacts(projectId);
  const videoArtifacts = artifacts.filter((artifact) => (artifact.nodeKey === "video_storyboard" || artifact.nodeKey === "intro_video_plan") && hasVideoAsset(artifact));
  const approved = videoArtifacts.filter((artifact) => artifact.isApproved);
  const candidates = approved.length ? approved : videoArtifacts;
  const latest = candidates.sort((left, right) => right.version - left.version)[0];
  if (!latest) {
    return null;
  }
  return buildStoredVideoDownload(latest);
}

async function getLatestImageDownload(projectId: string, service: AuthenticatedWorkbenchRequest["service"]) {
  const artifacts = await service.getArtifacts(projectId);
  const imageArtifacts = artifacts.filter((artifact) => (artifact.nodeKey === "image_prompts" || artifact.nodeKey === "ppt_draft") && hasImageAsset(artifact));
  const approved = imageArtifacts.filter((artifact) => artifact.isApproved);
  const candidates = approved.length ? approved : imageArtifacts;
  const latest = candidates.sort((left, right) => right.version - left.version)[0];
  if (!latest) {
    return null;
  }
  return buildStoredImageDownload(latest);
}

function hasVideoAsset(artifact: { structuredContent: Record<string, unknown> }) {
  const storage = artifact.structuredContent.storage;
  if (!storage || typeof storage !== "object" || Array.isArray(storage)) {
    return false;
  }
  const videoAsset = (storage as { videoAsset?: unknown }).videoAsset;
  return Boolean(videoAsset && typeof videoAsset === "object" && !Array.isArray(videoAsset));
}

function hasPptxAsset(artifact: { structuredContent: Record<string, unknown> }) {
  const storage = artifact.structuredContent.storage;
  if (!storage || typeof storage !== "object" || Array.isArray(storage)) {
    return false;
  }
  const cozePptx = (storage as { cozePptx?: unknown }).cozePptx;
  return Boolean(cozePptx && typeof cozePptx === "object" && !Array.isArray(cozePptx));
}

function hasImageAsset(artifact: { structuredContent: Record<string, unknown> }) {
  const storage = artifact.structuredContent.storage;
  if (!storage || typeof storage !== "object" || Array.isArray(storage)) {
    return false;
  }
  const imageAsset = (storage as { imageAsset?: unknown }).imageAsset;
  return Boolean(imageAsset && typeof imageAsset === "object" && !Array.isArray(imageAsset));
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);
  return arrayBuffer;
}
