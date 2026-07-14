import type { ArtifactRecord } from "@/server/workbench/types";

export type ArtifactQualityState = {
  validationStatus: "passed" | "failed" | "not_required";
  reviewStatus: "passed" | "repair" | "blocked" | "inconclusive";
  downstreamEligibility: "eligible" | "blocked";
};

export function withArtifactQualityState(
  structuredContent: Record<string, unknown>,
  state: ArtifactQualityState,
) {
  return { ...structuredContent, artifactQualityState: state };
}

export function isArtifactDownstreamEligible(artifact: ArtifactRecord) {
  return isArtifactStructuredContentDownstreamEligible(artifact.structuredContent);
}

export function isArtifactStructuredContentDownstreamEligible(structuredContent: unknown) {
  if (!isRecord(structuredContent)) return false;
  const state = structuredContent.artifactQualityState;
  if (!isRecord(state)) return false;
  return (state.validationStatus === "passed" || state.validationStatus === "not_required") &&
    state.reviewStatus === "passed" && state.downstreamEligibility === "eligible";
}

export function isArtifactTrustedForDownstream(artifact: ArtifactRecord) {
  return (artifact.status === "approved" && artifact.isApproved === true) ||
    isArtifactDownstreamEligible(artifact);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
