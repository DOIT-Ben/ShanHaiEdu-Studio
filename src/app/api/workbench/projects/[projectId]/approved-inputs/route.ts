import { NextResponse } from "next/server";
import { createWorkbenchService } from "@/server/workbench/service";
import type { WorkflowNodeKey } from "@/server/workbench/types";

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

export async function GET(request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    const { searchParams } = new URL(request.url);
    const nodeKey = assertNodeKey(searchParams.get("nodeKey"));
    const artifacts = await service.getApprovedInputs(projectId, nodeKey);
    return NextResponse.json({ artifacts });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Approved inputs lookup failed";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

function assertNodeKey(value: unknown): WorkflowNodeKey {
  if (typeof value === "string" && nodeKeys.has(value as WorkflowNodeKey)) {
    return value as WorkflowNodeKey;
  }
  throw new Error("Invalid nodeKey");
}
