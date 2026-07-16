import { createHash } from "node:crypto";

const findingSeverities = new Set(["P0", "P1", "P2", "P3"] as const);
const findingStatuses = new Set(["open", "closed"] as const);
const findingCategories = new Set([
  "design_quality",
  "security_vulnerability",
  "contract",
  "lineage",
  "runtime",
] as const);
const responsibilityLayers = new Set([
  "main_agent",
  "business_tool",
  "prompt",
  "critic_rubric",
  "human_gate",
  "quality_gate",
  "provider_adapter",
  "package_assembler",
] as const);

type FindingSeverity = "P0" | "P1" | "P2" | "P3";
type FindingStatus = "open" | "closed";
type FindingCategory = "design_quality" | "security_vulnerability" | "contract" | "lineage" | "runtime";
type ResponsibilityLayer =
  | "main_agent"
  | "business_tool"
  | "prompt"
  | "critic_rubric"
  | "human_gate"
  | "quality_gate"
  | "provider_adapter"
  | "package_assembler";

export type V1_9ExternalAcceptanceFinding = {
  findingId: string;
  status: FindingStatus;
  severity: FindingSeverity;
  responsibilityLayer: ResponsibilityLayer;
  category: FindingCategory;
  summary: string;
  feedback: {
    design: string | null;
    vulnerability: string | null;
    engineering: string;
  };
  locator: {
    artifactRole: string;
    artifactId: string;
    artifactVersion: string;
    pageNumber: number | null;
    shotId: string | null;
    packageEntry: string | null;
  };
  suggestedRegressionTest: string;
};

export type V1_9ExternalAuditAffectedUnit = {
  unitId: string;
  kind: "page" | "shot" | "package_entry" | "artifact_version";
  artifactRole: string;
  artifactId: string;
  artifactVersion: string;
  pageNumber: number | null;
  shotId: string | null;
  packageEntry: string | null;
};

export type V1_9ExternalAcceptanceReport = {
  schemaVersion: "v1-9-external-acceptance-report.v2";
  reportId: string;
  auditRound: number;
  runId: string;
  manifestSha256: string;
  packageArtifactId: string;
  packageArtifactVersion: number;
  packageVersion: string;
  packageSha256: string;
  rubricVersion: string;
  auditMode: "external_read_only";
  auditBoundary: {
    businessToolCalls: 0;
    artifactMutations: 0;
    teacherApprovalActions: 0;
    packageRebuilds: 0;
  };
  reviewScope:
    | { kind: "full_package"; previousReportDigest: null; reviewedFindingIds: [] }
    | { kind: "targeted_recheck"; previousReportDigest: string; reviewedFindingIds: string[] };
  findings: V1_9ExternalAcceptanceFinding[];
  generatedAt: string;
};

export type V1_9ExternalAcceptanceRoundEvaluation = {
  outcome: "repair_required" | "accepted";
  auditRound: number;
  reviewedFindingIds: string[];
  openP0FindingIds: string[];
  affectedUnits: V1_9ExternalAuditAffectedUnit[];
};

