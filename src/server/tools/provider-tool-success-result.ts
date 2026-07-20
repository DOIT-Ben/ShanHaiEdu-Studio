import type { CozePptGenerationResult } from "@/server/coze-ppt/coze-ppt-run";
import type { ImageGenerationResult } from "@/server/image-generation/image-generation-run";
import type { PptAssetBatchRunResult } from "@/server/ppt-quality/ppt-asset-batch-run";
import type { VideoGenerationResult } from "@/server/video-generation/video-generation-run";
import type { ArtifactRecord } from "@/server/workbench/types";

import type { ProviderToolAdapterInput } from "./provider-tool-adapter-types";
import { buildBudgetEvent } from "./provider-tool-result-contract";
import type { ToolArtifactTruth, ToolExecutionResult, ToolQualityGateResult } from "./tool-types";

const COZE_PPT_PROVIDER = "coze_ppt";
const ASSET_IMAGE_PROVIDER = "asset_image_generate";
const VIDEO_PROVIDER = "video_segment_generate";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export function buildImageSuccessResult(
  input: ProviderToolAdapterInput,
  capabilityId: string,
  sourceArtifactId: string,
  providerResult: ImageGenerationResult,
): ToolExecutionResult {
  assertCompleteImageGenerationResult(providerResult);
  const isAssetImage = input.tool.capabilityId === ASSET_IMAGE_PROVIDER;
  const producedKind = isAssetImage ? "asset_image_generate" : "image_prompts";
  const artifactTruth = buildProviderArtifactTruth(input, producedKind);
  const qualityGate = {
    passed: true,
    gates: ["image_valid", "supported_image_mime", "raw_and_normalized_lineage_complete"],
  } satisfies ToolQualityGateResult;
  const businessSkillProvenance = resolveBusinessSkillProvenance(input);
  const providerPayload = {
    ...providerResult,
    sourceArtifactId,
    ...(businessSkillProvenance ? { businessSkillProvenance } : {}),
    artifactTruth,
    qualityGate,
  };
  const structuredContent = {
    文件状态: isAssetImage ? "真实视频资产图已生成" : "真实课堂视觉图已生成",
    文件大小: `${providerResult.bytes} bytes`,
    文件类型: providerResult.mime,
    storage: {
      imageAsset: {
        fileName: providerResult.fileName,
        localOutput: providerResult.localOutput,
        bytes: providerResult.bytes,
        sha256: providerResult.sha256,
        mime: providerResult.mime,
        provider: providerResult.provider,
        model: providerResult.model,
        width: providerResult.width,
        height: providerResult.height,
        promptDigest: providerResult.promptDigest,
        rawAsset: structuredClone(providerResult.rawAsset),
        normalizedAsset: structuredClone(providerResult.normalizedAsset),
        generationMode: isAssetImage ? "asset_image_generated" : "image_generated",
        sourceArtifactId,
      },
    },
    ...(businessSkillProvenance ? { businessSkillProvenance } : {}),
    artifactTruth,
    qualityGate,
  };

  return {
    status: "succeeded",
    toolId: input.tool.id,
    capabilityId,
    provider: providerResult.provider,
    artifactTruth,
    qualityGate,
    artifactDraft: {
      nodeKey: input.tool.producedArtifactKind ?? producedKind,
      kind: input.tool.producedArtifactKind ?? producedKind,
      title: isAssetImage ? "真实视频资产图" : "真实课堂视觉图",
      summary: isAssetImage
        ? "已生成一张可用于分镜视频的资产参考图，请核对角色、场景和风格。"
        : "已生成一张可用于课件导入页的课堂视觉图，请核对画面内容。",
      markdownContent: isAssetImage
        ? "# 真实视频资产图\n\n已基于当前资产说明生成分镜视频参考图。"
        : "# 真实课堂视觉图\n\n已基于当前 PPT 大纲生成课堂视觉图。",
      structuredContent,
    },
    providerPayload,
    assistantSummary: isAssetImage
      ? "真实视频资产图已生成并通过基础校验。"
      : "真实课堂视觉图已生成并通过基础校验。",
    budgetEvent: buildBudgetEvent(input, capabilityId, "succeeded", "tool_succeeded", true),
  };
}

