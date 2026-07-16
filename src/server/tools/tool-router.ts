import type { AgentProjectContext, AgentRuntime, ApprovedArtifactInput, BusinessSkillContext } from "@/server/agent-runtime/types";
import type { CapabilityId } from "@/server/capabilities/types";
import { createToolObservation, type ToolObservationKind, type ToolObservationRetryAction } from "@/server/capabilities/tool-observation";
import { buildAgentHarnessBudgetEvent, type AgentHarnessBudgetEventKind, type AgentHarnessBudgetEventStatus } from "@/server/conversation/agent-harness-budget";
import { createValidationReport, validateToolExecutionResult, validateToolPreconditions } from "@/server/contracts/contract-validator";
import type { ValidationReport } from "@/server/quality/quality-types";
import { hasValidExecutionEnvelope, type ExecutionEnvelope } from "@/server/conversation/task-contract";
import { withArtifactQualityState } from "@/server/quality/artifact-quality-state";
import type { ProjectRecord } from "@/server/workbench/types";
import type { ArtifactRecord } from "@/server/workbench/types";
import type { VideoGenerationTaskLifecycle } from "@/server/video-generation/video-generation-run";
import type { PptDirectorPlanBinding } from "@/server/ppt-quality/ppt-director-design-adapter";
import { executeInternalCapabilityTool, type InternalCapabilityToolInput } from "./internal-capability-tool-adapter";
import { executePackageTool, type PackageToolAdapterInput } from "./package-tool-adapter";
import { executeProviderTool, type ProviderArtifactRef, type ProviderToolAdapterInput } from "./provider-tool-adapter";
import { getToolDefinition, getToolDefinitionByCapabilityId } from "./tool-registry";
import { isVerifiedProviderToolSuccess, type RoutedToolExecutionResult, type ToolDefinition, type ToolExecutionResult } from "./tool-types";

export type ToolRouterInput = {
  toolName?: string;
  capabilityId?: string;
  projectId: string;
  userInstruction?: string | null;
  toolInput?: Record<string, unknown>;
  artifactRefs?: ProviderArtifactRef[];
  resolvedArtifacts?: ArtifactRecord[];
  runtime?: AgentRuntime;
  project?: ProjectRecord;
  projectContext?: AgentProjectContext;
  approvedArtifacts?: ApprovedArtifactInput[];
  sourceMessageId?: string;
  generationTaskLifecycle?: VideoGenerationTaskLifecycle;
  executionInputHash?: string;
  executionIntentEpoch?: number;
  pptDirectorPlan?: PptDirectorPlanBinding;
  executionEnvelope?: ExecutionEnvelope;
  businessSkillContext?: BusinessSkillContext;
};

export type ToolRouterDependencies = {
  internalExecutor?: (input: InternalCapabilityToolInput) => Promise<ToolExecutionResult>;
  providerExecutor?: (input: ProviderToolAdapterInput) => Promise<ToolExecutionResult>;
  packageExecutor?: (input: PackageToolAdapterInput) => Promise<ToolExecutionResult>;
  resolveToolDefinition?: (input: Pick<ToolRouterInput, "toolName" | "capabilityId">) => ToolDefinition;
};

