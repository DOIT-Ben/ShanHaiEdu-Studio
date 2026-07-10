import { generateCozePptFromArtifact, type CozePptGenerationResult } from "@/server/coze-ppt/coze-ppt-run";
import { createToolObservation, type ToolObservationKind, type ToolObservationRetryAction } from "@/server/capabilities/tool-observation";
import { buildAgentHarnessBudgetEvent, type AgentHarnessBudgetEventKind, type AgentHarnessBudgetEventStatus } from "@/server/conversation/agent-harness-budget";
import { generateImageFromArtifact, type ImageGenerationResult } from "@/server/image-generation/image-generation-run";
import { assertVideoProviderPreconditions, generateVideoFromArtifact, type VideoGenerationResult } from "@/server/video-generation/video-generation-run";
import type { ArtifactRecord, ProjectRecord } from "@/server/workbench/types";
import type { ToolArtifactTruth, ToolDefinition, ToolExecutionResult, ToolQualityGateResult } from "./tool-types";

export type ProviderArtifactRef = {
  kind: string;
  artifactId: string;
  title?: string;
  summary?: string;
  markdownContent?: string;
  structuredContent?: Record<string, unknown>;
};

export type RunCozePptProvider = (input: { project: ProjectRecord; artifact: ArtifactRecord }) => Promise<CozePptGenerationResult>;
export type RunImageProvider = (input: { project: ProjectRecord; artifact: ArtifactRecord }) => Promise<ImageGenerationResult>;
export type RunVideoProvider = (input: {
  project: ProjectRecord;
  artifact: ArtifactRecord;
  upstreamArtifacts?: ArtifactRecord[];
}) => Promise<VideoGenerationResult>;

export type ProviderToolAdapterInput = {
  tool: ToolDefinition;
  projectId: string;
  project?: ProjectRecord;
  userInstruction?: string | null;
  artifactRefs: ProviderArtifactRef[];
  resolvedArtifacts?: ArtifactRecord[];
  sourceMessageId?: string;
  runCozePpt?: RunCozePptProvider;
  runImage?: RunImageProvider;
  runVideo?: RunVideoProvider;
};

const COZE_PPT_PROVIDER = "coze_ppt";
const IMAGE_PROVIDER = "image_asset";
const VIDEO_PROVIDER = "video_segment_generate";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

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

  const missingArtifactKinds = findMissingArtifactKinds(input.tool.requiredArtifactKinds, input);
  if (missingArtifactKinds.length > 0) {
    return buildNeedsInputResult(input, capabilityId, provider, missingArtifactKinds);
  }

  if (!isCozePptTool(input.tool) && !isImageTool(input.tool) && !isVideoTool(input.tool)) {
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

  if (isImageTool(input.tool)) {
    return executeImageTool(input, capabilityId, provider);
  }

  if (isVideoTool(input.tool)) {
    return executeVideoTool(input, capabilityId, provider);
  }

  const sourceArtifact = findResolvedArtifact(input, "ppt_design_draft");
  if (!sourceArtifact) {
    return buildNeedsInputResult(input, capabilityId, provider, ["ppt_design_draft"]);
  }

  const runCozePpt = input.runCozePpt ?? generateCozePptFromArtifact;

  try {
    const result = await runCozePpt({
      project: input.project ?? buildProjectRecord(input.projectId),
      artifact: sourceArtifact,
    });

    return buildCozePptSuccessResult(input, capabilityId, sourceArtifact.id, result);
  } catch (error) {
    return buildFailureResult(input, classifyCozePptFailure(error, capabilityId, provider, input.tool.failurePolicy.retryable));
  }
}

async function executeImageTool(input: ProviderToolAdapterInput, capabilityId: string, provider: string | undefined): Promise<ToolExecutionResult> {
  const sourceArtifact = findResolvedArtifact(input, "ppt_draft");
  if (!sourceArtifact) {
    return buildNeedsInputResult(input, capabilityId, provider, ["ppt_draft"]);
  }

  try {
    const result = await (input.runImage ?? generateImageFromArtifact)({
      project: input.project ?? buildProjectRecord(input.projectId),
      artifact: sourceArtifact,
    });
    return buildImageSuccessResult(input, capabilityId, sourceArtifact.id, result);
  } catch (error) {
    return buildFailureResult(input, classifyMediaFailure(error, capabilityId, provider, input.tool.failurePolicy.retryable, "image"));
  }
}

