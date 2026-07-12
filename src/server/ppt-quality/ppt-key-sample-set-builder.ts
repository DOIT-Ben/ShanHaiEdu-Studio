import type { PptDesignPackage } from "./ppt-quality-types";
import type { PptAssetManifest, PptAssetRequestBatch, PptKeySampleSet } from "./ppt-asset-types";
import type { PptKeySampleCompositionResult } from "./ppt-key-sample-composer";
import type { PptKeySampleRenderEvidence } from "./ppt-key-sample-renderer";
import { createPptKeySampleSetDigest, validatePptKeySampleSet } from "./ppt-sample-validator";

export function buildPptKeySampleSet(input: {
  designPackage: PptDesignPackage;
  requestBatch: PptAssetRequestBatch;
  manifest: PptAssetManifest;
  composition: PptKeySampleCompositionResult;
  renderEvidence: PptKeySampleRenderEvidence;
  qa: PptKeySampleSet["qa"];
}): PptKeySampleSet {
  const renderByPage = new Map(input.renderEvidence.pageRenders.map((render) => [render.pageId, render]));
  const sampleSetWithoutDigest: Omit<PptKeySampleSet, "sampleSetDigest"> = {
    schemaVersion: "ppt-key-sample-set.v1",
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
    qa: input.qa.map((entry) => ({ ...entry, findings: [...entry.findings] })),
  };
  const sampleSet: PptKeySampleSet = {
    ...sampleSetWithoutDigest,
    sampleSetDigest: createPptKeySampleSetDigest(sampleSetWithoutDigest),
  };
  const validation = validatePptKeySampleSet({
    designPackage: input.designPackage,
    requestBatch: input.requestBatch,
    manifest: input.manifest,
    sampleSet,
  });
  if (!validation.valid) throw new Error(`ppt_key_sample_set_invalid:${validation.issues.map((item) => item.code).join(",")}`);
  return sampleSet;
}
