import type { PrismaClient } from "@/generated/prisma/client";
import { hashArtifactDraft } from "@/server/contracts/contract-validator";
import {
  assertExecutionIdentityCanWriteProject,
  ExecutionIdentityRejectedError,
} from "@/server/execution/execution-identity";
import { isArtifactStructuredContentDownstreamEligible } from "@/server/quality/artifact-quality-state";

import type {
  AgentToolDefinition,
  AgentToolReviewBinding,
} from "./agent-tool-types";
import type {
  AgentToolArtifactRef,
  AgentToolInvocationEnvelope,
} from "./agent-tool-invocation";
import type { AgentToolRouterFailedResult } from "./agent-tool-router";
import {
  type VideoCourseAnchorCriticCandidate,
} from "./video-course-anchor-gate";

export const COURSE_ANCHOR_REVIEW_ARTIFACT_KIND = "creative_theme_generate";
export const FINAL_VIDEO_REVIEW_ARTIFACT_KIND = "concat_only_assemble";

export type AgentToolAuthorizationDatabase = {
  authSession: Pick<PrismaClient["authSession"], "findFirst">;
  project: Pick<PrismaClient["project"], "findFirst" | "findUnique">;
  conversationMessage: Pick<PrismaClient["conversationMessage"], "findFirst">;
  artifact: Pick<PrismaClient["artifact"], "findFirst" | "findMany">;
};

export type AgentToolAuthorizationDecision =
  | { authorized: true }
  | {
      authorized: false;
      errorCategory: AgentToolRouterFailedResult["errorCategory"];
      reasonCode: string;
      retryable: boolean;
    };

type AgentToolReferenceDecision =
  | { valid: true }
  | { valid: false; reasonCode: string };

export function validateInvocationBindings(
  envelope: AgentToolInvocationEnvelope,
  tool: AgentToolDefinition,
): string[] {
  const issues: string[] = [];
  if (tool.id === "delivery_critic.review") {
    if (!envelope.reviewTargetRef) issues.push("review_target_required");
    else issues.push(...validateCriticLocatorSet(
      envelope.arguments.targetLocators,
      envelope.reviewTargetRef,
      "review_target_input_locator_missing",
      "review_target_input_locator_outside_review_target",
    ));
  } else if (envelope.reviewTargetRef) {
    issues.push("review_target_not_allowed_for_director");
  }

  if (isVideoCourseAnchorCriticInvocation(tool, envelope)) {
    const courseAnchorRef = asArtifactVersionRef(envelope.arguments.courseAnchorRef);
    if (!courseAnchorRef || !envelope.reviewTargetRef || !sameArtifactVersionRef(courseAnchorRef, envelope.reviewTargetRef)) {
      issues.push("course_anchor_ref_mismatch");
    }
    if (envelope.reviewTargetRef?.kind !== COURSE_ANCHOR_REVIEW_ARTIFACT_KIND) {
      issues.push("course_anchor_review_target_kind_invalid");
    }
    if (!asRubricRef(envelope.arguments.rubricRef)) issues.push("rubric_ref_invalid");
    if (!hasText(envelope.arguments.generatorInvocationId)) issues.push("generator_invocation_id_invalid");
  }
  if (isVideoFinalCriticInvocation(tool, envelope)) {
    if (envelope.reviewTargetRef?.kind !== FINAL_VIDEO_REVIEW_ARTIFACT_KIND) issues.push("video_final_review_target_kind_invalid");
    if (!asRubricRef(envelope.arguments.rubricRef)) issues.push("rubric_ref_invalid");
    if (!hasText(envelope.arguments.generatorInvocationId)) issues.push("generator_invocation_id_invalid");
  }

  return issues;
}

export function isVideoCourseAnchorCriticInvocation(
  tool: AgentToolDefinition,
  envelope: AgentToolInvocationEnvelope,
): boolean {
  return tool.id === "delivery_critic.review" &&
    envelope.arguments.domain === "video" &&
    envelope.arguments.stage === "course_anchor";
}

export function isVideoFinalCriticInvocation(tool: AgentToolDefinition, envelope: AgentToolInvocationEnvelope): boolean {
  return tool.id === "delivery_critic.review" &&
    envelope.arguments.domain === "video" &&
    envelope.arguments.stage === "video_final_review";
}

