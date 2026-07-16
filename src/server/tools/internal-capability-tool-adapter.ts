import type { AgentProjectContext, AgentRuntime, ApprovedArtifactInput, BusinessSkillContext } from "@/server/agent-runtime/types";
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
import type { ExecutionEnvelope } from "@/server/conversation/task-contract";
import {
  adaptPptDirectorOutputToDesignArtifact,
  type PptDirectorPlanBinding,
} from "@/server/ppt-quality/ppt-director-design-adapter";

export type InternalCapabilityToolInput = {
  tool: ToolDefinition;
  runtime: AgentRuntime;
  projectId: string;
  userMessage: string;
  taskInput?: Record<string, unknown>;
  projectContext: AgentProjectContext;
  approvedArtifacts?: ApprovedArtifactInput[];
  sourceMessageId?: string;
  inputDigest?: string;
  intentEpoch?: number;
  pptDirectorPlan?: PptDirectorPlanBinding;
  businessSkillContext?: BusinessSkillContext;
  executionEnvelope?: ExecutionEnvelope;
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

  if (capabilityId === "ppt_design" && hasCurrentPptDirectorPlan(input)) {
    return executePptDirectorDesign(input);
  }

  try {
    const result = await runCapability({
      runtime: input.runtime,
      projectId: input.projectId,
      capabilityId,
      userMessage: input.userMessage,
      taskInput: input.taskInput,
      projectContext: input.projectContext,
      approvedArtifacts: input.approvedArtifacts ?? [],
      businessSkillContext: input.businessSkillContext,
      sourceMessageId: input.sourceMessageId,
      executionEnvelope: input.executionEnvelope,
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
        observation: createNeedsInputObservation(input, capabilityId, {
          teacherSafeSummary: result.assistantPrompt,
          internalReasonSanitized: `Missing required inputs: ${result.missingInputs.join(", ")}`,
        }),
        artifactCreated: false,
        budgetEvent: buildBudgetEvent(input, capabilityId, "failed", "quality_gate_failed"),
      };
    }

    return buildFailureResult(input, {
      capabilityId,
      userMessage: result.userMessage,
      internalReason: `${result.errorCategory}: ${result.userMessage}`,
      retryable: result.retryable,
      errorCategory: result.errorCategory,
      reasonCode: result.reasonCode,
      reasonDetails: result.reasonDetails,
      runtimeRun: result.runtimeRun,
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

function executePptDirectorDesign(input: InternalCapabilityToolInput): ToolExecutionResult {
  const binding = input.pptDirectorPlan!;
  try {
    const artifactDraft = adaptPptDirectorOutputToDesignArtifact({
      invocationId: binding.invocationId,
      structuredOutput: binding.structuredOutput,
      approvedArtifactRefs: binding.approvedArtifactRefs,
    });
    return {
      status: "succeeded",
      toolId: input.tool.id,
      capabilityId: "ppt_design",
      artifactDraft,
      assistantSummary: "逐页课件设计已完成并通过最低可信结构检查。",
      budgetEvent: buildBudgetEvent(input, "ppt_design", "succeeded", "tool_succeeded"),
    };
  } catch (error) {
    return buildFailureResult(input, {
      capabilityId: "ppt_design",
      userMessage: "逐页课件设计没有通过完整性检查，我会按问题位置重新规划。",
      internalReason: error instanceof Error ? error.message : "ppt_director_output_invalid",
      retryable: false,
      errorCategory: "validation",
    });
  }
}

function hasCurrentPptDirectorPlan(input: InternalCapabilityToolInput): boolean {
  return Boolean(
    input.pptDirectorPlan &&
    input.pptDirectorPlan.projectId === input.projectId &&
    input.pptDirectorPlan.intentEpoch === input.intentEpoch,
  );
}

function buildFailureResult(
  input: InternalCapabilityToolInput,
  failure: {
    capabilityId: string;
    userMessage: string;
    internalReason: string;
    retryable: boolean;
    errorCategory: string;
    reasonCode?: string;
    reasonDetails?: string[];
    runtimeRun?: Extract<CapabilityRunResult, { status: "failed" }>["runtimeRun"];
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
      runId: failure.runtimeRun?.runId,
      sourceMessageId: input.sourceMessageId,
      inputDigest: input.inputDigest,
      errorCategory: normalizedErrorCategory,
      reasonCode: failure.reasonCode,
      reasonDetails: failure.reasonDetails,
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
    reasonCode: failure.reasonCode,
    reasonDetails: failure.reasonDetails ? [...failure.reasonDetails] : undefined,
    budgetEvent: buildBudgetEvent(input, failure.capabilityId, budgetStatus, budgetKind),
  };
}

function createNeedsInputObservation(
  input: InternalCapabilityToolInput,
  capabilityId: string,
  details: { teacherSafeSummary: string; internalReasonSanitized: string },
) {
  return createToolObservation({
    projectId: input.projectId,
    sourceMessageId: input.sourceMessageId,
    capabilityId,
    expectedArtifactKind: input.tool.producedArtifactKind,
    kind: "quality_gate_failed",
    teacherSafeSummary: details.teacherSafeSummary,
    internalReasonSanitized: details.internalReasonSanitized,
    retryPolicy: {
      retryable: false,
      nextAction: "fix_inputs",
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
