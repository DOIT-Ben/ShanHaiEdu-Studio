import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { resolveLocalArtifactOutput } from "@/server/artifact-storage/local-artifact-storage";
import { createFinalPackageManifestDigest } from "@/server/package/versioned-final-package";
import { validatePptFullDeckPackage } from "@/server/ppt-quality/ppt-full-deck-candidate";
import type { PptFullDeckPackage } from "@/server/ppt-quality/ppt-production-types";
import type { ArtifactKind, ArtifactRecord } from "@/server/workbench/types";

const semanticOutputKinds: Record<string, ReadonlySet<ArtifactKind>> = {
  requirement_spec: new Set(["requirement_spec"]),
  textbook_evidence: new Set(["textbook_evidence"]),
  lesson_plan: new Set(["lesson_plan"]),
  interactive_courseware_spec: new Set(["interactive_courseware_spec"]),
  ppt_outline: new Set(["ppt_draft"]),
  ppt_design: new Set(["ppt_design_draft"]),
  video_script: new Set(["video_script_generate"]),
  knowledge_anchor: new Set(["knowledge_anchor_extract"]),
  creative_theme: new Set(["creative_theme_generate"]),
  storyboard: new Set(["storyboard_generate"]),
  asset_brief: new Set(["asset_brief_generate"]),
  video_segment_plan: new Set(["video_segment_plan"]),
  ppt_design_draft: new Set(["ppt_design_draft"]),
};

export function artifactSatisfiesRequestedOutput(artifact: ArtifactRecord, requestedOutput: string): boolean {
  if (requestedOutput === "ppt_sample_assets") {
    return artifact.kind === "image_prompts" && hasRecord(artifact.structuredContent.pptAssetRequestBatch) &&
      hasRecord(artifact.structuredContent.pptAssetManifest);
  }
  if (requestedOutput === "ppt_key_samples") {
    return artifact.kind === "image_prompts" && (
      hasRecord(artifact.structuredContent.pptKeySampleCandidate) || hasRecord(artifact.structuredContent.pptKeySampleSet)
    );
  }
  if (requestedOutput === "ppt_full_assets") {
    const requestBatch = record(artifact.structuredContent.pptAssetRequestBatch);
    return artifact.kind === "image_prompts" && requestBatch?.scope === "full_production" &&
      hasRecord(artifact.structuredContent.pptAssetManifest);
  }
  const semanticKinds = semanticOutputKinds[requestedOutput];
  if (semanticKinds) return semanticKinds.has(artifact.kind) && hasSemanticContent(artifact);
  if (artifact.origin !== "tool_result") return false;

  switch (requestedOutput) {
    case "ppt":
      return artifact.kind === "pptx_artifact" && hasRealPptDelivery(artifact);
    case "image":
    case "image_prompts":
      return artifact.kind === "image_prompts" && hasRealImageDelivery(artifact);
    case "video":
    case "intro_video":
      return artifact.kind === "concat_only_assemble" && hasRealVideoDelivery(artifact);
    case "package":
    case "final_package":
      return artifact.kind === "final_delivery" && hasRealPackageDelivery(artifact);
    default:
      return false;
  }
}

function hasRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasSemanticContent(artifact: ArtifactRecord): boolean {
  return Boolean(artifact.markdownContent.trim() || artifact.summary.trim() || Object.keys(artifact.structuredContent).length);
}

function hasRealPptDelivery(artifact: ArtifactRecord): boolean {
  if (!hasPersistedArtifactTruth(artifact, "pptx_artifact") || !hasPassedQualityGate(artifact)) return false;
  const packageValue = artifact.structuredContent.pptFullDeckPackage as PptFullDeckPackage | undefined;
  if (packageValue) {
    return validatePptFullDeckPackage(packageValue) &&
      hasStoredFile(packageValue.pptx, (buffer) => isPptxBuffer(buffer));
  }
  const asset = nestedRecord(artifact.structuredContent, "storage", "cozePptx");
  if (!asset) return false;
  return asset.generationMode === "coze_generated" &&
    hasText(asset.sourceArtifactId) && Number.isInteger(asset.slideCount) && (asset.slideCount as number) > 0 &&
    hasStoredFile(asset, (buffer) => isPptxBuffer(buffer));
}

