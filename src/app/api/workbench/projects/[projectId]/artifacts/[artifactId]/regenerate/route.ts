import { NextResponse } from "next/server";
import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";

type RouteContext = {
  params: Promise<{ projectId: string; artifactId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  return withLocalWorkbenchActor(request, async ({ service }) => {
    try {
      const { projectId, artifactId } = await context.params;
      const body = await request.json();
      const artifact = await service.regenerateArtifact(projectId, artifactId, {
        title: optionalString(body.title),
        expectedLatestVersion: optionalNumber(body.expectedLatestVersion),
        summary: String(body.summary ?? ""),
        markdownContent: String(body.markdownContent ?? ""),
        structuredContent: typeof body.structuredContent === "object" && body.structuredContent ? body.structuredContent : {},
      });
      return NextResponse.json({ artifact }, { status: 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Artifact regenerate failed";
      const status = message.includes("not found") ? 404 : message.includes("version conflict") ? 409 : 400;
      return NextResponse.json({ error: message }, { status });
    }
  });
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}