export async function routeToolCall(input: ToolRouterInput, dependencies: ToolRouterDependencies = {}): Promise<ToolExecutionResult> {
  const tool = resolveToolDefinition(input, dependencies);
  if (!tool) {
    return withUnknownToolValidation(input, buildBlockedResult({
      input,
      toolId: "unknown_tool",
      capabilityId: "unknown",
      expectedArtifactKind: undefined,
      teacherSafeSummary: "这一步暂时无法执行，请重新选择要处理的材料。",
      internalReason: "Unknown tool requested.",
      resultStatus: "failed",
      budgetStatus: "failed",
      budgetKind: "tool_failed",
      errorCategory: "unknown_tool",
      observationKind: "tool_failed",
      nextAction: "skip_or_replan",
    }));
  }

  const capabilityId = tool.capabilityId ?? "unknown";

  if (!tool.implemented || tool.blockedReason) {
    return withKnownToolFailureValidation(input, tool, buildBlockedResult({
      input,
      toolId: tool.id,
      capabilityId,
      expectedArtifactKind: tool.producedArtifactKind,
      teacherSafeSummary: "这项生成能力暂时还不能自动执行，请先继续完善前置材料或改走人工处理。",
      internalReason: tool.blockedReason ?? `Tool is not implemented: ${tool.id}`,
      resultStatus: "failed",
      budgetStatus: "failed",
      budgetKind: "tool_failed",
      errorCategory: "blocked_tool",
      observationKind: "tool_failed",
      nextAction: "skip_or_replan",
    }));
  }

  if (!input.executionEnvelope) {
    return withKnownToolFailureValidation(input, tool, buildBlockedResult({
      input,
      toolId: tool.id,
      capabilityId,
      expectedArtifactKind: tool.producedArtifactKind,
      teacherSafeSummary: "这一步缺少当前任务的执行信息，我会按当前任务重新规划。",
      internalReason: "ExecutionEnvelope is required.",
      resultStatus: "failed",
      budgetStatus: "failed",
      budgetKind: "tool_failed",
      errorCategory: "execution_envelope_required",
      observationKind: "tool_failed",
      nextAction: "skip_or_replan",
    }));
  }
  if (
    !hasValidExecutionEnvelope(input.executionEnvelope) ||
    input.executionEnvelope.projectId !== input.projectId ||
    input.executionEnvelope.intentEpoch !== input.executionIntentEpoch
  ) {
    return withKnownToolFailureValidation(input, tool, buildBlockedResult({
      input,
      toolId: tool.id,
      capabilityId,
      expectedArtifactKind: tool.producedArtifactKind,
      teacherSafeSummary: "这一步的任务版本已经变化，我会按当前任务重新规划。",
      internalReason: "Invalid or stale ExecutionEnvelope.",
      resultStatus: "failed",
      budgetStatus: "failed",
      budgetKind: "tool_failed",
      errorCategory: "invalid_execution_envelope",
      observationKind: "tool_failed",
      nextAction: "skip_or_replan",
    }));
  }
  const preValidationReport = validateToolPreconditions({
    tool,
    projectId: input.projectId,
    approvedArtifacts: input.approvedArtifacts,
    artifactRefs: input.artifactRefs,
    resolvedArtifacts: input.resolvedArtifacts,
    inputHash: input.executionInputHash,
    intentEpoch: input.executionIntentEpoch,
  });
  const missingArtifactKinds = preValidationReport.gates
    .filter((gate) => gate.status === "failed" && gate.gateId.startsWith("required_input:"))
    .map((gate) => gate.gateId.slice("required_input:".length));
  if (missingArtifactKinds.length > 0) {
    return buildNeedsInputResult(input, tool, capabilityId, missingArtifactKinds, preValidationReport);
  }

  if (tool.adapterKind === "internal_capability") {
    if (!input.runtime || !input.projectContext) {
      return withKnownToolFailureValidation(input, tool, buildBlockedResult({
        input,
        toolId: tool.id,
        capabilityId,
        expectedArtifactKind: tool.producedArtifactKind,
        teacherSafeSummary: "这一步暂时无法执行，请稍后重试。",
        internalReason: "Missing execution context for internal tool.",
        resultStatus: "failed",
        budgetStatus: "failed",
        budgetKind: "tool_failed",
        errorCategory: "router_missing_context",
        observationKind: "tool_failed",
        nextAction: "skip_or_replan",
      }));
    }

    const internalExecutor = dependencies.internalExecutor ?? executeInternalCapabilityTool;
    const result = await internalExecutor({
      tool,
      runtime: input.runtime,
      projectId: input.projectId,
      userMessage: input.userInstruction ?? "",
      taskInput: input.toolInput,
      projectContext: input.projectContext,
      approvedArtifacts: input.approvedArtifacts ?? [],
      sourceMessageId: input.sourceMessageId,
      inputDigest: input.executionInputHash,
      intentEpoch: input.executionIntentEpoch,
      pptDirectorPlan: input.pptDirectorPlan,
      businessSkillContext: input.businessSkillContext,
      executionEnvelope: input.executionEnvelope,
    });
    return attachPostValidation(input, tool, result);
  }

  if (tool.adapterKind === "provider") {
    const providerExecutor = dependencies.providerExecutor ?? executeProviderTool;
    const result = await providerExecutor({
      tool,
      projectId: input.projectId,
      project: input.project,
      userInstruction: input.userInstruction,
      toolInput: input.toolInput,
      artifactRefs: input.artifactRefs ?? [],
      resolvedArtifacts: input.resolvedArtifacts ?? [],
      sourceMessageId: input.sourceMessageId,
      generationTaskLifecycle: input.generationTaskLifecycle,
      businessSkillContext: input.businessSkillContext,
    });
    const validationReport = validateToolExecutionResult({
      tool,
      projectId: input.projectId,
      result,
      inputHash: input.executionInputHash,
      intentEpoch: input.executionIntentEpoch,
    });
    const validatedResult = { ...result, validationReport };
    if (validatedResult.status === "succeeded" && (!isVerifiedProviderToolSuccess(validatedResult) || validationReport.overallStatus !== "passed")) {
      return buildUnverifiedProviderResult(input, tool, result.provider, validationReport);
    }
    if (validatedResult.status !== "succeeded") return validatedResult;
    const downstreamEligibleResult: ToolExecutionResult = {
      ...validatedResult,
      artifactDraft: {
        ...validatedResult.artifactDraft,
        structuredContent: withArtifactQualityState(validatedResult.artifactDraft.structuredContent ?? {}, {
          validationStatus: "passed",
          reviewStatus: "passed",
          downstreamEligibility: "eligible",
        }),
      },
    };
    return {
      ...downstreamEligibleResult,
      validationReport: validateToolExecutionResult({
        tool,
        projectId: input.projectId,
        result: downstreamEligibleResult,
        inputHash: input.executionInputHash,
        intentEpoch: input.executionIntentEpoch,
      }),
    };
  }

  if (tool.adapterKind === "package") {
    const packageExecutor = dependencies.packageExecutor ?? executePackageTool;
    const result = await packageExecutor({
      tool,
      projectId: input.projectId,
      userInstruction: input.userInstruction,
      toolInput: input.toolInput,
      artifactRefs: input.artifactRefs ?? [],
      resolvedArtifacts: input.resolvedArtifacts ?? [],
      sourceMessageId: input.sourceMessageId,
      businessSkillContext: input.businessSkillContext,
    });
    return attachPostValidation(input, tool, result);
  }

  return withKnownToolFailureValidation(input, tool, buildBlockedResult({
    input,
    toolId: tool.id,
    capabilityId,
    expectedArtifactKind: tool.producedArtifactKind,
    teacherSafeSummary: "这类工具暂时不能自动执行，请选择其他处理方式。",
    internalReason: `Unsupported tool adapter kind: ${tool.adapterKind}`,
    resultStatus: "failed",
    budgetStatus: "failed",
    budgetKind: "tool_failed",
    errorCategory: "unsupported_tool_adapter",
    observationKind: "tool_failed",
    nextAction: "skip_or_replan",
  }));
}