export function buildPptAssetSuccessResult(
  input: ProviderToolAdapterInput,
  capabilityId: string,
  sourceArtifactId: string,
  result: PptAssetBatchRunResult,
  approvalArtifact?: ArtifactRecord,
  providerSubmissionCount = result.providerSubmissionCount ?? result.requestBatch.requests.length,
): ToolExecutionResult {
  const isFullProduction = result.requestBatch.scope === "full_production";
  const providerIdentity = resolvePptAssetProviderIdentity(result);
  const artifactTruth = buildProviderArtifactTruth(input, "image_prompts");
  const qualityGate = {
    passed: true,
    gates: ["ppt_asset_request_batch_valid", "ppt_asset_manifest_valid", "asset_lineage_complete"],
  } satisfies ToolQualityGateResult;
  const businessSkillProvenance = resolveBusinessSkillProvenance(input);
  const structuredContent = {
    文件状态: `真实 PPT ${isFullProduction ? "全量正式" : "样张"}资产已生成 ${result.manifest.entries.length} 项`,
    pptAssetRequestBatch: result.requestBatch,
    pptAssetManifest: result.manifest,
    ...(approvalArtifact ? {
      pptKeySampleSet: approvalArtifact.structuredContent.pptKeySampleSet,
      pptSampleApproval: approvalArtifact.structuredContent.pptSampleApproval,
    } : {}),
    storage: {
      pptAssetBundle: {
        sourceArtifactId,
        manifestDigest: result.manifest.manifestDigest,
        assets: result.manifest.entries.map((entry) => ({
          assetId: entry.assetId,
          pageIds: entry.pageIds,
          fileName: entry.fileName,
          localOutput: entry.storageRef,
          sha256: entry.sha256,
          mime: entry.mime,
        })),
      },
    },
    ...(businessSkillProvenance ? { businessSkillProvenance } : {}),
    artifactTruth,
    qualityGate,
  };
  return {
    status: "succeeded",
    toolId: input.tool.id,
    capabilityId,
    provider: providerIdentity,
    artifactTruth,
    qualityGate,
    artifactDraft: {
      nodeKey: input.tool.producedArtifactKind ?? "image_prompts",
      kind: input.tool.producedArtifactKind ?? "image_prompts",
      title: isFullProduction ? "PPT 全量正式资产批次" : "PPT 关键样张资产批次",
      summary: `已生成 ${result.manifest.entries.length} 项${isFullProduction ? "全量正式" : "关键"}场景与小素材，并形成逐对象来源清单。`,
      markdownContent: isFullProduction
        ? "# PPT 全量正式资产批次\n\n当前样张批准、完整真实资产文件和逐对象来源清单已绑定，下一步可以组装完整 PPT。"
        : "# PPT 关键样张资产批次\n\n真实资产文件和逐对象来源清单已生成，下一步需要组装样张并完成 D/V/P 审查。",
      structuredContent,
    },
    providerPayload: {
      provider: providerIdentity,
      sourceArtifactId,
      ...result,
      ...(businessSkillProvenance ? { businessSkillProvenance } : {}),
      artifactTruth,
      qualityGate,
    },
    assistantSummary: isFullProduction
      ? `PPT 全量正式资产已生成 ${result.manifest.entries.length} 项，下一步可以组装完整 PPT 并逐页审查。`
      : `PPT 关键样张资产已生成 ${result.manifest.entries.length} 项，下一步需要检查三份总览和正式组装样张。`,
    budgetEvent: buildBudgetEvent(
      input,
      capabilityId,
      "succeeded",
      "tool_succeeded",
      providerSubmissionCount,
    ),
  };
}

