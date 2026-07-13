import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolveLocalArtifactOutput, writeLocalArtifact } from "@/server/artifact-storage/local-artifact-storage";
import { prepareVersionedFinalPackageInput } from "@/server/package/final-package-input-contract";
import { buildVersionedFinalPackage, type FinalPackageInspectors } from "@/server/package/versioned-final-package";
import { buildStoredVideoDownload } from "@/server/video-generation/artifact-video";
import { buildPptKeySampleCandidate, validatePptKeySampleCandidate } from "@/server/ppt-quality/ppt-key-sample-candidate";
import { composePptKeySamplePptx } from "@/server/ppt-quality/ppt-key-sample-composer";
import { renderPptKeySamples } from "@/server/ppt-quality/ppt-key-sample-renderer";
import type { PptAssetManifest, PptAssetRequestBatch, PptKeySampleCandidate } from "@/server/ppt-quality/ppt-asset-types";
import type { PptDesignPackage } from "@/server/ppt-quality/ppt-quality-types";
import { composePptFullDeckPptx } from "@/server/ppt-quality/ppt-full-deck-composer";
import { renderPptFullDeck } from "@/server/ppt-quality/ppt-full-deck-renderer";
import { repairPptFullDeckPages } from "@/server/ppt-quality/ppt-full-deck-page-repair";
import { buildPptFullDeckCandidate, validatePptFullDeckCandidate } from "@/server/ppt-quality/ppt-full-deck-candidate";
import type { PptFullDeckCandidate } from "@/server/ppt-quality/ppt-production-types";
import type { PptKeySampleSet, PptSampleApproval } from "@/server/ppt-quality/ppt-asset-types";
import type { ArtifactRecord } from "@/server/workbench/types";
import type { ToolArtifactTruth, ToolDefinition, ToolExecutionResult, ToolQualityGateResult } from "./tool-types";
import { createToolObservation } from "@/server/capabilities/tool-observation";
import { buildAgentHarnessBudgetEvent } from "@/server/conversation/agent-harness-budget";
import { assembleVideoTimeline } from "@/server/video-quality/video-timeline-assembler";
import { generateMiniMaxVideoNarration, type VideoNarrationProviderResult } from "@/server/video-generation/video-narration-provider";
import { validateVideoNarrationScript, type VideoNarrationScript } from "@/server/video-quality/video-narration-contract";

export type PackageArtifactRef = {
  kind: string;
  artifactId: string;
};

export type PackageToolAdapterInput = {
  tool: ToolDefinition;
  projectId: string;
  userInstruction?: string | null;
  toolInput?: Record<string, unknown>;
  artifactRefs: PackageArtifactRef[];
  resolvedArtifacts?: ArtifactRecord[];
  sourceMessageId?: string;
  runPptKeySampleAssembly?: (input: {
    designPackage: PptDesignPackage;
    requestBatch: PptAssetRequestBatch;
    manifest: PptAssetManifest;
  }) => Promise<PptKeySampleCandidate>;
  runPptFullDeckAssembly?: (input: {
    designPackage: PptDesignPackage;
    requestBatch: PptAssetRequestBatch;
    manifest: PptAssetManifest;
    sampleSet: PptKeySampleSet;
    sampleApproval: PptSampleApproval;
  }) => Promise<PptFullDeckCandidate>;
  runVideoNarration?: (input: { script: VideoNarrationScript }) => Promise<VideoNarrationProviderResult>;
  finalPackageInspectors?: Partial<FinalPackageInspectors>;
};

const ZIP_MIME = "application/zip";