export function normalizeV1_9ExternalAcceptanceReport(value: unknown): V1_9ExternalAcceptanceReport {
  const report = requiredRecord(value, "v1_9_external_acceptance_report_invalid");
  assertOnlyFields(report, [
    "schemaVersion", "reportId", "auditRound", "runId", "manifestSha256", "packageArtifactId",
    "packageArtifactVersion", "packageVersion", "packageSha256", "rubricVersion", "auditMode",
    "auditBoundary", "reviewScope", "findings", "generatedAt",
  ], "v1_9_external_acceptance_report_invalid");
  if (report.schemaVersion !== "v1-9-external-acceptance-report.v2") {
    throw new Error("v1_9_external_acceptance_report_version_invalid");
  }
  if (report.auditMode !== "external_read_only") throw new Error("v1_9_external_acceptance_mode_invalid");
  const auditBoundary = normalizeAuditBoundary(report.auditBoundary);
  if (Object.values(auditBoundary).some((count) => count !== 0)) {
    throw new Error("v1_9_external_acceptance_not_read_only");
  }
  if (!Array.isArray(report.findings)) throw new Error("v1_9_external_acceptance_findings_invalid");
  const findings = report.findings.map(normalizeFinding);
  if (new Set(findings.map((finding) => finding.findingId)).size !== findings.length) {
    throw new Error("v1_9_external_acceptance_finding_id_duplicate");
  }
  return {
    schemaVersion: "v1-9-external-acceptance-report.v2",
    reportId: requiredSafeId(report.reportId, "v1_9_external_acceptance_report_id_invalid"),
    auditRound: requiredPositiveInteger(report.auditRound, "v1_9_external_acceptance_round_invalid"),
    runId: requiredRunId(report.runId),
    manifestSha256: requiredDigest(report.manifestSha256, "v1_9_external_acceptance_manifest_digest_invalid"),
    packageArtifactId: requiredSafeId(report.packageArtifactId, "v1_9_external_acceptance_package_artifact_invalid"),
    packageArtifactVersion: requiredPositiveInteger(
      report.packageArtifactVersion,
      "v1_9_external_acceptance_package_artifact_version_invalid",
    ),
    packageVersion: requiredText(report.packageVersion, "v1_9_external_acceptance_package_version_invalid"),
    packageSha256: requiredDigest(report.packageSha256, "v1_9_external_acceptance_package_digest_invalid"),
    rubricVersion: requiredText(report.rubricVersion, "v1_9_external_acceptance_rubric_version_invalid"),
    auditMode: "external_read_only",
    auditBoundary: { businessToolCalls: 0, artifactMutations: 0, teacherApprovalActions: 0, packageRebuilds: 0 },
    reviewScope: normalizeReviewScope(report.reviewScope),
    findings,
    generatedAt: requiredTimestamp(report.generatedAt, "v1_9_external_acceptance_generated_at_invalid"),
  };
}

export function createV1_9ExternalAcceptanceReportDigest(report: V1_9ExternalAcceptanceReport) {
  return createHash("sha256").update(`${JSON.stringify(normalizeV1_9ExternalAcceptanceReport(report), null, 2)}\n`).digest("hex");
}

export function deriveV1_9ExternalAuditAffectedUnits(findings: unknown[]): V1_9ExternalAuditAffectedUnit[] {
  if (!Array.isArray(findings)) throw new Error("v1_9_external_acceptance_findings_invalid");
  const units = findings.map((finding) => affectedUnitFromFinding(normalizeFinding(finding)));
  return [...new Map(units.map((unit) => [unit.unitId, unit])).values()]
    .sort((left, right) => left.unitId.localeCompare(right.unitId));
}

export function evaluateV1_9ExternalAcceptanceRound(input: {
  history: Array<{ report: V1_9ExternalAcceptanceReport; reportDigest: string }>;
  current: V1_9ExternalAcceptanceReport;
}): V1_9ExternalAcceptanceRoundEvaluation {
  const history = input.history.map((entry) => ({
    report: normalizeV1_9ExternalAcceptanceReport(entry.report),
    reportDigest: requiredDigest(entry.reportDigest, "v1_9_external_acceptance_history_digest_invalid"),
  }));
  const current = normalizeV1_9ExternalAcceptanceReport(input.current);
  const openP0 = new Map<string, V1_9ExternalAcceptanceFinding>();
  let previous: V1_9ExternalAcceptanceReport | undefined;
  let previousDigest: string | undefined;

  for (const [index, entry] of history.entries()) {
    if (createV1_9ExternalAcceptanceReportDigest(entry.report) !== entry.reportDigest) {
      throw new Error("v1_9_external_acceptance_history_digest_invalid");
    }
    applyRound({ report: entry.report, expectedRound: index + 1, previous, previousDigest, openP0 });
    previous = entry.report;
    previousDigest = entry.reportDigest;
  }
  applyRound({ report: current, expectedRound: history.length + 1, previous, previousDigest, openP0 });

  const openP0FindingIds = [...openP0.keys()].sort();
  return {
    outcome: openP0FindingIds.length > 0 ? "repair_required" : "accepted",
    auditRound: current.auditRound,
    reviewedFindingIds: [...current.reviewScope.reviewedFindingIds],
    openP0FindingIds,
    affectedUnits: deriveV1_9ExternalAuditAffectedUnits([...openP0.values()]),
  };
}

