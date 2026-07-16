import { hashArtifactDraft } from "@/server/contracts/contract-validator";
import type { TaskBrief } from "@/server/conversation/task-contract";
import type { ArtifactRecord } from "@/server/workbench/types";

export const ARTIFACT_APPROVAL_EVIDENCE_VERSION = "artifact-approval-evidence.v1" as const;
export const LEGACY_ARTIFACT_APPROVAL_MIGRATION_VERSION = "legacy-artifact-approval-migration.v1" as const;

const teacherInputAuthorityFields = new Set([
  "artifactApprovalEvidence",
  "legacyApprovalMigration",
  "artifactQualityState",
  "artifactTruth",
  "executionEnvelope",
  "generationMode",
  "packageAsset",
  "providerStatus",
  "qualityGate",
  "runtimeKind",
  "toolInvocation",
  "validationReport",
]);

export type ArtifactValidationEvidence = {
  overallStatus: string;
  reportDigest: string;
  targetDigest: string | null;
};

export function sanitizeTeacherArtifactStructuredContent(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !teacherInputAuthorityFields.has(key))
    .map(([key, entry]) => [key, structuredClone(entry)]));
}

export function attachVerifiedArtifactApprovalEvidence(
  artifact: Pick<ArtifactRecord, "nodeKey" | "kind" | "title" | "summary" | "markdownContent" | "structuredContent" | "origin" | "status">,
  validation?: ArtifactValidationEvidence | null,
): Record<string, unknown> {
  assertArtifactTruthApprovable(artifact, validation);
  const structuredContent = withoutApprovalEvidence(artifact.structuredContent);
  const artifactDigest = artifactDraftDigest({ ...artifact, structuredContent });
  const reviewEvidenceDigest = specializedApprovalEvidenceDigest(artifact.structuredContent);
  const sourceAuthority = artifact.origin === "teacher_input"
    ? "teacher_input"
    : artifact.origin === "legacy"
      ? "legacy_reapproved"
      : validation ? "validated_tool_result" : "validated_review_result";
  return {
    ...artifact.structuredContent,
    artifactApprovalEvidence: {
      schemaVersion: ARTIFACT_APPROVAL_EVIDENCE_VERSION,
      sourceAuthority,
      artifactDigest,
      validationReportDigest: sourceAuthority === "validated_tool_result" ? validation!.reportDigest : null,
      reviewEvidenceDigest: sourceAuthority === "validated_review_result" ? reviewEvidenceDigest : null,
      approvedAt: new Date().toISOString(),
    },
  };
}

export function hasVerifiedArtifactApprovalEvidence(artifact: ArtifactRecord): boolean {
  if (artifact.status !== "approved" || artifact.isApproved !== true) return false;
  const evidence = artifact.structuredContent.artifactApprovalEvidence;
  if (!isRecord(evidence) || evidence.schemaVersion !== ARTIFACT_APPROVAL_EVIDENCE_VERSION) return false;
  if (evidence.sourceAuthority !== "teacher_input" && evidence.sourceAuthority !== "validated_tool_result" &&
      evidence.sourceAuthority !== "validated_review_result" && evidence.sourceAuthority !== "legacy_reapproved") return false;
  if (evidence.sourceAuthority === "teacher_input" && artifact.origin !== "teacher_input") return false;
  if (evidence.sourceAuthority === "validated_tool_result" && artifact.origin !== "tool_result") return false;
  if (evidence.sourceAuthority === "validated_review_result" && artifact.origin !== "tool_result") return false;
  if (evidence.sourceAuthority === "legacy_reapproved" &&
      (artifact.origin !== "legacy" || !hasLegacyArtifactApprovalMigration(artifact.structuredContent) ||
        !isIsoDate(evidence.approvedAt))) return false;
  if (evidence.sourceAuthority === "validated_tool_result" && !isSha256(evidence.validationReportDigest)) return false;
  if (evidence.sourceAuthority === "validated_review_result" && !isSha256(evidence.reviewEvidenceDigest)) return false;
  if (!isSha256(evidence.artifactDigest)) return false;
  return evidence.artifactDigest === artifactDraftDigest({
    ...artifact,
    structuredContent: withoutApprovalEvidence(artifact.structuredContent),
  });
}

export function isArtifactAvailableAsTaskInput(artifact: ArtifactRecord, taskBrief: TaskBrief): boolean {
  if (artifact.intentEpoch !== taskBrief.intentEpoch) return false;
  const hasTaskId = hasText(artifact.taskId);
  const hasTaskBriefDigest = hasText(artifact.taskBriefDigest);
  if (hasTaskId !== hasTaskBriefDigest) return false;
  if (hasTaskId && hasTaskBriefDigest) {
    return artifact.taskId === taskBrief.taskId && artifact.taskBriefDigest === taskBrief.digest;
  }
  return artifact.origin === "teacher_input" || artifact.origin === "tool_result";
}

