import { buildAgentHarnessBudgetEvent, type AgentHarnessBudgetEventKind, type AgentHarnessBudgetEventStatus } from "@/server/conversation/agent-harness-budget";
import { createToolObservation, type ToolObservationKind, type ToolObservationRetryAction } from "@/server/capabilities/tool-observation";

import type { ToolDefinition, ToolExecutionResult } from "./tool-types";

export type ProviderResultInput = {
  tool: ToolDefinition;
  projectId: string;
  sourceMessageId?: string;
};

export type ProviderFailureDetails = {
  capabilityId: string;
  provider?: string;
  status: "failed" | "retryable_failed";
  kind: ToolObservationKind;
  userMessage: string;
  internalReason: string;
  retryable: boolean;
  errorCategory: string;
  reasonCode?: string;
  retryAction?: ToolObservationRetryAction;
};

export function buildNeedsInputResult(
  input: ProviderResultInput,
  capabilityId: string,
  provider: string | undefined,
  missingInputs: string[],
): ToolExecutionResult {
  const assistantPrompt = "当前缺少可供本 Tool 使用的可信上游材料，智能体需要先补齐或修复输入。";

  return {
    status: "needs_input",
    toolId: input.tool.id,
    capabilityId,
    provider,
    missingInputs,
    assistantPrompt,
    observation: createToolObservation({
      projectId: input.projectId,
      sourceMessageId: input.sourceMessageId,
      capabilityId,
      expectedArtifactKind: input.tool.producedArtifactKind,
      kind: "quality_gate_failed",
      teacherSafeSummary: assistantPrompt,
      internalReasonSanitized: `Missing required source artifacts: ${missingInputs.join(", ")}`,
      retryPolicy: {
        retryable: false,
        nextAction: "fix_inputs",
      },
    }),
    artifactCreated: false,
    budgetEvent: buildBudgetEvent(input, capabilityId, "failed", "quality_gate_failed"),
  };
}

export function buildFailureResult(
  input: ProviderResultInput,
  failure: ProviderFailureDetails,
  providerSubmission: boolean | number = false,
): ToolExecutionResult {
  return {
    status: failure.status,
    toolId: input.tool.id,
    capabilityId: failure.capabilityId,
    provider: failure.provider,
    observation: createToolObservation({
      projectId: input.projectId,
      sourceMessageId: input.sourceMessageId,
      capabilityId: failure.capabilityId,
      expectedArtifactKind: input.tool.producedArtifactKind,
      kind: failure.kind,
      teacherSafeSummary: failure.userMessage,
      internalReasonSanitized: failure.internalReason,
      reasonCode: failure.reasonCode,
      retryPolicy: {
        retryable: failure.retryable,
        nextAction: failure.retryAction ?? (failure.errorCategory === "submission_unknown"
          ? "do_not_retry_automatically"
          : resolveRetryAction(failure.kind, failure.retryable)),
      },
    }),
    artifactCreated: false,
    errorCategory: failure.errorCategory,
    budgetEvent: buildBudgetEvent(
      input,
      failure.capabilityId,
      resolveBudgetStatus(failure.kind, failure.status),
      resolveBudgetKind(failure.kind),
      providerSubmission,
    ),
  };
}

function resolveBudgetStatus(kind: ToolObservationKind, status: "failed" | "retryable_failed"): AgentHarnessBudgetEventStatus {
  if (kind === "blocked_by_policy") return "blocked";
  return status;
}

function resolveBudgetKind(kind: ToolObservationKind): AgentHarnessBudgetEventKind {
  return kind === "provider_unavailable"
    ? "provider_unavailable"
    : kind === "quality_gate_failed"
      ? "quality_gate_failed"
      : kind === "blocked_by_policy"
        ? "blocked_by_policy"
        : kind === "retry_exhausted"
          ? "retry_exhausted"
          : "tool_failed";
}

function resolveRetryAction(kind: ToolObservationKind, retryable: boolean): ToolObservationRetryAction {
  if (kind === "provider_unavailable") return "wait_for_provider";
  if (kind === "blocked_by_policy") return "ask_teacher";
  if (kind === "quality_gate_failed") return "fix_inputs";
  return retryable ? "retry_later" : "do_not_retry_automatically";
}

export function buildBudgetEvent(
  input: ProviderResultInput,
  capabilityId: string,
  status: AgentHarnessBudgetEventStatus,
  kind: AgentHarnessBudgetEventKind,
  providerSubmission: boolean | number = false,
) {
  const providerSubmissionCount = typeof providerSubmission === "number"
    ? providerSubmission
    : providerSubmission
      ? 1
      : 0;
  return buildAgentHarnessBudgetEvent({
    capabilityId,
    actionKey: `${input.tool.id}:${input.tool.producedArtifactKind ?? ""}`,
    expectedArtifactKind: input.tool.producedArtifactKind,
    status,
    kind,
    providerSubmitted: providerSubmissionCount > 0,
    providerSubmissionCount,
  });
}
