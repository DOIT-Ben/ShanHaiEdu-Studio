import { NextResponse } from "next/server";
import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
import { createAgentRuntimeFromEnv } from "@/server/agent-runtime/runtime-factory";
import { createConversationTurnService } from "@/server/conversation/conversation-turn-service";

const runtime = createAgentRuntimeFromEnv();

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  return withLocalWorkbenchActor(request, async ({ service }) => {
    try {
      const { projectId } = await context.params;
      const messages = await service.getMessages(projectId);
      return NextResponse.json({ messages });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Messages lookup failed";
      const status = message.includes("not found") ? 404 : 400;
      return NextResponse.json({ error: "项目消息暂时没有取回，请稍后再试。" }, { status });
    }
  });
}

export async function POST(request: Request, context: RouteContext) {
  return withLocalWorkbenchActor(request, async ({ service }) => {
    try {
      const { projectId } = await context.params;
      const body = await request.json();
      const turnService = createConversationTurnService({ service, runtime });
      const response = await turnService.createTurn(projectId, {
        role: "teacher",
        content: String(body.body ?? body.content ?? "").trim(),
        reference: body.reference ? String(body.reference).trim() : undefined,
        artifactRefs: Array.isArray(body.artifactRefs) ? body.artifactRefs.map(String) : [],
      });
      return NextResponse.json(response, { status: 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Message create failed";
      const status = message.includes("not found") ? 404 : 400;
      return NextResponse.json({ error: "这条消息暂时没有发送成功，请稍后再试。" }, { status });
    }
  });
}
