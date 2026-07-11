import { NextResponse } from "next/server";
import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";

type RouteContext = {
  params: Promise<{ projectId: string; messageId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  return withLocalWorkbenchActor(request, async ({ service }) => {
    try {
      const { projectId, messageId } = await context.params;
      const body = await request.json() as { value?: unknown };
      const value = body.value === "helpful" || body.value === "unhelpful" ? body.value : body.value === null ? null : undefined;
      if (value === undefined) return NextResponse.json({ error: "反馈标签不正确。" }, { status: 400 });
      const reaction = await service.setMessageReaction(projectId, { messageId, value });
      const snapshot = await service.getProjectSnapshot(projectId);
      return NextResponse.json({ reaction, snapshot });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Message reaction failed";
      return NextResponse.json({ error: message.includes("not found") ? "没有找到这条回复。" : "反馈标签暂时没有保存。" }, { status: message.includes("not found") ? 404 : 400 });
    }
  });
}
