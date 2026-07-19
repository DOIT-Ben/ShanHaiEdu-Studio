import { randomUUID } from "node:crypto";

import { hasValidValidationReportDigest } from "@/server/contracts/contract-validator";
import { hashRunInput } from "@/server/execution/run-input-snapshot";
import { hasValidCriticReportDigest } from "./critic-report";
import { omitObjectKeys } from "@/server/contracts/object-projection";
import type {
  CriticReport,
  EffectiveRubric,
  QualityDecision,
  QualityTarget,
  TargetLocator,
  ValidationReport,
} from "./quality-types";

export function decideQuality(input: {
  validationReports: ValidationReport[];
  criticReport?: CriticReport | null;
  rubric: EffectiveRubric;
  target: QualityTarget;
}): QualityDecision {
  const validations = [...input.validationReports].sort((a, b) => a.reportDigest.localeCompare(b.reportDigest));
  const critic = input.criticReport ?? null;
  const reasonCodes = new Set<string>();
  let nextAction: QualityDecision["nextAction"] = "continue_downstream";

  const reportTargetMismatch = validations.some((report) =>
    report.target.targetDigest !== input.target.artifactDigest ||
    (report.target.targetId !== undefined && report.target.targetId !== input.target.artifactId) ||
    (report.target.targetVersion !== undefined && report.target.targetVersion !== input.target.artifactVersion),
  ) || Boolean(critic && !sameQualityTarget(critic.target, input.target));
  if (reportTargetMismatch) {
    reasonCodes.add("report_target_mismatch");
    nextAction = "regenerate_evidence";
  }

  if (validations.length === 0 || validations.some((report) => !hasValidValidationReportDigest(report) || report.overallStatus !== "passed")) {
    reasonCodes.add("validation_not_passed");
    if (nextAction !== "regenerate_evidence") nextAction = "repair_upstream";
  }

  if (!critic || !hasValidCriticReportDigest(critic) || critic.status !== "complete") {
    reasonCodes.add("critic_missing_or_inconclusive");
    nextAction = "regenerate_evidence";
  }

  if (critic && (
    critic.effectiveRubric.id !== input.rubric.id ||
    critic.effectiveRubric.version !== input.rubric.version ||
    critic.effectiveRubric.digest !== input.rubric.digest
  )) {
    reasonCodes.add("rubric_digest_mismatch");
    nextAction = "regenerate_evidence";
  }

  if (critic && !criticValidationRefsMatch(critic, validations)) {
    reasonCodes.add("validation_report_ref_mismatch");
    nextAction = "regenerate_evidence";
  }
  const validationInputHashes = [...new Set(validations.map((report) => report.inputHash).filter((value): value is string => Boolean(value)))];
  if (validationInputHashes.length > 1 || (critic?.inputHash && critic.inputHash !== validationInputHashes[0])) {
    reasonCodes.add("report_input_hash_mismatch");
    nextAction = "regenerate_evidence";
  }

  const dimensionResults = input.rubric.dimensions.map((dimension) => ({
    ...dimension,
    result: critic?.dimensions.find((candidate) => candidate.dimensionId === dimension.dimensionId),
  }));
  if (dimensionResults.some((entry) => entry.required && (!entry.result || entry.result.score === "not_scorable" || entry.result.evidenceRefs.length === 0))) {
    reasonCodes.add("required_dimension_not_scorable");
    nextAction = "regenerate_evidence";
  }

  const weightedScore = dimensionResults.every((entry) => entry.result && entry.result.score !== "not_scorable")
    ? roundScore(dimensionResults.reduce((total, entry) => total + Number(entry.result!.score) * entry.weight / 100, 0))
    : null;
  const numericScores = dimensionResults.flatMap((entry) =>
    typeof entry.result?.score === "number" ? [entry.result.score] : [],
  );
  const blockerFindings = critic?.findings.filter((finding) => finding.severity === "blocker") ?? [];
  const majorFindings = critic?.findings.filter((finding) => finding.severity === "major") ?? [];

  if (blockerFindings.length > 0) {
    reasonCodes.add("critic_blocker_present");
    if (nextAction !== "regenerate_evidence") nextAction = "repair_upstream";
  }
  if (numericScores.some((score) => score < input.rubric.thresholds.blockBelowDimension)) {
    reasonCodes.add("dimension_below_block_threshold");
    if (nextAction !== "regenerate_evidence") nextAction = "repair_upstream";
  }
  if (weightedScore !== null && weightedScore < input.rubric.thresholds.repairMinTotal) {
    reasonCodes.add("total_below_block_threshold");
    if (nextAction !== "regenerate_evidence") nextAction = "repair_upstream";
  }

  const blockReasons = new Set([
    "report_target_mismatch", "validation_not_passed", "critic_missing_or_inconclusive",
    "rubric_digest_mismatch", "validation_report_ref_mismatch", "required_dimension_not_scorable",
    "report_input_hash_mismatch", "critic_blocker_present", "dimension_below_block_threshold", "total_below_block_threshold",
  ]);
  let outcome: QualityDecision["outcome"] = [...reasonCodes].some((reason) => blockReasons.has(reason)) ? "block" : "pass";

  if (outcome !== "block") {
    if (majorFindings.length > 0) reasonCodes.add("critic_major_present");
    if (numericScores.some((score) => score < input.rubric.thresholds.passMinDimension)) reasonCodes.add("dimension_below_pass_threshold");
    if (weightedScore !== null && weightedScore < input.rubric.thresholds.passTotal) reasonCodes.add("total_below_pass_threshold");
    if (reasonCodes.size > 0) {
      outcome = "repair";
      nextAction = "repair_unit";
    }
  }

  const repairTargets = normalizeLocators(
    outcome === "block" ? blockerFindings.map((finding) => finding.locator) : majorFindings.map((finding) => finding.locator),
  );
  const normalizedReasons = [...reasonCodes].sort();
  const deliveryEligibility = eligibilityFor(input.target.productionPath, input.rubric.target, outcome);
  const semanticPayload = {
    authority: "deterministic_policy" as const,
    domain: input.rubric.domain,
    stage: input.rubric.target,
    target: input.target,
    outcome,
    weightedScore,
    reasonCodes: normalizedReasons,
    nextAction,
    repairTargets,
    deliveryEligibility,
    validationReportDigests: validations.map((report) => report.reportDigest),
    criticReportDigest: critic?.reportDigest ?? null,
    rubricDigest: input.rubric.digest,
    inputHash: validationInputHashes[0] ?? null,
  };

  return {
    decisionId: randomUUID(),
    decisionDigest: hashRunInput(semanticPayload),
    createdAt: new Date().toISOString(),
    ...semanticPayload,
  };
}