function hasRealImageDelivery(artifact: ArtifactRecord): boolean {
  if (!hasPersistedArtifactTruth(artifact, "image_prompts") || !hasPassedQualityGate(artifact)) return false;
  const asset = nestedRecord(artifact.structuredContent, "storage", "imageAsset");
  if (!asset || !hasText(asset.sourceArtifactId) || !hasText(asset.mime) || !/^image\/(png|jpeg)$/.test(asset.mime)) return false;
  return hasStoredFile(asset, (buffer) => isImageBuffer(buffer));
}

function hasRealVideoDelivery(artifact: ArtifactRecord): boolean {
  if (!hasPersistedArtifactTruth(artifact, "concat_only_assemble") || !hasPassedQualityGate(artifact)) return false;
  const asset = nestedRecord(artifact.structuredContent, "storage", "videoAsset");
  const review = record(artifact.structuredContent.videoFinalReview);
  const evidence = record(artifact.structuredContent.videoFinalReviewEvidence);
  if (!asset || asset.generationMode !== "ffmpeg_timeline_assembled" || asset.mime !== "video/mp4" ||
      !hasNonEmptyStringArray(asset.sourceArtifactIds) || review?.schemaVersion !== "video-final-review.v1" ||
      review.overallStatus !== "passed" || !isSha256(review.evidenceDigest) || !hasCompleteVideoEvidence(evidence)) {
    return false;
  }
  return hasStoredFile(asset, (buffer) => isMp4Buffer(buffer));
}

function hasRealPackageDelivery(artifact: ArtifactRecord): boolean {
  if (!hasPersistedArtifactTruth(artifact, "final_delivery") || !hasPassedQualityGate(artifact)) return false;
  const asset = nestedRecord(artifact.structuredContent, "storage", "packageAsset");
  const manifest = record(artifact.structuredContent.finalPackageManifest);
  const runSpec = record(artifact.structuredContent.classroomRunSpec);
  if (!asset || !manifest || !runSpec || asset.generationMode !== "versioned_final_package_generated" ||
      asset.mime !== "application/zip" || !hasText(asset.fileName) || !asset.fileName.toLowerCase().endsWith(".zip") ||
      !isSha256(asset.manifestSha256) || asset.manifestSha256 !== createFinalPackageManifestDigest(manifest) ||
      !hasFinalPackageManifest(manifest) || !hasNonEmptyStringArray(asset.sourceArtifactIds) ||
      !hasCompletePackageLineage(asset.sourceArtifactIds, manifest.files) ||
      !hasMatchingPackageVersion(artifact, manifest, runSpec)) {
    return false;
  }
  return hasStoredFile(asset, (buffer) => isZipBuffer(buffer) &&
    buffer.includes(Buffer.from("manifest.json")) && buffer.includes(Buffer.from("classroom-run-spec.json")) &&
    Object.values(manifest.files as Record<string, Record<string, unknown>>).every((file) =>
      hasText(file.fileName) && buffer.includes(Buffer.from(file.fileName))));
}

function hasPersistedArtifactTruth(artifact: ArtifactRecord, expectedKind: ArtifactKind): boolean {
  const truth = record(artifact.structuredContent.artifactTruth);
  return Boolean(truth) && truth!.created === true && truth!.persisted === true && truth!.placeholder === false &&
    truth!.producedArtifactKind === expectedKind;
}

function hasPassedQualityGate(artifact: ArtifactRecord): boolean {
  const gate = record(artifact.structuredContent.qualityGate);
  return gate?.passed === true && Array.isArray(gate.gates) && gate.gates.length > 0;
}

function hasStoredFile(asset: Record<string, unknown>, validateBuffer: (buffer: Buffer) => boolean): boolean {
  if (!hasText(asset.localOutput) || !Number.isInteger(asset.bytes) || (asset.bytes as number) < 1 || !isSha256(asset.sha256)) return false;
  const absolutePath = resolveLocalArtifactOutput(asset.localOutput);
  if (!absolutePath || !existsSync(absolutePath)) return false;
  try {
    const buffer = readFileSync(absolutePath);
    return buffer.length === asset.bytes && createHash("sha256").update(buffer).digest("hex") === asset.sha256.toLowerCase() &&
      validateBuffer(buffer);
  } catch {
    return false;
  }
}

