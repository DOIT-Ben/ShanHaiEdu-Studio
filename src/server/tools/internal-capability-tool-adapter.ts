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
        artifactCreated: false,
        budgetEvent: buildBudgetEvent(input, capabilityId, "failed", "tool_failed"),
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
  const observationKind = resolveObservationKind(failure.errorCategory);
  const budgetStatus = failure.retryable ? "retryable_failed" : "failed";
  const budgetKind = resolveBudgetKind(observationKind);

  return {
    status: budgetStatus,
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
        retryable: failure.retryable,
        nextAction: resolveRetryAction(observationKind, failure.retryable),
      },
    }),
    artifactCreated: false,
    errorCategory: failure.errorCategory,
    budgetEvent: buildBudgetEvent(input, failure.capabilityId, budgetStatus, budgetKind),
  };
}

function resolveObservationKind(errorCategory: string): ToolObservationKind {
  if (errorCategory === "validation") return "quality_gate_failed";
  return "tool_failed";
}

function resolveBudgetKind(kind: ToolObservationKind): AgentHarnessBudgetEventKind {
  return kind === "quality_gate_failed" ? "quality_gate_failed" : "tool_failed";
}

function resolveRetryAction(kind: ToolObservationKind, retryable: boolean): ToolObservationRetryAction {
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