function applyRound(input: {
  report: V1_9ExternalAcceptanceReport;
  expectedRound: number;
  previous?: V1_9ExternalAcceptanceReport;
  previousDigest?: string;
  openP0: Map<string, V1_9ExternalAcceptanceFinding>;
}) {
  const { report, expectedRound, previous, previousDigest, openP0 } = input;
  if (report.auditRound !== expectedRound) throw new Error("v1_9_external_acceptance_round_invalid");
  if (!previous) {
    if (report.reviewScope.kind !== "full_package" || report.reviewScope.previousReportDigest !== null ||
        report.reviewScope.reviewedFindingIds.length !== 0 || report.findings.some((finding) => finding.status !== "open")) {
      throw new Error("v1_9_external_acceptance_recheck_scope_invalid");
    }
  } else {
    assertSameRunContract(previous, report);
    if (report.reviewScope.kind !== "targeted_recheck" || report.reviewScope.previousReportDigest !== previousDigest) {
      throw new Error("v1_9_external_acceptance_recheck_scope_invalid");
    }
    const expectedFindingIds = [...openP0.keys()].sort();
    const currentFindingIds = report.findings.map((finding) => finding.findingId);
    if (!sameTextSet(report.reviewScope.reviewedFindingIds, expectedFindingIds) ||
        expectedFindingIds.some((findingId) => !currentFindingIds.includes(findingId))) {
      throw new Error("v1_9_external_acceptance_recheck_scope_invalid");
    }
    if (report.packageArtifactVersion <= previous.packageArtifactVersion ||
        report.packageVersion === previous.packageVersion || report.packageSha256 === previous.packageSha256) {
      throw new Error("v1_9_external_acceptance_package_not_revised");
    }
    const authorizedScopeKeys = new Set([...openP0.values()].map(affectedScopeKey));
    for (const finding of report.findings) {
      const prior = openP0.get(finding.findingId);
      if ((prior && affectedScopeKey(prior) !== affectedScopeKey(finding)) ||
          !authorizedScopeKeys.has(affectedScopeKey(finding)) || (!prior && finding.status === "closed")) {
        throw new Error("v1_9_external_acceptance_recheck_scope_invalid");
      }
    }
  }

  for (const finding of report.findings) {
    if (finding.severity !== "P0") continue;
    if (finding.status === "open") openP0.set(finding.findingId, finding);
    else openP0.delete(finding.findingId);
  }
}

function assertSameRunContract(previous: V1_9ExternalAcceptanceReport, current: V1_9ExternalAcceptanceReport) {
  if (previous.runId !== current.runId || previous.manifestSha256 !== current.manifestSha256 ||
      previous.rubricVersion !== current.rubricVersion) {
    throw new Error("v1_9_external_acceptance_run_binding_mismatch");
  }
}

function affectedUnitFromFinding(finding: V1_9ExternalAcceptanceFinding): V1_9ExternalAuditAffectedUnit {
  const locator = finding.locator;
  const kind = locator.pageNumber !== null ? "page" as const
    : locator.shotId !== null ? "shot" as const
      : locator.packageEntry !== null ? "package_entry" as const : "artifact_version" as const;
  const suffix = locator.pageNumber ?? locator.shotId ?? locator.packageEntry ?? locator.artifactVersion;
  return {
    unitId: `${locator.artifactRole}:${kind}:${suffix}`,
    kind,
    artifactRole: locator.artifactRole,
    artifactId: locator.artifactId,
    artifactVersion: locator.artifactVersion,
    pageNumber: locator.pageNumber,
    shotId: locator.shotId,
    packageEntry: locator.packageEntry,
  };
}

