import { NextResponse } from "next/server";
import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";

type RouteContext = {
  params: Promise<{ projectId: string; artifactId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  return withLocalWorkbenchActor(request, async ({ service }) => {
    try {
      const { projectId, artifactId } = await context.params;
      const artifact = await service.getArtifact(projectId, artifactId);
      return NextResponse.json({ artifact });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Artifact lookup failed";
      const status = message.includes("not found") ? 404 : 400;
      return NextResponse.json({ error: message }, { status });
    }
  });
}