export function createInjectedReviewBinding(
  envelope: AgentToolInvocationEnvelope,
  tool: AgentToolDefinition,
): AgentToolReviewBinding {
  const reviewTargetRef = envelope.reviewTargetRef;
  const rubricRef = asRubricRef(envelope.arguments.rubricRef);
  const generatorInvocationId = envelope.arguments.generatorInvocationId;
  if (!reviewTargetRef || !rubricRef || !hasText(generatorInvocationId)) {
    throw new Error("Course anchor review binding is incomplete.");
  }
  return {
    projectId: envelope.projectId,
    intentEpoch: envelope.intentEpoch,
    sourceMessageId: envelope.sourceMessageId,
    invocationId: envelope.invocationId,
    agentProfileId: tool.agentProfileId,
    executorSource: "unverified_injected",
    productionEligible: false,
    reviewTargetRef: structuredClone(reviewTargetRef),
    rubricRef,
    generatorInvocationId,
    inputHash: envelope.inputHash,
    actionDigest: envelope.actionDigest,
  };
}

export function criticReviewOutcome(
  recommendation: VideoCourseAnchorCriticCandidate["recommendation"],
): "rework_required" | "blocked" | "inconclusive" {
  if (recommendation === "blocked") return "blocked";
  if (recommendation === "inconclusive") return "inconclusive";
  return "rework_required";
}

export async function defaultAuthorize(
  db: AgentToolAuthorizationDatabase,
  envelope: AgentToolInvocationEnvelope,
): Promise<AgentToolAuthorizationDecision> {
  try {
    try {
      await assertExecutionIdentityCanWriteProject(db, envelope.identity, envelope.projectId);
    } catch (error) {
      if (error instanceof ExecutionIdentityRejectedError) {
        return authorizationDenied(`execution_identity_${error.code}`);
      }
      throw error;
    }
    const project = await db.project.findUnique({
      where: { id: envelope.projectId },
      select: { intentEpoch: true },
    });
    if (project?.intentEpoch !== envelope.intentEpoch) {
      return invocationIntegrityDenied("intent_epoch_stale");
    }

    const sourceMessage = await db.conversationMessage.findFirst({
      where: { id: envelope.sourceMessageId, projectId: envelope.projectId },
      select: { id: true },
    });
    if (!sourceMessage) {
      return invocationIntegrityDenied("source_message_not_in_project");
    }

    if (envelope.reviewTargetRef) {
      const reviewTarget = await authorizeReviewTarget(
        db,
        envelope.projectId,
        envelope.reviewTargetRef,
        isCourseAnchorReviewArguments(envelope.arguments)
          ? COURSE_ANCHOR_REVIEW_ARTIFACT_KIND
          : isVideoFinalReviewArguments(envelope.arguments) ? FINAL_VIDEO_REVIEW_ARTIFACT_KIND : null,
      );
      if (!reviewTarget.valid) return inputEligibilityDenied(reviewTarget.reasonCode);
    }

    if (envelope.approvedArtifactRefs.length === 0) return { authorized: true };
    if (new Set(envelope.approvedArtifactRefs.map((ref) => ref.artifactId)).size !== envelope.approvedArtifactRefs.length) {
      return inputEligibilityDenied("approved_artifact_ref_duplicate");
    }
    const artifacts = await db.artifact.findMany({
      where: {
        projectId: envelope.projectId,
        id: { in: envelope.approvedArtifactRefs.map((ref) => ref.artifactId) },
      },
    });
    if (artifacts.length !== envelope.approvedArtifactRefs.length) {
      return inputEligibilityDenied("approved_artifact_ref_missing");
    }
    for (const ref of envelope.approvedArtifactRefs) {
      const artifact = artifacts.find((candidate) => candidate.id === ref.artifactId);
      if (!artifact) return inputEligibilityDenied("approved_artifact_ref_missing");
      if (artifact.kind !== ref.kind) return inputEligibilityDenied("approved_artifact_kind_mismatch");
      if (artifact.version !== ref.version) return inputEligibilityDenied("approved_artifact_version_mismatch");
      const structuredContent = parseStructuredContent(artifact.structuredContentJson);
      if (!structuredContent) return inputEligibilityDenied("approved_artifact_content_invalid");
      const trusted = (artifact.status === "approved" && artifact.isApproved) ||
        (artifact.status === "needs_review" && !artifact.isApproved && isArtifactStructuredContentDownstreamEligible(structuredContent));
      if (!trusted) return inputEligibilityDenied("approved_artifact_not_trusted");
      if (hashPersistedArtifact(artifact) !== ref.digest) {
        return inputEligibilityDenied("approved_artifact_digest_mismatch");
      }
    }
    return { authorized: true };
  } catch {
    return authorizationCheckUnavailable();
  }
}