export async function executePackageTool(input: PackageToolAdapterInput): Promise<ToolExecutionResult> {
  if (input.tool.adapterKind !== "package" || !input.tool.implemented) {
    return buildFailureResult(input, "tool_failed", "这一步暂时无法执行，请稍后重试。", "Unsupported package tool.", "unsupported_package_tool");
  }

  try {
    if (input.tool.capabilityId === "concat_only_assemble") {
      return await executeConcatOnlyAssemble(input);
    }
    if (input.tool.capabilityId === "final_package") {
      return await executeFinalPackage(input);
    }
    if (input.tool.capabilityId === "ppt_key_samples") {
      return await executePptKeySampleAssembly(input);
    }
    if (input.tool.capabilityId === "ppt_full_deck") {
      return await executePptFullDeckAssembly(input);
    }
    if (input.tool.capabilityId === "ppt_page_repair") {
      return await executePptPageRepair(input);
    }
    return buildFailureResult(input, "tool_failed", "这类打包工具暂时不能自动执行。", `Unsupported package capability: ${input.tool.capabilityId}`, "unsupported_package_tool");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown package tool error";
    return buildFailureResult(input, "quality_gate_failed", "生成结果没有通过交付校验，我没有保存这份结果。", reason, "quality_gate_failed");
  }
}

async function executePptPageRepair(input: PackageToolAdapterInput): Promise<ToolExecutionResult> {
  const previous = findRepairableArtifact(input, "pptx_artifact");
  const design = requireArtifact(input, "ppt_design_draft");
  const assets = findResolvedArtifacts(input, "image_prompts").find((artifact) => isRecord(artifact.structuredContent.pptAssetRequestBatch) && isRecord(artifact.structuredContent.pptAssetManifest) && isRecord(artifact.structuredContent.pptKeySampleSet) && isRecord(artifact.structuredContent.pptSampleApproval));
  const previousCandidate = previous?.structuredContent.pptFullDeckCandidate as PptFullDeckCandidate | undefined;
  const designPackage = design.structuredContent.pptDesignPackage as PptDesignPackage | undefined;
  const requestBatch = assets?.structuredContent.pptAssetRequestBatch as PptAssetRequestBatch | undefined;
  const manifest = assets?.structuredContent.pptAssetManifest as PptAssetManifest | undefined;
  const sampleSet = assets?.structuredContent.pptKeySampleSet as PptKeySampleSet | undefined;
  const sampleApproval = assets?.structuredContent.pptSampleApproval as PptSampleApproval | undefined;
  if (!previous || !previousCandidate || !validatePptFullDeckCandidate(previousCandidate) || !designPackage || !requestBatch || !manifest || !sampleSet || !sampleApproval) throw new Error("ppt_page_repair_inputs_incomplete");
  const pageIds = resolveRepairPageIds(input, previousCandidate.pageIds);
  const repaired = await repairPptFullDeckPages({ previousCandidate, repairedPageIds: pageIds, designPackage, requestBatch, manifest, sampleSet, sampleApproval });
  const candidate = buildPptFullDeckCandidate({ designPackage, requestBatch, manifest, sampleSet, sampleApproval, composition: repaired.composition, renderEvidence: repaired.renderEvidence });
  const artifactTruth = buildArtifactTruth(input.tool, "pptx_artifact");
  const qualityGate = { passed: true, gates: ["page_scoped_repair", "unaffected_page_evidence_reused", "awaiting_delivery_review"] } satisfies ToolQualityGateResult;
  return { status: "succeeded", toolId: input.tool.id, capabilityId: "ppt_page_repair", artifactDraft: { nodeKey: "pptx_artifact", kind: "pptx_artifact", title: "完整 PPT 页级返修包", summary: `已返修第 ${pageIds.map((pageId) => Number(pageId.slice(5))).join("、")} 页，等待重新审查。`, markdownContent: "# 完整 PPT 页级返修包\n\n仅指定页面已更新，其他页面证据已复用，等待重新审查。", structuredContent: { pptFullDeckCandidate: candidate, repairedPageIds: pageIds, sourceArtifactIds: [previous.id, design.id, assets!.id], artifactTruth, qualityGate } }, artifactTruth, qualityGate, assistantSummary: "指定课件页面已返修，其他页面未重复生成，等待重新审查。", budgetEvent: buildBudgetEvent(input.tool, "succeeded", "tool_succeeded") };
}

