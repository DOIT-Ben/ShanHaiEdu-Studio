import { hashRunInput } from "@/server/execution/run-input-snapshot";
import type {
  PptAssetManifest,
  PptAssetManifestEntry,
  PptAssetRequestBatch,
  PptAssetValidationIssue,
} from "./ppt-asset-types";

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const FORBIDDEN_FILE_MARKER = /(?:^|[-_.])(placeholder|stand[-_]?in|mock|temp|temporary)(?:[-_.]|$)/i;
const ALLOWED_PROCESSING_OPERATIONS = new Set([
  "remove_background",
  "crop",
  "resize",
  "color_correction",
  "format_conversion",
  "alias",
  "instance_copy",
]);

export function createPptAssetManifestDigest(input: Omit<PptAssetManifest, "manifestDigest">): string {
  return hashRunInput(input);
}

export function validatePptAssetManifest(
  manifest: PptAssetManifest,
  requestBatch: PptAssetRequestBatch,
): { valid: boolean; issues: PptAssetValidationIssue[] } {
  const issues: PptAssetValidationIssue[] = [];
  const requestsById = new Map(requestBatch.requests.map((request) => [request.assetId, request]));
  const entriesById = new Map<string, PptAssetManifestEntry>();

  if (manifest.schemaVersion !== "ppt-asset-manifest.v1") issue(issues, "asset_manifest_schema_invalid", "Asset manifest schema is not supported.");
  if (manifest.scope !== requestBatch.scope) issue(issues, "asset_manifest_scope_mismatch", "Asset manifest scope does not match the request batch.");
  if (manifest.designPackageDigest !== requestBatch.designPackageDigest) issue(issues, "asset_manifest_design_digest_mismatch", "Asset manifest is bound to a different design package.");
  if (manifest.requestBatchDigest !== requestBatch.batchDigest) issue(issues, "asset_manifest_request_digest_mismatch", "Asset manifest is bound to a different request batch.");

  for (const entry of manifest.entries) {
    if (entriesById.has(entry.assetId)) issue(issues, "duplicate_asset_manifest_entry", "Asset manifest contains a duplicate assetId.", entry.assetId);
    entriesById.set(entry.assetId, entry);
    const request = requestsById.get(entry.assetId);
    if (!request) {
      issue(issues, "asset_not_requested", "Asset manifest contains an asset outside the approved request batch.", entry.assetId);
      continue;
    }
    validateEntry(entry, request, issues);
  }

  for (const request of requestBatch.requests) {
    if (!entriesById.has(request.assetId)) issue(issues, "requested_asset_missing", "A requested asset is missing from the manifest.", request.assetId);
  }

  const { manifestDigest: _digest, ...semanticManifest } = manifest;
  if (createPptAssetManifestDigest(semanticManifest) !== manifest.manifestDigest) {
    issue(issues, "asset_manifest_digest_mismatch", "Asset manifest digest does not match its semantic content.");
  }
  return { valid: issues.length === 0, issues };
}

