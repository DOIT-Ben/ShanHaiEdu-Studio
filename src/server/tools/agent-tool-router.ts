import type { PrismaClient } from "@/generated/prisma/client";
import { createToolObservation, isToolObservation } from "@/server/capabilities/tool-observation";
import { hashArtifactDraft } from "@/server/contracts/contract-validator";
import { prisma } from "@/server/db/client";
import {
  assertExecutionIdentityCanWriteProject,
  ExecutionIdentityRejectedError,
} from "@/server/execution/execution-identity";
import { isArtifactStructuredContentDownstreamEligible } from "@/server/quality/artifact-quality-state";

import { getAgentToolDefinition, getAgentToolDefinitionByTransportName } from "./agent-tool-registry";
import type {
  AgentToolDefinition,
  AgentToolExecutionFailedResult,
  AgentToolExecutionResult,
  AgentToolExecutor,
  AgentToolPolicyOutcome,
  AgentToolRoutedExecutionResult,
  AgentToolReviewBinding,
} from "./agent-tool-types";
import {
  hasValidAgentToolInvocationEnvelope,
  type AgentToolArtifactRef,
  type AgentToolInvocationEnvelope,
} from "./agent-tool-invocation";
import { validateJsonSchemaValue } from "./json-schema-value-validator";
import {
  enforceVideoCourseAnchorCriticGate,
  enforceVideoCourseAnchorGate,
  videoCourseAnchorForbiddenNextToolIntents,
  type VideoCourseAnchorCandidate,
  type VideoCourseAnchorCriticCandidate,
} from "./video-course-anchor-gate";
import {
  enforceVideoFinalReviewGate,
  type VideoFinalReviewCandidate,
} from "./video-final-review-gate";

const COURSE_ANCHOR_REVIEW_ARTIFACT_KIND = "creative_theme_generate";
const FINAL_VIDEO_REVIEW_ARTIFACT_KIND = "concat_only_assemble";
const SUCCEEDED_EXECUTOR_RESULT_KEYS = new Set([
  "status",
  "toolId",
  "invocationId",
  "structuredOutput",
  "assistantSummary",
  "artifactCreated",
]);
const NON_SUCCEEDED_EXECUTOR_RESULT_KEYS = new Set([
  "status",
  "toolId",
  "invocationId",
  "observation",
  "artifactCreated",
  "errorCategory",
]);

export type AgentToolRouterFailedResult = {
  status: "failed";
  toolId: string;
  invocationId: string;
  errorCategory:
    | "invocation_integrity_failed"
    | "agent_tool_not_allowed"
    | "agent_tool_unauthorized"
    | "agent_tool_unavailable"
    | "agent_tool_arguments_invalid"
    | "agent_tool_output_invalid"
    | "agent_tool_output_blocked"
    | "agent_tool_execution_failed";
  observation: ReturnType<typeof createToolObservation>;
  artifactCreated: false;
};

export type AgentToolRouterResult = AgentToolRoutedExecutionResult | AgentToolRouterFailedResult;

export type AgentToolAuthorizationDatabase = {
  authSession: Pick<PrismaClient["authSession"], "findFirst">;
  project: Pick<PrismaClient["project"], "findFirst" | "findUnique">;
  conversationMessage: Pick<PrismaClient["conversationMessage"], "findFirst">;
  artifact: Pick<PrismaClient["artifact"], "findFirst" | "findMany">;
};

export type AgentToolRouterDependencies = {
  authorize?: (
    envelope: AgentToolInvocationEnvelope,
    tool: AgentToolDefinition,
  ) => Promise<boolean>;
  authorizationDb?: AgentToolAuthorizationDatabase;
  executor?: AgentToolExecutor<AgentToolInvocationEnvelope>;
};

type AgentToolAuthorizationDecision =
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