async function executePptFullDeckAssembly(input: PackageToolAdapterInput): Promise<ToolExecutionResult> {
  const designArtifact = requireArtifact(input, "ppt_design_draft");
  const assetArtifact = findResolvedArtifacts(input, "image_prompts").find((artifact) =>
    isRecord(artifact.structuredContent.pptAssetRequestBatch) &&
    isRecord(artifact.structuredContent.pptAssetManifest) &&
    isRecord(artifact.structuredContent.pptKeySampleSet) &&
    isRecord(artifact.structuredContent.pptSampleApproval));
  if (!assetArtifact) throw new Error("missing_ppt_full_production_bundle");

  const designPackage = designArtifact.structuredContent.pptDesignPackage as PptDesignPackage | undefined;
  const requestBatch = assetArtifact.structuredContent.pptAssetRequestBatch as PptAssetRequestBatch | undefined;
  const manifest = assetArtifact.structuredContent.pptAssetManifest as PptAssetManifest | undefined;
  const sampleSet = assetArtifact.structuredContent.pptKeySampleSet as PptKeySampleSet | undefined;
  const sampleApproval = assetArtifact.structuredContent.pptSampleApproval as PptSampleApproval | undefined;
  if (!designPackage || !requestBatch || !manifest || !sampleSet || !sampleApproval) throw new Error("ppt_full_production_inputs_incomplete");

  const candidate = await (input.runPptFullDeckAssembly ?? runDefaultPptFullDeckAssembly)({ designPackage, requestBatch, manifest, sampleSet, sampleApproval });
  if (!validatePptFullDeckCandidate(candidate)) throw new Error("ppt_full_deck_candidate_invalid");
  const artifactTruth = buildArtifactTruth(input.tool, "pptx_artifact");
  const qualityGate = { passed: true, gates: ["pptx_slide_count_verified", "pdf_page_count_verified", "page_renders_complete", "contact_sheet_created", "awaiting_delivery_review"] } satisfies ToolQualityGateResult;
  return {
    status: "succeeded",
    toolId: input.tool.id,
    capabilityId: input.tool.capabilityId ?? "ppt_full_deck",
    artifactDraft: {
      nodeKey: "pptx_artifact",
      kind: "pptx_artifact",
      title: "完整 PPT 交付审查包",
      summary: `${candidate.pageIds.length} 页可编辑 PPTX、PDF、逐页预览和总览已生成，等待逐页交付审查。`,
      markdownContent: "# 完整 PPT 交付审查包\n\nPPTX、PDF、逐页预览和总览已生成。所有页面的设计、视觉、来源和可读性审查通过后，才能进入最终交付。",
      structuredContent: {
        pptFullDeckCandidate: candidate,
        storage: {
          cozePptx: {
            fileName: "shanhai-quality-full-deck.pptx",
            localOutput: candidate.pptx.storageRef,
            bytes: candidate.pptx.bytes,
            sha256: candidate.pptx.sha256,
            slideCount: candidate.pptx.slideCount,
            generationMode: "ppt_quality_asset_assembly",
          },
          qualityPdf: { localOutput: candidate.pdf.storageRef, bytes: candidate.pdf.bytes, sha256: candidate.pdf.sha256, pageCount: candidate.pdf.pageCount },
          contactSheet: candidate.contactSheet,
        },
        sourceArtifactIds: [designArtifact.id, assetArtifact.id],
        artifactTruth,
        qualityGate,
      },
    },
    artifactTruth,
    qualityGate,
    assistantSummary: "完整 PPT 交付审查包已生成，尚未通过逐页 Delivery Critic，也未进入最终交付。",
    budgetEvent: buildBudgetEvent(input.tool, "succeeded", "tool_succeeded"),
  };
}