async function executeVideoTool(input: ProviderToolAdapterInput, capabilityId: string, provider: string | undefined): Promise<ToolExecutionResult> {
  const sourceArtifact = findResolvedArtifact(input, "video_segment_plan");
  const storyboard = findResolvedArtifact(input, "storyboard_generate");
  const assetImages = findResolvedArtifact(input, "asset_image_generate");
  const missingInputs = [
    !sourceArtifact ? "video_segment_plan" : null,
    !storyboard ? "storyboard_generate" : null,
    !assetImages ? "asset_image_generate" : null,
  ].filter((kind): kind is string => kind !== null);
  if (!sourceArtifact || !storyboard || !assetImages) {
    return buildNeedsInputResult(input, capabilityId, provider, missingInputs);
  }

  const artifact = sourceArtifact;
  const upstreamArtifacts = [storyboard, assetImages];

  try {
    assertVideoProviderPreconditions({ artifact, upstreamArtifacts });
    const result = await (input.runVideo ?? generateVideoFromArtifact)({
      project: input.project ?? buildProjectRecord(input.projectId),
      artifact,
      upstreamArtifacts,
    });
    return buildVideoSuccessResult(input, capabilityId, [sourceArtifact.id, storyboard.id, assetImages.id], result);
  } catch (error) {
    return buildFailureResult(input, classifyMediaFailure(error, capabilityId, provider, input.tool.failurePolicy.retryable, "video"));
  }
}

function buildImageSuccessResult(
  input: ProviderToolAdapterInput,
  capabilityId: string,
  sourceArtifactId: string,
  providerResult: ImageGenerationResult,
): ToolExecutionResult {
  const artifactTruth = buildProviderArtifactTruth(input, "image_prompts");
  const qualityGate = { passed: true, gates: ["image_valid", "supported_image_mime"] } satisfies ToolQualityGateResult;
  const providerPayload = { provider: IMAGE_PROVIDER, ...providerResult, sourceArtifactId, artifactTruth, qualityGate };
  const structuredContent = {
    文件状态: "真实课堂视觉图已生成",
    文件大小: `${providerResult.bytes} bytes`,
    文件类型: providerResult.mime,
    storage: {
      imageAsset: {
        fileName: providerResult.fileName,
        localOutput: providerResult.localOutput,
        bytes: providerResult.bytes,
        sha256: providerResult.sha256,
        mime: providerResult.mime,
        generationMode: "image_generated",
        sourceArtifactId,
      },
    },
    artifactTruth,
    qualityGate,
  };

  return {
    status: "succeeded",
    toolId: input.tool.id,
    capabilityId,
    provider: IMAGE_PROVIDER,
    artifactTruth,
    qualityGate,
    artifactDraft: {
      nodeKey: input.tool.producedArtifactKind ?? "image_prompts",
      kind: input.tool.producedArtifactKind ?? "image_prompts",
      title: "真实课堂视觉图",
      summary: "已生成一张可用于课件导入页的课堂视觉图，请核对画面内容。",
      markdownContent: "# 真实课堂视觉图\n\n已基于当前 PPT 大纲生成课堂视觉图。",
      structuredContent,
    },
    providerPayload,
    assistantSummary: "真实课堂视觉图已生成并通过基础校验。",
    budgetEvent: buildBudgetEvent(input, capabilityId, "succeeded", "tool_succeeded"),
  };
}

function buildVideoSuccessResult(
  input: ProviderToolAdapterInput,
  capabilityId: string,
  sourceArtifactIds: string[],
  providerResult: VideoGenerationResult,
): ToolExecutionResult {
  const artifactTruth = buildProviderArtifactTruth(input, "video_segment_generate");
  const qualityGate = { passed: true, gates: ["video_valid", "mp4_ftyp_present", "mp4_moov_present"] } satisfies ToolQualityGateResult;
  const providerPayload = { provider: VIDEO_PROVIDER, ...providerResult, sourceArtifactIds, artifactTruth, qualityGate };
  const structuredContent = {
    文件状态: "真实分镜视频片段已生成",
    文件大小: `${providerResult.bytes} bytes`,
    文件类型: providerResult.mime,
    storage: {
      videoAsset: {
        fileName: providerResult.fileName,
        localOutput: providerResult.localOutput,
        bytes: providerResult.bytes,
        sha256: providerResult.sha256,
        mime: providerResult.mime,
        generationMode: "video_generated",
        sourceArtifactId: sourceArtifactIds[0],
        sourceArtifactIds,
      },
    },
    artifactTruth,
    qualityGate,
  };

  return {
    status: "succeeded",
    toolId: input.tool.id,
    capabilityId,
    provider: VIDEO_PROVIDER,
    artifactTruth,
    qualityGate,
    artifactDraft: {
      nodeKey: input.tool.producedArtifactKind ?? "video_segment_generate",
      kind: input.tool.producedArtifactKind ?? "video_segment_generate",
      title: "真实分镜视频片段",
      summary: "已生成一段分镜视频，请核对画面、节奏和课堂锚点。",
      markdownContent: "# 真实分镜视频片段\n\n已基于当前分镜视频计划生成 MP4 视频。",
      structuredContent,
    },
    providerPayload,
    assistantSummary: "真实分镜视频片段已生成并通过基础校验。",
    budgetEvent: buildBudgetEvent(input, capabilityId, "succeeded", "tool_succeeded"),
  };
}

