import { describe, expect, it } from "vitest";

import { createValidationReport } from "@/server/contracts/contract-validator";
import {
  createCriticReport,
  parseCriticReportPayload,
  resolveEffectiveRubric,
} from "@/server/quality/critic-report";
import { decideQuality } from "@/server/quality/quality-decision-engine";
import type { CriticFinding, CriticReport, ValidationReport } from "@/server/quality/quality-types";

const target = {
  artifactId: "artifact-ppt-1",
  artifactVersion: 3,
  artifactDigest: "artifact-digest-v3",
  productionPath: "ppt_quality_asset_assembly",
};

describe("V1 Stage 2B deterministic quality decision", () => {
  it("blocks a failed ValidationReport even when the Critic recommends pass", () => {
    const validation = validationReport("failed");
    const rubric = resolveEffectiveRubric("ppt_final");
    const critic = criticReport({ rubric, recommendation: "pass", validationReports: [validation] });

    const decision = decideQuality({ validationReports: [validation], criticReport: critic, rubric, target });

    expect(decision).toMatchObject({ outcome: "block", nextAction: "repair_upstream" });
    expect(decision.reasonCodes).toContain("validation_not_passed");
  });

  it("blocks and requests evidence when a required dimension is not scorable", () => {
    const validation = validationReport("passed");
    const rubric = resolveEffectiveRubric("ppt_final");
    const critic = criticReport({
      rubric,
      dimensions: rubric.dimensions.map((dimension, index) => ({
        dimensionId: dimension.dimensionId,
        score: index === 0 ? "not_scorable" as const : 95 as const,
        evidenceRefs: index === 0 ? [] : [`render:${index}`],
        rationale: index === 0 ? "缺少真实逐页渲染。" : "证据完整。",
      })),
    });

    const decision = decideQuality({ validationReports: [validation], criticReport: critic, rubric, target });

    expect(decision).toMatchObject({ outcome: "block", nextAction: "regenerate_evidence" });
    expect(decision.reasonCodes).toContain("required_dimension_not_scorable");
  });

  it("passes when hard validation, evidence, dimensions and severity thresholds all pass", () => {
    const validation = validationReport("passed");
    const rubric = resolveEffectiveRubric("ppt_final");
    const critic = criticReport({ rubric });

    const first = decideQuality({ validationReports: [validation], criticReport: critic, rubric, target });
    const second = decideQuality({ validationReports: [validation], criticReport: critic, rubric, target });

    expect(first).toMatchObject({ outcome: "pass", nextAction: "await_teacher_approval", deliveryEligibility: "final_candidate" });
    expect(second.decisionDigest).toBe(first.decisionDigest);
  });

  it("returns repair with the smallest typed locator when a major finding exists", () => {
    const validation = validationReport("passed");
    const rubric = resolveEffectiveRubric("ppt_final");
    const finding = pageFinding("major");
    const critic = criticReport({ rubric, findings: [finding], recommendation: "repair" });

    const decision = decideQuality({ validationReports: [validation], criticReport: critic, rubric, target });

    expect(decision).toMatchObject({ outcome: "repair", nextAction: "repair_unit" });
    expect(decision.repairTargets).toEqual([finding.locator]);
  });

  it("blocks on a blocker finding regardless of high scores", () => {
    const validation = validationReport("passed");
    const rubric = resolveEffectiveRubric("ppt_final");
    const critic = criticReport({ rubric, findings: [pageFinding("blocker")], recommendation: "pass" });

    const decision = decideQuality({ validationReports: [validation], criticReport: critic, rubric, target });

    expect(decision).toMatchObject({ outcome: "block", nextAction: "repair_upstream" });
    expect(decision.reasonCodes).toContain("critic_blocker_present");
  });

  it("keeps decision digest stable when validation, dimension and finding order changes", () => {
    const validationA = validationReport("passed", "validation-a");
    const validationB = validationReport("passed", "validation-b");
    const rubric = resolveEffectiveRubric("ppt_final");
    const findings = [pageFinding("minor", "finding-b", "page-2"), pageFinding("major", "finding-a", "page-1")];
    const criticA = criticReport({ rubric, findings, dimensions: scoredDimensions(rubric), validationReports: [validationA, validationB] });
    const criticB = criticReport({ rubric, findings: [...findings].reverse(), dimensions: scoredDimensions(rubric).reverse(), validationReports: [validationB, validationA] });

    const first = decideQuality({ validationReports: [validationA, validationB], criticReport: criticA, rubric, target });
    const second = decideQuality({ validationReports: [validationB, validationA], criticReport: criticB, rubric, target });

    expect(second.outcome).toBe(first.outcome);
    expect(second.decisionDigest).toBe(first.decisionDigest);
  });

  it("rejects Critic payloads that try to write validator-only truth", () => {
    const rubric = resolveEffectiveRubric("ppt_final");
    const valid = criticPayload({ rubric });

    expect(() => parseCriticReportPayload({ ...valid, artifactTruth: { persisted: true } })).toThrow(/validator-only/i);
    expect(() => parseCriticReportPayload({ ...valid, validationStatus: "passed" })).toThrow(/validator-only/i);
  });

  it("blocks stale Critic and Validation reports when the target digest changes", () => {
    const validation = validationReport("passed");
    const rubric = resolveEffectiveRubric("ppt_final");
    const critic = criticReport({ rubric });

    const decision = decideQuality({
      validationReports: [validation],
      criticReport: critic,
      rubric,
      target: { ...target, artifactVersion: 4, artifactDigest: "artifact-digest-v4" },
    });

    expect(decision).toMatchObject({ outcome: "block", nextAction: "regenerate_evidence" });
    expect(decision.reasonCodes).toContain("report_target_mismatch");
  });
});

