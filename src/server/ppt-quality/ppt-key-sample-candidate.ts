import { hashRunInput } from "@/server/execution/run-input-snapshot";
import type { PptAssetManifest, PptAssetRequestBatch, PptKeySampleCandidate, PptKeySampleSet } from "./ppt-asset-types";
import type { PptKeySampleCompositionResult } from "./ppt-key-sample-composer";
import type { PptKeySampleRenderEvidence } from "./ppt-key-sample-renderer";
import type { PptDesignPackage } from "./ppt-quality-types";
import { buildPptKeySampleSet } from "./ppt-key-sample-set-builder";

export function createPptKeySampleCandidateDigest(input: Omit<PptKeySampleCandidate, "candidateDigest">): string {
  return hashRunInput(input);
}

export function buildPptKeySampleCandidate(input: {
  designPackage: PptDesignPackage;
  requestBatch: PptAssetRequestBatch;
  manifest: PptAssetManifest;
  composition: PptKeySampleCompositionResult;
  renderEvidence: PptKeySampleRenderEvidence;
}): PptKeySampleCandidate {
  const renderByPage = new Map(input.renderEvidence.pageRenders.map((render) => [render.pageId, render]));
  const semantic: Omit<PptKeySampleCandidate, "candidateDigest"> = {
    schemaVersion: "ppt-key-sample-candidate.v1",
    designPackageDigest: input.requestBatch.designPackageDigest,
    requestBatchDigest: input.requestBatch.batchDigest,
    assetManifestDigest: input.manifest.manifestDigest,
    samplePageIds: [...input.designPackage.samplePlan.samplePageIds],
    samplePptx: { ...input.renderEvidence.samplePptx },
    overviews: input.renderEvidence.overviews.map((overview) => ({ ...overview, pageIds: [...overview.pageIds] })),
    assembledPages: input.composition.pageEvidence.map((page) => {
      const render = renderByPage.get(page.pageId);
      if (!render) throw new Error(`ppt_sample_render_missing:${page.pageId}`);
      return {
        ...page,
        assetIds: [...page.assetIds],
        editableTextLayerIds: [...page.editableTextLayerIds],
        editableMathLayerIds: [...page.editableMathLayerIds],
        renderRef: render.storageRef,
        renderSha256: render.sha256,
      };
    }),
    reviewStatus: "awaiting_dvp_review",
  };
  return { ...semantic, candidateDigest: createPptKeySampleCandidateDigest(semantic) };
}

export function validatePptKeySampleCandidate(candidate: PptKeySampleCandidate): boolean {
  if (candidate.schemaVersion !== "ppt-key-sample-candidate.v1" || candidate.reviewStatus !== "awaiting_dvp_review") return false;
  if (candidate.samplePageIds.length < 3 || candidate.samplePageIds.length > 4) return false;
  if (candidate.assembledPages.length !== candidate.samplePageIds.length || candidate.overviews.length !== 3) return false;
  if (new Set(candidate.overviews.map((item) => item.kind)).size !== 3) return false;
  const { candidateDigest: _digest, ...semantic } = candidate;
  return createPptKeySampleCandidateDigest(semantic) === candidate.candidateDigest;
}

export function sealPptKeySampleCandidate(input: {
  designPackage: PptDesignPackage;
  requestBatch: PptAssetRequestBatch;
  manifest: PptAssetManifest;
  candidate: PptKeySampleCandidate;
  qa: PptKeySampleSet["qa"];
}): PptKeySampleSet {
  if (!validatePptKeySampleCandidate(input.candidate)) throw new Error("ppt_key_sample_candidate_invalid");
  if (
    input.candidate.designPackageDigest !== input.requestBatch.designPackageDigest ||
    input.candidate.requestBatchDigest !== input.requestBatch.batchDigest ||
    input.candidate.assetManifestDigest !== input.manifest.manifestDigest
  ) throw new Error("ppt_key_sample_candidate_stale");
  return buildPptKeySampleSet({
    designPackage: input.designPackage,
    requestBatch: input.requestBatch,
    manifest: input.manifest,
    composition: {
      pptxBuffer: Buffer.alloc(0),
      pptxSha256: input.candidate.samplePptx.sha256,
      pageEvidence: input.candidate.assembledPages.map(({ renderRef: _renderRef, renderSha256: _renderSha256, ...page }) => page),
    },
    renderEvidence: {
      samplePptx: input.candidate.samplePptx,
      pageRenders: input.candidate.assembledPages.map((page) => ({ pageId: page.pageId, storageRef: page.renderRef, sha256: page.renderSha256 })),
      overviews: input.candidate.overviews,
    },
    qa: input.qa,
  });
}
