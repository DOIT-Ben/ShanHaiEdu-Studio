import { NextResponse } from "next/server";
import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
import type { ArtifactKind, ArtifactStatus, WorkflowNodeKey } from "@/server/workbench/types";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

const nodeKeys = new Set<WorkflowNodeKey>([
  "requirement_spec",
  "textbook_evidence",
  "lesson_plan",
  "ppt_draft",
  "ppt_design_draft",
  "pptx_artifact",
  "intro_video_plan",
  "knowledge_anchor_extract",
  "creative_theme_generate",
  "video_script_generate",
  "storyboard_generate",
  "asset_brief_generate",
  "asset_image_generate",
  "video_segment_plan",
  "video_segment_generate",
  "concat_only_assemble",
  "image_prompts",
  "video_storyboard",
  "final_delivery",
]);

const artifactStatuses = new Set<ArtifactStatus>(["not_started", "in_progress", "needs_review", "approved", "blocked", "stale", "failed"]);

export async function GET(request: Request, context: RouteContext) {
  return withLocalWorkbenchActor(request, async ({ service }) => {
    try {
      const { projectId } = await context.params;
      const artifacts = await service.getArtifacts(projectId);
      return NextResponse.json({ artifacts });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Artifacts lookup failed";
      const status = message.includes("not found") ? 404 : 400;
      return NextResponse.json({ error: "项目产物暂时没有取回，请稍后再试。" }, { status });
    }
  });
}

export async function POST(request: Request, context: RouteContext) {
  return withLocalWorkbenchActor(request, async ({ service }) => {
    try {
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
    } catch (error) {
      const message = error instanceof Error ? error.message : "Artifact save failed";
      const status = message.includes("not found") ? 404 : 400;
      return NextResponse.json({ error: "这个产物暂时没有保存成功，请稍后再试。" }, { status });
    }
  });
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
