import type { AgentProjectContext, AgentRuntime, ApprovedArtifactInput } from "@/server/agent-runtime/types";
import {
  type AgentRuntimeCapabilityInput,
  runCapabilityWithAgentRuntime,
} from "@/server/capabilities/capability-runner";
import type { CapabilityRunResult } from "@/server/capabilities/types";
import { createToolObservation, type ToolObservationKind, type ToolObservationRetryAction } from "@/server/capabilities/tool-observation";
import {
  buildAgentHarnessBudgetEvent,
  type AgentHarnessBudgetEventKind,
  type AgentHarnessBudgetEventStatus,
} from "@/server/conversation/agent-harness-budget";
import type { ToolDefinition, ToolExecutionResult } from "./tool-types";

export type InternalCapabilityToolInput = {
  tool: ToolDefinition;
  runtime: AgentRuntime;
  projectId: string;
  userMessage: string;
  projectContext: AgentProjectContext;
  approvedArtifacts?: ApprovedArtifactInput[];
  sourceMessageId?: string;
};

export type InternalCapabilityToolDependencies = {
  runCapability?: (input: AgentRuntimeCapabilityInput) => Promise<CapabilityRunResult>;
};

export async function executeInternalCapabilityTool(
  input: InternalCapabilityToolInput,
  dependencies: InternalCapabilityToolDependencies = {},
): Promise<ToolExecutionResult> {
  const capabilityId = input.tool.capabilityId;

  if (input.tool.adapterKind !== "internal_capability" || !capabilityId || !input.tool.implemented) {
    return buildFailureResult(input, {
      capabilityId: capabilityId ?? "unknown",
      userMessage: "这一步暂时无法执行，请先确认当前材料是否完整。",
      internalReason: input.tool.blockedReason ?? `Unsupported internal capability tool: ${input.tool.id}`,
      retryable: false,
      errorCategory: "unknown",
    });
  }

  const runCapability = dependencies.runCapability ?? runCapabilityWithAgentRuntime;

  try {
    const result = await runCapability({
      runtime: input.runtime,
      projectId: input.projectId,
      capabilityId,
      userMessage: input.userMessage,
      projectContext: input.projectContext,
      approvedArtifacts: input.approvedArtifacts ?? [],
      sourceMessageId: input.sourceMessageId,
    });

    if (result.status === "succeeded") {
      return {
        status: "succeeded",
        toolId: input.tool.id,
        capabilityId,
        artifactDraft: result.artifactDraft,
        assistantSummary: result.assistantSummary,
        budgetEvent: buildBudgetEvent(input, capabilityId, "succeeded", "tool_succeeded"),
      };
    }

    if (result.status === "needs_input") {
      return {
        status: "needs_input",
        toolId: input.tool.id,
        capabilityId,
        missingInputs: [...result.missingInputs],
        assistantPrompt: result.assistantPrompt,
        observation: createBlockedObservation(input, capabilityId, {
          teacherSafeSummary: result.assistantPrompt,
          internalReasonSanitized: `Needs teacher input: ${result.missingInputs.join(", ")}`,
        }),
        artifactCreated: false,
        budgetEvent: buildBudgetEvent(input, capabilityId, "blocked", "blocked_by_policy"),
      };
    }

    return buildFailureResult(input, {
      capabilityId,
      userMessage: result.userMessage,
      internalReason: `${result.errorCategory}: ${result.userMessage}`,
      retryable: result.retryable,
      errorCategory: result.errorCategory,
    });
  } catch (error) {
    return buildFailureResult(input, {
      capabilityId,
      userMessage: "这一步暂时没有完成，可以稍后重试。",
      internalReason: error instanceof Error ? error.message : "Unknown internal capability tool error",
      retryable: input.tool.failurePolicy.retryable,
      errorCategory: "unknown",
    });
  }
}

function buildFailureResult(
  input: InternalCapabilityToolInput,
  failure: {
    capabilityId: string;
    userMessage: string;
    internalReason: string;
    retryable: boolean;
    errorCategory: string;
  },
): ToolExecutionResult {
  const normalizedErrorCategory = normalizeErrorCategory(failure.errorCategory);
  const observationKind = resolveObservationKind(normalizedErrorCategory);
  const retryable = resolveRetryable(observationKind, failure.retryable);
  const resultStatus = retryable ? "retryable_failed" : "failed";
  const budgetStatus = observationKind === "blocked_by_policy" ? "blocked" : resultStatus;
  const budgetKind = resolveBudgetKind(observationKind);

  return {
    status: resultStatus,
    toolId: input.tool.id,
    capabilityId: failure.capabilityId,
    observation: createToolObservation({
      projectId: input.projectId,
      sourceMessageId: input.sourceMessageId,
      capabilityId: failure.capabilityId,
      expectedArtifactKind: input.tool.producedArtifactKind,
      kind: observationKind,
      teacherSafeSummary: failure.userMessage,
      internalReasonSanitized: failure.internalReason,
      retryPolicy: {
        retryable,
        nextAction: resolveRetryAction(observationKind, retryable),
      },
    }),
    artifactCreated: false,
    errorCategory: normalizedErrorCategory,
    budgetEvent: buildBudgetEvent(input, failure.capabilityId, budgetStatus, budgetKind),
  };
}

function createBlockedObservation(
  input: InternalCapabilityToolInput,
  capabilityId: string,
  details: { teacherSafeSummary: string; internalReasonSanitized: string },
) {
  return createToolObservation({
    projectId: input.projectId,
    sourceMessageId: input.sourceMessageId,
    capabilityId,
    expectedArtifactKind: input.tool.producedArtifactKind,
    kind: "blocked_by_policy",
    teacherSafeSummary: details.teacherSafeSummary,
    internalReasonSanitized: details.internalReasonSanitized,
    retryPolicy: {
      retryable: false,
      nextAction: "ask_teacher",
    },
  });
}

function normalizeErrorCategory(errorCategory: string): string {
  if (errorCategory === "permission") return "blocked_by_policy";
  return errorCategory;
}

function resolveObservationKind(errorCategory: string): ToolObservationKind {
  if (errorCategory === "blocked_by_policy") return "blocked_by_policy";
  if (errorCategory === "validation") return "quality_gate_failed";
  return "tool_failed";
}

function resolveBudgetKind(kind: ToolObservationKind): AgentHarnessBudgetEventKind {
  if (kind === "blocked_by_policy") return "blocked_by_policy";
  return kind === "quality_gate_failed" ? "quality_gate_failed" : "tool_failed";
}

function resolveRetryable(kind: ToolObservationKind, retryable: boolean): boolean {
  if (kind === "blocked_by_policy") return false;
  return retryable;
}

function resolveRetryAction(kind: ToolObservationKind, retryable: boolean): ToolObservationRetryAction {
  if (kind === "blocked_by_policy") return "ask_teacher";
  if (kind === "quality_gate_failed") return "fix_inputs";
  return retryable ? "retry_later" : "do_not_retry_automatically";
}

function buildBudgetEvent(
  input: InternalCapabilityToolInput,
  capabilityId: string,
  status: AgentHarnessBudgetEventStatus,
  kind: AgentHarnessBudgetEventKind,
) {
  return buildAgentHarnessBudgetEvent({
    capabilityId,
    actionKey: `${input.tool.id}:${input.tool.producedArtifactKind ?? ""}`,
    expectedArtifactKind: input.tool.producedArtifactKind,
    status,
    kind,
  });
}
