import { generateCozePptFromArtifact, type CozePptGenerationResult } from "@/server/coze-ppt/coze-ppt-run";
import { createToolObservation, type ToolObservationKind, type ToolObservationRetryAction } from "@/server/capabilities/tool-observation";
import { buildAgentHarnessBudgetEvent, type AgentHarnessBudgetEventKind, type AgentHarnessBudgetEventStatus } from "@/server/conversation/agent-harness-budget";
import type { ArtifactRecord, ProjectRecord } from "@/server/workbench/types";
import type { ToolDefinition, ToolExecutionResult } from "./tool-types";

export type ProviderArtifactRef = {
  kind: string;
  artifactId: string;
  title?: string;
  summary?: string;
  markdownContent?: string;
  structuredContent?: Record<string, unknown>;
};

export type RunCozePptProvider = (input: { project: ProjectRecord; artifact: ArtifactRecord }) => Promise<CozePptGenerationResult>;

export type ProviderToolAdapterInput = {
  tool: ToolDefinition;
  projectId: string;
  userInstruction?: string | null;
  artifactRefs: ProviderArtifactRef[];
  sourceMessageId?: string;
  runCozePpt?: RunCozePptProvider;
};

const COZE_PPT_PROVIDER = "coze_ppt";

export async function executeProviderTool(input: ProviderToolAdapterInput): Promise<ToolExecutionResult> {
  const capabilityId = input.tool.capabilityId ?? "unknown";
  const provider = resolveProvider(input.tool);

  if (input.tool.adapterKind !== "provider" || !input.tool.implemented) {
    return buildFailureResult(input, {
      capabilityId,
      provider,
      status: "failed",
      kind: "tool_failed",
      userMessage: "这一步暂时无法执行，请先确认当前材料是否完整。",
      internalReason: input.tool.blockedReason ?? `Unsupported provider tool: ${input.tool.id}`,
      retryable: false,
      errorCategory: "unsupported_provider_tool",
    });
  }

  const missingArtifactKinds = findMissingArtifactKinds(input.tool.requiredArtifactKinds, input.artifactRefs);
  if (missingArtifactKinds.length > 0) {
    return buildNeedsInputResult(input, capabilityId, provider, missingArtifactKinds);
  }

  if (!isCozePptTool(input.tool)) {
    return buildFailureResult(input, {
      capabilityId,
      provider,
      status: "failed",
      kind: "tool_failed",
      userMessage: "这类素材生成暂时还没有接入自动执行，请先继续完善前置材料。",
      internalReason: `Unsupported provider adapter target: ${input.tool.id}`,
      retryable: false,
      errorCategory: "unsupported_provider",
    });
  }

  const sourceArtifact = findArtifactRef(input.artifactRefs, "ppt_design_draft");
  if (!sourceArtifact) {
    return buildNeedsInputResult(input, capabilityId, provider, ["ppt_design_draft"]);
  }

  const runCozePpt = input.runCozePpt ?? generateCozePptFromArtifact;

  try {
    const result = await runCozePpt({
      project: buildProjectRecord(input.projectId),
      artifact: buildArtifactRecord(input.projectId, sourceArtifact, "ppt_design_draft"),
    });

    return buildCozePptSuccessResult(input, capabilityId, result);
  } catch (error) {
    const retryable = input.tool.failurePolicy.retryable;
    return buildFailureResult(input, {
      capabilityId,
      provider,
      status: retryable ? "retryable_failed" : "failed",
      kind: "provider_unavailable",
      userMessage: "PPTX 生成服务暂时没有完成这一步，可以稍后重试。",
      internalReason: error instanceof Error ? error.message : "Unknown coze_ppt provider error",
      retryable,
      errorCategory: "provider_unavailable",
    });
  }
}

function buildCozePptSuccessResult(input: ProviderToolAdapterInput, capabilityId: string, providerResult: CozePptGenerationResult): ToolExecutionResult {
  const providerPayload = cozePptPayload(providerResult);

  return {
    status: "succeeded",
    toolId: input.tool.id,
    capabilityId,
    provider: COZE_PPT_PROVIDER,
    artifactDraft: {
      nodeKey: input.tool.producedArtifactKind ?? "pptx_artifact",
      kind: input.tool.producedArtifactKind ?? "pptx_artifact",
      title: "真实 PPTX 文件",
      summary: `已生成并校验 ${providerResult.slideCount} 页 PPTX。`,
      structuredContent: providerPayload,
    },
    providerPayload,
    assistantSummary: `真实 PPTX 已生成并通过基础校验：${providerResult.slideCount} 页。`,
    budgetEvent: buildBudgetEvent(input, capabilityId, "succeeded", "tool_succeeded"),
  };
}

