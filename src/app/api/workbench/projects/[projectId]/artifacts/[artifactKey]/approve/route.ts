import { NextResponse } from "next/server";
import { createWorkbenchService } from "@/server/workbench/service";
import type { WorkflowNodeKey } from "@/server/workbench/types";

const service = createWorkbenchService();

type RouteContext = {
  params: Promise<{ projectId: string; artifactKey: string }>;
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

export async function POST(_request: Request, context: RouteContext) {
  const { projectId, artifactKey } = await context.params;
  const artifact = await service.approveArtifact(projectId, assertNodeKey(artifactKey));
  return NextResponse.json({ artifact });
}

function assertNodeKey(value: unknown): WorkflowNodeKey {
  const normalized = typeof value === "string" ? value.replaceAll("-", "_") : "";
  if (nodeKeys.has(normalized as WorkflowNodeKey)) {
    return normalized as WorkflowNodeKey;
  }
  throw new Error("Invalid artifact key");
}
