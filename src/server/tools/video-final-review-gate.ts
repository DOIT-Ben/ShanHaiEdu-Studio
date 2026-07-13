import type { CriticFinding, TargetLocator } from "@/server/quality/quality-types";

export const videoFinalReviewHardGateIds = [
  "independent_understandability",
  "standalone_viewing_value",
  "not_textbook_or_ppt_retelling",
  "exactly_one_minimal_course_anchor",
  "audience_not_story_world_constraint",
  "no_answer_disclosure",
  "shot_timeline_continuity",
  "narrative_completeness_and_pacing",
  "caption_transcript_integrity",
  "audio_track_integrity",
] as const;

const allowedRepairStages = new Set([
  "video_concept_selection",
  "video_course_anchor",
  "video_storyboard",
  "video_shot_generation",
  "video_post_production",
  "video_timeline_assembly",
]);

export type VideoFinalReviewCandidate = {
  recommendation: string;
  summary: string;
  findings: CriticFinding[];
  targetLocators: TargetLocator[];
  responsibleStage: string;
  minimalFix: string;
  inconclusiveReasons: string[];
  hardGateResults: Array<{
    gateId: string;
    status: string;
    evidenceRefs: string[];
    rationale: string;
    findingIds: string[];
  }>;
  [key: string]: unknown;
};

export function enforceVideoFinalReviewGate(candidate: VideoFinalReviewCandidate) {
  const reasons: string[] = [];
  const expected = new Set<string>(videoFinalReviewHardGateIds);
  const counts = new Map<string, number>();
  const findingIds = new Set((candidate.findings ?? []).map((finding) => finding.findingId));

  for (const gate of candidate.hardGateResults ?? []) {
    counts.set(gate.gateId, (counts.get(gate.gateId) ?? 0) + 1);
    if (!expected.has(gate.gateId)) reasons.push(`hard_gate_unexpected:${gate.gateId}`);
    if (!isStatus(gate.status)) reasons.push(`hard_gate_status_invalid:${gate.gateId}`);
    if (!gate.evidenceRefs?.some((ref) => ref.trim())) reasons.push(`hard_gate_evidence_missing:${gate.gateId}`);
    if (!gate.rationale?.trim()) reasons.push(`hard_gate_rationale_missing:${gate.gateId}`);
    if (gate.status === "failed" && !gate.findingIds?.length) reasons.push(`hard_gate_finding_missing:${gate.gateId}`);
    for (const findingId of gate.findingIds ?? []) {
      if (!findingIds.has(findingId)) reasons.push(`hard_gate_finding_unknown:${gate.gateId}:${findingId}`);
    }
  }
  for (const gateId of videoFinalReviewHardGateIds) {
    const count = counts.get(gateId) ?? 0;
    if (count === 0) reasons.push(`hard_gate_missing:${gateId}`);
    if (count > 1) reasons.push(`hard_gate_duplicate:${gateId}`);
  }

  if (!allowedRepairStages.has(candidate.responsibleStage?.trim())) reasons.push("repair_stage_invalid");
  if (!candidate.minimalFix?.trim()) reasons.push("repair_minimal_fix_missing");
  for (const finding of candidate.findings ?? []) {
    if (!allowedRepairStages.has(finding.responsibleStage?.trim())) reasons.push(`finding_repair_stage_invalid:${finding.findingId}`);
    if (!isLocalVideoLocator(finding.locator)) reasons.push(`finding_locator_invalid:${finding.findingId}`);
  }
  if ((candidate.recommendation === "rework_required" || candidate.recommendation === "blocked") && !candidate.findings?.length) {
    reasons.push("repair_finding_missing");
  }
  if ((candidate.recommendation === "inconclusive" || (candidate.hardGateResults ?? []).some((gate) => gate.status === "inconclusive")) &&
      !candidate.inconclusiveReasons?.some((reason) => reason.trim())) {
    reasons.push("inconclusive_reason_missing");
  }

  const structurallyValid = reasons.length === 0;
  const failed = structurallyValid ? candidate.hardGateResults.filter((gate) => gate.status === "failed") : [];
  const inconclusive = structurallyValid ? candidate.hardGateResults.filter((gate) => gate.status === "inconclusive") : [];
  const blocking = (candidate.findings ?? []).some((finding) => finding.severity === "blocker" || finding.invalidatesDownstream);
  const recommendation = !structurallyValid || inconclusive.length > 0
    ? "inconclusive"
    : failed.length > 0 || blocking
      ? candidate.recommendation === "blocked" ? "blocked" : "rework_required"
      : candidate.recommendation === "pass" ? "pass" : "inconclusive";
  const reviewPassed = structurallyValid && failed.length === 0 && inconclusive.length === 0 && !blocking && recommendation === "pass";

  return {
    ...candidate,
    recommendation,
    reportStructurallyValid: structurallyValid,
    reviewPassed,
    eligibleForDownstreamGuard: reviewPassed,
    reasonCodes: [...new Set(reasons)].sort(),
    forbiddenNextToolIntents: reviewPassed ? [] : ["create_final_package", "final_package_generate"],
  };
}

function isStatus(value: string) {
  return value === "passed" || value === "failed" || value === "inconclusive";
}

function isLocalVideoLocator(locator: TargetLocator) {
  return locator.kind === "shot" || locator.kind === "frame_range" || locator.kind === "track" || locator.kind === "timeline";
}
