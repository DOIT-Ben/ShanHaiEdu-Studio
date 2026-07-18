import { NextResponse } from "next/server";
import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
import { createControlPlaneStore } from "@/server/conversation/control-plane-store";
import { readOrchestrationAuthoritySummary } from "@/server/conversation/orchestration-authority-summary";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  return withLocalWorkbenchActor(request, async ({ actor, service }) => {
    try {
      const { projectId } = await context.params;
      await service.getProject(projectId);
      const [agentEventSequence, snapshot, orchestrationAuthoritySummary] = await Promise.all([
        createControlPlaneStore().getLatestEventSequence(projectId),
        service.getProjectSnapshot(projectId),
        readOrchestrationAuthoritySummary({ projectId, actor }),
      ]);
      const artifacts = snapshot.artifacts.map((artifact) => ({
        ...artifact,
        taskId: artifact.taskId ?? null,
        taskBriefDigest: artifact.taskBriefDigest ?? null,
        intentEpoch: artifact.intentEpoch ?? null,
        planRevision: artifact.planRevision ?? null,
        origin: artifact.origin ?? null,
      }));
      return NextResponse.json({ ...snapshot, artifacts, agentEventSequence, orchestrationAuthoritySummary });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Project snapshot failed";
      const status = message.includes("not found") ? 404 : 400;
      return NextResponse.json({ error: "项目内容暂时没有取回，请稍后再试。" }, { status });
    }
  });
}
