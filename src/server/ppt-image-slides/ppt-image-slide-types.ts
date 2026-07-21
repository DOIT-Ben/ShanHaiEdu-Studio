export type PptImageSlideEntry = {
  pageId: string;
  pageNumber: number;
  prompt: string;
  promptDigest: string;
  storageRef: string;
  fileName: string;
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  mime: "image/png" | "image/jpeg";
  provider: "model_gateway";
  model: string;
  rawAsset: { fileName: string; storageRef: string; sha256: string; bytes: number; width: number; height: number; mime: string };
  normalizedAsset: { fileName: string; storageRef: string; sha256: string; bytes: number; width: number; height: number; mime: string };
  processingChain: Array<{ operation: string; sourceSha256: string; targetSha256: string }>;
};

export type PptImageSlideBundle = {
  schemaVersion: "ppt-image-slide-bundle.v1";
  designPackageDigest: string;
  entries: PptImageSlideEntry[];
};

export type PptImageSlideReview = {
  schemaVersion: "ppt-image-slide-review.v1";
  passed: true;
  slideCount: number;
  imageCount: number;
  editableTextLayerCount: number;
  editableMathLayerCount: number;
  checks: string[];
};
