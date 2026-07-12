import { NextResponse } from "next/server";
import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";

type RouteContext = {
  params: Promise<{ projectId: string; runId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  return withLocalWorkbenchActor(request, async ({ service }) => {
    try {
      const { projectId, runId } = await context.params;
      const body = await request.json();
      const run = await service.finishAgentRun(projectId, runId, {
        status: assertFinishStatus(body.status),
        errorMessage: typeof body.errorMessage === "string" ? body.errorMessage : undefined,
        evidence: parseFinishEvidence(body.evidence),
      });
      return NextResponse.json({ run });
    } catch (error) {
      const message = error instanceof Error ? error.message : "AgentRun finish failed";
      const status = message.includes("not found") ? 404 : message.includes("already finished") ? 409 : 400;
      return NextResponse.json({ error: message }, { status });
    }
  });
}

function parseFinishEvidence(value: unknown) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("完成证据格式无效");
  }
  const evidence = value as Record<string, unknown>;
  if (
    typeof evidence.artifactId !== "string" || !evidence.artifactId ||
    typeof evidence.validationReportId !== "string" || !evidence.validationReportId ||
    typeof evidence.qualityDecisionId !== "string" || !evidence.qualityDecisionId
  ) {
    throw new Error("完成证据格式无效");
  }
  return {
    artifactId: evidence.artifactId,
    validationReportId: evidence.validationReportId,
    qualityDecisionId: evidence.qualityDecisionId,
  };
}

function assertFinishStatus(value: unknown) {
  if (value === "succeeded" || value === "failed") {
    return value;
  }
  throw new Error("Invalid run status");
}
