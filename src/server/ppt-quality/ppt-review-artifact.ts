import { withArtifactQualityState } from "@/server/quality/artifact-quality-state";
import type {
  ArtifactRecord,
  SaveArtifactInput,
  SubmitPptFullDeckReviewInput,
  SubmitPptSampleReviewInput,
} from "@/server/workbench/types";

import { sealPptFullDeckCandidate, validatePptFullDeckCandidate } from "./ppt-full-deck-candidate";
import { sealPptKeySampleCandidate, validatePptKeySampleCandidate } from "./ppt-key-sample-candidate";
import type {
  PptAssetManifest,
  PptAssetRequestBatch,
  PptKeySampleCandidate,
  PptKeySampleSet,
} from "./ppt-asset-types";
import type { PptDesignPackage } from "./ppt-quality-types";
import type { PptFullDeckCandidate, PptFullDeckPackage } from "./ppt-production-types";

export function buildPptSampleReviewArtifact(
  artifact: ArtifactRecord,
  input: SubmitPptSampleReviewInput,
): SaveArtifactInput {
  const candidate = artifact.structuredContent.pptKeySampleCandidate as PptKeySampleCandidate | undefined;
  const designPackage = artifact.structuredContent.pptDesignPackage as PptDesignPackage | undefined;
  const requestBatch = artifact.structuredContent.pptAssetRequestBatch as PptAssetRequestBatch | undefined;
  const manifest = artifact.structuredContent.pptAssetManifest as PptAssetManifest | undefined;
  if (!candidate || !designPackage || !requestBatch || !manifest || !validatePptKeySampleCandidate(candidate)) {
    throw new Error("PPT key sample review evidence is incomplete.");
  }
  if (input.candidateDigest !== candidate.candidateDigest) throw new Error("PPT key sample review version conflict.");
  assertPptSampleQa(candidate, input.qa);

  const allPassed = input.qa.every((entry) => entry.design === "passed" && entry.visual === "passed" && entry.provenance === "passed" && entry.findings.length === 0);
  const review = {
    schemaVersion: "ppt-sample-review.v1",
    candidateDigest: candidate.candidateDigest,
    reviewSource: input.reviewSource,
    reviewerMessageId: input.reviewerMessageId ?? null,
    overallStatus: allPassed ? "passed" : "failed",
    qa: input.qa.map((entry) => ({ ...entry, findings: [...entry.findings] })),
    reviewedAt: new Date().toISOString(),
  };
  let sampleSet: PptKeySampleSet | undefined;
  if (allPassed) {
    sampleSet = sealPptKeySampleCandidate({ designPackage, requestBatch, manifest, candidate, qa: input.qa });
  }
  const sampleApproval = sampleSet ? {
    schemaVersion: "ppt-sample-approval.v1" as const,
    decision: "approved" as const,
    decisionSource: "delivery_critic" as const,
    decisionText: "delivery_critic_passed",
    teacherMessageId: null,
    designPackageDigest: sampleSet.designPackageDigest,
    sampleSetDigest: sampleSet.sampleSetDigest,
    approvedAt: new Date().toISOString(),
  } : undefined;

  return {
    nodeKey: artifact.nodeKey,
    kind: artifact.kind,
    title: sampleSet ? "PPT 关键样张验收包" : "PPT 关键样张返修包",
    status: "needs_review",
    summary: sampleSet ? "逐页 D/V/P 已通过，可继续内部下游；教师签收仍单独记录。" : "逐页 D/V/P 存在未关闭问题，需要定点返修后重新审查。",
    markdownContent: sampleSet
      ? "# PPT 关键样张验收包\n\n逐页 D/V/P 已全部通过，可以继续内部制作；教师签收仍是独立状态。"
      : "# PPT 关键样张返修包\n\n存在未关闭的设计、视觉或来源问题，尚不能批准。",
    structuredContent: withArtifactQualityState({
      ...artifact.structuredContent,
      pptKeySampleReview: review,
      ...(sampleSet ? { pptKeySampleSet: sampleSet } : {}),
      ...(sampleApproval ? { pptSampleApproval: sampleApproval } : {}),
    }, {
      validationStatus: "passed",
      reviewStatus: allPassed ? "passed" : "repair",
      downstreamEligibility: allPassed ? "eligible" : "blocked",
    }),
  };
}