async function runDefaultPptFullDeckAssembly(input: {
  designPackage: PptDesignPackage;
  requestBatch: PptAssetRequestBatch;
  manifest: PptAssetManifest;
  sampleSet: PptKeySampleSet;
  sampleApproval: PptSampleApproval;
}): Promise<PptFullDeckCandidate> {
  const composition = await composePptFullDeckPptx(input);
  const renderEvidence = await renderPptFullDeck({
    pptxBuffer: composition.pptxBuffer,
    pageIds: input.designPackage.pageSpecs.map((page) => page.pageId),
    slideCount: composition.slideCount,
  });
  return buildPptFullDeckCandidate({ ...input, composition, renderEvidence });
}

async function executePptKeySampleAssembly(input: PackageToolAdapterInput): Promise<ToolExecutionResult> {
  const designArtifact = requireArtifact(input, "ppt_design_draft");
  const assetArtifact = findResolvedArtifacts(input, "image_prompts")
    .find((artifact) => isRecord(artifact.structuredContent.pptAssetRequestBatch) && isRecord(artifact.structuredContent.pptAssetManifest));
  if (!assetArtifact) throw new Error("missing_ppt_sample_asset_bundle");

  const designPackage = designArtifact.structuredContent.pptDesignPackage as PptDesignPackage | undefined;
  const requestBatch = assetArtifact.structuredContent.pptAssetRequestBatch as PptAssetRequestBatch | undefined;
  const manifest = assetArtifact.structuredContent.pptAssetManifest as PptAssetManifest | undefined;
  if (!designPackage || !requestBatch || !manifest) throw new Error("ppt_sample_assembly_inputs_incomplete");

  const runAssembly = input.runPptKeySampleAssembly ?? runDefaultPptKeySampleAssembly;
  const candidate = await runAssembly({ designPackage, requestBatch, manifest });
  if (!validatePptKeySampleCandidate(candidate)) throw new Error("ppt_key_sample_candidate_invalid");

  const artifactTruth = buildArtifactTruth(input.tool, "image_prompts");
  const qualityGate = {
    passed: true,
    gates: ["editable_sample_pptx_created", "sample_pages_rendered", "three_overviews_created", "awaiting_dvp_review"],
  } satisfies ToolQualityGateResult;
  return {
    status: "succeeded",
    toolId: input.tool.id,
    capabilityId: input.tool.capabilityId ?? "ppt_key_samples",
    artifactDraft: {
      nodeKey: "image_prompts",
      kind: "image_prompts",
      title: "PPT 关键样张审查包",
      summary: "可编辑关键样张、逐页预览和三份独立总览已生成，等待逐页 D/V/P 审查。",
      markdownContent: "# PPT 关键样张审查包\n\n样张文件与三份总览已生成。逐页设计、视觉和来源审查全部通过后，才能提交教师批准。",
      structuredContent: {
        pptDesignPackage: designPackage,
        pptAssetRequestBatch: requestBatch,
        pptAssetManifest: manifest,
        pptKeySampleCandidate: candidate,
        sourceArtifactIds: [designArtifact.id, assetArtifact.id],
        artifactTruth,
        qualityGate,
      },
    },
    artifactTruth,
    qualityGate,
    assistantSummary: "PPT 关键样张审查包已生成，下一步需要逐页完成 D/V/P 审查，尚未批准批量生产。",
    budgetEvent: buildBudgetEvent(input.tool, "succeeded", "tool_succeeded"),
  };
}

async function runDefaultPptKeySampleAssembly(input: {
  designPackage: PptDesignPackage;
  requestBatch: PptAssetRequestBatch;
  manifest: PptAssetManifest;
}): Promise<PptKeySampleCandidate> {
  const composition = await composePptKeySamplePptx(input);
  const renderEvidence = await renderPptKeySamples({
    pptxBuffer: composition.pptxBuffer,
    samplePageIds: input.designPackage.samplePlan.samplePageIds,
    manifest: input.manifest,
  });
  return buildPptKeySampleCandidate({ ...input, composition, renderEvidence });
}

