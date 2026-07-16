import { createHash } from "node:crypto";

import {
  createV1_9ExternalAcceptanceReportDigest,
  deriveV1_9ExternalAuditAffectedUnits,
  normalizeV1_9ExternalAcceptanceReport,
  type V1_9ExternalAcceptanceFinding,
  type V1_9ExternalAcceptanceReport,
  type V1_9ExternalAuditAffectedUnit,
} from "@/server/quality/v1-9-external-acceptance";

export const EXTERNAL_AUDIT_REPAIR_HANDOFF_VERSION = "external-audit-repair-handoff.v1" as const;

export type ExternalAuditTaskBinding = {
  actorUserId: string;
  actorAuthMode: "local" | "password" | "oauth" | "sso";
  projectId: string;
  taskId: string;
  intentEpoch: number;
  taskBriefDigest: string;
  planRevision: number;
  turnJobId: string;
  teacherMessageId: string;
  idempotencyKey: string;
};

export type ExternalAuditRepairHandoff = {
  schemaVersion: typeof EXTERNAL_AUDIT_REPAIR_HANDOFF_VERSION;
  reportId: string;
  reportDigest: string;
  auditRound: number;
  runId: string;
  manifestSha256: string;
  packageArtifactId: string;
  packageArtifactVersion: number;
  packageVersion: string;
  packageSha256: string;
  taskBinding: ExternalAuditTaskBinding;
  openFindingIds: string[];
  findings: V1_9ExternalAcceptanceFinding[];
  affectedUnits: V1_9ExternalAuditAffectedUnit[];
  preserveUnlistedVersions: true;
  externalCodexBusinessToolCallCount: 0;
  createdAt: string;
  handoffDigest: string;
};

export function createExternalAuditRepairHandoff(input: {
  report: V1_9ExternalAcceptanceReport;
  reportDigest: string;
  binding: ExternalAuditTaskBinding;
}): ExternalAuditRepairHandoff {
  const report = normalizeV1_9ExternalAcceptanceReport(input.report);
  const reportDigest = requiredDigest(input.reportDigest, "external_audit_report_digest_invalid");
  if (createV1_9ExternalAcceptanceReportDigest(report) !== reportDigest) {
    throw new Error("external_audit_report_digest_invalid");
  }
  const taskBinding = normalizeTaskBinding(input.binding);
  const findings = report.findings.filter((finding) => finding.severity === "P0" && finding.status === "open");
  if (findings.length === 0) throw new Error("external_audit_open_p0_finding_required");
  const unsigned = {
    schemaVersion: EXTERNAL_AUDIT_REPAIR_HANDOFF_VERSION,
    reportId: report.reportId,
    reportDigest,
    auditRound: report.auditRound,
    runId: report.runId,
    manifestSha256: report.manifestSha256,
    packageArtifactId: report.packageArtifactId,
    packageArtifactVersion: report.packageArtifactVersion,
    packageVersion: report.packageVersion,
    packageSha256: report.packageSha256,
    taskBinding,
    openFindingIds: findings.map((finding) => finding.findingId).sort(),
    findings: structuredClone(findings).sort((left, right) => left.findingId.localeCompare(right.findingId)),
    affectedUnits: deriveV1_9ExternalAuditAffectedUnits(findings),
    preserveUnlistedVersions: true as const,
    externalCodexBusinessToolCallCount: 0 as const,
    createdAt: report.generatedAt,
  };
  return { ...unsigned, handoffDigest: digest(unsigned) };
}