function buildNeedsInputResult(input: ProviderToolAdapterInput, capabilityId: string, provider: string | undefined, missingInputs: string[]): ToolExecutionResult {
  const assistantPrompt = "请先确认前置材料，再继续生成真实文件。";

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
      kind: "blocked_by_policy",
      teacherSafeSummary: assistantPrompt,
      internalReasonSanitized: `Missing required source artifacts: ${missingInputs.join(", ")}`,
      retryPolicy: {
        retryable: false,
        nextAction: "ask_teacher",
      },
    }),
    artifactCreated: false,
    budgetEvent: buildBudgetEvent(input, capabilityId, "blocked", "blocked_by_policy"),
  };
}

function buildFailureResult(
  input: ProviderToolAdapterInput,
  failure: {
    capabilityId: string;
    provider?: string;
    status: "failed" | "retryable_failed";
    kind: ToolObservationKind;
    userMessage: string;
    internalReason: string;
    retryable: boolean;
    errorCategory: string;
  },
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
      retryPolicy: {
        retryable: failure.retryable,
        nextAction: resolveRetryAction(failure.kind, failure.retryable),
      },
    }),
    artifactCreated: false,
    errorCategory: failure.errorCategory,
    budgetEvent: buildBudgetEvent(input, failure.capabilityId, resolveBudgetStatus(failure.kind, failure.status), resolveBudgetKind(failure.kind)),
  };
}

function cozePptPayload(result: CozePptGenerationResult): Record<string, unknown> {
  return {
    provider: COZE_PPT_PROVIDER,
    fileName: result.fileName,
    localOutput: result.localOutput,
    bytes: result.bytes,
    sha256: result.sha256,
    requestedPageCount: result.requestedPageCount,
    slideCount: result.slideCount,
    pptxValid: result.pptxValid,
    hasPresentationXml: result.hasPresentationXml,
  };
}

function isCozePptTool(tool: ToolDefinition): boolean {
  return tool.capabilityId === COZE_PPT_PROVIDER && tool.providerToolId === "coze_ppt.generate_pptx";
}

function resolveProvider(tool: ToolDefinition): string | undefined {
  if (tool.capabilityId === COZE_PPT_PROVIDER || tool.providerToolId?.startsWith("coze_ppt.")) return COZE_PPT_PROVIDER;
  return tool.capabilityId;
}

function findMissingArtifactKinds(requiredArtifactKinds: string[], artifactRefs: ProviderArtifactRef[]): string[] {
  return requiredArtifactKinds.filter((kind) => !findArtifactRef(artifactRefs, kind));
}

function findArtifactRef(artifactRefs: ProviderArtifactRef[], kind: string): ProviderArtifactRef | undefined {
  return artifactRefs.find((artifactRef) => artifactRef.kind === kind && artifactRef.artifactId.trim().length > 0);
}

function buildProjectRecord(projectId: string): ProjectRecord {
  const now = new Date().toISOString();
  return {
    id: projectId,
    title: "ShanHaiEdu 项目",
    status: "active",
    currentNodeKey: "ppt_design_draft",
    grade: null,
    subject: null,
    textbookVersion: null,
    lessonTopic: null,
    createdAt: now,
    updatedAt: now,
  };
}

function buildArtifactRecord(projectId: string, artifactRef: ProviderArtifactRef, fallbackKind: ArtifactRecord["kind"]): ArtifactRecord {
  const now = new Date().toISOString();
  const kind = (artifactRef.kind || fallbackKind) as ArtifactRecord["kind"];
  return {
    id: artifactRef.artifactId,
    projectId,
    nodeKey: kind,
    title: artifactRef.title ?? "已确认材料",
    kind,
    status: "approved",
    summary: artifactRef.summary ?? "已确认的前置材料。",
    markdownContent: artifactRef.markdownContent ?? "",
    structuredContent: artifactRef.structuredContent ?? {},
    version: 1,
    isApproved: true,
    createdAt: now,
    updatedAt: now,
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

function buildBudgetEvent(input: ProviderToolAdapterInput, capabilityId: string, status: AgentHarnessBudgetEventStatus, kind: AgentHarnessBudgetEventKind) {
  return buildAgentHarnessBudgetEvent({
    capabilityId,
    actionKey: `${input.tool.id}:${input.tool.producedArtifactKind ?? ""}`,
    expectedArtifactKind: input.tool.producedArtifactKind,
    status,
    kind,
  });
}