// Existing callers use this boundary to select context and upstream inputs.
export function isArtifactBoundToTask(artifact: ArtifactRecord, taskBrief: TaskBrief): boolean {
  return isArtifactAvailableAsTaskInput(artifact, taskBrief);
}

export function isArtifactBoundToRequestedOutput(artifact: ArtifactRecord, taskBrief: TaskBrief): boolean {
  return artifact.intentEpoch === taskBrief.intentEpoch &&
    hasText(artifact.taskId) && artifact.taskId === taskBrief.taskId &&
    hasText(artifact.taskBriefDigest) && artifact.taskBriefDigest === taskBrief.digest;
}

export function hasForbiddenArtifactTruthMarker(value: unknown): boolean {
  if (!isRecord(value)) return false;
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if ((normalizedKey === "placeholder" || normalizedKey === "isplaceholder") && entry === true) return true;
    if ((normalizedKey === "degraded" || normalizedKey === "isdegraded") && entry === true) return true;
    if ((normalizedKey === "generationmode" || normalizedKey === "providerstatus") &&
        typeof entry === "string" && /deterministic|placeholder|degraded|fallback/i.test(entry)) return true;
    if (isRecord(entry) && hasForbiddenArtifactTruthMarker(entry)) return true;
    if (Array.isArray(entry) && entry.some(hasForbiddenArtifactTruthMarker)) return true;
  }
  return false;
}

export function hasLegacyArtifactApprovalMigration(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const migration = value.legacyApprovalMigration;
  return isRecord(migration) &&
    migration.schemaVersion === LEGACY_ARTIFACT_APPROVAL_MIGRATION_VERSION &&
    migration.reasonCode === "legacy_approval_evidence_missing" &&
    migration.migratedFromStatus === "approved" &&
    migration.migratedFromApproved === true &&
    isIsoDate(migration.migratedAt);
}

function assertArtifactTruthApprovable(
  artifact: Pick<ArtifactRecord, "status" | "title" | "summary" | "markdownContent" | "structuredContent" | "origin" | "nodeKey" | "kind">,
  validation?: ArtifactValidationEvidence | null,
) {
  if (artifact.status !== "needs_review") throw new Error("artifact_truth_not_approvable:status");
  if (!artifact.title.trim() || (!artifact.summary.trim() && !artifact.markdownContent.trim() && Object.keys(artifact.structuredContent).length === 0)) {
    throw new Error("artifact_truth_not_approvable:content_empty");
  }
  if (hasForbiddenArtifactTruthMarker(artifact.structuredContent)) {
    throw new Error("artifact_truth_not_approvable:non_production_result");
  }
  if (artifact.origin === "teacher_input") return;
  if (artifact.origin === "legacy") {
    if (!hasLegacyArtifactApprovalMigration(artifact.structuredContent)) {
      throw new Error("artifact_truth_not_approvable:legacy_migration_evidence_missing");
    }
    return;
  }
  if (specializedApprovalEvidenceDigest(artifact.structuredContent)) return;
  const expectedDigest = artifactDraftDigest({
    ...artifact,
    structuredContent: withoutApprovalEvidence(artifact.structuredContent),
  });
  if (!validation || validation.overallStatus !== "passed" || !isSha256(validation.reportDigest) || validation.targetDigest !== expectedDigest) {
    throw new Error("artifact_truth_not_approvable:validation_missing_or_mismatched");
  }
}

function specializedApprovalEvidenceDigest(value: Record<string, unknown>): string | null {
  for (const key of ["videoCourseAnchorApproval", "videoFinalApproval"]) {
    const approval = value[key];
    if (isRecord(approval) && approval.decision === "approved" && isSha256(approval.reviewEvidenceDigest)) {
      return approval.reviewEvidenceDigest;
    }
  }
  const pptApproval = value.pptSampleApproval;
  if (isRecord(pptApproval) && pptApproval.decision === "approved" && isSha256(pptApproval.sampleSetDigest)) {
    return pptApproval.sampleSetDigest;
  }
  return null;
}

function artifactDraftDigest(
  artifact: Pick<ArtifactRecord, "nodeKey" | "kind" | "title" | "summary" | "markdownContent" | "structuredContent">,
) {
  return hashArtifactDraft({
    nodeKey: artifact.nodeKey,
    kind: artifact.kind,
    title: artifact.title,
    summary: artifact.summary,
    markdownContent: artifact.markdownContent,
    structuredContent: artifact.structuredContent,
  });
}

function withoutApprovalEvidence(value: Record<string, unknown>) {
  const {
    artifactApprovalEvidence: _approval,
    pptSampleApproval: _pptSampleApproval,
    routeGenerationActions: _routeGenerationActions,
    videoCourseAnchorApproval: _videoCourseAnchorApproval,
    videoFinalApproval: _videoFinalApproval,
    ...rest
  } = value;
  return rest;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