export function normalizeExternalAuditRepairHandoff(value: unknown): ExternalAuditRepairHandoff {
  const handoff = requiredRecord(value, "external_audit_repair_handoff_invalid");
  assertOnlyFields(handoff, [
    "schemaVersion", "reportId", "reportDigest", "auditRound", "runId", "manifestSha256",
    "packageArtifactId", "packageArtifactVersion", "packageVersion", "packageSha256", "taskBinding",
    "openFindingIds", "findings", "affectedUnits", "preserveUnlistedVersions",
    "externalCodexBusinessToolCallCount", "createdAt", "handoffDigest",
  ], "external_audit_repair_handoff_invalid");
  if (handoff.schemaVersion !== EXTERNAL_AUDIT_REPAIR_HANDOFF_VERSION ||
      handoff.preserveUnlistedVersions !== true || handoff.externalCodexBusinessToolCallCount !== 0) {
    throw new Error("external_audit_repair_handoff_invalid");
  }
  const findings = normalizeFindings(handoff.findings);
  const affectedUnits = normalizeAffectedUnits(handoff.affectedUnits);
  const openFindingIds = requiredTextArray(handoff.openFindingIds, "external_audit_repair_handoff_invalid");
  if (!sameTextSet(openFindingIds, findings.map((finding) => finding.findingId)) ||
      findings.some((finding) => finding.severity !== "P0" || finding.status !== "open") ||
      JSON.stringify(affectedUnits) !== JSON.stringify(deriveV1_9ExternalAuditAffectedUnits(findings))) {
    throw new Error("external_audit_repair_handoff_invalid");
  }
  const normalizedWithoutDigest = {
    schemaVersion: EXTERNAL_AUDIT_REPAIR_HANDOFF_VERSION,
    reportId: requiredSafeId(handoff.reportId, "external_audit_repair_handoff_invalid"),
    reportDigest: requiredDigest(handoff.reportDigest, "external_audit_repair_handoff_invalid"),
    auditRound: requiredPositiveInteger(handoff.auditRound, "external_audit_repair_handoff_invalid"),
    runId: requiredSafeId(handoff.runId, "external_audit_repair_handoff_invalid"),
    manifestSha256: requiredDigest(handoff.manifestSha256, "external_audit_repair_handoff_invalid"),
    packageArtifactId: requiredSafeId(handoff.packageArtifactId, "external_audit_repair_handoff_invalid"),
    packageArtifactVersion: requiredPositiveInteger(handoff.packageArtifactVersion, "external_audit_repair_handoff_invalid"),
    packageVersion: requiredText(handoff.packageVersion, "external_audit_repair_handoff_invalid"),
    packageSha256: requiredDigest(handoff.packageSha256, "external_audit_repair_handoff_invalid"),
    taskBinding: normalizeTaskBinding(handoff.taskBinding),
    openFindingIds: [...openFindingIds].sort(),
    findings: [...findings].sort((left, right) => left.findingId.localeCompare(right.findingId)),
    affectedUnits,
    preserveUnlistedVersions: true as const,
    externalCodexBusinessToolCallCount: 0 as const,
    createdAt: requiredTimestamp(handoff.createdAt, "external_audit_repair_handoff_invalid"),
  };
  const handoffDigest = requiredDigest(handoff.handoffDigest, "external_audit_repair_handoff_invalid");
  if (handoffDigest !== digest(normalizedWithoutDigest)) throw new Error("external_audit_repair_handoff_digest_invalid");
  return { ...normalizedWithoutDigest, handoffDigest };
}

function normalizeTaskBinding(value: unknown): ExternalAuditTaskBinding {
  const binding = requiredRecord(value, "external_audit_task_binding_invalid");
  assertOnlyFields(binding, [
    "actorUserId", "actorAuthMode",
    "projectId", "taskId", "intentEpoch", "taskBriefDigest", "planRevision",
    "turnJobId", "teacherMessageId", "idempotencyKey",
  ], "external_audit_task_binding_invalid");
  return {
    actorUserId: requiredSafeId(binding.actorUserId, "external_audit_task_binding_invalid"),
    actorAuthMode: requiredAuthMode(binding.actorAuthMode),
    projectId: requiredSafeId(binding.projectId, "external_audit_task_binding_invalid"),
    taskId: requiredSafeId(binding.taskId, "external_audit_task_binding_invalid"),
    intentEpoch: requiredNonNegativeInteger(binding.intentEpoch, "external_audit_task_binding_invalid"),
    taskBriefDigest: requiredDigest(binding.taskBriefDigest, "external_audit_task_binding_invalid"),
    planRevision: requiredNonNegativeInteger(binding.planRevision, "external_audit_task_binding_invalid"),
    turnJobId: requiredSafeId(binding.turnJobId, "external_audit_task_binding_invalid"),
    teacherMessageId: requiredSafeId(binding.teacherMessageId, "external_audit_task_binding_invalid"),
    idempotencyKey: requiredSafeId(binding.idempotencyKey, "external_audit_task_binding_invalid"),
  };
}

