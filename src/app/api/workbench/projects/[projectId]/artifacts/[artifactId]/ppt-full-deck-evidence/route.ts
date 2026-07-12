import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import { resolveLocalArtifactOutput } from "@/server/artifact-storage/local-artifact-storage";
import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
import type { PptFullDeckCandidate } from "@/server/ppt-quality/ppt-production-types";

type RouteContext = { params: Promise<{ projectId: string; artifactId: string }> };

export async function GET(request: Request, context: RouteContext) {
  return withLocalWorkbenchActor(request, async ({ service }) => {
    try {
      const { projectId, artifactId } = await context.params;
      const artifact = await service.getArtifact(projectId, artifactId);
      const candidate = artifact.structuredContent.pptFullDeckCandidate as PptFullDeckCandidate | undefined;
      if (!candidate) throw new Error("PPT full deck evidence not found.");
      const evidence = selectEvidence(candidate, new URL(request.url).searchParams.get("kind"), new URL(request.url).searchParams.get("id"));
      const absolutePath = resolveLocalArtifactOutput(evidence.storageRef);
      if (!absolutePath) throw new Error("PPT full deck evidence path is invalid.");
      const buffer = readFileSync(absolutePath);
      if (createHash("sha256").update(buffer).digest("hex") !== evidence.sha256) throw new Error("PPT full deck evidence hash mismatch.");
      return new NextResponse(buffer, { status: 200, headers: {
        "content-type": evidence.mime,
        "content-length": String(buffer.length),
        "cache-control": "private, no-store",
        ...(evidence.fileName ? { "content-disposition": `attachment; filename="${evidence.fileName}"` } : {}),
      } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "PPT full deck evidence lookup failed";
      return NextResponse.json({ error: message.includes("not found") ? "完整课件证据不存在。" : "完整课件证据暂时无法读取。" }, { status: message.includes("not found") ? 404 : 400 });
    }
  });
}

function selectEvidence(candidate: PptFullDeckCandidate, kind: string | null, id: string | null) {
  if (kind === "page" && id) {
    const page = candidate.pages.find((entry) => entry.pageId === id);
    if (page) return { storageRef: page.renderRef, sha256: page.renderSha256, mime: "image/png", fileName: null };
  }
  if (kind === "contact-sheet") return { storageRef: candidate.contactSheet.storageRef, sha256: candidate.contactSheet.sha256, mime: "image/png", fileName: null };
  if (kind === "pptx") return { storageRef: candidate.pptx.storageRef, sha256: candidate.pptx.sha256, mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", fileName: "ppt-full-deck.pptx" };
  if (kind === "pdf") return { storageRef: candidate.pdf.storageRef, sha256: candidate.pdf.sha256, mime: "application/pdf", fileName: "ppt-full-deck.pdf" };
  throw new Error("PPT full deck evidence not found.");
}
