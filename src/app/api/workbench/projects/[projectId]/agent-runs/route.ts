import { NextResponse } from "next/server";
import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
import type { WorkflowNodeKey } from "@/server/workbench/types";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

const nodeKeys = new Set<WorkflowNodeKey>([
  "requirement_spec",
  "textbook_evidence",
  "lesson_plan",
  "ppt_draft",
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

export async function POST(request: Request, context: RouteContext) {
  return withLocalWorkbenchActor(request, async ({ service }) => {
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
      const status = message.includes("not found") ? 404 : 400;
      return NextResponse.json({ error: message }, { status });
    }
  });
}

function assertNodeKey(value: unknown): WorkflowNodeKey {
  if (typeof value === "string" && nodeKeys.has(value as WorkflowNodeKey)) {
    return value as WorkflowNodeKey;
  }
  throw new Error("Invalid nodeKey");
}
