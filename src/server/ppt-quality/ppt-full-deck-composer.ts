import { validatePptxBuffer } from "@/server/coze-ppt/coze-ppt-run";
import { composePptDeckPptx, type PptDeckCompositionResult } from "./ppt-key-sample-composer";
import { validatePptDesignPackage } from "./ppt-design-validator";
import { validatePptSampleApproval } from "./ppt-sample-validator";
import type { PptAssetManifest, PptAssetRequestBatch, PptKeySampleSet, PptSampleApproval } from "./ppt-asset-types";
import type { PptDesignPackage } from "./ppt-quality-types";

export async function composePptFullDeckPptx(input: {
  designPackage: PptDesignPackage;
  requestBatch: PptAssetRequestBatch;
  manifest: PptAssetManifest;
  sampleSet: PptKeySampleSet;
  sampleApproval: PptSampleApproval;
}): Promise<PptDeckCompositionResult & { slideCount: number }> {
  const designValidation = validatePptDesignPackage(input.designPackage);
  if (!designValidation.valid) throw new Error(`ppt_full_design_invalid:${designValidation.issues.map((item) => item.code).join(",")}`);
  if (input.requestBatch.scope !== "full_production" || input.manifest.scope !== "full_production") {
    throw new Error("ppt_full_production_scope_required");
  }
  if (input.requestBatch.designPackageDigest !== input.sampleSet.designPackageDigest) {
    throw new Error("ppt_full_sample_design_stale");
  }
  const approvalValidation = validatePptSampleApproval(input.sampleSet, input.sampleApproval);
  if (!approvalValidation.valid) throw new Error(`ppt_full_sample_approval_invalid:${approvalValidation.issues.map((item) => item.code).join(",")}`);

  const pageIds = input.designPackage.pageSpecs.map((page) => page.pageId);
  if (pageIds.length < 12 || pageIds.length !== input.designPackage.brief.targetSlideCount) {
    throw new Error("ppt_full_slide_count_contract_failed");
  }
  const composition = await composePptDeckPptx({ ...input, pageIds, titleSuffix: "公开课课件" });
  const pptxValidation = await validatePptxBuffer(composition.pptxBuffer);
  if (!pptxValidation.valid || pptxValidation.slideCount !== pageIds.length) {
    throw new Error(`ppt_full_pptx_invalid:${pptxValidation.slideCount}_of_${pageIds.length}`);
  }
  return { ...composition, slideCount: pptxValidation.slideCount };
}
