import { composePptFullDeckPptx } from "./ppt-full-deck-composer";
import { buildPptFullDeckContactSheet, renderPptFullDeck, type PptFullDeckRenderEvidence } from "./ppt-full-deck-renderer";
import type { PptFullDeckCandidate } from "./ppt-production-types";
import type { PptAssetManifest, PptAssetRequestBatch, PptKeySampleSet, PptSampleApproval } from "./ppt-asset-types";
import type { PptDesignPackage } from "./ppt-quality-types";

export async function repairPptFullDeckPages(input: {
  previousCandidate: PptFullDeckCandidate;
  repairedPageIds: string[];
  designPackage: PptDesignPackage;
  requestBatch: PptAssetRequestBatch;
  manifest: PptAssetManifest;
  sampleSet: PptKeySampleSet;
  sampleApproval: PptSampleApproval;
  convert?: (input: { pptxPath: string; outputDir: string }) => Promise<{ pdfPath: string; pdfPageCount: number; renderPaths: string[] }>;
}): Promise<{ composition: Awaited<ReturnType<typeof composePptFullDeckPptx>>; renderEvidence: PptFullDeckRenderEvidence }> {
  const pageIds = input.designPackage.pageSpecs.map((page) => page.pageId);
  const repairedPageIds = [...new Set(input.repairedPageIds)].sort();
  if (!repairedPageIds.length || repairedPageIds.some((pageId) => !pageIds.includes(pageId))) {
    throw new Error("ppt_full_page_repair_target_invalid");
  }
  if (input.previousCandidate.pageIds.length !== pageIds.length || input.previousCandidate.pageIds.some((pageId, index) => pageId !== pageIds[index])) {
    throw new Error("ppt_full_page_repair_candidate_stale");
  }

  const composition = await composePptFullDeckPptx(input);
  const reusableRenders = input.previousCandidate.pages
    .filter((page) => !repairedPageIds.includes(page.pageId))
    .map((page) => ({ pageId: page.pageId, storageRef: page.renderRef, sha256: page.renderSha256 }));
  const rendered = await renderPptFullDeck({
    pptxBuffer: composition.pptxBuffer,
    pageIds,
    slideCount: composition.slideCount,
    reusePageRenders: reusableRenders,
    convert: input.convert,
  });
  const contactSheet = await buildPptFullDeckContactSheet(rendered.pageRenders, "page-repair-contact-sheet.png");

  return {
    composition,
    renderEvidence: { ...rendered, contactSheet: { ...contactSheet, pageIds } },
  };
}
