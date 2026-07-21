import { createHash, randomUUID } from "node:crypto";
import { generateCozePptFromArtifact } from "@/server/coze-ppt/coze-ppt-run";
import { generateImageFromArtifact, generatePptAssetImage } from "@/server/image-generation/image-generation-run";
import { generatePptImageSlideBundle } from "@/server/ppt-image-slides/ppt-image-slide-generation";
import { PptAssetBatchExecutionError, runPptAssetBatch, type PptAssetBatchLifecycle, type PptAssetBatchRunResult } from "@/server/ppt-quality/ppt-asset-batch-run";
import type { PptDesignPackage } from "@/server/ppt-quality/ppt-quality-types";
import { validatePptDesignPackageForProviderProduction } from "@/server/ppt-quality/ppt-design-validator";
import { validatePptSampleApproval } from "@/server/ppt-quality/ppt-sample-validator";
import type { PptKeySampleSet, PptSampleApproval } from "@/server/ppt-quality/ppt-asset-types";
import {
  assertVideoProviderPreconditions,
  generateVideoFromArtifact,
} from "@/server/video-generation/video-generation-run";
import { writeLocalArtifact } from "@/server/artifact-storage/local-artifact-storage";
import { isArtifactTrustedForDownstream } from "@/server/quality/artifact-quality-state";
import { generateMiniMaxVideoNarration, VideoNarrationProviderError } from "@/server/video-generation/video-narration-provider";
import { validateVideoNarrationScript, type VideoNarrationScript } from "@/server/video-quality/video-narration-contract";
import type { ArtifactRecord, ProjectRecord } from "@/server/workbench/types";
import {
  findMissingArtifactKinds,
  findPrimarySourceArtifact,
  findResolvedArtifact,
} from "./provider-tool-artifact-resolution";
import type { ToolDefinition, ToolExecutionResult, ToolQualityGateResult } from "./tool-types";
import type { ProviderBusinessSkillInput, ProviderToolAdapterInput } from "./provider-tool-adapter-types";
export type {
  ProviderArtifactRef,
  ProviderToolAdapterInput,
  ResolveVideoShotProvider,
  RunCozePptProvider,
  RunImageProvider,
  RunPptAssetBatchProvider,
  RunPptImageSlideProvider,
  RunVideoNarrationProvider,
  RunVideoProvider,
} from "./provider-tool-adapter-types";
import { buildBudgetEvent, buildFailureResult, buildNeedsInputResult } from "./provider-tool-result-contract";
import { resolveDefaultVideoShotRequest } from "./provider-video-shot-request";
import {
  classifyCozePptFailure,
  classifyMediaFailure,
  classifyVideoNarrationFailure,
} from "./provider-tool-failure-classifier";
import {
  buildCozePptSuccessResult,
  buildImageSuccessResult,
  buildPptAssetSuccessResult,
  buildPptImageSlideSuccessResult,
  buildProviderArtifactTruth,
  buildVideoSuccessResult,
  resolveBusinessSkillProvenance,
} from "./provider-tool-success-result";
import { hashRunInput } from "@/server/execution/run-input-snapshot";