export function buildPptFullDeckReviewArtifact(
  artifact: ArtifactRecord,
  input: SubmitPptFullDeckReviewInput,
): SaveArtifactInput {
  const candidate = artifact.structuredContent.pptFullDeckCandidate as PptFullDeckCandidate | undefined;
  if (!candidate || !validatePptFullDeckCandidate(candidate)) throw new Error("PPT full deck review evidence is incomplete.");
  if (input.candidateDigest !== candidate.candidateDigest) throw new Error("PPT full deck review version conflict.");
  assertPptFullDeckQa(candidate, input.qa);

  const allPassed = input.qa.every((entry) =>
    entry.design === "passed" && entry.visual === "passed" && entry.provenance === "passed" && entry.readability === "passed" && entry.findings.length === 0);
  const review = {
    schemaVersion: "ppt-full-deck-review.v1",
    candidateDigest: candidate.candidateDigest,
    reviewSource: input.reviewSource,
    reviewerMessageId: input.reviewerMessageId ?? null,
    overallStatus: allPassed ? "passed" : "failed",
    qa: input.qa.map((entry) => ({ ...entry, findings: [...entry.findings] })),
    reviewedAt: new Date().toISOString(),
  };
  let deckPackage: PptFullDeckPackage | undefined;
  if (allPassed) deckPackage = sealPptFullDeckCandidate(candidate, input.qa);

  return {
    nodeKey: artifact.nodeKey,
    kind: artifact.kind,
    title: deckPackage ? "完整 PPT 交付验收包" : "完整 PPT 页级返修包",
    status: "needs_review",
    summary: deckPackage ? "12 页 Delivery Critic 已通过，可继续内部下游；教师签收仍单独记录。" : "存在未关闭的页面问题，需要按页返修后重新审查。",
    markdownContent: deckPackage
      ? "# 完整 PPT 交付验收包\n\n全部页面的设计、视觉、来源和可读性审查通过，可以继续内部制作；教师签收仍是独立状态。"
      : "# 完整 PPT 页级返修包\n\n存在未关闭的页面问题，尚不能进入最终交付。",
    structuredContent: withArtifactQualityState({
      ...artifact.structuredContent,
      pptFullDeckReview: review,
      ...(deckPackage ? { pptFullDeckPackage: deckPackage } : {}),
    }, {
      validationStatus: "passed",
      reviewStatus: allPassed ? "passed" : "repair",
      downstreamEligibility: allPassed ? "eligible" : "blocked",
    }),
  };
}

function assertPptSampleQa(candidate: PptKeySampleCandidate, qa: SubmitPptSampleReviewInput["qa"]): void {
  const expected = [...candidate.samplePageIds].sort();
  const actual = qa.map((entry) => entry.pageId).sort();
  if (actual.length !== expected.length || actual.some((pageId, index) => pageId !== expected[index])) {
    throw new Error("PPT key sample review page set mismatch.");
  }
  for (const entry of qa) {
    const failed = entry.design === "failed" || entry.visual === "failed" || entry.provenance === "failed";
    if (failed && entry.findings.every((finding) => !finding.trim())) {
      throw new Error(`PPT key sample review findings required: ${entry.pageId}`);
    }
    if (!failed && entry.findings.length > 0) {
      throw new Error(`PPT key sample review has unresolved findings: ${entry.pageId}`);
    }
  }
}

function assertPptFullDeckQa(candidate: PptFullDeckCandidate, qa: SubmitPptFullDeckReviewInput["qa"]): void {
  const expected = [...candidate.pageIds].sort();
  const actual = qa.map((entry) => entry.pageId).sort();
  if (actual.length !== expected.length || actual.some((pageId, index) => pageId !== expected[index])) {
    throw new Error("PPT full deck review page set mismatch.");
  }
  for (const entry of qa) {
    const failed = entry.design === "failed" || entry.visual === "failed" || entry.provenance === "failed" || entry.readability === "failed";
    if (failed && entry.findings.every((finding) => !finding.trim())) {
      throw new Error(`PPT full deck review findings required: ${entry.pageId}`);
    }
    if (!failed && entry.findings.length > 0) {
      throw new Error(`PPT full deck review has unresolved findings: ${entry.pageId}`);
    }
  }
}
