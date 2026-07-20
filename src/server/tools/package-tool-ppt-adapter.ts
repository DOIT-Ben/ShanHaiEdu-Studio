import type { PptAssetManifest, PptAssetRequestBatch, PptKeySampleCandidate, PptKeySampleSet, PptSampleApproval } from "@/server/ppt-quality/ppt-asset-types";
import { buildPptKeySampleCandidate, validatePptKeySampleCandidate } from "@/server/ppt-quality/ppt-key-sample-candidate";
import { composePptKeySamplePptx } from "@/server/ppt-quality/ppt-key-sample-composer";
import { renderPptKeySamples } from "@/server/ppt-quality/ppt-key-sample-renderer";
import { composePptFullDeckPptx } from "@/server/ppt-quality/ppt-full-deck-composer";
import { renderPptFullDeck } from "@/server/ppt-quality/ppt-full-deck-renderer";
import { repairPptFullDeckPages } from "@/server/ppt-quality/ppt-full-deck-page-repair";
import { buildPptFullDeckCandidate, validatePptFullDeckCandidate } from "@/server/ppt-quality/ppt-full-deck-candidate";
import type { PptFullDeckCandidate } from "@/server/ppt-quality/ppt-production-types";
import type { PptDesignPackage } from "@/server/ppt-quality/ppt-quality-types";
import type { ArtifactRecord } from "@/server/workbench/types";

import {
  buildArtifactTruth,
  buildBudgetEvent,
  findResolvedArtifacts,
  isRecord,
  requireArtifact,
  type PackageToolAdapterInput,
} from "./package-tool-adapter-shared";
import type { ToolExecutionResult, ToolQualityGateResult } from "./tool-types";

export async function executePptPageRepair(input: PackageToolAdapterInput): Promise<ToolExecutionResult> {
  const previous = findRepairableArtifact(input, "pptx_artifact");
  const design = requireArtifact(input, "ppt_design_draft");
  const assets = findResolvedArtifacts(input, "image_prompts").find((artifact) =>
    isRecord(artifact.structuredContent.pptAssetRequestBatch) &&
    isRecord(artifact.structuredContent.pptAssetManifest) &&
    isRecord(artifact.structuredContent.pptKeySampleSet) &&
    isRecord(artifact.structuredContent.pptSampleApproval));
  const previousCandidate = previous?.structuredContent.pptFullDeckCandidate as PptFullDeckCandidate | undefined;
  const designPackage = design.structuredContent.pptDesignPackage as PptDesignPackage | undefined;
  const requestBatch = assets?.structuredContent.pptAssetRequestBatch as PptAssetRequestBatch | undefined;
  const manifest = assets?.structuredContent.pptAssetManifest as PptAssetManifest | undefined;
  const sampleSet = assets?.structuredContent.pptKeySampleSet as PptKeySampleSet | undefined;
  const sampleApproval = assets?.structuredContent.pptSampleApproval as PptSampleApproval | undefined;
  if (!previous || !previousCandidate || !validatePptFullDeckCandidate(previousCandidate) || !designPackage || !requestBatch || !manifest || !sampleSet || !sampleApproval) {
    throw new Error("ppt_page_repair_inputs_incomplete");
  }
  const pageIds = resolveRepairPageIds(input, previousCandidate.pageIds);
  const repaired = await repairPptFullDeckPages({ previousCandidate, repairedPageIds: pageIds, designPackage, requestBatch, manifest, sampleSet, sampleApproval });
  const candidate = buildPptFullDeckCandidate({ designPackage, requestBatch, manifest, sampleSet, sampleApproval, composition: repaired.composition, renderEvidence: repaired.renderEvidence });
  const artifactTruth = buildArtifactTruth(input.tool, "pptx_artifact");
  const qualityGate = { passed: true, gates: ["page_scoped_repair", "unaffected_page_evidence_reused", "awaiting_delivery_review"] } satisfies ToolQualityGateResult;
  return { status: "succeeded", toolId: input.tool.id, capabilityId: "ppt_page_repair", artifactDraft: { nodeKey: "pptx_artifact", kind: "pptx_artifact", title: "完整 PPT 页级返修包", summary: `已返修第 ${pageIds.map((pageId) => Number(pageId.slice(5))).join("、")} 页，等待重新审查。`, markdownContent: "# 完整 PPT 页级返修包\n\n仅指定页面已更新，其他页面证据已复用，等待重新审查。", structuredContent: { pptFullDeckCandidate: candidate, repairedPageIds: pageIds, sourceArtifactIds: [previous.id, design.id, assets!.id], artifactTruth, qualityGate } }, artifactTruth, qualityGate, assistantSummary: "指定课件页面已返修，其他页面未重复生成，等待重新审查。", budgetEvent: buildBudgetEvent(input.tool, "succeeded", "tool_succeeded") };
}