const COZE_PPT_PROVIDER = "coze_ppt";
const IMAGE_PROVIDER = "image_asset";
const PPT_SAMPLE_ASSET_PROVIDER = "ppt_sample_assets";
const PPT_FULL_ASSET_PROVIDER = "ppt_full_assets";
const PPT_IMAGE_SLIDE_PROVIDER = "ppt_image_slides";
const ASSET_IMAGE_PROVIDER = "asset_image_generate";
const VIDEO_PROVIDER = "video_segment_generate";
const VIDEO_NARRATION_PROVIDER = "tts_minimax";

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

  if (!isCozePptTool(input.tool) && !isImageTool(input.tool) && !isPptAssetTool(input.tool) && !isPptImageSlideTool(input.tool) && !isVideoTool(input.tool) && !isVideoNarrationTool(input.tool)) {
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

  if (isPptAssetTool(input.tool)) {
    return executePptAssetTool(input, capabilityId, provider);
  }

  if (isPptImageSlideTool(input.tool)) {
    return executePptImageSlideTool(input, capabilityId, provider);
  }

  if (isImageTool(input.tool)) {
    return executeImageTool(input, capabilityId, provider);
  }

  if (isVideoTool(input.tool)) {
    return executeVideoTool(input, capabilityId, provider);
  }

  if (isVideoNarrationTool(input.tool)) {
    return executeVideoNarrationTool(input, capabilityId, provider);
  }

  const sourceArtifact = findPrimarySourceArtifact(input);
  if (!sourceArtifact) {
    return buildNeedsInputResult(input, capabilityId, provider, ["ppt_design_draft"]);
  }

  const runCozePpt = input.runCozePpt ?? generateCozePptFromArtifact;

  try {
    const result = await runCozePpt({
      project: input.project ?? buildProjectRecord(input.projectId),
      artifact: sourceArtifact,
      ...providerBusinessSkillInput(input),
    });

    return buildCozePptSuccessResult(input, capabilityId, sourceArtifact.id, result);
  } catch (error) {
    return buildFailureResult(input, classifyCozePptFailure(error, capabilityId, provider, input.tool.failurePolicy.retryable), true);
  }
}

async function executePptAssetTool(input: ProviderToolAdapterInput, capabilityId: string, provider: string | undefined): Promise<ToolExecutionResult> {
  const sourceArtifact = findPrimarySourceArtifact(input);
  if (!sourceArtifact) return buildNeedsInputResult(input, capabilityId, provider, ["ppt_design_draft"]);
  const isFullProduction = input.tool.capabilityId === PPT_FULL_ASSET_PROVIDER;
  const approvalArtifact = isFullProduction ? findResolvedArtifact(input, "image_prompts") : undefined;
  if (isFullProduction && !approvalArtifact) return buildNeedsInputResult(input, capabilityId, provider, ["image_prompts"]);

  let providerSubmissionCount = 0;
  try {
    if (isFullProduction) {
      assertCurrentPptSampleApproval(sourceArtifact, approvalArtifact!);
      assertPptProductionEvidenceResolved(sourceArtifact, input.resolvedArtifacts ?? []);
    }
    const scope = isFullProduction ? "full_production" as const : "key_samples" as const;
    const result = await (input.runPptAssetBatch ?? runDefaultPptAssetBatch)({
      artifact: sourceArtifact,
      scope,
      lifecycle: input.pptAssetBatchLifecycle,
      ...providerBusinessSkillInput(input),
    });
    providerSubmissionCount = result.providerSubmissionCount ?? result.requestBatch.requests.length;
    return buildPptAssetSuccessResult(input, capabilityId, sourceArtifact.id, result, approvalArtifact, providerSubmissionCount);
  } catch (error) {
    providerSubmissionCount = error instanceof PptAssetBatchExecutionError ? error.providerSubmissionCount : providerSubmissionCount;
    return buildFailureResult(input, classifyMediaFailure(error, capabilityId, provider, input.tool.failurePolicy.retryable, "image"), providerSubmissionCount);
  }
}

async function runDefaultPptAssetBatch(input: { artifact: ArtifactRecord; scope: "key_samples" | "full_production"; lifecycle?: PptAssetBatchLifecycle } & ProviderBusinessSkillInput): Promise<PptAssetBatchRunResult> {
  const packageValue = input.artifact.structuredContent.pptDesignPackage;
  if (!packageValue || typeof packageValue !== "object" || Array.isArray(packageValue)) throw new Error("ppt_design_package_missing");
  const validation = validatePptDesignPackageForProviderProduction(packageValue as PptDesignPackage);
  if (!validation.valid) throw new Error(`ppt_design_package_invalid:${validation.issues.map((issue) => issue.code).join(",")}`);
  return runPptAssetBatch({ designPackage: packageValue as PptDesignPackage, generateAsset: generatePptAssetImage, scope: input.scope, lifecycle: input.lifecycle });
}