export function buildVideoSuccessResult(
  input: ProviderToolAdapterInput,
  capabilityId: string,
  sourceArtifactIds: string[],
  providerResult: VideoGenerationResult,
): ToolExecutionResult {
  const artifactTruth = buildProviderArtifactTruth(input, "video_segment_generate");
  const qualityGate = {
    passed: true,
    gates: ["video_valid", "mp4_ftyp_present", "mp4_moov_present"],
  } satisfies ToolQualityGateResult;
  const businessSkillProvenance = resolveBusinessSkillProvenance(input);
  const providerPayload = {
    provider: providerResult.providerEvidence.name,
    model: providerResult.providerEvidence.model,
    ...providerResult,
    sourceArtifactIds,
    ...(businessSkillProvenance ? { businessSkillProvenance } : {}),
    artifactTruth,
    qualityGate,
  };
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
        provider: providerResult.providerEvidence.name,
        model: providerResult.providerEvidence.model,
        sourceArtifactId: sourceArtifactIds[0],
        sourceArtifactIds,
        ...(providerResult.requestEvidence ? { requestEvidence: providerResult.requestEvidence } : {}),
      },
    },
    ...(businessSkillProvenance ? { businessSkillProvenance } : {}),
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
    budgetEvent: buildBudgetEvent(input, capabilityId, "succeeded", "tool_succeeded", true),
  };
}

export function buildCozePptSuccessResult(
  input: ProviderToolAdapterInput,
  capabilityId: string,
  sourceArtifactId: string,
  providerResult: CozePptGenerationResult,
): ToolExecutionResult {
  const artifactTruth = buildProviderArtifactTruth(input, "pptx_artifact");
  const qualityGate = {
    passed: true,
    gates: ["pptx_valid", "presentation_xml_present", "slide_count_matches_design"],
  } satisfies ToolQualityGateResult;
  const businessSkillProvenance = resolveBusinessSkillProvenance(input);
  const providerPayload = {
    provider: COZE_PPT_PROVIDER,
    fileName: providerResult.fileName,
    localOutput: providerResult.localOutput,
    mime: PPTX_MIME,
    bytes: providerResult.bytes,
    sha256: providerResult.sha256,
    requestedPageCount: providerResult.requestedPageCount,
    slideCount: providerResult.slideCount,
    pptxValid: providerResult.pptxValid,
    hasPresentationXml: providerResult.hasPresentationXml,
    artifactTruth,
    qualityGate,
    ...(businessSkillProvenance ? { businessSkillProvenance } : {}),
  };
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
    ...(businessSkillProvenance ? { businessSkillProvenance } : {}),
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
    budgetEvent: buildBudgetEvent(input, capabilityId, "succeeded", "tool_succeeded", true),
  };
}

export function buildProviderArtifactTruth(
  input: ProviderToolAdapterInput,
  fallbackKind: string,
): ToolArtifactTruth {
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

export function resolveBusinessSkillProvenance(input: ProviderToolAdapterInput) {
  return input.businessSkillContext
    ? structuredClone(input.businessSkillContext.provenance)
    : undefined;
}

function assertCompleteImageGenerationResult(result: ImageGenerationResult) {
  const files = [result.rawAsset, result.normalizedAsset];
  if (result.provider !== "model_gateway" || !result.model?.trim() ||
      !Number.isInteger(result.width) || result.width <= 0 ||
      !Number.isInteger(result.height) || result.height <= 0 ||
      !/^[a-f0-9]{64}$/i.test(result.promptDigest) ||
      files.some((file) => !file?.fileName?.trim() || !file.localOutput?.trim() || file.bytes <= 0 ||
        !/^[a-f0-9]{64}$/i.test(file.sha256) || !file.mime?.trim()) ||
      result.rawAsset.localOutput === result.normalizedAsset.localOutput ||
      result.sha256 !== result.normalizedAsset.sha256 ||
      result.localOutput !== result.normalizedAsset.localOutput ||
      result.width !== result.normalizedAsset.width || result.height !== result.normalizedAsset.height) {
    throw new Error("model_gateway_image_lineage_incomplete");
  }
}

function resolvePptAssetProviderIdentity(result: PptAssetBatchRunResult) {
  const providers = [...new Set(
    result.manifest.entries.map((entry) => entry.provider.trim()).filter(Boolean),
  )];
  if (providers.length !== 1) throw new Error("ppt_asset_provider_identity_invalid");
  return providers[0];
}
