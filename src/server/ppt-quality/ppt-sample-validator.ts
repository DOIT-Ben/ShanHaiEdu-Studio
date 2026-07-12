import { hashRunInput } from "@/server/execution/run-input-snapshot";
import type { PptDesignPackage } from "./ppt-quality-types";
import type {
  PptAssetManifest,
  PptAssetRequestBatch,
  PptAssetValidationIssue,
  PptKeySampleSet,
  PptSampleApproval,
} from "./ppt-asset-types";
import { validatePptAssetManifest } from "./ppt-asset-validator";

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const OVERVIEW_KINDS = ["scene_and_primary_props", "micro_assets", "assembled_samples"] as const;
const VAGUE_CONTINUATION = /^(继续|下一步|接着|往下|按刚才的继续)[。！!\s]*$/;

export function createPptKeySampleSetDigest(input: Omit<PptKeySampleSet, "sampleSetDigest">): string {
  return hashRunInput(input);
}

export function validatePptKeySampleSet(input: {
  designPackage: PptDesignPackage;
  requestBatch: PptAssetRequestBatch;
  manifest: PptAssetManifest;
  sampleSet: PptKeySampleSet;
}): { valid: boolean; issues: PptAssetValidationIssue[] } {
  const issues = [...validatePptAssetManifest(input.manifest, input.requestBatch).issues];
  const sampleSet = input.sampleSet;
  const expectedPageIds = input.designPackage.samplePlan.samplePageIds;
  const manifestById = new Map(input.manifest.entries.map((entry) => [entry.assetId, entry]));
  const pagesById = new Map(input.designPackage.pageSpecs.map((page) => [page.pageId, page]));

  if (sampleSet.schemaVersion !== "ppt-key-sample-set.v1") issue(issues, "sample_set_schema_invalid", "Sample set schema is not supported.");
  if (sampleSet.designPackageDigest !== input.requestBatch.designPackageDigest) issue(issues, "sample_design_digest_mismatch", "Sample set is bound to a different design package.");
  if (sampleSet.requestBatchDigest !== input.requestBatch.batchDigest) issue(issues, "sample_request_digest_mismatch", "Sample set is bound to a different request batch.");
  if (sampleSet.assetManifestDigest !== input.manifest.manifestDigest) issue(issues, "sample_manifest_digest_mismatch", "Sample set is bound to a different asset manifest.");
  if (!sameSet(sampleSet.samplePageIds, expectedPageIds) || sampleSet.samplePageIds.length < 3 || sampleSet.samplePageIds.length > 4) {
    issue(issues, "sample_page_set_mismatch", "Sample pages must exactly match the approved 3-4 page sample plan.");
  }
  if (!sampleSet.samplePptx?.storageRef.trim() || !SHA256_PATTERN.test(sampleSet.samplePptx?.sha256 ?? "")) {
    issue(issues, "sample_pptx_evidence_invalid", "Key sample PPTX storage and hash evidence are required.");
  }

  const overviewKinds = sampleSet.overviews.map((overview) => overview.kind);
  if (!sameSet(overviewKinds, [...OVERVIEW_KINDS])) issue(issues, "sample_overviews_incomplete", "Three required overview types must be present exactly once.");
  if (new Set(sampleSet.overviews.map((overview) => overview.storageRef)).size !== sampleSet.overviews.length || new Set(sampleSet.overviews.map((overview) => overview.sha256)).size !== sampleSet.overviews.length) {
    issue(issues, "sample_overviews_not_distinct", "The three overviews must be independent files.");
  }
  for (const overview of sampleSet.overviews) {
    if (!overview.storageRef.trim() || !SHA256_PATTERN.test(overview.sha256) || !sameSet(overview.pageIds, expectedPageIds)) {
      issue(issues, "sample_overview_evidence_invalid", "Overview storage, hash, and page coverage must be valid.");
    }
  }

  if (!sameSet(sampleSet.assembledPages.map((page) => page.pageId), expectedPageIds)) issue(issues, "assembled_sample_pages_incomplete", "Every sample page must have one assembled render.");
  for (const assembled of sampleSet.assembledPages) {
    const page = pagesById.get(assembled.pageId);
    if (!page) {
      issue(issues, "assembled_sample_page_unknown", "Assembled sample page is not in the design package.", undefined, assembled.pageId);
      continue;
    }
    if (!assembled.renderRef.trim() || !SHA256_PATTERN.test(assembled.renderSha256)) issue(issues, "assembled_sample_render_invalid", "Assembled sample render evidence is invalid.", undefined, assembled.pageId);
    if (assembled.rasterizedExactContent !== false) issue(issues, "sample_exact_content_rasterized", "Exact text and math must remain editable.", undefined, assembled.pageId);
    const requiredTextLayers = page.editableText.map((layer) => layer.layerId);
    const requiredMathLayers = page.editableMath.map((layer) => layer.layerId);
    const requiredAssetIds = input.requestBatch.requests
      .filter((request) => request.pageIds.includes(assembled.pageId))
      .map((request) => request.assetId);
    if (!containsAll(assembled.assetIds, requiredAssetIds)) {
      issue(issues, "sample_required_assets_missing", "Assembled sample is missing one or more assets required by the approved page contract.", undefined, assembled.pageId);
    }
    if (!containsAll(assembled.editableTextLayerIds, requiredTextLayers) || !containsAll(assembled.editableMathLayerIds, requiredMathLayers)) {
      issue(issues, "sample_editable_layers_missing", "Assembled sample is missing required editable text or math layers.", undefined, assembled.pageId);
    }
    for (const assetId of assembled.assetIds) {
      const entry = manifestById.get(assetId);
      if (!entry || !entry.pageIds.includes(assembled.pageId)) issue(issues, "sample_asset_unbound", "Assembled sample references an unregistered or wrong-page asset.", assetId, assembled.pageId);
    }
  }

  if (!sameSet(sampleSet.qa.map((entry) => entry.pageId), expectedPageIds)) issue(issues, "sample_qa_incomplete", "Every sample page must have one D/V/P QA result.");
  for (const qa of sampleSet.qa) {
    if (qa.design !== "passed" || qa.visual !== "passed" || qa.provenance !== "passed" || qa.findings.length > 0) {
      issue(issues, "sample_qa_failed", "All D/V/P checks must pass with no unresolved findings.", undefined, qa.pageId);
    }
  }

  const { sampleSetDigest: _digest, ...semanticSampleSet } = sampleSet;
  if (createPptKeySampleSetDigest(semanticSampleSet) !== sampleSet.sampleSetDigest) issue(issues, "sample_set_digest_mismatch", "Sample set digest does not match its semantic content.");
  return { valid: issues.length === 0, issues };
}

