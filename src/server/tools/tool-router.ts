import type { AgentProjectContext, AgentRuntime, ApprovedArtifactInput } from "@/server/agent-runtime/types";
import type { CapabilityId } from "@/server/capabilities/types";
import { createToolObservation } from "@/server/capabilities/tool-observation";
import { buildAgentHarnessBudgetEvent, type AgentHarnessBudgetEventKind, type AgentHarnessBudgetEventStatus } from "@/server/conversation/agent-harness-budget";
import { executeInternalCapabilityTool, type InternalCapabilityToolInput } from "./internal-capability-tool-adapter";
import { executeProviderTool, type ProviderArtifactRef, type ProviderToolAdapterInput } from "./provider-tool-adapter";
import { getToolDefinition, getToolDefinitionByCapabilityId } from "./tool-registry";
import type { ToolDefinition, ToolExecutionResult } from "./tool-types";

export type ToolRouterInput = {
  toolName?: string;
  capabilityId?: string;
  projectId: string;
  userInstruction?: string | null;
  artifactRefs?: ProviderArtifactRef[];
  runtime?: AgentRuntime;
  projectContext?: AgentProjectContext;
  approvedArtifacts?: ApprovedArtifactInput[];
  sourceMessageId?: string;
};

export type ToolRouterDependencies = {
  internalExecutor?: (input: InternalCapabilityToolInput) => Promise<ToolExecutionResult>;
  providerExecutor?: (input: ProviderToolAdapterInput) => Promise<ToolExecutionResult>;
  resolveToolDefinition?: (input: Pick<ToolRouterInput, "toolName" | "capabilityId">) => ToolDefinition;
};

export async function routeToolCall(input: ToolRouterInput, dependencies: ToolRouterDependencies = {}): Promise<ToolExecutionResult> {
  const tool = resolveToolDefinition(input, dependencies);
  if (!tool) {
    return buildBlockedResult({
      input,
      toolId: "unknown_tool",
      capabilityId: "unknown",
      expectedArtifactKind: undefined,
      teacherSafeSummary: "这一步暂时无法执行，请重新选择要处理的材料。",
      internalReason: "Unknown tool requested.",
      resultStatus: "failed",
      budgetStatus: "blocked",
      budgetKind: "blocked_by_policy",
      errorCategory: "unknown_tool",
    });
  }

  const capabilityId = tool.capabilityId ?? "unknown";

  if (!tool.implemented || tool.blockedReason) {
    return buildBlockedResult({
      input,
      toolId: tool.id,
      capabilityId,
      expectedArtifactKind: tool.producedArtifactKind,
      teacherSafeSummary: "这项生成能力暂时还不能自动执行，请先继续完善前置材料或改走人工处理。",
      internalReason: tool.blockedReason ?? `Tool is not implemented: ${tool.id}`,
      resultStatus: "failed",
      budgetStatus: "blocked",
      budgetKind: "blocked_by_policy",
      errorCategory: "blocked_tool",
    });
  }

  const missingArtifactKinds = findMissingArtifactKinds(tool, input);
  if (missingArtifactKinds.length > 0) {
    return buildNeedsInputResult(input, tool, capabilityId, missingArtifactKinds);
  }

  if (tool.adapterKind === "internal_capability") {
    if (!input.runtime || !input.projectContext) {
      return buildBlockedResult({
        input,
        toolId: tool.id,
        capabilityId,
        expectedArtifactKind: tool.producedArtifactKind,
        teacherSafeSummary: "这一步暂时无法执行，请稍后重试。",
        internalReason: "Missing execution context for internal tool.",
        resultStatus: "failed",
        budgetStatus: "blocked",
        budgetKind: "blocked_by_policy",
        errorCategory: "router_missing_context",
      });
    }

    const internalExecutor = dependencies.internalExecutor ?? executeInternalCapabilityTool;
    return internalExecutor({
      tool,
      runtime: input.runtime,
      projectId: input.projectId,
      userMessage: input.userInstruction ?? "",
      projectContext: input.projectContext,
      approvedArtifacts: input.approvedArtifacts ?? [],
      sourceMessageId: input.sourceMessageId,
    });
  }

  if (tool.adapterKind === "provider") {
    const providerExecutor = dependencies.providerExecutor ?? executeProviderTool;
    return providerExecutor({
      tool,
      projectId: input.projectId,
      userInstruction: input.userInstruction,
      artifactRefs: input.artifactRefs ?? [],
      sourceMessageId: input.sourceMessageId,
    });
  }

  return buildBlockedResult({
    input,
    toolId: tool.id,
    capabilityId,
    expectedArtifactKind: tool.producedArtifactKind,
    teacherSafeSummary: "这类工具暂时不能自动执行，请选择其他处理方式。",
    internalReason: `Unsupported tool adapter kind: ${tool.adapterKind}`,
    resultStatus: "failed",
    budgetStatus: "blocked",
    budgetKind: "blocked_by_policy",
    errorCategory: "unsupported_tool_adapter",
  });
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

function findMissingArtifactKinds(tool: ToolDefinition, input: ToolRouterInput): string[] {
  return tool.requiredArtifactKinds.filter((kind) => !hasArtifactRef(kind, input.artifactRefs) && !hasApprovedArtifact(kind, input.approvedArtifacts));
}

function hasArtifactRef(kind: string, artifactRefs: ProviderArtifactRef[] | undefined): boolean {
  return (artifactRefs ?? []).some((artifactRef) => artifactRef.kind === kind && artifactRef.artifactId.trim().length > 0);
}

function hasApprovedArtifact(kind: string, approvedArtifacts: ApprovedArtifactInput[] | undefined): boolean {
  return (approvedArtifacts ?? []).some((artifact) => artifact.nodeKey === kind);
}

function buildNeedsInputResult(input: ToolRouterInput, tool: ToolDefinition, capabilityId: string, missingInputs: string[]): ToolExecutionResult {
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
      kind: "blocked_by_policy",
      teacherSafeSummary: assistantPrompt,
      internalReasonSanitized: `Missing required source artifacts: ${missingInputs.join(", ")}`,
      retryPolicy: {
        retryable: false,
        nextAction: "ask_teacher",
      },
    }),
    artifactCreated: false,
    budgetEvent: buildBudgetEvent(tool.id, capabilityId, tool.producedArtifactKind, "blocked", "blocked_by_policy"),
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
      kind: "blocked_by_policy",
      teacherSafeSummary: details.teacherSafeSummary,
      internalReasonSanitized: details.internalReason,
      retryPolicy: {
        retryable: false,
        nextAction: "ask_teacher",
      },
    }),
    artifactCreated: false,
    errorCategory: details.errorCategory,
    budgetEvent: buildBudgetEvent(details.toolId, details.capabilityId, details.expectedArtifactKind, details.budgetStatus, details.budgetKind),
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
