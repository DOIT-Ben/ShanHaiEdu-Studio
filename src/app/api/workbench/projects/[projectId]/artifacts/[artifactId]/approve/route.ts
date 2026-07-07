import { NextResponse } from "next/server";
import { createWorkbenchService } from "@/server/workbench/service";
import { advanceM2AfterApproval } from "@/server/workbench/m2-orchestrator";

const service = createWorkbenchService();

type RouteContext = {
  params: Promise<{ projectId: string; artifactId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { projectId, artifactId } = await context.params;
    const artifact = await service.approveArtifact(projectId, artifactId);
    await advanceM2AfterApproval(projectId, artifact, service);
    return NextResponse.json({ artifact });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Artifact approve failed";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
