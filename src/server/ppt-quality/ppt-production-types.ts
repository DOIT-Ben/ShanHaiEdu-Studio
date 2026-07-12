export type PptProductionPageEvidence = {
  pageId: string;
  renderRef: string;
  renderSha256: string;
  assetIds: string[];
  editableTextLayerIds: string[];
  editableMathLayerIds: string[];
  rasterizedExactContent: false;
};

export type PptFullDeckCandidate = {
  schemaVersion: "ppt-full-deck-candidate.v1";
  designPackageDigest: string;
  requestBatchDigest: string;
  assetManifestDigest: string;
  sampleSetDigest: string;
  sampleApprovalDigest: string;
  pageIds: string[];
  pptx: { storageRef: string; sha256: string; bytes: number; slideCount: number };
  pdf: { storageRef: string; sha256: string; bytes: number; pageCount: number };
  pages: PptProductionPageEvidence[];
  contactSheet: { storageRef: string; sha256: string; pageIds: string[] };
  reviewStatus: "awaiting_delivery_review";
  candidateDigest: string;
};

export type PptFullDeckPackage = Omit<PptFullDeckCandidate, "reviewStatus" | "candidateDigest"> & {
  qa: Array<{
    pageId: string;
    design: "passed" | "failed";
    visual: "passed" | "failed";
    provenance: "passed" | "failed";
    readability: "passed" | "failed";
    findings: string[];
  }>;
  finalEligible: true;
  packageDigest: string;
};