function assertCurrentPptSampleApproval(designArtifact: ArtifactRecord, approvalArtifact: ArtifactRecord): void {
  const designPackage = designArtifact.structuredContent.pptDesignPackage as PptDesignPackage | undefined;
  const sampleSet = approvalArtifact.structuredContent.pptKeySampleSet as PptKeySampleSet | undefined;
  const approval = approvalArtifact.structuredContent.pptSampleApproval as PptSampleApproval | undefined;
  if (!designPackage || !sampleSet || !approval) throw new Error("ppt_full_sample_approval_missing");
  if (hashRunInput(designPackage) !== sampleSet.designPackageDigest) throw new Error("ppt_full_sample_design_stale");
  const validation = validatePptSampleApproval(sampleSet, approval);
  if (!validation.valid) throw new Error(`ppt_full_sample_approval_invalid:${validation.issues.map((item) => item.code).join(",")}`);
}

function assertPptProductionEvidenceResolved(designArtifact: ArtifactRecord, resolvedArtifacts: ArtifactRecord[]): void {
  const designPackage = designArtifact.structuredContent.pptDesignPackage as PptDesignPackage | undefined;
  if (!designPackage?.evidenceBindings.length) throw new Error("ppt_full_evidence_missing");
  const unresolved = designPackage.evidenceBindings
    .map((binding) => binding.sourceArtifactId.trim())
    .filter((artifactId) => !resolvedArtifacts.some((artifact) =>
      artifact.id === artifactId &&
      artifact.projectId === designArtifact.projectId &&
      isArtifactTrustedForDownstream(artifact),
    ));
  if (unresolved.length > 0) throw new Error("ppt_full_evidence_unresolved");
}

async function executeImageTool(input: ProviderToolAdapterInput, capabilityId: string, provider: string | undefined): Promise<ToolExecutionResult> {
  const sourceArtifactKind = input.tool.primarySourceArtifactKind ?? "";
  const sourceArtifact = findPrimarySourceArtifact(input);
  if (!sourceArtifact) {
    return buildNeedsInputResult(input, capabilityId, provider, [sourceArtifactKind]);
  }

  try {
    const result = await (input.runImage ?? generateImageFromArtifact)({
      project: input.project ?? buildProjectRecord(input.projectId),
      artifact: sourceArtifact,
      ...providerBusinessSkillInput(input),
    });
    return buildImageSuccessResult(input, capabilityId, sourceArtifact.id, result);
  } catch (error) {
    return buildFailureResult(input, classifyMediaFailure(error, capabilityId, provider, input.tool.failurePolicy.retryable, "image"), true);
  }
}

async function executeVideoTool(input: ProviderToolAdapterInput, capabilityId: string, provider: string | undefined): Promise<ToolExecutionResult> {
  const sourceArtifact = findPrimarySourceArtifact(input);
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

  let providerSubmitted = false;
  try {
    assertVideoProviderPreconditions({ artifact, upstreamArtifacts });
    const shot = await (input.resolveVideoShot ?? resolveDefaultVideoShotRequest)({
      toolInput: input.toolInput,
      storyboard,
      assetImages,
    });
    providerSubmitted = true;
    const result = await (input.runVideo ?? generateVideoFromArtifact)({
      project: input.project ?? buildProjectRecord(input.projectId),
      artifact,
      upstreamArtifacts,
      taskLifecycle: input.generationTaskLifecycle,
      shot,
      ...providerBusinessSkillInput(input),
    });
    return buildVideoSuccessResult(input, capabilityId, [sourceArtifact.id, storyboard.id, assetImages.id], result);
  } catch (error) {
    return buildFailureResult(input, classifyMediaFailure(error, capabilityId, provider, input.tool.failurePolicy.retryable, "video"), providerSubmitted);
  }
}

