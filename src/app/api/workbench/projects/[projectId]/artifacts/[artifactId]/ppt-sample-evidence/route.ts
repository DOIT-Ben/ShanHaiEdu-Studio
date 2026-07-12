import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import { resolveLocalArtifactOutput } from "@/server/artifact-storage/local-artifact-storage";
import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
import type { PptKeySampleCandidate } from "@/server/ppt-quality/ppt-asset-types";

type RouteContext = {
  params: Promise<{ projectId: string; artifactId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  return withLocalWorkbenchActor(request, async ({ service }) => {
    try {
      const { projectId, artifactId } = await context.params;
      const artifact = await service.getArtifact(projectId, artifactId);
      const candidate = artifact.structuredContent.pptKeySampleCandidate as PptKeySampleCandidate | undefined;
      if (!candidate) throw new Error("PPT sample evidence not found.");
      const url = new URL(request.url);
      const evidence = selectEvidence(candidate, url.searchParams.get("kind"), url.searchParams.get("id"));
      const absolutePath = resolveLocalArtifactOutput(evidence.storageRef);
      if (!absolutePath) throw new Error("PPT sample evidence path is invalid.");
      const buffer = readFileSync(absolutePath);
      if (createHash("sha256").update(buffer).digest("hex") !== evidence.sha256) throw new Error("PPT sample evidence hash mismatch.");
      return new NextResponse(buffer, {
        status: 200,
        headers: {
          "content-type": evidence.mime,
          "content-length": String(buffer.length),
          "cache-control": "private, no-store",
          ...(evidence.fileName ? { "content-disposition": `attachment; filename="${evidence.fileName}"` } : {}),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "PPT sample evidence lookup failed";
      return NextResponse.json({ error: message.includes("not found") ? "样张证据不存在。" : "样张证据暂时无法读取。" }, { status: message.includes("not found") ? 404 : 400 });
    }
  });
}

function selectEvidence(candidate: PptKeySampleCandidate, kind: string | null, id: string | null) {
  if (kind === "page" && id) {
    const page = candidate.assembledPages.find((entry) => entry.pageId === id);
    if (page) return { storageRef: page.renderRef, sha256: page.renderSha256, mime: "image/png", fileName: null };
  }
  if (kind === "overview" && id) {
    const overview = candidate.overviews.find((entry) => entry.kind === id);
    if (overview) return { storageRef: overview.storageRef, sha256: overview.sha256, mime: "image/png", fileName: null };
  }
  if (kind === "pptx") {
    return { storageRef: candidate.samplePptx.storageRef, sha256: candidate.samplePptx.sha256, mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", fileName: "ppt-key-samples.pptx" };
  }
  throw new Error("PPT sample evidence not found.");
}
