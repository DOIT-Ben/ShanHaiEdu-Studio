import type { Artifact } from "@/generated/prisma/client";
import type { ArtifactRecord } from "@/server/workbench/types";
import { hasForbiddenArtifactTruthMarker, hasVerifiedArtifactApprovalEvidence } from "./artifact-truth-boundary";

export type ArtifactQualityState = {
  validationStatus: "passed" | "failed" | "not_required";
  reviewStatus: "passed" | "repair" | "blocked" | "inconclusive";
  downstreamEligibility: "eligible" | "blocked";
  eligibleStages?: string[];
};

export function withArtifactQualityState(
  structuredContent: Record<string, unknown>,
  state: ArtifactQualityState,
) {
  return { ...structuredContent, artifactQualityState: state };
}

export function isArtifactDownstreamEligible(artifact: ArtifactRecord) {
  return (artifact.origin === "tool_result" || artifact.origin === undefined) &&
    !hasForbiddenArtifactTruthMarker(artifact.structuredContent) &&
    isArtifactStructuredContentDownstreamEligible(artifact.structuredContent);
}

export function isArtifactStructuredContentDownstreamEligible(structuredContent: unknown) {
  if (!isRecord(structuredContent)) return false;
  const state = structuredContent.artifactQualityState;
  if (!isRecord(state)) return false;
  return (state.validationStatus === "passed" || state.validationStatus === "not_required") &&
    state.reviewStatus === "passed" && state.downstreamEligibility === "eligible";
}

export function isArtifactTrustedForDownstream(artifact: ArtifactRecord) {
  if (artifact.origin === undefined) {
    return (artifact.status === "approved" && artifact.isApproved === true) ||
      isArtifactStructuredContentDownstreamEligible(artifact.structuredContent);
  }
  return hasVerifiedArtifactApprovalEvidence(artifact) || isArtifactDownstreamEligible(artifact);
}

export function isPersistedArtifactTrustedForDownstream(artifact: Artifact) {
  let structuredContent: Record<string, unknown>;
  try {
    const parsed = JSON.parse(artifact.structuredContentJson) as unknown;
    if (!isRecord(parsed)) return false;
    structuredContent = parsed;
  } catch {
    return false;
  }
  return isArtifactTrustedForDownstream({
    id: artifact.id,
    projectId: artifact.projectId,
    taskId: artifact.taskId,
    taskBriefDigest: artifact.taskBriefDigest,
    intentEpoch: artifact.intentEpoch,
    planRevision: artifact.planRevision,
    origin: artifact.origin as ArtifactRecord["origin"],
    nodeKey: artifact.nodeKey as ArtifactRecord["nodeKey"],
    title: artifact.title,
    kind: artifact.kind as ArtifactRecord["kind"],
    status: artifact.status as ArtifactRecord["status"],
    summary: artifact.summary,
    markdownContent: artifact.markdownContent,
    structuredContent,
    version: artifact.version,
    isApproved: artifact.isApproved,
    createdAt: artifact.createdAt.toISOString(),
    updatedAt: artifact.updatedAt.toISOString(),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