function validateEntry(
  entry: PptAssetManifestEntry,
  request: PptAssetRequestBatch["requests"][number],
  issues: PptAssetValidationIssue[],
) {
  if (entry.assetKind !== request.assetKind) issue(issues, "asset_kind_mismatch", "Asset kind does not match the request.", entry.assetId);
  if (!sameSet(entry.pageIds, request.pageIds) || entry.pageIds.length === 0) issue(issues, "asset_page_binding_mismatch", "Asset page bindings do not match the request.", entry.assetId);
  if (entry.sourceAuthority !== "provider_generated" || entry.placeholder !== false || entry.localSubjectDrawn !== false || FORBIDDEN_FILE_MARKER.test(entry.fileName)) {
    issue(issues, "asset_lineage_forbidden", "Placeholder, local stand-in, or non-provider subject lineage is forbidden.", entry.assetId);
  }
  if (![entry.provider, entry.model, entry.clientRequestId, entry.inputHash, entry.promptDigest, entry.fileName, entry.storageRef].every(nonEmpty)) {
    issue(issues, "asset_lineage_incomplete", "Provider, task, request, and storage lineage must be complete.", entry.assetId);
  }
  if (entry.inputHash !== request.inputHash) issue(issues, "asset_input_hash_mismatch", "Asset inputHash does not match the approved request.", entry.assetId);
  if (entry.promptDigest !== request.promptDigest) issue(issues, "asset_prompt_digest_mismatch", "Asset prompt digest does not match the approved request.", entry.assetId);
  if (!sameSet(entry.referenceAssetIds, request.referenceAssetIds) || !sameSet(entry.sentReferenceAssetIds, request.referenceAssetIds)) {
    issue(issues, "asset_reference_evidence_mismatch", "Reference assets were not proven as actually sent.", entry.assetId);
  }
  if (!SHA256_PATTERN.test(entry.sha256) || entry.bytes <= 0 || entry.width <= 0 || entry.height <= 0) {
    issue(issues, "asset_file_evidence_invalid", "Asset hash, byte size, and dimensions must be valid.", entry.assetId);
  }
  if (!entry.rawAsset) {
    issue(issues, "asset_raw_evidence_missing", "Provider raw image file evidence is required.", entry.assetId);
  } else {
    validateFileEvidence(entry.rawAsset, "raw", entry.assetId, issues);
  }
  if (!entry.normalizedAsset) {
    issue(issues, "asset_normalized_evidence_missing", "Normalized image file evidence is required.", entry.assetId);
  } else {
    validateFileEvidence(entry.normalizedAsset, "normalized", entry.assetId, issues);
  }
  if (entry.rawAsset && entry.normalizedAsset) {
    if (entry.rawAsset.storageRef === entry.normalizedAsset.storageRef || entry.rawAsset.fileName === entry.normalizedAsset.fileName) {
      issue(issues, "asset_raw_normalized_locator_collision", "Raw and normalized images must be stored as distinct files.", entry.assetId);
    }
    if (
      entry.normalizedAsset.fileName !== entry.fileName ||
      entry.normalizedAsset.storageRef !== entry.storageRef ||
      entry.normalizedAsset.sha256 !== entry.sha256 ||
      entry.normalizedAsset.bytes !== entry.bytes ||
      entry.normalizedAsset.width !== entry.width ||
      entry.normalizedAsset.height !== entry.height ||
      entry.normalizedAsset.mime !== entry.mime
    ) {
      issue(issues, "asset_normalized_evidence_mismatch", "Normalized file evidence must match the delivered image fields.", entry.assetId);
    }
  }
  if (entry.transparentBackground !== request.transparentBackground) issue(issues, "asset_transparency_mismatch", "Asset transparency policy does not match the request.", entry.assetId);

  let expectedSourceHash: string | undefined;
  for (const step of entry.processingChain) {
    if (!ALLOWED_PROCESSING_OPERATIONS.has(step.operation)) issue(issues, "asset_processing_operation_forbidden", "Asset processing chain contains a forbidden operation.", entry.assetId);
    if (!SHA256_PATTERN.test(step.sourceSha256) || !SHA256_PATTERN.test(step.targetSha256)) issue(issues, "asset_processing_hash_invalid", "Asset processing step hashes are invalid.", entry.assetId);
    if (expectedSourceHash && step.sourceSha256 !== expectedSourceHash) issue(issues, "asset_processing_chain_broken", "Asset processing hashes do not form a continuous chain.", entry.assetId);
    expectedSourceHash = step.targetSha256;
  }
  if (entry.processingChain.length > 0 && entry.rawAsset && entry.processingChain[0].sourceSha256 !== entry.rawAsset.sha256) {
    issue(issues, "asset_processing_source_hash_mismatch", "Processing must start from the stored provider raw image.", entry.assetId);
  }
  if (entry.processingChain.length === 0 && entry.rawAsset && entry.normalizedAsset && entry.rawAsset.sha256 !== entry.normalizedAsset.sha256) {
    issue(issues, "asset_processing_evidence_missing", "Changed image bytes require a complete processing chain.", entry.assetId);
  }
  if (expectedSourceHash && expectedSourceHash !== entry.sha256) issue(issues, "asset_processing_final_hash_mismatch", "Final processing hash does not match the delivered asset.", entry.assetId);
}

function validateFileEvidence(
  evidence: PptAssetManifestEntry["rawAsset"],
  kind: "raw" | "normalized",
  assetId: string,
  issues: PptAssetValidationIssue[],
) {
  if (
    !nonEmpty(evidence.fileName) ||
    !nonEmpty(evidence.storageRef) ||
    !SHA256_PATTERN.test(evidence.sha256) ||
    evidence.bytes <= 0 ||
    evidence.width <= 0 ||
    evidence.height <= 0 ||
    !["image/png", "image/jpeg", "image/webp"].includes(evidence.mime)
  ) {
    issue(issues, `asset_${kind}_evidence_invalid`, `${kind} image file evidence is incomplete.`, assetId);
  }
}

function sameSet(left: string[], right: string[]): boolean {
  return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function nonEmpty(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function issue(issues: PptAssetValidationIssue[], code: string, message: string, assetId?: string): void {
  issues.push({ code, message, assetId });
}
