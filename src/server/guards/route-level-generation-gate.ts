import { evaluateToolPlan } from "@/server/guards/plan-guard";
import type { ArtifactRecord } from "@/server/workbench/types";

export type RouteLevelGenerationCapabilityId = "coze_ppt" | "image_asset" | "video_segment_generate";

export class RouteLevelGenerationConfirmationError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "RouteLevelGenerationConfirmationError";
    this.status = status;
  }
}

export async function readRouteGenerationBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export function readConfirmedActionId(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const record = body as Record<string, unknown>;
  const value = record.confirmedActionId ?? record.actionId;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function assertRouteLevelGenerationConfirmation(input: {
  projectId: string;
  capabilityId: RouteLevelGenerationCapabilityId;
  sourceArtifact: ArtifactRecord;
  confirmedActionId?: string;
}) {
  if (!input.sourceArtifact.isApproved || input.sourceArtifact.status !== "approved") {
    throw new RouteLevelGenerationConfirmationError("approved_source_artifact_required", 400);
  }

  const expectedActionId = routeGenerationActionId(input.sourceArtifact, input.capabilityId);
  if (!expectedActionId) {
    throw new RouteLevelGenerationConfirmationError("route_generation_action_not_issued", 403);
  }
  const guardResult = evaluateToolPlan({
    capabilityId: input.capabilityId,
    toolRequiresConfirmation: true,
    hasHumanConfirmation: Boolean(input.confirmedActionId),
    expectedActionId,
    confirmedActionId: input.confirmedActionId,
  });

  if (guardResult.status !== "allowed") {
    throw new RouteLevelGenerationConfirmationError(guardResult.reason, 403);
  }

  return { expectedActionId };
}

function routeGenerationActionId(sourceArtifact: ArtifactRecord, capabilityId: RouteLevelGenerationCapabilityId) {
  const routeGenerationActions = sourceArtifact.structuredContent.routeGenerationActions;
  if (!routeGenerationActions || typeof routeGenerationActions !== "object" || Array.isArray(routeGenerationActions)) return null;
  const action = (routeGenerationActions as Record<string, unknown>)[capabilityId];
  if (!action || typeof action !== "object" || Array.isArray(action)) return null;
  const actionId = (action as Record<string, unknown>).actionId;
  return typeof actionId === "string" && actionId.trim() ? actionId.trim() : null;
}

export function routeLevelGenerationConfirmationStatus(error: unknown) {
  return error instanceof RouteLevelGenerationConfirmationError ? error.status : null;
}