function requiredAuthMode(value: unknown): "local" | "password" | "oauth" | "sso" {
  if (value !== "local" && value !== "password" && value !== "oauth" && value !== "sso") {
    throw new Error("external_audit_task_binding_invalid");
  }
  return value;
}

function normalizeFindings(value: unknown): V1_9ExternalAcceptanceFinding[] {
  if (!Array.isArray(value)) throw new Error("external_audit_repair_handoff_invalid");
  return value.map((finding) => {
    const synthetic = normalizeV1_9ExternalAcceptanceReport({
      schemaVersion: "v1-9-external-acceptance-report.v2",
      reportId: "handoff-validation",
      auditRound: 1,
      runId: "v1-9-handoff-validation",
      manifestSha256: "a".repeat(64),
      packageArtifactId: "package-validation",
      packageArtifactVersion: 1,
      packageVersion: "validation-v1",
      packageSha256: "b".repeat(64),
      rubricVersion: "validation-rubric",
      auditMode: "external_read_only",
      auditBoundary: { businessToolCalls: 0, artifactMutations: 0, teacherApprovalActions: 0, packageRebuilds: 0 },
      reviewScope: { kind: "full_package", previousReportDigest: null, reviewedFindingIds: [] },
      findings: [finding],
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    return synthetic.findings[0];
  });
}

function normalizeAffectedUnits(value: unknown): V1_9ExternalAuditAffectedUnit[] {
  if (!Array.isArray(value)) throw new Error("external_audit_repair_handoff_invalid");
  return value.map((unit) => {
    const source = requiredRecord(unit, "external_audit_repair_handoff_invalid");
    assertOnlyFields(source, ["unitId", "kind", "artifactRole", "artifactId", "artifactVersion", "pageNumber", "shotId", "packageEntry"], "external_audit_repair_handoff_invalid");
    return structuredClone(source) as V1_9ExternalAuditAffectedUnit;
  }).sort((left, right) => left.unitId.localeCompare(right.unitId));
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sameTextSet(left: string[], right: string[]) {
  return JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
}

function requiredTextArray(value: unknown, errorCode: string) {
  if (!Array.isArray(value)) throw new Error(errorCode);
  const items = value.map((item) => requiredSafeId(item, errorCode));
  if (new Set(items).size !== items.length) throw new Error(errorCode);
  return items;
}

function requiredSafeId(value: unknown, errorCode: string) {
  const id = requiredText(value, errorCode);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,191}$/.test(id)) throw new Error(errorCode);
  return id;
}

function requiredDigest(value: unknown, errorCode: string) {
  const valueText = requiredText(value, errorCode).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(valueText)) throw new Error(errorCode);
  return valueText;
}

function requiredTimestamp(value: unknown, errorCode: string) {
  const timestamp = requiredText(value, errorCode);
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error(errorCode);
  return timestamp;
}

function requiredNonNegativeInteger(value: unknown, errorCode: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(errorCode);
  return Number(value);
}

function requiredPositiveInteger(value: unknown, errorCode: string) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error(errorCode);
  return Number(value);
}

function requiredText(value: unknown, errorCode: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(errorCode);
  return value.trim();
}

function requiredRecord(value: unknown, errorCode: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(errorCode);
  return value as Record<string, unknown>;
}

function assertOnlyFields(value: Record<string, unknown>, fields: string[], errorCode: string) {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) throw new Error(errorCode);
}
