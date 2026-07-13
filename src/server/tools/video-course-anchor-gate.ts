import type { CriticFinding, TargetLocator } from "@/server/quality/quality-types";

const INDEPENDENT_FILM_CHECK_KEYS = [
  "understandableWithoutLesson",
  "worthwhileWithoutClassroomReturn",
  "notTextbookOrPptRetelling",
] as const;

export const videoCourseAnchorHardGateIds = [
  "independent_understandability",
  "standalone_viewing_value",
  "not_textbook_or_ppt_retelling",
  "exactly_one_minimal_course_anchor",
  "audience_not_story_world_constraint",
  "no_answer_disclosure",
] as const;

const REAL_MEDIA_TOOL_INTENTS = [
  "asset_image_generate",
  "generate_video_segment",
  "video_segment_generate",
  "concat_only_assemble",
  "generate_video_assets",
  "generate_video_shot",
  "assemble_video",
  "create_final_package",
  "final_package_generate",
] as const;

export const videoCourseAnchorForbiddenNextToolIntents = [...REAL_MEDIA_TOOL_INTENTS] as const;

const preCriticAllowedNextToolIntentSet = new Set<string>(["delivery_critic.review"]);
const courseAnchorRepairStageSet = new Set<string>([
  "teacher_brief",
  "lesson_evidence",
  "video_concept_selection",
  "video_story_world",
  "video_course_anchor",
  "video_beat",
]);

type IndependentFilmCheckKey = typeof INDEPENDENT_FILM_CHECK_KEYS[number];
export type VideoCourseAnchorHardGateId = typeof videoCourseAnchorHardGateIds[number];
type VideoCourseAnchorHardGateStatus = "passed" | "failed" | "inconclusive";

export type VideoCourseAnchorCandidate = {
  verdict: string;
  independentFilmChecks: Partial<Record<IndependentFilmCheckKey, {
    passed: boolean;
    evidence?: string;
  }>>;
  storyWorld: {
    premise?: string;
    requiredCharacters?: string[];
    requiredSettings?: string[];
  };
  courseAnchor: {
    anchorTrigger?: string;
    handoffMoment?: string;
    classroomReturnQuestion?: string;
    doNotExplain?: string[];
    anchorCount?: number;
  };
  nextToolIntents: string[];
  [key: string]: unknown;
};

export type VideoCourseAnchorGateResult = VideoCourseAnchorCandidate & {
  candidateAccepted: boolean;
  eligibleForDownstreamGuard: false;
  verdict: "pass" | "rework_required";
  reasonCodes: string[];
};

export type VideoCourseAnchorCriticCandidate = {
  recommendation: string;
  summary: string;
  findings: CriticFinding[];
  targetLocators: TargetLocator[];
  responsibleStage: string;
  minimalFix: string;
  inconclusiveReasons: string[];
  hardGateResults: Array<{
    gateId: string;
    status: VideoCourseAnchorHardGateStatus | string;
    evidenceRefs: string[];
    rationale: string;
    findingIds: string[];
  }>;
  [key: string]: unknown;
};

export type VideoCourseAnchorCriticGateResult = VideoCourseAnchorCriticCandidate & {
  recommendation: "pass" | "rework_required" | "blocked" | "inconclusive";
  reportStructurallyValid: boolean;
  reviewPassed: boolean;
  eligibleForDownstreamGuard: boolean;
  reasonCodes: string[];
  forbiddenNextToolIntents: string[];
};

