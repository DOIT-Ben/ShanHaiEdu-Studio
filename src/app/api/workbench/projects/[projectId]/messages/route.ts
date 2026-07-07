import { NextResponse } from "next/server";
import { createWorkbenchService } from "@/server/workbench/service";

const service = createWorkbenchService();

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const messages = await service.getMessages(projectId);
  return NextResponse.json({ messages });
}

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const body = await request.json();
  const message = await service.addMessage(projectId, {
    role: body.role === "assistant" || body.role === "system" ? body.role : "teacher",
    content: String(body.content ?? ""),
    artifactRefs: Array.isArray(body.artifactRefs) ? body.artifactRefs.map(String) : [],
  });

  return NextResponse.json({ message }, { status: 201 });
}