async function authorizeReviewTarget(
  db: AgentToolAuthorizationDatabase,
  projectId: string,
  ref: AgentToolArtifactRef,
  expectedNodeKey: string | null,
): Promise<AgentToolReferenceDecision> {
  const artifact = await db.artifact.findFirst({
    where: { id: ref.artifactId, projectId },
  });
  if (!artifact) return { valid: false, reasonCode: "review_target_not_found" };
  if (artifact.kind !== ref.kind) return { valid: false, reasonCode: "review_target_kind_mismatch" };
  if (artifact.version !== ref.version) return { valid: false, reasonCode: "review_target_version_mismatch" };
  if (expectedNodeKey && artifact.nodeKey !== expectedNodeKey) {
    return { valid: false, reasonCode: "review_target_node_mismatch" };
  }
  if ((artifact.status === "needs_review" && artifact.isApproved) ||
      (artifact.status === "approved" && !artifact.isApproved) ||
      (artifact.status !== "needs_review" && artifact.status !== "approved")) {
    return { valid: false, reasonCode: "review_target_approval_state_invalid" };
  }
  if (!parseStructuredContent(artifact.structuredContentJson)) {
    return { valid: false, reasonCode: "review_target_content_invalid" };
  }

  const latest = await db.artifact.findFirst({
    where: { projectId, nodeKey: artifact.nodeKey },
    orderBy: { version: "desc" },
    select: { id: true, version: true },
  });
  if (!latest || latest.id !== artifact.id || latest.version !== artifact.version) {
    return { valid: false, reasonCode: "review_target_stale" };
  }
  if (hashPersistedArtifact(artifact) !== ref.digest) {
    return { valid: false, reasonCode: "review_target_digest_mismatch" };
  }
  return { valid: true };
}

export function authorizationDenied(reasonCode: string): AgentToolAuthorizationDecision {
  return { authorized: false, errorCategory: "agent_tool_unauthorized", reasonCode, retryable: false };
}

function invocationIntegrityDenied(reasonCode: string): AgentToolAuthorizationDecision {
  return { authorized: false, errorCategory: "invocation_integrity_failed", reasonCode, retryable: false };
}

function inputEligibilityDenied(reasonCode: string): AgentToolAuthorizationDecision {
  return { authorized: false, errorCategory: "agent_tool_arguments_invalid", reasonCode, retryable: false };
}

export function authorizationCheckUnavailable(): AgentToolAuthorizationDecision {
  return {
    authorized: false,
    errorCategory: "agent_tool_unavailable",
    reasonCode: "authorization_check_failed",
    retryable: true,
  };
}

function hashPersistedArtifact(artifact: {
  nodeKey: string;
  kind: string;
  title: string;
  summary: string;
  markdownContent: string;
  structuredContentJson: string;
}): string | null {
  const structuredContent = parseStructuredContent(artifact.structuredContentJson);
  if (!structuredContent) return null;
  return hashArtifactDraft({
    nodeKey: artifact.nodeKey,
    kind: artifact.kind,
    title: artifact.title,
    summary: artifact.summary,
    markdownContent: artifact.markdownContent,
    structuredContent,
  });
}

