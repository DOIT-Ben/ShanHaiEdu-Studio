import { NextResponse } from "next/server";
import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
import type { SubmitPptSampleReviewInput } from "@/server/workbench/types";

type RouteContext = {
  params: Promise<{ projectId: string; artifactId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  return withLocalWorkbenchActor(request, async ({ service }) => {
    try {
      const { projectId, artifactId } = await context.params;
      const body = await request.json();
      const artifact = await service.submitPptSampleReview(projectId, artifactId, parseReview(body));
      return NextResponse.json({ artifact }, { status: 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "PPT sample review failed";
      const status = message.includes("not found") ? 404 : message.includes("version conflict") ? 409 : 400;
      return NextResponse.json({ error: message }, { status });
    }
  });
}

function parseReview(value: unknown): SubmitPptSampleReviewInput {
  if (!isRecord(value)) throw new Error("Invalid PPT sample review payload.");
  const reviewSource = value.reviewSource;
  if (reviewSource !== "teacher" && reviewSource !== "critic") throw new Error("Invalid PPT sample review source.");
  if (typeof value.candidateDigest !== "string" || !value.candidateDigest.trim()) throw new Error("PPT sample candidate digest is required.");
  if (!Array.isArray(value.qa)) throw new Error("PPT sample D/V/P review is required.");
  return {
    candidateDigest: value.candidateDigest,
    reviewSource,
    reviewerMessageId: typeof value.reviewerMessageId === "string" ? value.reviewerMessageId : null,
    qa: value.qa.map((entry) => parseQaEntry(entry)),
  };
}

function parseQaEntry(value: unknown): SubmitPptSampleReviewInput["qa"][number] {
  if (!isRecord(value) || typeof value.pageId !== "string") throw new Error("Invalid PPT sample page review.");
  return {
    pageId: value.pageId,
    design: passFail(value.design),
    visual: passFail(value.visual),
    provenance: passFail(value.provenance),
    findings: Array.isArray(value.findings) && value.findings.every((finding) => typeof finding === "string") ? value.findings : [],
  };
}

function passFail(value: unknown): "passed" | "failed" {
  if (value === "passed" || value === "failed") return value;
  throw new Error("PPT sample review status must be passed or failed.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