function validationReport(overallStatus: ValidationReport["overallStatus"], reportId = "validation-ppt") {
  return createValidationReport({
    reportId,
    createdAt: "2026-07-12T00:00:00.000Z",
    domain: "ppt",
    stage: "ppt_final",
    target: {
      kind: "artifact",
      targetId: target.artifactId,
      targetVersion: target.artifactVersion,
      targetDigest: target.artifactDigest,
    },
    contract: { id: "ppt.final", version: "v1" },
    overallStatus,
    gates: [],
  });
}

function criticReport(overrides: {
  rubric: ReturnType<typeof resolveEffectiveRubric>;
  recommendation?: CriticReport["recommendation"];
  dimensions?: CriticReport["dimensions"];
  findings?: CriticFinding[];
  validationReports?: ValidationReport[];
}) {
  return createCriticReport(criticPayload(overrides));
}

function criticPayload(overrides: {
  rubric: ReturnType<typeof resolveEffectiveRubric>;
  recommendation?: CriticReport["recommendation"];
  dimensions?: CriticReport["dimensions"];
  findings?: CriticFinding[];
  validationReports?: ValidationReport[];
}) {
  return {
    reportId: "critic-ppt",
    createdAt: "2026-07-12T00:01:00.000Z",
    status: "complete" as const,
    domain: "ppt" as const,
    stage: "ppt_final",
    target,
    validationReportRefs: (overrides.validationReports ?? [validationReport("passed")]).map((report) => ({
      reportId: report.reportId,
      digest: report.reportDigest,
    })),
    effectiveRubric: { id: overrides.rubric.id, version: overrides.rubric.version, digest: overrides.rubric.digest },
    targetLocators: [{ kind: "artifact" as const, artifactKind: "pptx_artifact", artifactId: target.artifactId }],
    dimensions: overrides.dimensions ?? scoredDimensions(overrides.rubric),
    findings: overrides.findings ?? [],
    recommendation: overrides.recommendation ?? "pass" as const,
  };
}

function scoredDimensions(rubric: ReturnType<typeof resolveEffectiveRubric>): CriticReport["dimensions"] {
  return rubric.dimensions.map((dimension, index) => ({
    dimensionId: dimension.dimensionId,
    score: 95,
    evidenceRefs: [`render:${index}`],
    rationale: "真实渲染证据达到课堂交付标准。",
  }));
}

function pageFinding(
  severity: CriticFinding["severity"],
  findingId = "finding-page-1",
  pageId = "page-1",
): CriticFinding {
  return {
    findingId,
    severity,
    locator: { kind: "page", pageId, parentArtifactId: target.artifactId },
    evidenceRefs: [`render:${pageId}`],
    responsibleStage: "ppt_page_layout",
    minimalFix: "增大正文并重新渲染本页。",
    invalidatesDownstream: false,
  };
}