async function executePptImageSlideTool(input: ProviderToolAdapterInput, capabilityId: string, provider: string | undefined): Promise<ToolExecutionResult> {
  const sourceArtifact = findPrimarySourceArtifact(input);
  if (!sourceArtifact) return buildNeedsInputResult(input, capabilityId, provider, ["ppt_design_draft"]);
  try {
    const bundle = await (input.runPptImageSlides ?? generatePptImageSlideBundle)({ project: input.project ?? buildProjectRecord(input.projectId), designArtifact: sourceArtifact });
    return buildPptImageSlideSuccessResult(input, capabilityId, sourceArtifact.id, bundle);
  } catch (error) {
    return buildFailureResult(input, classifyMediaFailure(error, capabilityId, provider, input.tool.failurePolicy.retryable, "image"), true);
  }
}

async function executeVideoNarrationTool(input: ProviderToolAdapterInput, capabilityId: string, provider: string | undefined): Promise<ToolExecutionResult> {
  const sourceArtifact = findPrimarySourceArtifact(input);
  if (!sourceArtifact) return buildNeedsInputResult(input, capabilityId, provider, ["video_script_generate"]);
  const script = sourceArtifact.structuredContent.videoNarrationScript as VideoNarrationScript | undefined;
  if (!script || !validateVideoNarrationScript(script).valid) {
    return buildFailureResult(input, classifyMediaFailure(new Error("video_narration_script_invalid"), capabilityId, provider, false, "video"));
  }

  try {
    const narration = await (input.runVideoNarration ?? ((value) => generateMiniMaxVideoNarration(value)))({
      script,
      ...providerBusinessSkillInput(input),
    });
    if (narration.providerEvidence.scriptDigest !== script.scriptDigest || narration.audioBuffer.length < 512 || narration.transcriptBuffer.length === 0 || narration.cues.length === 0) {
      throw new Error("video_narration_output_invalid");
    }
    const suffix = randomUUID();
    const audio = writeLocalArtifact({ category: "video-artifacts", fileName: `narration-${suffix}.mp3`, buffer: narration.audioBuffer });
    const transcript = writeLocalArtifact({ category: "video-artifacts", fileName: `narration-${suffix}.srt`, buffer: narration.transcriptBuffer });
    const audioSha256 = createHash("sha256").update(narration.audioBuffer).digest("hex");
    const transcriptSha256 = createHash("sha256").update(narration.transcriptBuffer).digest("hex");
    const artifactTruth = buildProviderArtifactTruth(input, "video_narration_generate");
    const qualityGate = { passed: true, gates: ["narration_audio_persisted", "subtitle_cues_valid", "script_digest_bound"] } satisfies ToolQualityGateResult;
    const businessSkillProvenance = resolveBusinessSkillProvenance(input);
    return {
      status: "succeeded",
      toolId: input.tool.id,
      capabilityId,
      provider: VIDEO_NARRATION_PROVIDER,
      artifactDraft: {
        nodeKey: "video_narration_generate",
        kind: "video_narration_generate",
        title: "真实视频旁白与字幕",
        summary: "真实旁白音轨与时间绑定字幕已生成并完成脚本版本绑定。",
        markdownContent: "# 视频旁白与字幕\n\n真实旁白音轨和字幕已持久化，可用于最终视频组装。",
        structuredContent: {
          narrationProviderEvidence: narration.providerEvidence,
          cues: narration.cues,
          storage: {
            audioTrack: { fileName: `narration-${suffix}.mp3`, localOutput: audio.localOutput, bytes: narration.audioBuffer.length, sha256: audioSha256, mime: "audio/mpeg" },
            transcript: { fileName: `narration-${suffix}.srt`, localOutput: transcript.localOutput, bytes: narration.transcriptBuffer.length, sha256: transcriptSha256, mime: "application/x-subrip" },
          },
          ...(businessSkillProvenance ? { businessSkillProvenance } : {}),
          artifactTruth,
          qualityGate,
        },
      },
      artifactTruth,
      qualityGate,
      providerPayload: { provider: VIDEO_NARRATION_PROVIDER, scriptDigest: script.scriptDigest, audioSha256, transcriptSha256, ...(businessSkillProvenance ? { businessSkillProvenance } : {}), artifactTruth, qualityGate },
      assistantSummary: "真实视频旁白与字幕已生成并通过持久化与脚本绑定校验。",
      budgetEvent: buildBudgetEvent(input, capabilityId, "succeeded", "tool_succeeded"),
    };
  } catch (error) {
    return buildFailureResult(
      input,
      classifyVideoNarrationFailure(error, capabilityId, provider, input.tool.failurePolicy.retryable),
      error instanceof VideoNarrationProviderError ? error.providerSubmitted : false,
    );
  }
}

