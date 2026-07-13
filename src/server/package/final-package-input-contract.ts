import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveLocalArtifactOutput } from "@/server/artifact-storage/local-artifact-storage";
import { hashArtifactDraft } from "@/server/contracts/contract-validator";
import { hashRunInput } from "@/server/execution/run-input-snapshot";
import { buildStoredImageDownload } from "@/server/image-generation/artifact-image";
import { sealPptFullDeckCandidate, validatePptFullDeckCandidate, validatePptFullDeckPackage } from "@/server/ppt-quality/ppt-full-deck-candidate";
import type { PptFullDeckCandidate, PptFullDeckPackage } from "@/server/ppt-quality/ppt-production-types";
import { validateVideoNarrationScript, type VideoNarrationScript } from "@/server/video-quality/video-narration-contract";
import type { ArtifactRecord } from "@/server/workbench/types";
import type { ClassroomRunSpec, FinalPackageFile } from "./versioned-final-package";

export type ClassroomRunSpecDraft = {
  schemaVersion: "classroom-run-spec-draft.v1";
  courseAnchor: string;
  sequence: ClassroomRunSpec["sequence"];
};

export type FinalPackageSourceArtifacts = {
  requirement: ArtifactRecord;
  lessonPlan: ArtifactRecord;
  pptDesign: ArtifactRecord;
  pptx: ArtifactRecord;
  image: ArtifactRecord;
  narrationScript: ArtifactRecord;
  video: ArtifactRecord;
};