async function executeConcatOnlyAssemble(input: PackageToolAdapterInput): Promise<ToolExecutionResult> {
  const segments = findResolvedArtifacts(input, "video_segment_generate");
  if (segments.length === 0) {
    throw new Error("missing_video_segments");
  }

  const clipInputs = segments.map((artifact) => buildTimelineClipInput(artifact));
  const scriptArtifact = requireArtifact(input, "video_script_generate");
  const narrationScript = scriptArtifact.structuredContent.videoNarrationScript as VideoNarrationScript | undefined;
  if (!narrationScript || !validateVideoNarrationScript(narrationScript).valid) throw new Error("video_narration_script_missing");
  const narration = await (input.runVideoNarration ?? ((value) => generateMiniMaxVideoNarration(value)))({ script: narrationScript });
  const assembly = assembleVideoTimeline({ projectId: input.projectId, clips: clipInputs, narration });
  if (!assembly.transcript || !assembly.audioTrack) throw new Error("video_final_review_tracks_missing");
  const sourceArtifactIds = [...assembly.timeline.entries.map((entry) => entry.sourceArtifactId), scriptArtifact.id];
  const artifactTruth = buildArtifactTruth(input.tool, "concat_only_assemble");
  const qualityGate = { passed: true, gates: ["ffprobe_shots_verified", "clips_normalized", "ffmpeg_timeline_assembled", "provider_audio_replaced", "controlled_audio_verified", "subtitle_timing_verified", "final_video_fully_decoded", "timeline_order_preserved", "sampled_frames_created", "awaiting_video_final_review"] } satisfies ToolQualityGateResult;

  return {
    status: "succeeded",
    toolId: input.tool.id,
    capabilityId: input.tool.capabilityId ?? "concat_only_assemble",
    artifactDraft: {
      nodeKey: "concat_only_assemble",
      kind: "concat_only_assemble",
      title: "真实导入视频成片",
      summary: "已按分镜顺序完成 FFmpeg 归一化组装、受控音轨替换和字幕校验，等待成片审查。",
      markdownContent: "# 真实导入视频成片\n\n已按镜头身份和顺序完成真实媒体组装、受控音轨替换、字幕时序校验、完整解码与采样帧校验，等待成片 Critic 独立审查。",
      structuredContent: {
        文件状态: "真实导入视频已完成技术组装",
        文件大小: `${assembly.finalVideo.bytes} bytes`,
        文件类型: "video/mp4",
        storage: {
          videoAsset: {
            fileName: `concat-${safeFileSegment(input.projectId)}.mp4`,
            localOutput: assembly.finalVideo.storageRef,
            bytes: assembly.finalVideo.bytes,
            sha256: assembly.finalVideo.sha256,
            mime: "video/mp4",
            generationMode: "ffmpeg_timeline_assembled",
            sourceArtifactIds,
          },
        },
        videoFinalReviewEvidence: {
          finalVideo: assembly.finalVideo,
          timeline: assembly.timeline,
          sampledFrames: assembly.sampledFrames,
          transcript: assembly.transcript,
          audioTrack: assembly.audioTrack,
        },
        shotProbeEvidence: assembly.shotProbes,
        normalizedClipManifest: assembly.normalizedClips,
        artifactTruth,
        qualityGate,
      },
    },
    artifactTruth,
    qualityGate,
    assistantSummary: "真实导入视频已完成 FFmpeg 时间线组装和技术校验；字幕或转写证据尚未形成，暂不能批准成片。",
    budgetEvent: buildBudgetEvent(input.tool, "succeeded", "tool_succeeded"),
  };
}