function isCozePptTool(tool: ToolDefinition): boolean {
  return tool.capabilityId === COZE_PPT_PROVIDER && tool.providerToolId === "coze_ppt.generate_pptx";
}

function isImageTool(tool: ToolDefinition): boolean {
  return (
    (tool.id === "generate_classroom_image" && tool.capabilityId === IMAGE_PROVIDER && tool.providerToolId === "image_asset.generate") ||
    (tool.id === "asset_image_generate" && tool.capabilityId === ASSET_IMAGE_PROVIDER && tool.providerToolId === "image_asset.generate_asset_reference")
  );
}

function isPptAssetTool(tool: ToolDefinition): boolean {
  return (
    (tool.id === "generate_ppt_sample_assets" && tool.capabilityId === PPT_SAMPLE_ASSET_PROVIDER && tool.providerToolId === "image_asset.generate_ppt_sample_assets") ||
    (tool.id === "generate_ppt_full_assets" && tool.capabilityId === PPT_FULL_ASSET_PROVIDER && tool.providerToolId === "image_asset.generate_ppt_full_assets")
  );
}

function isVideoTool(tool: ToolDefinition): boolean {
  return tool.id === "generate_video_segment" && tool.capabilityId === VIDEO_PROVIDER && tool.providerToolId === "video_segment_generate.generate";
}

function isPptImageSlideTool(tool: ToolDefinition): boolean {
  return tool.id === "generate_ppt_page_images" && tool.capabilityId === PPT_IMAGE_SLIDE_PROVIDER && tool.providerToolId === "image_asset.generate_ppt_page_images";
}

function isVideoNarrationTool(tool: ToolDefinition): boolean {
  return tool.id === "generate_video_narration" && tool.capabilityId === "video_narration_generate" && tool.providerToolId === "tts_minimax.generate_narration";
}

function resolveProvider(tool: ToolDefinition): string | undefined {
  if (tool.capabilityId === COZE_PPT_PROVIDER || tool.providerToolId?.startsWith("coze_ppt.")) return COZE_PPT_PROVIDER;
  if (tool.capabilityId === PPT_SAMPLE_ASSET_PROVIDER || tool.capabilityId === PPT_FULL_ASSET_PROVIDER || tool.capabilityId === PPT_IMAGE_SLIDE_PROVIDER) return IMAGE_PROVIDER;
  if (tool.capabilityId === ASSET_IMAGE_PROVIDER) return IMAGE_PROVIDER;
  if (tool.capabilityId === "video_narration_generate") return VIDEO_NARRATION_PROVIDER;
  return tool.capabilityId;
}

function buildProjectRecord(projectId: string): ProjectRecord {
  const now = new Date().toISOString();
  return {
    id: projectId,
    title: "ShanHaiEdu 项目",
    status: "active",
    grade: null,
    subject: null,
    textbookVersion: null,
    lessonTopic: null,
    lifecycleState: "active",
    lifecycleVersion: 0,
    archivedAt: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function providerBusinessSkillInput(input: ProviderToolAdapterInput): ProviderBusinessSkillInput {
  return {
    ...(input.userInstruction === undefined ? {} : { userInstruction: input.userInstruction }),
    ...(input.toolInput === undefined ? {} : { toolInput: structuredClone(input.toolInput) }),
    ...(input.businessSkillContext === undefined
      ? {}
      : { businessSkillContext: structuredClone(input.businessSkillContext) }),
  };
}