export function hasValidQualityDecisionDigest(decision: QualityDecision): boolean {
  const semanticPayload = omitObjectKeys(decision, ["decisionId", "decisionDigest", "createdAt"]);
  return hashRunInput(semanticPayload) === decision.decisionDigest;
}

function criticValidationRefsMatch(critic: CriticReport, validations: ValidationReport[]) {
  const expected = validations.map((report) => `${report.reportId}:${report.reportDigest}`).sort();
  const actual = critic.validationReportRefs.map((ref) => `${ref.reportId}:${ref.digest}`).sort();
  return expected.length === actual.length && expected.every((entry, index) => entry === actual[index]);
}

function sameQualityTarget(a: QualityTarget, b: QualityTarget) {
  return a.artifactId === b.artifactId &&
    a.artifactVersion === b.artifactVersion &&
    a.artifactDigest === b.artifactDigest &&
    a.productionPath === b.productionPath;
}

function normalizeLocators(locators: TargetLocator[]) {
  const byDigest = new Map(locators.map((locator) => [hashRunInput(locator), locator]));
  return [...byDigest.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, locator]) => locator);
}

function eligibilityFor(productionPath: string, target: EffectiveRubric["target"], outcome: QualityDecision["outcome"]): QualityDecision["deliveryEligibility"] {
  if (outcome !== "pass") return "not_eligible";
  if (productionPath.includes("fast") || productionPath.includes("preview") || productionPath.includes("short")) return "preview_only";
  if (target === "video_shot") return "unit_candidate";
  return "final_candidate";
}

function roundScore(value: number) {
  return Math.round(value * 100) / 100;
}
