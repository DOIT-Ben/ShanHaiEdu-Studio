import { NextResponse } from "next/server";
import { createWorkbenchService } from "@/server/workbench/service";

const service = createWorkbenchService();

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const snapshot = await service.getProjectSnapshot(projectId);
  return NextResponse.json(snapshot);
}
