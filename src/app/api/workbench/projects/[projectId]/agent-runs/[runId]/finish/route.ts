import { NextResponse } from "next/server";
import { createWorkbenchService } from "@/server/workbench/service";

const service = createWorkbenchService();

type RouteContext = {
  params: Promise<{ projectId: string; runId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { projectId, runId } = await context.params;
    const body = await request.json();
    const run = await service.finishAgentRun(projectId, runId, {
      status: assertFinishStatus(body.status),
      errorMessage: typeof body.errorMessage === "string" ? body.errorMessage : undefined,
    });
    return NextResponse.json({ run });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AgentRun finish failed";
    const status = message.includes("not found") ? 404 : message.includes("already finished") ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

function assertFinishStatus(value: unknown) {
  if (value === "succeeded" || value === "failed") {
    return value;
  }
  throw new Error("Invalid run status");
}