async function executeFinalPackage(input: PackageToolAdapterInput): Promise<ToolExecutionResult> {
  const prepared = prepareVersionedFinalPackageInput({
    projectId: input.projectId,
    classroomRunSpecDraft: input.toolInput?.classroomRunSpecDraft,
    artifacts: {
      requirement: requireArtifact(input, "requirement_spec"),
      lessonPlan: requireArtifact(input, "lesson_plan"),
      pptDesign: requireArtifact(input, "ppt_design_draft"),
      pptx: requireArtifact(input, "pptx_artifact"),
      image: requireFinalImageArtifact(input),
      narrationScript: requireArtifact(input, "video_script_generate"),
      video: requireArtifact(input, "concat_only_assemble"),
    },
  });
  let download: Awaited<ReturnType<typeof buildVersionedFinalPackage>>;
  try {
    download = await buildVersionedFinalPackage({
      files: prepared.files,
      classroomRunSpec: prepared.classroomRunSpec,
      teacherSignoff: false,
      inspectors: input.finalPackageInspectors,
    });
  } finally {
    prepared.cleanup();
  }

  const fileName = `shanhai-final-${safeFileSegment(input.projectId)}.zip`;
  const stored = writeLocalArtifact({ category: "package-artifacts", fileName, buffer: download.buffer });
  const artifactTruth = buildArtifactTruth(input.tool, "final_delivery");
  const qualityGate = { passed: true, gates: ["version_binding_verified", "review_batch_verified", "classroom_run_spec_verified", "all_files_final_eligible", "manifest_reverse_verified"] } satisfies ToolQualityGateResult;

  return {
    status: "succeeded",
    toolId: input.tool.id,
    capabilityId: input.tool.capabilityId ?? "final_package",
    artifactDraft: {
      nodeKey: "final_delivery",
      kind: "final_delivery",
      title: "最终材料包",
      summary: "已打包真实 PPTX、课堂图片和导入视频，可下载后授课前核对。",
      markdownContent: buildFinalDeliveryMarkdown(input),
      structuredContent: {
        文件状态: "真实最终材料包已生成",
        文件大小: `${download.buffer.length} bytes`,
        文件类型: ZIP_MIME,
        finalPackageManifest: download.manifest,
        classroomRunSpec: prepared.classroomRunSpec,
        courseVersionId: prepared.courseVersionId,
        reviewBatchId: prepared.reviewBatchId,
        storage: {
          packageAsset: {
            fileName,
            localOutput: stored.localOutput,
            bytes: download.buffer.length,
            sha256: download.sha256,
            mime: ZIP_MIME,
            generationMode: "versioned_final_package_generated",
            sourceArtifactIds: prepared.sourceArtifactIds,
          },
        },
        artifactTruth,
        qualityGate,
      },
    },
    artifactTruth,
    qualityGate,
    assistantSummary: "最终材料包已完成版本、审查批次、课堂顺序和文件完整性校验。",
    budgetEvent: buildBudgetEvent(input.tool, "succeeded", "tool_succeeded"),
  };
}

function buildFinalDeliveryMarkdown(input: PackageToolAdapterInput) {
  const lessonPlan = findResolvedArtifacts(input, "lesson_plan")[0];
  const design = findResolvedArtifacts(input, "ppt_design_draft")[0];
  return [
    "# 最终交付清单",
    "",
    "## 已包含材料",
    "- 真实 PPTX 文件",
    "- 课堂视觉图",
    "- 导入视频成片",
    "- 本清单与校验信息",
    "",
    "## 教师核对重点",
    `- 教案：${lessonPlan?.title ?? "已确认教案"}`,
    `- PPT 设计：${design?.title ?? "已确认 PPT 设计稿"}`,
    "- 正式授课前请核对教材页码、例题、页面顺序、视频节奏和课堂锚点。",
    "",
  ].join("\n");
}

function requireArtifact(input: PackageToolAdapterInput, kind: string): ArtifactRecord {
  const artifact = findResolvedArtifacts(input, kind)[0];
  if (!artifact) {
    throw new Error(`missing_${kind}`);
  }
  return artifact;
}

function requireFinalImageArtifact(input: PackageToolAdapterInput): ArtifactRecord {
  const artifact = findResolvedArtifacts(input, "image_prompts").find((candidate) => {
    const storage = candidate.structuredContent.storage;
    if (!isRecord(storage) || !isRecord(storage.imageAsset)) return false;
    return typeof storage.imageAsset.localOutput === "string" && typeof storage.imageAsset.sha256 === "string";
  });
  if (!artifact) throw new Error("missing_final_classroom_image");
  return artifact;
}

