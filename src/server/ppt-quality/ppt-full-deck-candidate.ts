import { hashRunInput } from "@/server/execution/run-input-snapshot";
import type { PptAssetManifest, PptAssetRequestBatch, PptKeySampleSet, PptSampleApproval } from "./ppt-asset-types";
import type { PptDeckCompositionResult } from "./ppt-key-sample-composer";
import type { PptFullDeckRenderEvidence } from "./ppt-full-deck-renderer";
import type { PptFullDeckCandidate, PptFullDeckPackage } from "./ppt-production-types";
import type { PptDesignPackage } from "./ppt-quality-types";

const SHA256 = /^[a-f0-9]{64}$/i;

export function buildPptFullDeckCandidate(input: {
  designPackage: PptDesignPackage;
  requestBatch: PptAssetRequestBatch;
  manifest: PptAssetManifest;
  sampleSet: PptKeySampleSet;
  sampleApproval: PptSampleApproval;
  composition: PptDeckCompositionResult;
  renderEvidence: PptFullDeckRenderEvidence;
}): PptFullDeckCandidate {
  const pageIds = input.designPackage.pageSpecs.map((page) => page.pageId);
  const renderByPage = new Map(input.renderEvidence.pageRenders.map((page) => [page.pageId, page]));
  const semantic: Omit<PptFullDeckCandidate, "candidateDigest"> = {
    schemaVersion: "ppt-full-deck-candidate.v1",
    designPackageDigest: input.requestBatch.designPackageDigest,
    requestBatchDigest: input.requestBatch.batchDigest,
    assetManifestDigest: input.manifest.manifestDigest,
    sampleSetDigest: input.sampleSet.sampleSetDigest,
    sampleApprovalDigest: hashRunInput(input.sampleApproval),
    pageIds,
    pptx: { ...input.renderEvidence.pptx },
    pdf: { ...input.renderEvidence.pdf },
    pages: input.composition.pageEvidence.map((page) => {
      const render = renderByPage.get(page.pageId);
      if (!render) throw new Error(`ppt_full_page_render_missing:${page.pageId}`);
      return { ...page, renderRef: render.storageRef, renderSha256: render.sha256 };
    }),
    contactSheet: { ...input.renderEvidence.contactSheet, pageIds: [...input.renderEvidence.contactSheet.pageIds] },
    reviewStatus: "awaiting_delivery_review",
  };
  const candidate = { ...semantic, candidateDigest: hashRunInput(semantic) };
  if (!validatePptFullDeckCandidate(candidate)) throw new Error("ppt_full_deck_candidate_invalid");
  return candidate;
}

export function validatePptFullDeckCandidate(candidate: PptFullDeckCandidate): boolean {
  if (candidate.schemaVersion !== "ppt-full-deck-candidate.v1" || candidate.reviewStatus !== "awaiting_delivery_review") return false;
  if (candidate.pageIds.length < 12 || candidate.pages.length !== candidate.pageIds.length) return false;
  if (candidate.pptx.slideCount !== candidate.pageIds.length || candidate.pdf.pageCount !== candidate.pageIds.length) return false;
  if (![candidate.pptx.sha256, candidate.pdf.sha256, candidate.contactSheet.sha256, ...candidate.pages.map((page) => page.renderSha256)].every((value) => SHA256.test(value))) return false;
  if (!sameSet(candidate.pageIds, candidate.pages.map((page) => page.pageId)) || !sameSet(candidate.pageIds, candidate.contactSheet.pageIds)) return false;
  if (candidate.pages.some((page) => page.rasterizedExactContent !== false || page.editableTextLayerIds.length === 0 || page.editableMathLayerIds.length === 0)) return false;
  const { candidateDigest: _digest, ...semantic } = candidate;
  return hashRunInput(semantic) === candidate.candidateDigest;
}

export function sealPptFullDeckCandidate(candidate: PptFullDeckCandidate, qa: PptFullDeckPackage["qa"]): PptFullDeckPackage {
  if (!validatePptFullDeckCandidate(candidate)) throw new Error("ppt_full_deck_candidate_invalid");
  if (!sameSet(candidate.pageIds, qa.map((entry) => entry.pageId))) throw new Error("ppt_full_deck_qa_incomplete");
  if (qa.some((entry) => entry.design !== "passed" || entry.visual !== "passed" || entry.provenance !== "passed" || entry.readability !== "passed" || entry.findings.length > 0)) {
    throw new Error("ppt_full_deck_qa_failed");
  }
  const { reviewStatus: _review, candidateDigest: _candidateDigest, ...base } = candidate;
  const semantic: Omit<PptFullDeckPackage, "packageDigest"> = { ...base, qa: qa.map((entry) => ({ ...entry, findings: [...entry.findings] })), finalEligible: true };
  return { ...semantic, packageDigest: hashRunInput(semantic) };
}

export function validatePptFullDeckPackage(value: PptFullDeckPackage): boolean {
  if (value.finalEligible !== true || value.pageIds.length < 12 || value.pages.length !== value.pageIds.length) return false;
  if (value.pptx.slideCount !== value.pageIds.length || value.pdf.pageCount !== value.pageIds.length) return false;
  if (!sameSet(value.pageIds, value.qa.map((entry) => entry.pageId))) return false;
  if (value.qa.some((entry) => entry.design !== "passed" || entry.visual !== "passed" || entry.provenance !== "passed" || entry.readability !== "passed" || entry.findings.length > 0)) return false;
  const { packageDigest: _digest, ...semantic } = value;
  return hashRunInput(semantic) === value.packageDigest;
}

function sameSet(left: string[], right: string[]): boolean {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