export async function routeAgentToolCall(
  envelope: AgentToolInvocationEnvelope,
  dependencies: AgentToolRouterDependencies = {},
): Promise<AgentToolRouterResult> {
  let tool: AgentToolDefinition;
  try {
    tool = getAgentToolDefinition(envelope.toolId);
  } catch {
    try {
      tool = getAgentToolDefinitionByTransportName(envelope.toolId);
    } catch {
      return failed(envelope, "agent_tool_not_allowed", "Agent Tool is not registered for model use.", false);
    }
  }

  if (!hasValidAgentToolInvocationEnvelope(envelope)) {
    return failed(envelope, "invocation_integrity_failed", "Agent Tool invocation integrity check failed.", false);
  }

  const inputValidation = validateJsonSchemaValue(envelope.arguments, tool.inputSchema);
  if (!inputValidation.valid) {
    return failed(envelope, "agent_tool_arguments_invalid", `Agent Tool arguments failed contract validation: ${inputValidation.issues.join(",")}`, false);
  }

  const bindingIssues = validateInvocationBindings(envelope, tool);
  if (bindingIssues.length > 0) {
    return failed(
      envelope,
      "agent_tool_arguments_invalid",
      `Agent Tool invocation binding failed: ${bindingIssues.join(",")}`,
      false,
      { reasonCode: bindingIssues[0], reasonDetails: bindingIssues },
    );
  }

  let authorization: AgentToolAuthorizationDecision;
  if (dependencies.authorize) {
    try {
      authorization = await dependencies.authorize(envelope, tool)
        ? { authorized: true }
        : authorizationDenied("authorization_denied");
    } catch {
      authorization = authorizationCheckUnavailable();
    }
  } else {
    authorization = await defaultAuthorize(dependencies.authorizationDb ?? prisma, envelope);
  }
  if (!authorization.authorized) {
    return failed(
      envelope,
      authorization.errorCategory,
      `Agent Tool preflight rejected the invocation: ${authorization.reasonCode}.`,
      authorization.retryable,
      { reasonCode: authorization.reasonCode },
    );
  }

  if (!dependencies.executor) {
    return failed(envelope, "agent_tool_unavailable", "Agent Tool executor is unavailable.", true);
  }

  try {
    const rawResult = await dependencies.executor(envelope, tool);
    const result = rebuildAgentToolExecutorResult(rawResult, tool.id, envelope.invocationId);
    if (!result) {
      return failed(envelope, "agent_tool_execution_failed", "Agent Tool executor returned an invalid result.", false);
    }
    if (result.status !== "succeeded") return normalizeExecutorFailure(envelope, result);

    const outputValidation = validateJsonSchemaValue(result.structuredOutput, tool.outputSchema);
    if (!outputValidation.valid) {
      return failed(envelope, "agent_tool_output_invalid", `Agent Tool output failed contract validation: ${outputValidation.issues.join(",")}`, false);
    }

    if (tool.id === "delivery_critic.review") {
      const outputBindingIssues = validateCriticOutputBinding(
        result.structuredOutput,
        envelope.reviewTargetRef,
        envelope.arguments.targetLocators,
        isVideoCourseAnchorCriticInvocation(tool, envelope) || isVideoFinalCriticInvocation(tool, envelope),
      );
      if (outputBindingIssues.length > 0) {
        return failed(
          envelope,
          "agent_tool_output_invalid",
          `Agent Tool output target binding failed: ${outputBindingIssues.join(",")}`,
          false,
        );
      }
    }

    if (tool.id === "video_director.plan_or_repair") {
      const gate = enforceVideoCourseAnchorGate(result.structuredOutput as unknown as VideoCourseAnchorCandidate);
      const { candidateAccepted, eligibleForDownstreamGuard, reasonCodes, ...structuredOutput } = gate;
      const policyOutcome: AgentToolPolicyOutcome = {
        gateId: "video_director_candidate",
        passed: candidateAccepted,
        eligibleForDownstreamGuard,
        reviewOutcome: candidateAccepted ? "candidate_ready_for_critic" : "rework_required",
        reasonCodes,
        forbiddenNextToolIntents: [...videoCourseAnchorForbiddenNextToolIntents],
      };
      return { ...result, structuredOutput, policyOutcome };
    }

    if (isVideoCourseAnchorCriticInvocation(tool, envelope)) {
      const gate = enforceVideoCourseAnchorCriticGate(
        result.structuredOutput as unknown as VideoCourseAnchorCriticCandidate,
      );
      const {
        reportStructurallyValid,
        reviewPassed,
        eligibleForDownstreamGuard,
        reasonCodes,
        forbiddenNextToolIntents,
        ...structuredOutput
      } = gate;
      if (!reportStructurallyValid) {
        return failed(
          envelope,
          "agent_tool_output_invalid",
          `Agent Tool output repair contract failed: ${reasonCodes.join(",")}`,
          false,
        );
      }
      const policyOutcome: AgentToolPolicyOutcome = {
        gateId: "video_course_anchor_critic",
        passed: reviewPassed,
        eligibleForDownstreamGuard,
        reviewOutcome: reviewPassed
          ? "eligible_for_downstream_guard"
          : criticReviewOutcome(gate.recommendation),
        reasonCodes,
        forbiddenNextToolIntents,
        reviewBinding: createInjectedReviewBinding(envelope, tool),
      };
      return { ...result, structuredOutput, policyOutcome };
    }

    if (isVideoFinalCriticInvocation(tool, envelope)) {
      const gate = enforceVideoFinalReviewGate(result.structuredOutput as unknown as VideoFinalReviewCandidate);
      const { reportStructurallyValid, reviewPassed, eligibleForDownstreamGuard, reasonCodes, forbiddenNextToolIntents, ...structuredOutput } = gate;
      if (!reportStructurallyValid) {
        return failed(envelope, "agent_tool_output_invalid", `Agent Tool video final review contract failed: ${reasonCodes.join(",")}`, false);
      }
      const policyOutcome: AgentToolPolicyOutcome = {
        gateId: "video_final_critic",
        passed: reviewPassed,
        eligibleForDownstreamGuard,
        reviewOutcome: reviewPassed ? "eligible_for_downstream_guard" : criticReviewOutcome(gate.recommendation),
        reasonCodes,
        forbiddenNextToolIntents,
        reviewBinding: createInjectedReviewBinding(envelope, tool),
      };
      return { ...result, structuredOutput, policyOutcome };
    }

    return result;
  } catch {
    return failed(envelope, "agent_tool_execution_failed", "Agent Tool execution failed.", true);
  }
}

