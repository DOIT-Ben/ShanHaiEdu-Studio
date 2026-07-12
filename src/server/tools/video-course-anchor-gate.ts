const INDEPENDENT_FILM_CHECK_KEYS = [
  "understandableWithoutLesson",
  "worthwhileWithoutClassroomReturn",
  "notTextbookOrPptRetelling",
] as const;

const REAL_MEDIA_TOOL_INTENTS = new Set([
  "asset_image_generate",
  "generate_video_segment",
  "video_segment_generate",
  "concat_only_assemble",
  "generate_video_assets",
  "generate_video_shot",
  "assemble_video",
]);

type IndependentFilmCheckKey = typeof INDEPENDENT_FILM_CHECK_KEYS[number];

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
    handoffMoment?: string;
    classroomReturnQuestion?: string;
  };
  nextToolIntents: string[];
  [key: string]: unknown;
};

export type VideoCourseAnchorGateResult = VideoCourseAnchorCandidate & {
  allowed: boolean;
  verdict: "pass" | "rework_required";
  reasonCodes: string[];
};

export function enforceVideoCourseAnchorGate(candidate: VideoCourseAnchorCandidate): VideoCourseAnchorGateResult {
  const reasonCodes = independentFilmFailureReasons(candidate);

  if (!hasMinimalCourseHandoff(candidate.courseAnchor)) {
    reasonCodes.push("course_anchor_handoff_incomplete");
  }

  if (isStoryWorldOverconstrained(candidate.storyWorld)) {
    reasonCodes.push("course_anchor_story_world_overconstrained");
  }

  if (candidate.verdict !== "pass") {
    reasonCodes.push("upstream_verdict_not_passed");
  }

  const normalizedReasons = [...new Set(reasonCodes)].sort();
  const allowed = normalizedReasons.length === 0;

  return {
    ...candidate,
    allowed,
    verdict: allowed ? "pass" : "rework_required",
    reasonCodes: normalizedReasons,
    nextToolIntents: allowed
      ? [...candidate.nextToolIntents]
      : candidate.nextToolIntents.filter((intent) => !REAL_MEDIA_TOOL_INTENTS.has(intent)),
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
  return Boolean(courseAnchor?.handoffMoment?.trim() && courseAnchor?.classroomReturnQuestion?.trim());
}

function isStoryWorldOverconstrained(storyWorld: VideoCourseAnchorCandidate["storyWorld"]): boolean {
  const characters = normalizeParts(storyWorld?.requiredCharacters);
  const settings = normalizeParts(storyWorld?.requiredSettings);
  const combined = [...characters, ...settings].join(" ");

  return hasAudienceForcedStoryWorld(combined) ||
    hasRequiredClassroomWorld(characters, settings) ||
    isTextbookRetelling(combined) ||
    isPptRetelling(combined);
}

function hasAudienceForcedStoryWorld(value: string): boolean {
  const audience = "(?:小学生|儿童|低龄学生|目标年龄|观众年龄|受众年龄)";
  const forcedWorld = "(?:小学生|儿童|学生|主角|教师|教室|课堂|黑板)";
  return new RegExp(`(?:因为|由于).{0,40}${audience}.{0,40}(?:所以|因此|必须|只能).{0,40}${forcedWorld}`).test(value) ||
    new RegExp(`${audience}.{0,30}(?:意味着|要求|决定).{0,20}(?:必须|只能).{0,30}${forcedWorld}`).test(value);
}

function hasRequiredClassroomWorld(characters: string[], settings: string[]): boolean {
  const settingText = settings.join(" ");
  if (/全程.{0,8}(?:教室|课堂)|课堂活动/.test(settingText)) return true;

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