export function enforceVideoCourseAnchorGate(candidate: VideoCourseAnchorCandidate): VideoCourseAnchorGateResult {
  const blockingReasons = independentFilmFailureReasons(candidate);

  if (!hasMinimalCourseHandoff(candidate.courseAnchor)) {
    blockingReasons.push("course_anchor_handoff_incomplete");
  }

  if (isStoryWorldOverconstrained(candidate.storyWorld)) {
    blockingReasons.push("course_anchor_story_world_overconstrained");
  }

  if (candidate.verdict !== "pass") {
    blockingReasons.push("upstream_verdict_not_passed");
  }

  const candidateAccepted = blockingReasons.length === 0;
  const reasonCodes = [...new Set([
    ...blockingReasons,
    ...(candidateAccepted ? ["independent_critic_required"] : []),
  ])].sort();

  return {
    ...candidate,
    candidateAccepted,
    eligibleForDownstreamGuard: false,
    verdict: candidateAccepted ? "pass" : "rework_required",
    reasonCodes,
    nextToolIntents: [...new Set(candidate.nextToolIntents.filter((intent) => preCriticAllowedNextToolIntentSet.has(intent)))],
  };
}

export function enforceVideoCourseAnchorCriticGate(
  candidate: VideoCourseAnchorCriticCandidate,
): VideoCourseAnchorCriticGateResult {
  const reasonCodes: string[] = [];
  const expectedIds = new Set<string>(videoCourseAnchorHardGateIds);
  const counts = new Map<string, number>();
  const findingIds = new Set((candidate.findings ?? []).map((finding) => finding.findingId));
  reasonCodes.push(...courseAnchorRepairContractReasons(candidate));

  for (const gate of candidate.hardGateResults ?? []) {
    counts.set(gate.gateId, (counts.get(gate.gateId) ?? 0) + 1);
    if (!expectedIds.has(gate.gateId)) reasonCodes.push(`hard_gate_unexpected:${gate.gateId}`);
    if (!isHardGateStatus(gate.status)) reasonCodes.push(`hard_gate_status_invalid:${gate.gateId}`);
    if (!gate.evidenceRefs?.some((ref) => ref.trim())) reasonCodes.push(`hard_gate_evidence_missing:${gate.gateId}`);
    if (!gate.rationale?.trim()) reasonCodes.push(`hard_gate_rationale_missing:${gate.gateId}`);
    if (gate.status === "failed" && !gate.findingIds?.length) {
      reasonCodes.push(`hard_gate_finding_missing:${gate.gateId}`);
    }
    for (const findingId of gate.findingIds ?? []) {
      if (!findingIds.has(findingId)) reasonCodes.push(`hard_gate_finding_unknown:${gate.gateId}:${findingId}`);
    }
  }

  for (const gateId of videoCourseAnchorHardGateIds) {
    const count = counts.get(gateId) ?? 0;
    if (count === 0) reasonCodes.push(`hard_gate_missing:${gateId}`);
    if (count > 1) reasonCodes.push(`hard_gate_duplicate:${gateId}`);
  }

  const rawHasInconclusiveGate = (candidate.hardGateResults ?? []).some((gate) => gate.status === "inconclusive");
  if ((rawHasInconclusiveGate || candidate.recommendation === "inconclusive") &&
      !candidate.inconclusiveReasons?.some((reason) => reason.trim())) {
    reasonCodes.push("inconclusive_reason_missing");
  }

  const gateReportValid = reasonCodes.every((reason) => !isGateReportStructuralReason(reason));
  const failedGateIds = gateReportValid
    ? candidate.hardGateResults.filter((gate) => gate.status === "failed").map((gate) => gate.gateId)
    : [];
  const inconclusiveGateIds = gateReportValid
    ? candidate.hardGateResults.filter((gate) => gate.status === "inconclusive").map((gate) => gate.gateId)
    : [];
  const blockingFindingPresent = (candidate.findings ?? []).some((finding) =>
    finding.severity === "blocker" || finding.invalidatesDownstream,
  );

  reasonCodes.push(...failedGateIds.map((gateId) => `hard_gate_failed:${gateId}`));
  reasonCodes.push(...inconclusiveGateIds.map((gateId) => `hard_gate_inconclusive:${gateId}`));

  let recommendation = normalizeCriticRecommendation(candidate.recommendation);
  if (!gateReportValid) {
    recommendation = "inconclusive";
  } else if (failedGateIds.length > 0) {
    if (candidate.recommendation === "pass") {
      reasonCodes.push("recommendation_conflict:pass_with_failed_gate");
    }
    recommendation = candidate.recommendation === "blocked" ? "blocked" : "rework_required";
  } else if (inconclusiveGateIds.length > 0) {
    if (candidate.recommendation === "pass") {
      reasonCodes.push("recommendation_conflict:pass_with_inconclusive_gate");
    }
    recommendation = "inconclusive";
  } else if (blockingFindingPresent) {
    reasonCodes.push("blocking_finding_present");
    if (candidate.recommendation === "pass") {
      reasonCodes.push("recommendation_conflict:pass_with_blocking_finding");
    }
    recommendation = candidate.recommendation === "blocked" ? "blocked" : "rework_required";
  } else if (recommendation !== "pass") {
    reasonCodes.push(`recommendation_not_pass:${recommendation}`);
  }

  const normalizedReasonCodes = [...new Set(reasonCodes)].sort();
  const reviewPassed = gateReportValid &&
    failedGateIds.length === 0 &&
    inconclusiveGateIds.length === 0 &&
    !blockingFindingPresent &&
    recommendation === "pass";

  return {
    ...candidate,
    recommendation,
    reportStructurallyValid: gateReportValid,
    reviewPassed,
    eligibleForDownstreamGuard: reviewPassed,
    reasonCodes: normalizedReasonCodes,
    forbiddenNextToolIntents: reviewPassed ? [] : [...videoCourseAnchorForbiddenNextToolIntents],
  };
}