function validateInvocationBindings(
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

function isVideoCourseAnchorCriticInvocation(
  tool: AgentToolDefinition,
  envelope: AgentToolInvocationEnvelope,
): boolean {
  return tool.id === "delivery_critic.review" &&
    envelope.arguments.domain === "video" &&
    envelope.arguments.stage === "course_anchor";
}

function isVideoFinalCriticInvocation(tool: AgentToolDefinition, envelope: AgentToolInvocationEnvelope): boolean {
  return tool.id === "delivery_critic.review" &&
    envelope.arguments.domain === "video" &&
    envelope.arguments.stage === "video_final_review";
}

function createInjectedReviewBinding(
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

function criticReviewOutcome(
  recommendation: VideoCourseAnchorCriticCandidate["recommendation"],
): "rework_required" | "blocked" | "inconclusive" {
  if (recommendation === "blocked") return "blocked";
  if (recommendation === "inconclusive") return "inconclusive";
  return "rework_required";
}

async function defaultAuthorize(
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
    where: {
      id: ref.artifactId,
      projectId,
    },
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

function authorizationDenied(reasonCode: string): AgentToolAuthorizationDecision {
  return { authorized: false, errorCategory: "agent_tool_unauthorized", reasonCode, retryable: false };
}

function invocationIntegrityDenied(reasonCode: string): AgentToolAuthorizationDecision {
  return { authorized: false, errorCategory: "invocation_integrity_failed", reasonCode, retryable: false };
}

function inputEligibilityDenied(reasonCode: string): AgentToolAuthorizationDecision {
  return { authorized: false, errorCategory: "agent_tool_arguments_invalid", reasonCode, retryable: false };
}

function authorizationCheckUnavailable(): AgentToolAuthorizationDecision {
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
  if (!isRecord(value) || !hasText(value.artifactId) || !Number.isInteger(value.version) || !isDigest(value.digest)) {
    return null;
  }
  return {
    artifactId: value.artifactId,
    version: value.version,
    digest: value.digest.toLowerCase(),
  };
}

function asRubricRef(value: unknown): { id: string; version: string; digest: string } | null {
  if (!isRecord(value) || !hasText(value.id) || !hasText(value.version) || !isDigest(value.digest)) return null;
  return { id: value.id, version: value.version, digest: value.digest.toLowerCase() };
}

function sameArtifactVersionRef(
  left: Omit<AgentToolArtifactRef, "kind">,
  right: AgentToolArtifactRef,
): boolean {
  return left.artifactId === right.artifactId &&
    left.version === right.version &&
    left.digest === right.digest;
}

function validateCriticOutputBinding(
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
  } else if (!targetLocators.every((locator) =>
    locatorWithinSignedReviewScope(locator, signedInputLocators, reviewTargetRef))) {
    issues.push("review_target_locator_outside_review_target");
  }
  if (requireExactRootArtifact &&
      !targetLocators.some((locator) => isExactArtifactLocator(locator, reviewTargetRef))) {
    issues.push("review_target_root_locator_missing");
  }

  const findings = Array.isArray(output.findings) ? output.findings : [];
  for (const finding of findings) {
    if (!isRecord(finding) ||
        !locatorWithinSignedReviewScope(finding.locator, signedInputLocators, reviewTargetRef)) {
      issues.push("finding_locator_outside_review_target");
      break;
    }
  }
  return issues;
}

function locatorWithinSignedReviewScope(
  value: unknown,
  signedInputLocators: unknown[],
  reviewTargetRef: AgentToolArtifactRef,
): boolean {
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
    case "artifact":
      return signed.artifactKind === candidate.artifactKind && signed.artifactId === candidate.artifactId;
    case "page":
      return signed.parentArtifactId === candidate.parentArtifactId && signed.pageId === candidate.pageId;
    case "asset":
      return signed.parentArtifactId === candidate.parentArtifactId && signed.assetId === candidate.assetId;
    case "shot":
      return signed.parentArtifactId === candidate.parentArtifactId && signed.shotId === candidate.shotId;
    case "track":
      return signed.parentArtifactId === candidate.parentArtifactId && signed.trackId === candidate.trackId;
    case "timeline":
      return signed.parentArtifactId === candidate.parentArtifactId && signed.timelineId === candidate.timelineId;
    case "frame_range":
      return signed.parentArtifactId === candidate.parentArtifactId &&
        signed.parentShotId === candidate.parentShotId &&
        timeRangeContains(signed.timeRangeMs, candidate.timeRangeMs);
    default:
      return false;
  }
}

function timeRangeContains(container: unknown, candidate: unknown): boolean {
  return isRecord(container) && isRecord(candidate) &&
    typeof container.start === "number" && typeof container.end === "number" &&
    typeof candidate.start === "number" && typeof candidate.end === "number" &&
    container.start <= candidate.start && container.end >= candidate.end;
}

function validateCriticLocatorSet(
  value: unknown,
  reviewTargetRef: AgentToolArtifactRef,
  missingCode: string,
  outsideCode: string,
): string[] {
  if (!Array.isArray(value) || value.length === 0) return [missingCode];
  return value.every((locator) => locatorBelongsToReviewTarget(locator, reviewTargetRef))
    ? []
    : [outsideCode];
}

function isExactArtifactLocator(value: unknown, ref: AgentToolArtifactRef): boolean {
  return isRecord(value) &&
    value.kind === "artifact" &&
    value.artifactKind === ref.kind &&
    value.artifactId === ref.artifactId;
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

function rebuildAgentToolExecutorResult(
  value: unknown,
  expectedToolId: AgentToolDefinition["id"],
  expectedInvocationId: string,
): AgentToolExecutionResult | null {
  if (!isRecord(value) ||
      value.toolId !== expectedToolId ||
      value.invocationId !== expectedInvocationId ||
      value.artifactCreated !== false) {
    return null;
  }

  if (value.status === "succeeded") {
    if (!hasOnlyAllowedOwnKeys(value, SUCCEEDED_EXECUTOR_RESULT_KEYS) ||
        !isRecord(value.structuredOutput) ||
        typeof value.assistantSummary !== "string") {
      return null;
    }
    return {
      status: "succeeded",
      toolId: expectedToolId,
      invocationId: expectedInvocationId,
      structuredOutput: structuredClone(value.structuredOutput),
      assistantSummary: value.assistantSummary,
      artifactCreated: false,
    };
  }

  if (!isNonSucceededExecutorStatus(value.status) ||
      !hasOnlyAllowedOwnKeys(value, NON_SUCCEEDED_EXECUTOR_RESULT_KEYS) ||
      !isToolObservation(value.observation) ||
      (value.errorCategory !== undefined && typeof value.errorCategory !== "string")) {
    return null;
  }

  const result: AgentToolExecutionFailedResult = {
    status: value.status,
    toolId: expectedToolId,
    invocationId: expectedInvocationId,
    observation: structuredClone(value.observation),
    artifactCreated: false,
  };
  if (typeof value.errorCategory === "string") result.errorCategory = value.errorCategory;
  return result;
}

function normalizeExecutorFailure(
  envelope: AgentToolInvocationEnvelope,
  result: AgentToolExecutionFailedResult,
): AgentToolExecutionFailedResult {
  const retryable = result.observation.retryPolicy.retryable === true;
  const errorCategory = retryable ? "agent_tool_unavailable" : "agent_tool_execution_failed";
  const policy = failedObservationPolicy(errorCategory, retryable);

  return {
    status: result.status,
    toolId: result.toolId,
    invocationId: result.invocationId,
    errorCategory,
    observation: createToolObservation({
      projectId: envelope.projectId,
      sourceMessageId: envelope.sourceMessageId,
      capabilityId: envelope.toolId,
      errorCategory,
      reasonCode: result.observation.reasonCode ?? (retryable
        ? "agent_tool_executor_temporarily_unavailable"
        : "agent_tool_executor_result_inconclusive"),
      reasonDetails: result.observation.reasonDetails,
      kind: policy.kind,
      teacherSafeSummary: policy.teacherSafeSummary,
      internalReasonSanitized: result.observation.internalReasonSanitized,
      retryPolicy: { retryable, nextAction: policy.nextAction },
    }),
    artifactCreated: false,
  };
}

function hasOnlyAllowedOwnKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Reflect.ownKeys(value).every((key) => typeof key === "string" && allowed.has(key));
}

function isNonSucceededExecutorStatus(
  value: unknown,
): value is AgentToolExecutionFailedResult["status"] {
  return value === "needs_input" || value === "failed" || value === "inconclusive";
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failed(
  envelope: Pick<AgentToolInvocationEnvelope, "invocationId" | "projectId" | "sourceMessageId" | "toolId">,
  errorCategory: AgentToolRouterFailedResult["errorCategory"],
  internalReasonSanitized: string,
  retryable: boolean,
  details: { reasonCode?: string; reasonDetails?: string[] } = {},
): AgentToolRouterFailedResult {
  const policy = failedObservationPolicy(errorCategory, retryable);
  return {
    status: "failed",
    toolId: envelope.toolId,
    invocationId: envelope.invocationId,
    errorCategory,
    observation: createToolObservation({
      projectId: envelope.projectId,
      sourceMessageId: envelope.sourceMessageId,
      capabilityId: envelope.toolId,
      errorCategory,
      reasonCode: details.reasonCode,
      reasonDetails: details.reasonDetails,
      kind: policy.kind,
      teacherSafeSummary: policy.teacherSafeSummary,
      internalReasonSanitized,
      retryPolicy: {
        retryable,
        nextAction: policy.nextAction,
      },
    }),
    artifactCreated: false,
  };
}

function failedObservationPolicy(
  errorCategory: AgentToolRouterFailedResult["errorCategory"],
  retryable: boolean,
) {
  if (retryable) {
    return {
      kind: "tool_failed" as const,
      nextAction: "retry_later" as const,
      teacherSafeSummary: "这项专业审查暂时不可用，当前进度已经保存。",
    };
  }
  if (errorCategory === "agent_tool_unauthorized") {
    return {
      kind: "blocked_by_policy" as const,
      nextAction: "ask_teacher" as const,
      teacherSafeSummary: "这项操作缺少当前任务所需的授权，尚未执行。",
    };
  }
  if (errorCategory === "agent_tool_arguments_invalid" || errorCategory === "agent_tool_output_invalid" ||
      errorCategory === "agent_tool_output_blocked" || errorCategory === "agent_tool_execution_failed") {
    return {
      kind: "quality_gate_failed" as const,
      nextAction: "fix_inputs" as const,
      teacherSafeSummary: "当前输入或审查结果没有通过校验，已返回重新调整。",
    };
  }
  return {
    kind: "tool_failed" as const,
    nextAction: "skip_or_replan" as const,
    teacherSafeSummary: "当前调用没有通过完整性校验，已返回重新规划。",
  };
}