function findResolvedArtifacts(input: PackageToolAdapterInput, kind: string): ArtifactRecord[] {
  const refIds = new Set(input.artifactRefs.filter((ref) => ref.kind === kind && ref.artifactId.trim()).map((ref) => ref.artifactId));
  return (input.resolvedArtifacts ?? []).filter(
    (artifact) =>
      refIds.has(artifact.id) &&
      artifact.projectId === input.projectId &&
      artifact.kind === kind &&
      artifact.nodeKey === kind &&
      artifact.status === "approved" &&
      artifact.isApproved === true,
  );
}

function findRepairableArtifact(input: PackageToolAdapterInput, kind: string): ArtifactRecord | undefined {
  const refIds = new Set(input.artifactRefs.filter((ref) => ref.kind === kind).map((ref) => ref.artifactId));
  return (input.resolvedArtifacts ?? [])
    .filter((artifact) => artifact.projectId === input.projectId && artifact.kind === kind && artifact.nodeKey === kind && refIds.has(artifact.id) && artifact.status === "needs_review" && artifact.isApproved === false)
    .sort((left, right) => right.version - left.version || right.updatedAt.localeCompare(left.updatedAt))[0];
}

function parseRepairPageIds(value: string | null | undefined): string[] {
  return [...new Set([...((value ?? "").matchAll(/第\s*(\d{1,2})\s*页/g))].map((match) => `page_${match[1].padStart(2, "0")}`))].sort();
}

function resolveRepairPageIds(input: PackageToolAdapterInput, candidatePageIds: string[]): string[] {
  const hasStructuredPageIds = input.toolInput && Object.prototype.hasOwnProperty.call(input.toolInput, "pageIds");
  const rawPageIds = hasStructuredPageIds ? input.toolInput?.pageIds : undefined;
  if (hasStructuredPageIds && (!Array.isArray(rawPageIds) || rawPageIds.length === 0)) {
    throw new Error("ppt_page_repair_page_id_required");
  }

  const pageIds = hasStructuredPageIds
    ? [...new Set((rawPageIds as unknown[]).map((pageId) => {
        if (typeof pageId !== "string" || !/^page_\d{2}$/.test(pageId)) throw new Error("ppt_page_repair_page_id_invalid");
        return pageId;
      }))].sort()
    : parseRepairPageIds(input.userInstruction);
  if (!pageIds.length) throw new Error("ppt_page_repair_page_id_required");

  const candidatePages = new Set(candidatePageIds);
  if (pageIds.some((pageId) => !candidatePages.has(pageId))) throw new Error("ppt_page_repair_page_id_out_of_range");
  return pageIds;
}

function buildTimelineClipInput(artifact: ArtifactRecord) {
  const storage = isRecord(artifact.structuredContent.storage) ? artifact.structuredContent.storage : null;
  const videoAsset = storage && isRecord(storage.videoAsset) ? storage.videoAsset : null;
  const requestEvidence = videoAsset && isRecord(videoAsset.requestEvidence) ? videoAsset.requestEvidence : null;
  const shotId = requestEvidence?.shotId;
  if (typeof shotId !== "string" || !/^shot_[a-z0-9_-]+$/i.test(shotId)) throw new Error("video_segment_shot_binding_missing");
  const match = shotId.match(/(\d+)$/);
  if (!match) throw new Error("video_segment_shot_ordinal_missing");
  const localOutput = typeof videoAsset?.localOutput === "string" ? videoAsset.localOutput : "";
  const sourcePath = resolveLocalArtifactOutput(localOutput);
  if (!sourcePath) throw new Error("video_segment_storage_invalid");
  const buffer = buildStoredVideoDownload(artifact).buffer;
  const storedDigest = typeof videoAsset?.sha256 === "string" ? videoAsset.sha256.toLowerCase() : "";
  const actualDigest = createHash("sha256").update(buffer).digest("hex");
  if (storedDigest && storedDigest !== actualDigest) throw new Error("video_segment_digest_mismatch");
  return { shotId, ordinal: Number(match[1]), sourceArtifactId: artifact.id, sourcePath, sourceSha256: actualDigest };
}