function affectedScopeKey(finding: V1_9ExternalAcceptanceFinding) {
  const locator = finding.locator;
  if (locator.pageNumber !== null) return `${locator.artifactRole}:page:${locator.pageNumber}`;
  if (locator.shotId !== null) return `${locator.artifactRole}:shot:${locator.shotId}`;
  if (locator.packageEntry !== null) return `${locator.artifactRole}:package_entry:${stripVersion(locator.packageEntry)}`;
  return `${locator.artifactRole}:artifact_version`;
}

function stripVersion(value: string) {
  return value.replace(/(?:^|[-_])v?\d+(?=\.|[-_]|$)/gi, "");
}

function normalizeReviewScope(value: unknown): V1_9ExternalAcceptanceReport["reviewScope"] {
  const scope = requiredRecord(value, "v1_9_external_acceptance_recheck_scope_invalid");
  assertOnlyFields(scope, ["kind", "previousReportDigest", "reviewedFindingIds"], "v1_9_external_acceptance_recheck_scope_invalid");
  const reviewedFindingIds = requiredSafeIdArray(scope.reviewedFindingIds, "v1_9_external_acceptance_recheck_scope_invalid");
  if (scope.kind === "full_package") {
    if (scope.previousReportDigest !== null || reviewedFindingIds.length !== 0) {
      throw new Error("v1_9_external_acceptance_recheck_scope_invalid");
    }
    return { kind: "full_package", previousReportDigest: null, reviewedFindingIds: [] };
  }
  if (scope.kind !== "targeted_recheck") throw new Error("v1_9_external_acceptance_recheck_scope_invalid");
  return {
    kind: "targeted_recheck",
    previousReportDigest: requiredDigest(scope.previousReportDigest, "v1_9_external_acceptance_recheck_scope_invalid"),
    reviewedFindingIds,
  };
}

function normalizeAuditBoundary(value: unknown) {
  const boundary = requiredRecord(value, "v1_9_external_acceptance_boundary_invalid");
  assertOnlyFields(boundary, ["businessToolCalls", "artifactMutations", "teacherApprovalActions", "packageRebuilds"], "v1_9_external_acceptance_boundary_invalid");
  return {
    businessToolCalls: requiredNonNegativeInteger(boundary.businessToolCalls, "v1_9_external_acceptance_boundary_invalid"),
    artifactMutations: requiredNonNegativeInteger(boundary.artifactMutations, "v1_9_external_acceptance_boundary_invalid"),
    teacherApprovalActions: requiredNonNegativeInteger(boundary.teacherApprovalActions, "v1_9_external_acceptance_boundary_invalid"),
    packageRebuilds: requiredNonNegativeInteger(boundary.packageRebuilds, "v1_9_external_acceptance_boundary_invalid"),
  };
}

function normalizeFinding(value: unknown): V1_9ExternalAcceptanceFinding {
  const finding = requiredRecord(value, "v1_9_external_acceptance_finding_invalid");
  assertOnlyFields(finding, ["findingId", "status", "severity", "responsibilityLayer", "category", "summary", "feedback", "locator", "suggestedRegressionTest"], "v1_9_external_acceptance_finding_invalid");
  const status = requiredEnum(finding.status, findingStatuses, "v1_9_external_acceptance_finding_status_invalid");
  const severity = requiredEnum(finding.severity, findingSeverities, "v1_9_external_acceptance_severity_invalid");
  const responsibilityLayer = requiredEnum(finding.responsibilityLayer, responsibilityLayers, "v1_9_external_acceptance_responsibility_layer_invalid");
  const category = requiredEnum(finding.category, findingCategories, "v1_9_external_acceptance_finding_category_invalid");
  return {
    findingId: requiredSafeId(finding.findingId, "v1_9_external_acceptance_finding_id_invalid"),
    status, severity, responsibilityLayer, category,
    summary: requiredText(finding.summary, "v1_9_external_acceptance_finding_summary_invalid"),
    feedback: normalizeFeedback(finding.feedback),
    locator: normalizeFindingLocator(finding.locator),
    suggestedRegressionTest: requiredText(finding.suggestedRegressionTest, "v1_9_external_acceptance_regression_test_invalid"),
  };
}