export function validatePptSampleApproval(
  sampleSet: PptKeySampleSet,
  approval: PptSampleApproval | undefined,
): { valid: boolean; issues: PptAssetValidationIssue[] } {
  const issues: PptAssetValidationIssue[] = [];
  if (!approval) {
    issue(issues, "sample_approval_missing", "Explicit sample approval is required.");
    return { valid: false, issues };
  }
  if (approval.schemaVersion !== "ppt-sample-approval.v1" || approval.decision !== "approved") issue(issues, "sample_approval_invalid", "Sample approval decision is invalid.");
  if (approval.sampleSetDigest !== sampleSet.sampleSetDigest || approval.designPackageDigest !== sampleSet.designPackageDigest) issue(issues, "sample_approval_stale", "Sample approval is bound to an older sample or design package.");
  if (!approval.decisionText.trim() || VAGUE_CONTINUATION.test(approval.decisionText.trim())) issue(issues, "sample_approval_not_explicit", "A vague continuation message cannot approve samples.");
  if (approval.decisionSource === "explicit_teacher_message" && !approval.teacherMessageId?.trim()) issue(issues, "sample_approval_message_missing", "Explicit teacher approval must reference the source message.");
  if (!Number.isFinite(Date.parse(approval.approvedAt))) issue(issues, "sample_approval_time_invalid", "Sample approval time is invalid.");
  return { valid: issues.length === 0, issues };
}

function sameSet(left: string[], right: readonly string[]): boolean {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.length === sortedRight.length && sortedLeft.every((value, index) => value === sortedRight[index]);
}

function containsAll(actual: string[], expected: string[]): boolean {
  const set = new Set(actual);
  return expected.every((value) => set.has(value));
}

function issue(issues: PptAssetValidationIssue[], code: string, message: string, assetId?: string, pageId?: string): void {
  issues.push({ code, message, assetId, pageId });
}
