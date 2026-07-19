import { hashArtifactDraft, hasValidValidationReportDigest } from "@/server/contracts/contract-validator";
import type { ValidationReport } from "@/server/quality/quality-types";

export function validationReportIssue(
  report: ValidationReport,
  draft: {
    nodeKey: string | null;
    kind: string | null;
    title: string | null;
    summary: string | null;
    markdownContent: string | null;
    structuredContent?: Record<string, unknown>;
    structuredContentJson?: string;
  },
  job?: { id: string; inputHash: string | null; intentEpoch: number },
): string | undefined {
  if (!hasValidValidationReportDigest(report)) return "validation_report_digest_mismatch";
  if (report.overallStatus !== "passed") return `validation_report_${report.overallStatus}`;
  if (!draft.nodeKey || !draft.kind || !draft.title || draft.summary === null || draft.markdownContent === null) {
    return "validation_target_incomplete";
  }
  const structuredContent = draft.structuredContent
    ?? (draft.structuredContentJson ? parseStructuredContent(draft.structuredContentJson) : {});
  const targetDigest = hashArtifactDraft({
    nodeKey: draft.nodeKey,
    kind: draft.kind,
    title: draft.title,
    summary: draft.summary,
    markdownContent: draft.markdownContent,
    structuredContent,
  });
  if (report.target.kind !== "artifact_draft" || report.target.targetDigest !== targetDigest) {
    return "validation_target_digest_mismatch";
  }
  if (job) {
    const expectedInputHash = job.inputHash ?? `legacy:${job.id}`;
    if (report.inputHash !== expectedInputHash) return "validation_input_hash_mismatch";
    if (report.intentEpoch !== job.intentEpoch) return "validation_intent_epoch_mismatch";
  }
  return undefined;
}

export function validationReportRecordData(input: {
  projectId: string;
  report: ValidationReport;
  artifactId: string;
}) {
  const report = input.report;
  const createdAt = new Date(report.createdAt);
  if (Number.isNaN(createdAt.getTime())) throw new Error("Validation report createdAt is invalid.");
  return {
    id: report.reportId,
    projectId: input.projectId,
    capabilityId: report.stage,
    stage: report.stage,
    authority: report.authority,
    domain: report.domain,
    targetKind: report.target.kind,
    targetId: report.target.targetId,
    targetVersion: report.target.targetVersion,
    targetDigest: report.target.targetDigest,
    inputHash: report.inputHash,
    intentEpoch: report.intentEpoch,
    contractId: report.contract.id,
    contractVersion: report.contract.version,
    overallStatus: report.overallStatus,
    reportDigest: report.reportDigest,
    payloadJson: JSON.stringify(report),
    artifactId: input.artifactId,
    createdAt,
  };
}

function parseStructuredContent(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}");
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