function hasCompleteVideoEvidence(value: Record<string, unknown> | null): boolean {
  return Boolean(value) && ["finalVideo", "timeline", "transcript", "audioTrack"].every((key) => Boolean(record(value![key]))) &&
    Array.isArray(value!.sampledFrames) && value!.sampledFrames.length > 0;
}

function hasCompletePackageLineage(sourceArtifactIds: unknown, files: unknown): boolean {
  if (!hasNonEmptyStringArray(sourceArtifactIds)) return false;
  const fileMap = record(files);
  if (!fileMap || Object.keys(fileMap).length === 0) return false;
  const sources = new Set(sourceArtifactIds);
  return Object.values(fileMap).every((value) => {
    const file = record(value);
    return Boolean(file) && hasText(file!.sourceArtifactId) && sources.has(file!.sourceArtifactId as string) &&
      isSha256(file!.sha256) && Number.isInteger(file!.sourceArtifactVersion) && (file!.sourceArtifactVersion as number) > 0 &&
      isSha256(file!.sourceArtifactDigest);
  });
}

function hasFinalPackageManifest(manifest: Record<string, unknown>): boolean {
  const roles = ["lesson_plan", "pptx", "pdf", "image", "video"];
  const requiredRoles = manifest.requiredRoles;
  const files = record(manifest.files);
  return manifest.schemaVersion === "final-package-manifest.v1" &&
    (manifest.packageStatus === "integration_review_passed" || manifest.packageStatus === "teacher_signed_off") &&
    Array.isArray(requiredRoles) && requiredRoles.length === roles.length && roles.every((role) => requiredRoles.includes(role)) &&
    Boolean(files) && Object.keys(files!).length === roles.length && roles.every((role) => Boolean(record(files![role])));
}

function hasMatchingPackageVersion(
  artifact: ArtifactRecord,
  manifest: Record<string, unknown>,
  runSpec: Record<string, unknown>,
): boolean {
  return hasText(manifest.courseVersionId) && hasText(manifest.reviewBatchId) && hasText(manifest.courseAnchor) &&
    Number.isInteger(manifest.pptSlideCount) && (manifest.pptSlideCount as number) > 0 &&
    artifact.structuredContent.courseVersionId === manifest.courseVersionId &&
    artifact.structuredContent.reviewBatchId === manifest.reviewBatchId &&
    runSpec.schemaVersion === "classroom-run-spec.v1" && runSpec.courseVersionId === manifest.courseVersionId &&
    runSpec.reviewBatchId === manifest.reviewBatchId && runSpec.courseAnchor === manifest.courseAnchor &&
    runSpec.pptSlideCount === manifest.pptSlideCount && Array.isArray(runSpec.sequence) && runSpec.sequence.length > 0;
}

function isPptxBuffer(buffer: Buffer): boolean {
  return isZipBuffer(buffer) && buffer.includes(Buffer.from("ppt/presentation.xml"));
}

function isImageBuffer(buffer: Buffer): boolean {
  const png = buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) &&
    buffer.subarray(12, 16).toString("ascii") === "IHDR" && buffer.readUInt32BE(16) > 0 && buffer.readUInt32BE(20) > 0;
  const jpeg = buffer.length >= 32 && buffer[0] === 0xff && buffer[1] === 0xd8 &&
    buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
  return png || jpeg;
}

function isMp4Buffer(buffer: Buffer): boolean {
  return buffer.length >= 1024 && buffer.subarray(0, Math.min(buffer.length, 68)).includes(Buffer.from("ftyp")) &&
    buffer.subarray(0, Math.min(buffer.length, 1024 * 1024 + 4)).includes(Buffer.from("moov"));
}

function isZipBuffer(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function nestedRecord(value: Record<string, unknown>, parent: string, child: string): Record<string, unknown> | null {
  return record(record(value[parent])?.[child]);
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(hasText) && new Set(value).size === value.length;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}