function parseStructuredContent(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function asArtifactVersionRef(value: unknown): Omit<AgentToolArtifactRef, "kind"> | null {
  if (!isRecord(value) || !hasText(value.artifactId) || typeof value.version !== "number" || !Number.isInteger(value.version) || !isDigest(value.digest)) {
    return null;
  }
  return { artifactId: value.artifactId, version: value.version, digest: value.digest.toLowerCase() };
}

function asRubricRef(value: unknown): { id: string; version: string; digest: string } | null {
  if (!isRecord(value) || !hasText(value.id) || !hasText(value.version) || !isDigest(value.digest)) return null;
  return { id: value.id, version: value.version, digest: value.digest.toLowerCase() };
}

function sameArtifactVersionRef(left: Omit<AgentToolArtifactRef, "kind">, right: AgentToolArtifactRef): boolean {
  return left.artifactId === right.artifactId && left.version === right.version && left.digest === right.digest;
}

export function validateCriticOutputBinding(
  output: Record<string, unknown>,
  reviewTargetRef: AgentToolArtifactRef | null,
  signedInputLocatorsValue: unknown,
  requireExactRootArtifact: boolean,
): string[] {
  if (!reviewTargetRef) return ["review_target_missing"];
  const issues: string[] = [];
  const targetLocators = Array.isArray(output.targetLocators) ? output.targetLocators : [];
  const signedInputLocators = Array.isArray(signedInputLocatorsValue) ? signedInputLocatorsValue : [];
  if (targetLocators.length === 0) {
    issues.push("review_target_locator_missing");
  } else if (!targetLocators.every((locator) => locatorWithinSignedReviewScope(locator, signedInputLocators, reviewTargetRef))) {
    issues.push("review_target_locator_outside_review_target");
  }
  if (requireExactRootArtifact && !targetLocators.some((locator) => isExactArtifactLocator(locator, reviewTargetRef))) {
    issues.push("review_target_root_locator_missing");
  }

  const findings = Array.isArray(output.findings) ? output.findings : [];
  for (const finding of findings) {
    if (!isRecord(finding) || !locatorWithinSignedReviewScope(finding.locator, signedInputLocators, reviewTargetRef)) {
      issues.push("finding_locator_outside_review_target");
      break;
    }
  }
  return issues;
}

function locatorWithinSignedReviewScope(value: unknown, signedInputLocators: unknown[], reviewTargetRef: AgentToolArtifactRef): boolean {
  if (!locatorBelongsToReviewTarget(value, reviewTargetRef)) return false;
  if (signedInputLocators.some((locator) => isExactArtifactLocator(locator, reviewTargetRef))) return true;
  return signedInputLocators.some((locator) => sameReviewLocatorScope(locator, value));
}

function sameReviewLocatorScope(signed: unknown, candidate: unknown): boolean {
  if (!isRecord(signed) || !isRecord(candidate) || signed.kind !== candidate.kind) {
    if (isRecord(signed) && signed.kind === "shot" && isRecord(candidate) && candidate.kind === "frame_range") {
      return signed.parentArtifactId === candidate.parentArtifactId && signed.shotId === candidate.parentShotId;
    }
    if (isRecord(signed) && signed.kind === "page" && isRecord(candidate) && candidate.kind === "asset") {
      return signed.parentArtifactId === candidate.parentArtifactId && signed.pageId === candidate.ownerUnitId;
    }
    return false;
  }

  switch (signed.kind) {
    case "artifact": return signed.artifactKind === candidate.artifactKind && signed.artifactId === candidate.artifactId;
    case "page": return signed.parentArtifactId === candidate.parentArtifactId && signed.pageId === candidate.pageId;
    case "asset": return signed.parentArtifactId === candidate.parentArtifactId && signed.assetId === candidate.assetId;
    case "shot": return signed.parentArtifactId === candidate.parentArtifactId && signed.shotId === candidate.shotId;
    case "track": return signed.parentArtifactId === candidate.parentArtifactId && signed.trackId === candidate.trackId;
    case "timeline": return signed.parentArtifactId === candidate.parentArtifactId && signed.timelineId === candidate.timelineId;
    case "frame_range": return signed.parentArtifactId === candidate.parentArtifactId && signed.parentShotId === candidate.parentShotId &&
      timeRangeContains(signed.timeRangeMs, candidate.timeRangeMs);
    default: return false;
  }
}

function timeRangeContains(container: unknown, candidate: unknown): boolean {
  return isRecord(container) && isRecord(candidate) &&
    typeof container.start === "number" && typeof container.end === "number" &&
    typeof candidate.start === "number" && typeof candidate.end === "number" &&
    container.start <= candidate.start && container.end >= candidate.end;
}

function validateCriticLocatorSet(value: unknown, reviewTargetRef: AgentToolArtifactRef, missingCode: string, outsideCode: string): string[] {
  if (!Array.isArray(value) || value.length === 0) return [missingCode];
  return value.every((locator) => locatorBelongsToReviewTarget(locator, reviewTargetRef)) ? [] : [outsideCode];
}

function isExactArtifactLocator(value: unknown, ref: AgentToolArtifactRef): boolean {
  return isRecord(value) && value.kind === "artifact" && value.artifactKind === ref.kind && value.artifactId === ref.artifactId;
}

function locatorBelongsToReviewTarget(value: unknown, ref: AgentToolArtifactRef): boolean {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "artifact") return isExactArtifactLocator(value, ref);
  if (["page", "asset", "shot", "track", "timeline", "frame_range"].includes(value.kind)) {
    return value.parentArtifactId === ref.artifactId;
  }
  return false;
}

function isCourseAnchorReviewArguments(argumentsValue: Record<string, unknown>): boolean {
  return argumentsValue.domain === "video" && argumentsValue.stage === "course_anchor";
}

function isVideoFinalReviewArguments(argumentsValue: Record<string, unknown>): boolean {
  return argumentsValue.domain === "video" && argumentsValue.stage === "video_final_review";
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
