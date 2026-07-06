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

export async function POST(request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    const body = await request.json();
    const run = await service.startAgentRun(projectId, {
      nodeKey: assertNodeKey(body.nodeKey),
      runtime: String(body.runtime ?? "deterministic"),
    });
    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AgentRun start failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function assertNodeKey(value: unknown): WorkflowNodeKey {
  if (typeof value === "string" && nodeKeys.has(value as WorkflowNodeKey)) {
    return value as WorkflowNodeKey;
  }
  throw new Error("Invalid nodeKey");
}