function independentFilmFailureReasons(candidate: VideoCourseAnchorCandidate): string[] {
  return INDEPENDENT_FILM_CHECK_KEYS.flatMap((key) =>
    candidate.independentFilmChecks?.[key]?.passed === true
      ? []
      : [`independent_film_check_failed:${key}`],
  );
}

function hasMinimalCourseHandoff(courseAnchor: VideoCourseAnchorCandidate["courseAnchor"]): boolean {
  return Boolean(
    courseAnchor?.anchorTrigger?.trim() &&
    courseAnchor.handoffMoment?.trim() &&
    courseAnchor.classroomReturnQuestion?.trim() &&
    courseAnchor.anchorCount === 1 &&
    courseAnchor.doNotExplain?.some((item) => item.trim()),
  );
}

function isStoryWorldOverconstrained(storyWorld: VideoCourseAnchorCandidate["storyWorld"]): boolean {
  const premise = affirmedStoryWorldText(storyWorld?.premise?.trim() ?? "");
  const characters = normalizeParts(storyWorld?.requiredCharacters).map(affirmedStoryWorldText).filter(Boolean);
  const settings = normalizeParts(storyWorld?.requiredSettings).map(affirmedStoryWorldText).filter(Boolean);
  const combined = [premise, ...characters, ...settings].join(" ");

  return hasAudienceForcedStoryWorld(combined) ||
    hasRequiredClassroomWorld(combined, characters, settings) ||
    isTextbookRetelling(combined) ||
    isPptRetelling(combined);
}

function hasAudienceForcedStoryWorld(value: string): boolean {
  const audience = "(?:小学生|儿童|低龄学生|目标年龄|观众年龄|受众年龄)";
  const forcedWorld = "(?:小学生|儿童|学生|主角|教师|教室|课堂|黑板)";
  return new RegExp(`(?:因为|由于).{0,40}${audience}.{0,40}(?:所以|因此|必须|只能).{0,40}${forcedWorld}`).test(value) ||
    new RegExp(`${audience}.{0,30}(?:意味着|要求|决定).{0,20}(?:必须|只能).{0,30}${forcedWorld}`).test(value);
}