export const executeTool = routeToolCall;

function resolveToolDefinition(input: ToolRouterInput, dependencies: ToolRouterDependencies): ToolDefinition | undefined {
  try {
    if (dependencies.resolveToolDefinition) {
      return dependencies.resolveToolDefinition({ toolName: input.toolName, capabilityId: input.capabilityId });
    }

    if (input.toolName) {
      return getToolDefinition(input.toolName);
    }

    if (input.capabilityId) {
      return getToolDefinitionByCapabilityId(input.capabilityId as CapabilityId);
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function buildNeedsInputResult(input: ToolRouterInput, tool: ToolDefinition, capabilityId: string, missingInputs: string[], validationReport: ValidationReport): RoutedToolExecutionResult {
  const assistantPrompt = "请先确认前置材料，再继续生成。";

  return {
    status: "needs_input",
    toolId: tool.id,
    capabilityId,
    provider: tool.adapterKind === "provider" ? tool.capabilityId : undefined,
    missingInputs,
    assistantPrompt,
    observation: createToolObservation({
      projectId: input.projectId,
      sourceMessageId: input.sourceMessageId,
      capabilityId,
      expectedArtifactKind: tool.producedArtifactKind,
      kind: "quality_gate_failed",
      teacherSafeSummary: assistantPrompt,
      internalReasonSanitized: `Missing required source artifacts: ${missingInputs.join(", ")}`,
      retryPolicy: {
        retryable: false,
        nextAction: "fix_inputs",
      },
    }),
    artifactCreated: false,
    budgetEvent: buildBudgetEvent(tool.id, capabilityId, tool.producedArtifactKind, "failed", "quality_gate_failed"),
    validationReport,
  };
}

function buildBlockedResult(details: {
  input: ToolRouterInput;
  toolId: string;
  capabilityId: string;
  expectedArtifactKind?: string;
  teacherSafeSummary: string;
  internalReason: string;
  resultStatus: "failed" | "retryable_failed";
  budgetStatus: AgentHarnessBudgetEventStatus;
  budgetKind: AgentHarnessBudgetEventKind;
  errorCategory: string;
  observationKind: ToolObservationKind;
  nextAction: ToolObservationRetryAction;
}): ToolExecutionResult {
  return {
    status: details.resultStatus,
    toolId: details.toolId,
    capabilityId: details.capabilityId,
    observation: createToolObservation({
      projectId: details.input.projectId,
      sourceMessageId: details.input.sourceMessageId,
      capabilityId: details.capabilityId,
      expectedArtifactKind: details.expectedArtifactKind,
      kind: details.observationKind,
      teacherSafeSummary: details.teacherSafeSummary,
      internalReasonSanitized: details.internalReason,
      retryPolicy: {
        retryable: false,
        nextAction: details.nextAction,
      },
    }),
    artifactCreated: false,
    errorCategory: details.errorCategory,
    budgetEvent: buildBudgetEvent(details.toolId, details.capabilityId, details.expectedArtifactKind, details.budgetStatus, details.budgetKind),
  };
}

function buildUnverifiedProviderResult(input: ToolRouterInput, tool: ToolDefinition, provider: string | undefined, validationReport: ValidationReport): RoutedToolExecutionResult {
  const capabilityId = tool.capabilityId ?? "unknown";
  const teacherSafeSummary = "生成结果没有通过交付校验，我没有保存这份结果。请稍后重试。";
  return {
    status: "failed",
    toolId: tool.id,
    capabilityId,
    provider,
    observation: createToolObservation({
      projectId: input.projectId,
      sourceMessageId: input.sourceMessageId,
      capabilityId,
      expectedArtifactKind: tool.producedArtifactKind,
      kind: "quality_gate_failed",
      teacherSafeSummary,
      internalReasonSanitized: "Provider success lacked artifact truth or a passing quality gate.",
      retryPolicy: { retryable: false, nextAction: "fix_inputs" },
    }),
    artifactCreated: false,
    errorCategory: "quality_gate_failed",
    budgetEvent: buildBudgetEvent(tool.id, capabilityId, tool.producedArtifactKind, "failed", "quality_gate_failed"),
    validationReport,
  };
}

function attachPostValidation(input: ToolRouterInput, tool: ToolDefinition, result: ToolExecutionResult): RoutedToolExecutionResult {
  const initialValidationReport = validateToolExecutionResult({
    tool,
    projectId: input.projectId,
    result,
    inputHash: input.executionInputHash,
    intentEpoch: input.executionIntentEpoch,
  });
  if (result.status === "succeeded" && initialValidationReport.overallStatus !== "passed") {
    return buildPostValidationFailureResult(input, tool, initialValidationReport);
  }
  if (result.status !== "succeeded" || tool.adapterKind !== "internal_capability") {
    return { ...result, validationReport: initialValidationReport };
  }

  const downstreamEligibleResult: ToolExecutionResult = {
    ...result,
    artifactDraft: {
      ...result.artifactDraft,
      structuredContent: withArtifactQualityState(result.artifactDraft.structuredContent ?? {}, {
        validationStatus: "passed",
        reviewStatus: "passed",
        ...resolveInternalDownstreamScope(result),
      }),
    },
  };
  const validationReport = validateToolExecutionResult({
    tool,
    projectId: input.projectId,
    result: downstreamEligibleResult,
    inputHash: input.executionInputHash,
    intentEpoch: input.executionIntentEpoch,
  });
  return { ...downstreamEligibleResult, validationReport };
}

function resolveInternalDownstreamScope(result: Extract<ToolExecutionResult, { status: "succeeded" }>) {
  const structuredContent = result.artifactDraft.structuredContent ?? {};
  const candidateOnly = result.capabilityId === "ppt_design" &&
    structuredContent.pptDesignCandidate !== undefined &&
    structuredContent.pptDesignPackage === undefined;
  return candidateOnly
    ? { downstreamEligibility: "blocked" as const, eligibleStages: ["production_design_expansion"] }
    : { downstreamEligibility: "eligible" as const };
}

function buildPostValidationFailureResult(input: ToolRouterInput, tool: ToolDefinition, validationReport: ValidationReport): RoutedToolExecutionResult {
  const capabilityId = tool.capabilityId ?? "unknown";
  return {
    status: "failed",
    toolId: tool.id,
    capabilityId,
    observation: createToolObservation({
      projectId: input.projectId,
      sourceMessageId: input.sourceMessageId,
      capabilityId,
      expectedArtifactKind: tool.producedArtifactKind,
      kind: "quality_gate_failed",
      teacherSafeSummary: "生成结果没有通过交付校验，我没有保存这份结果。",
      internalReasonSanitized: "Tool output failed deterministic runtime contract validation.",
      retryPolicy: { retryable: false, nextAction: "fix_inputs" },
    }),
    artifactCreated: false,
    errorCategory: "quality_gate_failed",
    budgetEvent: buildBudgetEvent(tool.id, capabilityId, tool.producedArtifactKind, "failed", "quality_gate_failed"),
    validationReport,
  };
}

function withKnownToolFailureValidation(
  input: ToolRouterInput,
  tool: ToolDefinition,
  result: ToolExecutionResult,
): RoutedToolExecutionResult {
  return {
    ...result,
    validationReport: validateToolExecutionResult({
      tool,
      projectId: input.projectId,
      result,
      inputHash: input.executionInputHash,
      intentEpoch: input.executionIntentEpoch,
    }),
  };
}

function withUnknownToolValidation(input: ToolRouterInput, result: ToolExecutionResult): RoutedToolExecutionResult {
  return {
    ...result,
    validationReport: createValidationReport({
      reportId: `unknown-tool:${input.projectId}:${Date.now()}`,
      createdAt: new Date().toISOString(),
      domain: "generic",
      stage: "unknown",
      target: { kind: "tool_execution", targetId: "unknown_tool" },
      contract: { id: "router:unknown_tool", version: "v1" },
      inputHash: input.executionInputHash,
      intentEpoch: input.executionIntentEpoch,
      overallStatus: "failed",
      gates: [{
        gateId: "known_tool",
        validatorId: "tool_router",
        validatorVersion: "v1",
        status: "failed",
        evidenceRefs: [],
        locators: [{ kind: "tool", toolId: "unknown_tool" }],
        responsibleStage: "unknown",
        reasonCode: "unknown_tool",
      }],
    }),
  };
}

function buildBudgetEvent(
  toolId: string,
  capabilityId: string,
  expectedArtifactKind: string | undefined,
  status: AgentHarnessBudgetEventStatus,
  kind: AgentHarnessBudgetEventKind,
) {
  return buildAgentHarnessBudgetEvent({
    capabilityId,
    actionKey: `${toolId}:${expectedArtifactKind ?? ""}`,
    expectedArtifactKind,
    status,
    kind,
  });
}