function normalizeFeedback(value: unknown) {
  const feedback = requiredRecord(value, "v1_9_external_acceptance_feedback_invalid");
  assertOnlyFields(feedback, ["design", "vulnerability", "engineering"], "v1_9_external_acceptance_feedback_invalid");
  const design = optionalText(feedback.design, "v1_9_external_acceptance_feedback_invalid");
  const vulnerability = optionalText(feedback.vulnerability, "v1_9_external_acceptance_feedback_invalid");
  if (design === null && vulnerability === null) throw new Error("v1_9_external_acceptance_feedback_invalid");
  return { design, vulnerability, engineering: requiredText(feedback.engineering, "v1_9_external_acceptance_feedback_invalid") };
}

function normalizeFindingLocator(value: unknown) {
  const locator = requiredRecord(value, "v1_9_external_acceptance_finding_locator_invalid");
  assertOnlyFields(locator, ["artifactRole", "artifactId", "artifactVersion", "pageNumber", "shotId", "packageEntry"], "v1_9_external_acceptance_finding_locator_invalid");
  const pageNumber = locator.pageNumber === null ? null : requiredPositiveInteger(locator.pageNumber, "v1_9_external_acceptance_finding_locator_invalid");
  const shotId = locator.shotId === null ? null : requiredSafeId(locator.shotId, "v1_9_external_acceptance_finding_locator_invalid");
  const packageEntry = locator.packageEntry === null ? null : requiredPackageEntry(locator.packageEntry);
  return {
    artifactRole: requiredSafeId(locator.artifactRole, "v1_9_external_acceptance_finding_locator_invalid"),
    artifactId: requiredSafeId(locator.artifactId, "v1_9_external_acceptance_finding_locator_invalid"),
    artifactVersion: requiredText(locator.artifactVersion, "v1_9_external_acceptance_finding_locator_invalid"),
    pageNumber, shotId, packageEntry,
  };
}

function sameTextSet(left: string[], right: string[]) {
  return JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
}

function requiredEnum<const T extends string>(value: unknown, values: ReadonlySet<T>, errorCode: string): T {
  const normalized = requiredText(value, errorCode);
  if (!values.has(normalized as T)) throw new Error(errorCode);
  return normalized as T;
}

function requiredSafeIdArray(value: unknown, errorCode: string) {
  if (!Array.isArray(value)) throw new Error(errorCode);
  const items = value.map((item) => requiredSafeId(item, errorCode));
  if (new Set(items).size !== items.length) throw new Error(errorCode);
  return items.sort();
}

function requiredPackageEntry(value: unknown) {
  const entry = requiredText(value, "v1_9_external_acceptance_finding_locator_invalid").replaceAll("\\", "/");
  if (entry.startsWith("/") || entry.includes("..") || !/^[^\0]+$/.test(entry)) throw new Error("v1_9_external_acceptance_finding_locator_invalid");
  return entry;
}

function requiredRunId(value: unknown) {
  const runId = requiredText(value, "v1_9_run_id_invalid");
  if (!/^v1-9-[a-z0-9][a-z0-9._-]{0,127}$/i.test(runId)) throw new Error("v1_9_run_id_invalid");
  return runId;
}

function requiredSafeId(value: unknown, errorCode: string) {
  const id = requiredText(value, errorCode);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,191}$/.test(id)) throw new Error(errorCode);
  return id;
}

function requiredDigest(value: unknown, errorCode: string) {
  const digest = requiredText(value, errorCode).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(errorCode);
  return digest;
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

function optionalText(value: unknown, errorCode: string) {
  if (value === null) return null;
  return requiredText(value, errorCode);
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