function buildArtifactTruth(tool: ToolDefinition, fallbackKind: string): ToolArtifactTruth {
  return {
    created: true,
    persisted: true,
    persistenceScope: "provider_local_file",
    providerPersisted: true,
    workbenchPersisted: false,
    placeholder: false,
    producedArtifactKind: tool.producedArtifactKind ?? fallbackKind,
  };
}

function buildFailureResult(
  input: PackageToolAdapterInput,
  kind: "tool_failed" | "quality_gate_failed",
  teacherSafeSummary: string,
  internalReason: string,
  errorCategory: string,
): ToolExecutionResult {
  const capabilityId = input.tool.capabilityId ?? "unknown";
  return {
    status: "failed",
    toolId: input.tool.id,
    capabilityId,
    observation: createToolObservation({
      projectId: input.projectId,
      sourceMessageId: input.sourceMessageId,
      capabilityId,
      expectedArtifactKind: input.tool.producedArtifactKind,
      kind,
      teacherSafeSummary,
      internalReasonSanitized: internalReason,
      retryPolicy: { retryable: false, nextAction: kind === "quality_gate_failed" ? "fix_inputs" : "ask_teacher" },
    }),
    artifactCreated: false,
    errorCategory,
    budgetEvent: buildBudgetEvent(input.tool, "failed", kind),
  };
}

function buildBudgetEvent(tool: ToolDefinition, status: "succeeded" | "failed", kind: "tool_succeeded" | "tool_failed" | "quality_gate_failed") {
  return buildAgentHarnessBudgetEvent({
    capabilityId: tool.capabilityId ?? "unknown",
    actionKey: `${tool.id}:${tool.producedArtifactKind ?? ""}`,
    expectedArtifactKind: tool.producedArtifactKind,
    status,
    kind,
  });
}

function validateZipBuffer(buffer: Buffer) {
  return buffer.length > 64 && buffer.subarray(0, 2).toString("utf8") === "PK" && buffer.includes(Buffer.from("manifest.json"));
}

function validateMp4Buffer(buffer: Buffer) {
  if (buffer.length < 1024) return false;
  const ftypLimit = Math.min(buffer.length - 4, 64);
  let hasFtyp = false;
  for (let index = 0; index <= ftypLimit; index += 1) {
    if (buffer.subarray(index, index + 4).toString("ascii") === "ftyp") {
      hasFtyp = true;
      break;
    }
  }
  const moovLimit = Math.min(buffer.length - 4, 1024 * 1024);
  let hasMoov = false;
  for (let index = 0; index <= moovLimit; index += 1) {
    if (buffer.subarray(index, index + 4).toString("ascii") === "moov") {
      hasMoov = true;
      break;
    }
  }
  return hasFtyp && hasMoov;
}

function safeFileSegment(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-")
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "project"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function readPackageAssetBuffer(artifact: ArtifactRecord) {
  const storage = artifact.structuredContent.storage;
  const packageAsset = storage && typeof storage === "object" ? (storage as Record<string, unknown>).packageAsset : null;
  if (!packageAsset || typeof packageAsset !== "object") {
    throw new Error("stored_package_asset_not_found");
  }
  const asset = packageAsset as { localOutput?: unknown; fileName?: unknown };
  const localOutput = typeof asset.localOutput === "string" ? asset.localOutput : "";
  const absolutePath = resolveLocalArtifactOutput(localOutput);
  if (!absolutePath) {
    throw new Error("stored_package_path_outside_storage");
  }
  const buffer = readFileSync(absolutePath);
  if (!validateZipBuffer(buffer)) {
    throw new Error("invalid_stored_package_file");
  }
  return {
    filename: typeof asset.fileName === "string" && asset.fileName.trim() ? asset.fileName : `${safeFileSegment(artifact.id)}.zip`,
    buffer,
  };
}
