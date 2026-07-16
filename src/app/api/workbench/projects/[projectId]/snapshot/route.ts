import { NextResponse } from "next/server";
import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
import { createControlPlaneStore } from "@/server/conversation/control-plane-store";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  return withLocalWorkbenchActor(request, async ({ service }) => {
    try {
      const { projectId } = await context.params;
      await service.getProject(projectId);
      const agentEventSequence = await createControlPlaneStore().getLatestEventSequence(projectId);
      const snapshot = await service.getProjectSnapshot(projectId);
      const artifacts = snapshot.artifacts.map((artifact) => ({
        ...artifact,
        taskId: artifact.taskId ?? null,
        taskBriefDigest: artifact.taskBriefDigest ?? null,
        intentEpoch: artifact.intentEpoch ?? null,
        planRevision: artifact.planRevision ?? null,
        origin: artifact.origin ?? null,
      }));
      return NextResponse.json({ ...snapshot, artifacts, agentEventSequence });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Project snapshot failed";
      const status = message.includes("not found") ? 404 : 400;
      return NextResponse.json({ error: "项目内容暂时没有取回，请稍后再试。" }, { status });
    }
  });
}