function classifyMediaFailure(
  error: unknown,
  capabilityId: string,
  provider: string | undefined,
  providerRetryable: boolean,
  media: "image" | "video",
): Parameters<typeof buildFailureResult>[1] {
  const internalReason = error instanceof Error ? error.message : `Unknown ${media} provider error`;
  if (internalReason.toLowerCase().includes(`invalid_${media}_output`)) {
    return {
      capabilityId,
      provider,
      status: "failed",
      kind: "quality_gate_failed",
      userMessage: media === "image" ? "课堂视觉图没有通过交付校验，请调整输入后再继续。" : "分镜视频没有通过交付校验，请调整输入后再继续。",
      internalReason,
      retryable: false,
      errorCategory: "quality_gate_failed",
    };
  }

  return {
    capabilityId,
    provider,
    status: providerRetryable ? "retryable_failed" : "failed",
    kind: "provider_unavailable",
    userMessage: media === "image" ? "课堂视觉图生成服务暂时没有完成这一步，可以稍后重试。" : "分镜视频生成服务暂时没有完成这一步，可以稍后重试。",
    internalReason,
    retryable: providerRetryable,
    errorCategory: "provider_unavailable",
  };
}

function buildCozePptSuccessResult(
  input: ProviderToolAdapterInput,
  capabilityId: string,
  sourceArtifactId: string,
  providerResult: CozePptGenerationResult,
): ToolExecutionResult {
  const artifactTruth = buildCozePptArtifactTruth(input);
  const qualityGate = buildCozePptQualityGate();
  const providerPayload = cozePptPayload(providerResult, artifactTruth, qualityGate);
  const pageLabel = `${providerResult.slideCount} 页`;
  const structuredContent = {
    文件状态: `真实 ${pageLabel} PPTX 已生成`,
    文件大小: `${providerResult.bytes} bytes`,
    实际页数: pageLabel,
    目标页数: `${providerResult.requestedPageCount} 页`,
    storage: {
      cozePptx: {
        fileName: providerResult.fileName,
        localOutput: providerResult.localOutput,
        bytes: providerResult.bytes,
        sha256: providerResult.sha256,
        slideCount: providerResult.slideCount,
        requestedPageCount: providerResult.requestedPageCount,
        generationMode: "coze_generated",
        sourceArtifactId,
      },
    },
    artifactTruth,
    qualityGate,
  };

  return {
    status: "succeeded",
    toolId: input.tool.id,
    capabilityId,
    provider: COZE_PPT_PROVIDER,
    artifactTruth,
    qualityGate,
    artifactDraft: {
      nodeKey: input.tool.producedArtifactKind ?? "pptx_artifact",
      kind: input.tool.producedArtifactKind ?? "pptx_artifact",
      title: `真实 ${pageLabel} PPTX 文件`,
      summary: `已生成并校验 ${providerResult.slideCount} 页 PPTX。`,
      structuredContent,
    },
    providerPayload,
    assistantSummary: `真实 PPTX 已生成并通过基础校验：${providerResult.slideCount} 页。`,
    budgetEvent: buildBudgetEvent(input, capabilityId, "succeeded", "tool_succeeded"),
  };
}

