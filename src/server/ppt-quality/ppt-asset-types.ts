export type PptAssetKind = "AI_SCENE" | "AI_ASSET";

export type PptAssetRequest = {
  assetId: string;
  assetKind: PptAssetKind;
  pageIds: string[];
  role: string;
  promptBrief: string;
  negativePrompt: string;
  aspectRatio: "16:9" | "1:1" | "4:3" | "3:4";
  compositionSafeZone: string[];
  transparentBackground: boolean;
  reusePolicy: "page_scoped" | "reuse_identical";
  referenceAssetIds: string[];
  promptDigest: string;
  inputHash: string;
};

export type PptAssetRequestBatch = {
  schemaVersion: "ppt-asset-request-batch.v1";
  scope: "key_samples" | "full_production";
  designPackageDigest: string;
  requests: PptAssetRequest[];
  batchDigest: string;
};

export type PptAssetProcessingOperation =
  | "remove_background"
  | "crop"
  | "resize"
  | "color_correction"
  | "format_conversion"
  | "alias"
  | "instance_copy";

export type PptAssetFileEvidence = {
  fileName: string;
  storageRef: string;
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  mime: "image/png" | "image/jpeg" | "image/webp";
};

export type PptAssetManifestEntry = {
  assetId: string;
  assetKind: PptAssetKind;
  pageIds: string[];
  sourceAuthority: "provider_generated";
  provider: string;
  model: string;
  clientRequestId: string;
  providerRequestId: string | null;
  providerTaskId: string | null;
  inputHash: string;
  promptDigest: string;
  referenceAssetIds: string[];
  sentReferenceAssetIds: string[];
  fileName: string;
  storageRef: string;
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  mime: "image/png" | "image/jpeg" | "image/webp";
  rawAsset: PptAssetFileEvidence;
  normalizedAsset: PptAssetFileEvidence;
  transparentBackground: boolean;
  placeholder: false;
  localSubjectDrawn: false;
  processingChain: Array<{
    operation: PptAssetProcessingOperation;
    sourceSha256: string;
    targetSha256: string;
  }>;
};

export type PptAssetManifest = {
  schemaVersion: "ppt-asset-manifest.v1";
  scope: "key_samples" | "full_production";
  designPackageDigest: string;
  requestBatchDigest: string;
  entries: PptAssetManifestEntry[];
  manifestDigest: string;
};

export type PptSampleOverviewKind = "scene_and_primary_props" | "micro_assets" | "assembled_samples";

export type PptKeySampleCandidate = {
  schemaVersion: "ppt-key-sample-candidate.v1";
  designPackageDigest: string;
  requestBatchDigest: string;
  assetManifestDigest: string;
  samplePageIds: string[];
  samplePptx: { storageRef: string; sha256: string };
  overviews: Array<{
    kind: PptSampleOverviewKind;
    storageRef: string;
    sha256: string;
    pageIds: string[];
  }>;
  assembledPages: Array<{
    pageId: string;
    renderRef: string;
    renderSha256: string;
    assetIds: string[];
    editableTextLayerIds: string[];
    editableMathLayerIds: string[];
    rasterizedExactContent: false;
  }>;
  reviewStatus: "awaiting_dvp_review";
  candidateDigest: string;
};

export type PptKeySampleSet = {
  schemaVersion: "ppt-key-sample-set.v1";
  designPackageDigest: string;
  requestBatchDigest: string;
  assetManifestDigest: string;
  samplePageIds: string[];
  samplePptx: { storageRef: string; sha256: string };
  overviews: Array<{
    kind: PptSampleOverviewKind;
    storageRef: string;
    sha256: string;
    pageIds: string[];
  }>;
  assembledPages: Array<{
    pageId: string;
    renderRef: string;
    renderSha256: string;
    assetIds: string[];
    editableTextLayerIds: string[];
    editableMathLayerIds: string[];
    rasterizedExactContent: false;
  }>;
  qa: Array<{
    pageId: string;
    design: "passed" | "failed";
    visual: "passed" | "failed";
    provenance: "passed" | "failed";
    findings: string[];
  }>;
  sampleSetDigest: string;
};

export type PptSampleApproval = {
  schemaVersion: "ppt-sample-approval.v1";
  decision: "approved";
  decisionSource: "artifact_approve_action" | "explicit_teacher_message" | "delivery_critic";
  decisionText: string;
  teacherMessageId: string | null;
  designPackageDigest: string;
  sampleSetDigest: string;
  approvedAt: string;
};

export type PptAssetValidationIssue = {
  code: string;
  message: string;
  assetId?: string;
  pageId?: string;
};

export type PptImageProviderRequestEvidence = {
  assetId: string;
  pageIds: string[];
  inputHash: string;
  promptDigest: string;
  referenceAssetIds: string[];
  sentReferenceAssetIds: string[];
  transport: "json_generation" | "multipart_edit";
  requestBodyDigest: string;
};

export type PptGeneratedAsset = {
  fileName: string;
  storageRef: string;
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  mime: "image/png" | "image/jpeg" | "image/webp";
  transparentBackgroundVerified: boolean;
  provider: string;
  model: string;
  clientRequestId: string;
  providerRequestId: string | null;
  providerTaskId: string | null;
  sentReferenceAssetIds: string[];
  rawAsset: PptAssetFileEvidence;
  normalizedAsset: PptAssetFileEvidence;
  processingChain?: Array<{
    operation: PptAssetProcessingOperation;
    sourceSha256: string;
    targetSha256: string;
  }>;
};