export function prepareVersionedFinalPackageInput(input: {
  projectId: string;
  artifacts: FinalPackageSourceArtifacts;
  classroomRunSpecDraft: unknown;
}): {
  files: FinalPackageFile[];
  classroomRunSpec: ClassroomRunSpec;
  courseVersionId: string;
  reviewBatchId: string;
  sourceArtifactIds: string[];
  cleanup: () => void;
} {
  const artifacts = Object.values(input.artifacts);
  assertApprovedProjectArtifacts(input.projectId, artifacts);
  assertModelGeneratedSemanticSources(input.artifacts);

  const pptPackage = requirePptFinalEligibility(input.artifacts.pptx);
  const narration = requireNarrationScript(input.artifacts.narrationScript);
  const videoEvidence = requireVideoFinalEligibility(input.artifacts.video);
  const draft = parseClassroomRunSpecDraft(input.classroomRunSpecDraft, narration.courseAnchor);
  const image = buildStoredImageDownload(input.artifacts.image);

  const sourceBindings = artifacts.map((artifact) => ({
    artifactId: artifact.id,
    kind: artifact.kind,
    version: artifact.version,
    digest: digestArtifact(artifact),
  })).sort((left, right) => `${left.kind}:${left.artifactId}`.localeCompare(`${right.kind}:${right.artifactId}`));
  const courseVersionId = hashRunInput({ projectId: input.projectId, sourceBindings });
  const reviewBatchId = hashRunInput({
    pptPackageDigest: pptPackage.packageDigest,
    pptReview: input.artifacts.pptx.structuredContent.pptFullDeckReview,
    videoReview: input.artifacts.video.structuredContent.videoFinalReview,
    videoApproval: input.artifacts.video.structuredContent.videoFinalApproval,
  });
  const classroomRunSpec: ClassroomRunSpec = {
    schemaVersion: "classroom-run-spec.v1",
    courseVersionId,
    courseAnchor: narration.courseAnchor,
    reviewBatchId,
    sequence: structuredClone(draft.sequence),
  };

  const pptxPath = requireStoredFile(pptPackage.pptx.storageRef, pptPackage.pptx.sha256, "pptx");
  const pdfPath = requireStoredFile(pptPackage.pdf.storageRef, pptPackage.pdf.sha256, "pdf");
  const imageStorage = requireRecord(requireRecord(input.artifacts.image.structuredContent.storage, "image_storage_missing").imageAsset, "image_asset_missing");
  const imageSha256 = readSha256(imageStorage.sha256, "image_sha256_missing");
  if (hashBuffer(image.buffer) !== imageSha256) throw new Error("final_package_sha256_mismatch:image");
  const imagePath = requireStoredFile(readString(imageStorage.localOutput, "image_storage_ref_missing"), imageSha256, "image");
  const finalVideo = requireRecord(videoEvidence.finalVideo, "video_final_evidence_missing");
  const videoPath = requireStoredFile(readString(finalVideo.storageRef, "video_storage_ref_missing"), readSha256(finalVideo.sha256, "video_sha256_missing"), "video");

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "shanhai-final-package-"));
  try {
    const lessonPath = path.join(tempRoot, "lesson-plan.md");
    const lessonBuffer = Buffer.from(input.artifacts.lessonPlan.markdownContent.trim() + "\n", "utf8");
    if (lessonBuffer.length < 16) throw new Error("final_package_lesson_plan_empty");
    writeFileSync(lessonPath, lessonBuffer);

    const binding = { courseVersionId, courseAnchor: narration.courseAnchor, reviewBatchId, deliveryStatus: "final_eligible" as const };
    const files: FinalPackageFile[] = [
      finalFile("lesson_plan", lessonPath, "lesson-plan.md", hashBuffer(lessonBuffer), input.artifacts.lessonPlan, binding),
      finalFile("pptx", pptxPath, "lesson-slides.pptx", pptPackage.pptx.sha256, input.artifacts.pptx, binding),
      finalFile("pdf", pdfPath, "lesson-slides.pdf", pptPackage.pdf.sha256, input.artifacts.pptx, binding),
      finalFile("image", imagePath, image.filename, imageSha256, input.artifacts.image, binding),
      finalFile("video", videoPath, "intro-video.mp4", readSha256(finalVideo.sha256, "video_sha256_missing"), input.artifacts.video, binding),
    ];
    return {
      files,
      classroomRunSpec,
      courseVersionId,
      reviewBatchId,
      sourceArtifactIds: sourceBindings.map((bindingValue) => bindingValue.artifactId),
      cleanup: () => rmSync(tempRoot, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

function finalFile(
  role: FinalPackageFile["role"],
  filePath: string,
  packageFileName: string,
  sha256: string,
  artifact: ArtifactRecord,
  binding: Pick<FinalPackageFile, "courseVersionId" | "courseAnchor" | "reviewBatchId" | "deliveryStatus">,
): FinalPackageFile {
  return {
    role,
    filePath,
    packageFileName,
    sha256: sha256.toLowerCase(),
    ...binding,
    sourceArtifactId: artifact.id,
    sourceArtifactVersion: artifact.version,
    sourceArtifactDigest: digestArtifact(artifact),
  };
}

function assertApprovedProjectArtifacts(projectId: string, artifacts: ArtifactRecord[]): void {
  if (artifacts.some((artifact) => artifact.projectId !== projectId)) throw new Error("final_package_cross_project_artifact");
  if (artifacts.some((artifact) => artifact.status !== "approved" || artifact.isApproved !== true)) throw new Error("final_package_artifact_not_approved");
  if (new Set(artifacts.map((artifact) => artifact.id)).size !== artifacts.length) throw new Error("final_package_source_artifact_duplicate");
}

function assertModelGeneratedSemanticSources(artifacts: FinalPackageSourceArtifacts): void {
  for (const artifact of [artifacts.requirement, artifacts.lessonPlan, artifacts.pptDesign, artifacts.narrationScript]) {
    const source = artifact.structuredContent;
    if (source.generationMode !== "model_generated" || source.providerStatus !== "real" || source.runtimeKind !== "openai") {
      throw new Error(`final_package_semantic_source_not_model_generated:${artifact.kind}`);
    }
  }
}

function requirePptFinalEligibility(artifact: ArtifactRecord): PptFullDeckPackage {
  const value = artifact.structuredContent.pptFullDeckPackage as PptFullDeckPackage | undefined;
  const candidate = artifact.structuredContent.pptFullDeckCandidate as PptFullDeckCandidate | undefined;
  const review = requireRecord(artifact.structuredContent.pptFullDeckReview, "ppt_final_review_missing");
  if (!value || !validatePptFullDeckPackage(value) || !candidate || !validatePptFullDeckCandidate(candidate) ||
      review.schemaVersion !== "ppt-full-deck-review.v1" || review.overallStatus !== "passed" ||
      !isSha256(review.candidateDigest) || review.candidateDigest !== candidate.candidateDigest || !Array.isArray(review.qa)) {
    throw new Error("ppt_final_delivery_not_eligible");
  }
  const sealed = sealPptFullDeckCandidate(candidate, review.qa as PptFullDeckPackage["qa"]);
  if (sealed.packageDigest !== value.packageDigest || JSON.stringify(review.qa) !== JSON.stringify(value.qa)) {
    throw new Error("ppt_final_delivery_not_eligible");
  }
  return value;
}

function requireNarrationScript(artifact: ArtifactRecord): VideoNarrationScript {
  const value = artifact.structuredContent.videoNarrationScript as VideoNarrationScript | undefined;
  if (!value || !validateVideoNarrationScript(value).valid) throw new Error("final_package_narration_script_invalid");
  return value;
}

function requireVideoFinalEligibility(artifact: ArtifactRecord): Record<string, unknown> {
  const evidence = requireRecord(artifact.structuredContent.videoFinalReviewEvidence, "video_final_review_evidence_missing");
  const review = requireRecord(artifact.structuredContent.videoFinalReview, "video_final_review_missing");
  const approval = requireRecord(artifact.structuredContent.videoFinalApproval, "video_final_approval_missing");
  if (review.overallStatus !== "passed" || approval.decision !== "approved" || approval.reviewEvidenceDigest !== review.evidenceDigest) {
    throw new Error("video_final_delivery_not_eligible");
  }
  for (const key of ["finalVideo", "timeline", "transcript", "audioTrack"]) requireRecord(evidence[key], `video_final_${key}_missing`);
  if (!Array.isArray(evidence.sampledFrames) || evidence.sampledFrames.length === 0) throw new Error("video_final_sampled_frames_missing");
  return evidence;
}

function parseClassroomRunSpecDraft(value: unknown, courseAnchor: string): ClassroomRunSpecDraft {
  const draft = requireRecord(value, "classroom_run_spec_draft_missing");
  if (draft.schemaVersion !== "classroom-run-spec-draft.v1" || readString(draft.courseAnchor, "classroom_run_spec_anchor_missing").trim() !== courseAnchor.trim()) {
    throw new Error("classroom_run_spec_anchor_mismatch");
  }
  if (!Array.isArray(draft.sequence)) throw new Error("classroom_run_spec_sequence_missing");
  const actions = new Set<ClassroomRunSpec["sequence"][number]["action"]>(["play_intro_video", "ask_return_question", "open_ppt", "teacher_explain", "reveal_answer"]);
  const roles = new Set<NonNullable<ClassroomRunSpec["sequence"][number]["artifactRole"]>>(["lesson_plan", "pptx", "pdf", "image", "video"]);
  const sequence = draft.sequence.map((raw) => {
    const step = requireRecord(raw, "classroom_run_spec_step_invalid");
    if (!Number.isInteger(step.ordinal) || typeof step.action !== "string" || !actions.has(step.action as ClassroomRunSpec["sequence"][number]["action"]) ||
        typeof step.instruction !== "string" || !step.instruction.trim()) throw new Error("classroom_run_spec_step_invalid");
    if (step.artifactRole !== null && step.artifactRole !== undefined && (typeof step.artifactRole !== "string" || !roles.has(step.artifactRole as never))) {
      throw new Error("classroom_run_spec_step_role_invalid");
    }
    if (step.pptPage !== null && step.pptPage !== undefined && (!Number.isInteger(step.pptPage) || (step.pptPage as number) < 1)) {
      throw new Error("classroom_run_spec_step_page_invalid");
    }
    return {
      ordinal: step.ordinal as number,
      action: step.action as ClassroomRunSpec["sequence"][number]["action"],
      ...(typeof step.artifactRole === "string" ? { artifactRole: step.artifactRole as ClassroomRunSpec["sequence"][number]["artifactRole"] } : {}),
      ...(typeof step.pptPage === "number" ? { pptPage: step.pptPage } : {}),
      instruction: step.instruction,
    };
  });
  return { schemaVersion: "classroom-run-spec-draft.v1", courseAnchor, sequence };
}

function requireStoredFile(storageRef: string, expectedSha256: string, role: string): string {
  const filePath = resolveLocalArtifactOutput(storageRef);
  if (!filePath || !existsSync(filePath)) throw new Error(`final_package_file_missing:${role}`);
  const actual = hashBuffer(readFileSync(filePath));
  if (actual !== expectedSha256.toLowerCase()) throw new Error(`final_package_sha256_mismatch:${role}`);
  return filePath;
}

function digestArtifact(artifact: ArtifactRecord): string {
  return hashArtifactDraft({
    nodeKey: artifact.nodeKey,
    kind: artifact.kind,
    title: artifact.title,
    summary: artifact.summary,
    markdownContent: artifact.markdownContent,
    structuredContent: artifact.structuredContent,
  });
}

function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function readSha256(value: unknown, errorCode: string): string {
  const text = readString(value, errorCode).toLowerCase();
  if (!isSha256(text)) throw new Error(errorCode);
  return text;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function readString(value: unknown, errorCode: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(errorCode);
  return value;
}

function requireRecord(value: unknown, errorCode: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(errorCode);
  return value as Record<string, unknown>;
}
