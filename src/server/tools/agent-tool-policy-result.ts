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
import {
  createInjectedReviewBinding,
  criticReviewOutcome,
  isVideoCourseAnchorCriticInvocation,
  isVideoFinalCriticInvocation,
  validateCriticOutputBinding,
} from "./agent-tool-authorization";
import type { AgentToolInvocationEnvelope } from "./agent-tool-invocation";
import type {
  AgentToolDefinition,
  AgentToolExecutionSucceededResult,
  AgentToolPolicyOutcome,
  AgentToolRoutedExecutionResult,
} from "./agent-tool-types";
import type { AgentToolRouterFailedResult } from "./agent-tool-router";

export function applyAgentToolPolicyOutcome(input: {
  envelope: AgentToolInvocationEnvelope;
  tool: AgentToolDefinition;
  result: AgentToolExecutionSucceededResult;
  invalidOutput: (internalReasonSanitized: string) => AgentToolRouterFailedResult;
}): AgentToolRoutedExecutionResult | AgentToolRouterFailedResult {
  const { envelope, tool, result } = input;

  if (tool.id === "delivery_critic.review") {
    const outputBindingIssues = validateCriticOutputBinding(
      result.structuredOutput,
      envelope.reviewTargetRef,
      envelope.arguments.targetLocators,
      isVideoCourseAnchorCriticInvocation(tool, envelope) || isVideoFinalCriticInvocation(tool, envelope),
    );
    if (outputBindingIssues.length > 0) {
      return input.invalidOutput(`Agent Tool output target binding failed: ${outputBindingIssues.join(",")}`);
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
      return input.invalidOutput(`Agent Tool output repair contract failed: ${reasonCodes.join(",")}`);
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
    const {
      reportStructurallyValid,
      reviewPassed,
      eligibleForDownstreamGuard,
      reasonCodes,
      forbiddenNextToolIntents,
      ...structuredOutput
    } = gate;
    if (!reportStructurallyValid) {
      return input.invalidOutput(`Agent Tool video final review contract failed: ${reasonCodes.join(",")}`);
    }
    const policyOutcome: AgentToolPolicyOutcome = {
      gateId: "video_final_critic",
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

  return result;
}
