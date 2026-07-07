import { NextResponse } from "next/server";
import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  return withLocalWorkbenchActor(request, async ({ service }) => {
    try {
      const { projectId } = await context.params;
      const generationJobs = await service.getGenerationJobs(projectId);
      return NextResponse.json({ generationJobs });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Generation jobs lookup failed";
      const status = message.includes("not found") ? 404 : 400;
      return NextResponse.json({ error: "生成任务暂时没有取回，请稍后再试。" }, { status });
    }
  });
}