function hasRequiredClassroomWorld(value: string, characters: string[], settings: string[]): boolean {
  if (/全程.{0,12}(?:教室|课堂)|(?:必须|只能|依赖).{0,12}课堂活动|课堂活动.{0,12}(?:必须|只能|依赖)/.test(value)) {
    return true;
  }

  const settingText = settings.join(" ");
  const classroomMarkers = ["教室", "黑板", "课堂", "课件", "教材"]
    .filter((marker) => settingText.includes(marker));
  const classroomRolesRequired = characters.some((item) => /教师|老师/.test(item)) &&
    characters.some((item) => /学生|小学生/.test(item));
  return classroomRolesRequired && classroomMarkers.length >= 2;
}

function isTextbookRetelling(value: string): boolean {
  return /教材/.test(value) && /复刻|复述|动画|逐页|原样|照搬|情境/.test(value);
}

function isPptRetelling(value: string): boolean {
  return /PPT|ppt|课件/.test(value) && /动态|动画|逐页|复述|复刻|翻页/.test(value);
}

function normalizeParts(value: string[] | undefined): string[] {
  return (value ?? []).map((item) => item.trim()).filter(Boolean);
}

function affirmedStoryWorldText(value: string): string {
  const negatedClaim = /不是|并非|不属于|避免|不要|不应|不得|不可|不把|无需|无须|不再|拒绝|禁止/;
  return value
    .split(/[，。；;！？!?]/u)
    .map((clause) => {
      const contrastIndex = clause.lastIndexOf("而是");
      const assertedClause = contrastIndex >= 0 ? clause.slice(contrastIndex + 2) : clause;
      return negatedClaim.test(assertedClause) ? "" : assertedClause.trim();
    })
    .filter(Boolean)
    .join(" ");
}

function courseAnchorRepairContractReasons(candidate: VideoCourseAnchorCriticCandidate): string[] {
  const reasons: string[] = [];
  const responsibleStage = candidate.responsibleStage?.trim() ?? "";
  if (!courseAnchorRepairStageSet.has(responsibleStage)) {
    reasons.push(`repair_stage_invalid:${responsibleStage || "missing"}`);
  }
  if (!candidate.minimalFix?.trim()) reasons.push("repair_minimal_fix_missing");

  for (const finding of candidate.findings ?? []) {
    const findingStage = finding.responsibleStage?.trim() ?? "";
    if (!courseAnchorRepairStageSet.has(findingStage)) {
      reasons.push(`finding_repair_stage_invalid:${finding.findingId}:${findingStage || "missing"}`);
    }
  }

  if (candidate.recommendation === "rework_required" || candidate.recommendation === "blocked") {
    if (!(candidate.findings ?? []).length) reasons.push("repair_finding_missing");
    if (candidate.recommendation === "blocked" &&
        !(candidate.findings ?? []).some((finding) => finding.severity === "blocker" || finding.invalidatesDownstream)) {
      reasons.push("blocked_finding_missing");
    }
  }
  return reasons;
}

function isHardGateStatus(value: string): value is VideoCourseAnchorHardGateStatus {
  return value === "passed" || value === "failed" || value === "inconclusive";
}

function normalizeCriticRecommendation(
  value: string,
): "pass" | "rework_required" | "blocked" | "inconclusive" {
  if (value === "pass" || value === "rework_required" || value === "blocked" || value === "inconclusive") {
    return value;
  }
  return "inconclusive";
}

function isGateReportStructuralReason(reason: string): boolean {
  return reason.startsWith("hard_gate_missing:") ||
    reason.startsWith("hard_gate_duplicate:") ||
    reason.startsWith("hard_gate_unexpected:") ||
    reason.startsWith("hard_gate_status_invalid:") ||
    reason.startsWith("hard_gate_evidence_missing:") ||
    reason.startsWith("hard_gate_rationale_missing:") ||
    reason.startsWith("hard_gate_finding_missing:") ||
    reason.startsWith("hard_gate_finding_unknown:") ||
    reason.startsWith("repair_stage_invalid:") ||
    reason.startsWith("finding_repair_stage_invalid:") ||
    reason === "repair_minimal_fix_missing" ||
    reason === "repair_finding_missing" ||
    reason === "blocked_finding_missing" ||
    reason === "inconclusive_reason_missing";
}