export async function executePptFullDeckAssembly(input: PackageToolAdapterInput): Promise<ToolExecutionResult> {
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
          cozePptx: { fileName: "shanhai-quality-full-deck.pptx", localOutput: candidate.pptx.storageRef, bytes: candidate.pptx.bytes, sha256: candidate.pptx.sha256, slideCount: candidate.pptx.slideCount, generationMode: "ppt_quality_asset_assembly" },
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
  const renderEvidence = await renderPptFullDeck({ pptxBuffer: composition.pptxBuffer, pageIds: input.designPackage.pageSpecs.map((page) => page.pageId), slideCount: composition.slideCount });
  return buildPptFullDeckCandidate({ ...input, composition, renderEvidence });
}

export async function executePptKeySampleAssembly(input: PackageToolAdapterInput): Promise<ToolExecutionResult> {
  const designArtifact = requireArtifact(input, "ppt_design_draft");
  const assetArtifact = findResolvedArtifacts(input, "image_prompts").find((artifact) =>
    isRecord(artifact.structuredContent.pptAssetRequestBatch) && isRecord(artifact.structuredContent.pptAssetManifest));
  if (!assetArtifact) throw new Error("missing_ppt_sample_asset_bundle");

  const designPackage = designArtifact.structuredContent.pptDesignPackage as PptDesignPackage | undefined;
  const requestBatch = assetArtifact.structuredContent.pptAssetRequestBatch as PptAssetRequestBatch | undefined;
  const manifest = assetArtifact.structuredContent.pptAssetManifest as PptAssetManifest | undefined;
  if (!designPackage || !requestBatch || !manifest) throw new Error("ppt_sample_assembly_inputs_incomplete");

  const candidate = await (input.runPptKeySampleAssembly ?? runDefaultPptKeySampleAssembly)({ designPackage, requestBatch, manifest });
  if (!validatePptKeySampleCandidate(candidate)) throw new Error("ppt_key_sample_candidate_invalid");
  const artifactTruth = buildArtifactTruth(input.tool, "image_prompts");
  const qualityGate = { passed: true, gates: ["editable_sample_pptx_created", "sample_pages_rendered", "three_overviews_created", "awaiting_dvp_review"] } satisfies ToolQualityGateResult;
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
      structuredContent: { pptDesignPackage: designPackage, pptAssetRequestBatch: requestBatch, pptAssetManifest: manifest, pptKeySampleCandidate: candidate, sourceArtifactIds: [designArtifact.id, assetArtifact.id], artifactTruth, qualityGate },
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
  const renderEvidence = await renderPptKeySamples({ pptxBuffer: composition.pptxBuffer, samplePageIds: input.designPackage.samplePlan.samplePageIds, manifest: input.manifest });
  return buildPptKeySampleCandidate({ ...input, composition, renderEvidence });
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
  if (hasStructuredPageIds && (!Array.isArray(rawPageIds) || rawPageIds.length === 0)) throw new Error("ppt_page_repair_page_id_required");
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
