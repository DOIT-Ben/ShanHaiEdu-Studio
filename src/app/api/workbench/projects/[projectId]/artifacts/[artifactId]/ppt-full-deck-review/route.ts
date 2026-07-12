import { NextResponse } from "next/server";
import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
import type { SubmitPptFullDeckReviewInput } from "@/server/workbench/types";

type RouteContext = { params: Promise<{ projectId: string; artifactId: string }> };

export async function POST(request: Request, context: RouteContext) {
  return withLocalWorkbenchActor(request, async ({ service }) => {
    try {
      const { projectId, artifactId } = await context.params;
      const artifact = await service.submitPptFullDeckReview(projectId, artifactId, parseReview(await request.json()));
      return NextResponse.json({ artifact }, { status: 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "PPT full deck review failed";
      const status = message.includes("not found") ? 404 : message.includes("version conflict") ? 409 : 400;
      return NextResponse.json({ error: message }, { status });
    }
  });
}

function parseReview(value: unknown): SubmitPptFullDeckReviewInput {
  if (!isRecord(value) || typeof value.candidateDigest !== "string" || !value.candidateDigest.trim() || !Array.isArray(value.qa)) {
    throw new Error("Invalid PPT full deck review payload.");
  }
  if (value.reviewSource !== "teacher" && value.reviewSource !== "critic") throw new Error("Invalid PPT full deck review source.");
  return {
    candidateDigest: value.candidateDigest,
    reviewSource: value.reviewSource,
    reviewerMessageId: typeof value.reviewerMessageId === "string" ? value.reviewerMessageId : null,
    qa: value.qa.map((entry) => parseEntry(entry)),
  };
}

function parseEntry(value: unknown): SubmitPptFullDeckReviewInput["qa"][number] {
  if (!isRecord(value) || typeof value.pageId !== "string") throw new Error("Invalid PPT full deck page review.");
  return {
    pageId: value.pageId,
    design: passFail(value.design),
    visual: passFail(value.visual),
    provenance: passFail(value.provenance),
    readability: passFail(value.readability),
    findings: Array.isArray(value.findings) && value.findings.every((finding) => typeof finding === "string") ? value.findings : [],
  };
}

function passFail(value: unknown): "passed" | "failed" {
  if (value === "passed" || value === "failed") return value;
  throw new Error("PPT full deck review status must be passed or failed.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