function classifyCozePptFailure(
  error: unknown,
  capabilityId: string,
  provider: string | undefined,
  providerRetryable: boolean,
): Parameters<typeof buildFailureResult>[1] {
  const internalReason = error instanceof Error ? error.message : "Unknown coze_ppt provider error";

  if (isCozePptQualityGateFailure(internalReason)) {
    return {
      capabilityId,
      provider,
      status: "failed",
      kind: "quality_gate_failed",
      userMessage: "PPTX 没有通过交付校验，请先调整设计稿或生成结果后再继续。",
      internalReason,
      retryable: false,
      errorCategory: "quality_gate_failed",
    };
  }

  return {
    capabilityId,
    provider,
    status: providerRetryable ? "retryable_failed" : "failed",
    kind: "provider_unavailable",
    userMessage: "PPTX 生成服务暂时没有完成这一步，可以稍后重试。",
    internalReason,
    retryable: providerRetryable,
    errorCategory: "provider_unavailable",
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

function cozePptPayload(result: CozePptGenerationResult, artifactTruth: ToolArtifactTruth, qualityGate: ToolQualityGateResult): Record<string, unknown> {
  return {
    provider: COZE_PPT_PROVIDER,
    fileName: result.fileName,
    localOutput: result.localOutput,
    mime: PPTX_MIME,
    bytes: result.bytes,
    sha256: result.sha256,
    requestedPageCount: result.requestedPageCount,
    slideCount: result.slideCount,
    pptxValid: result.pptxValid,
    hasPresentationXml: result.hasPresentationXml,
    artifactTruth,
    qualityGate,
  };
}

function buildCozePptArtifactTruth(input: ProviderToolAdapterInput): ToolArtifactTruth {
  return buildProviderArtifactTruth(input, "pptx_artifact");
}

function buildProviderArtifactTruth(input: ProviderToolAdapterInput, fallbackKind: string): ToolArtifactTruth {
  return {
    created: true,
    persisted: true,
    persistenceScope: "provider_local_file",
    providerPersisted: true,
    workbenchPersisted: false,
    placeholder: false,
    producedArtifactKind: input.tool.producedArtifactKind ?? fallbackKind,
  };
}

function buildCozePptQualityGate(): ToolQualityGateResult {
  return {
    passed: true,
    gates: ["pptx_valid", "presentation_xml_present", "slide_count_matches_design"],
  };
}

function isCozePptQualityGateFailure(reason: string): boolean {
  const normalized = reason.toLowerCase();
  return (
    normalized.includes("invalid ppt design") ||
    normalized.includes("invalid_ppt_design") ||
    normalized.includes("invalid pptx") ||
    normalized.includes("invalid_pptx") ||
    normalized.includes("invalid_coze_pptx") ||
    normalized.includes("slide count mismatch") ||
    normalized.includes("slide_count_mismatch") ||
    normalized.includes("validation failed") ||
    normalized.includes("quality gate") ||
    normalized.includes("quality_gate") ||
    reason.includes("PPT 设计稿未逐页完整") ||
    reason.includes("范围合并页") ||
    reason.includes("独立四层设计")
  );
}

function isCozePptTool(tool: ToolDefinition): boolean {
  return tool.capabilityId === COZE_PPT_PROVIDER && tool.providerToolId === "coze_ppt.generate_pptx";
}

function isImageTool(tool: ToolDefinition): boolean {
  return tool.id === "generate_classroom_image" && tool.capabilityId === IMAGE_PROVIDER && tool.providerToolId === "image_asset.generate";
}

function isVideoTool(tool: ToolDefinition): boolean {
  return tool.id === "generate_video_segment" && tool.capabilityId === VIDEO_PROVIDER && tool.providerToolId === "video_segment_generate.generate";
}

function resolveProvider(tool: ToolDefinition): string | undefined {
  if (tool.capabilityId === COZE_PPT_PROVIDER || tool.providerToolId?.startsWith("coze_ppt.")) return COZE_PPT_PROVIDER;
  return tool.capabilityId;
}

function findMissingArtifactKinds(requiredArtifactKinds: string[], input: ProviderToolAdapterInput): string[] {
  return requiredArtifactKinds.filter((kind) => !findResolvedArtifact(input, kind));
}

function findResolvedArtifact(input: ProviderToolAdapterInput, kind: string): ArtifactRecord | undefined {
  for (let index = input.artifactRefs.length - 1; index >= 0; index -= 1) {
    const artifactRef = input.artifactRefs[index];
    if (artifactRef.kind !== kind || !artifactRef.artifactId.trim()) continue;
    const resolved = (input.resolvedArtifacts ?? []).find(
      (artifact) =>
        artifact.id === artifactRef.artifactId &&
        artifact.projectId === input.projectId &&
        artifact.kind === kind &&
        artifact.nodeKey === kind &&
        artifact.status === "approved" &&
        artifact.isApproved === true,
    );
    if (resolved) return resolved;
  }
  return undefined;
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
  if (kind === "quality_gate_failed") return "ask_teacher";
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
