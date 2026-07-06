import { NextResponse } from "next/server";
import { createWorkbenchService } from "@/server/workbench/service";
import type { ArtifactKind, ArtifactStatus, WorkflowNodeKey } from "@/server/workbench/types";

const service = createWorkbenchService();

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

const nodeKeys = new Set<WorkflowNodeKey>([
  "requirement_spec",
  "textbook_evidence",
  "lesson_plan",
  "ppt_draft",
  "intro_video_plan",
  "image_prompts",
  "video_storyboard",
  "final_delivery",
]);

const artifactStatuses = new Set<ArtifactStatus>(["not_started", "in_progress", "needs_review", "approved", "blocked", "stale", "failed"]);

export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const artifacts = await service.getArtifacts(projectId);
  return NextResponse.json({ artifacts });
}

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const body = await request.json();
  const nodeKey = assertNodeKey(body.nodeKey);
  const status = assertArtifactStatus(body.status);
  const artifact = await service.saveArtifact(projectId, {
    nodeKey,
    kind: assertArtifactKind(body.kind ?? body.nodeKey),
    title: String(body.title ?? "未命名产物"),
    status,
    summary: String(body.summary ?? ""),
    markdownContent: String(body.markdownContent ?? ""),
    structuredContent: typeof body.structuredContent === "object" && body.structuredContent ? body.structuredContent : {},
  });

  return NextResponse.json({ artifact }, { status: 201 });
}

function assertNodeKey(value: unknown): WorkflowNodeKey {
  if (typeof value === "string" && nodeKeys.has(value as WorkflowNodeKey)) {
    return value as WorkflowNodeKey;
  }
  throw new Error("Invalid nodeKey");
}

function assertArtifactKind(value: unknown): ArtifactKind {
  return assertNodeKey(value);
}

function assertArtifactStatus(value: unknown): ArtifactStatus {
  if (typeof value === "string" && artifactStatuses.has(value as ArtifactStatus)) {
    return value as ArtifactStatus;
  }
  return "needs_review";
}
