import { hashRunInput } from "@/server/execution/run-input-snapshot";

export type VideoProductionPath = "video_short_preview" | "video_full_intro";

export type VideoIntent = {
  schemaVersion: "video-intent.v1";
  productionPath: VideoProductionPath;
  videoMode: "short_preview" | "full_intro";
  targetDurationRange: { minSeconds: number; maxSeconds: number };
  courseAnchor: string;
  classroomReturnQuestion: string;
  answerDisclosureBoundary: string;
};

export type ShotSpec = {
  shotId: string;
  ordinal: number;
  durationTargetRange: { minSeconds: number; maxSeconds: number };
  sceneFunction: string;
  mainSubject: string;
  subjectAction: string;
  cameraMotion: string;
  continuityKeys: string[];
  startFrameIntent: string;
  endFrameIntent: string;
  referencePolicy: "required" | "recommended" | "none";
  referenceAssetIds: string[];
  textPolicy: "no_generated_text" | "post_production_only";
  modelPrompt: string;
  negativePrompt: string;
  retakeVariables: string[];
};

export type ReferenceAsset = {
  assetId: string;
  assetDomain: "video";
  sha256?: string;
  applicableShotIds: string[];
  purpose: string;
};

export type StoryboardManifest = {
  schemaVersion: "video-storyboard.v1";
  intent: VideoIntent;
  shots: ShotSpec[];
  references: ReferenceAsset[];
  manifestDigest: string;
};

export type VideoContractIssue = { code: string; locator?: string };

export function createStoryboardManifest(input: Omit<StoryboardManifest, "manifestDigest">): StoryboardManifest {
  const manifest = { ...input, manifestDigest: hashRunInput(input) };
  const validation = validateStoryboardManifest(manifest);
  if (!validation.valid) throw new Error(`video_storyboard_invalid:${validation.issues.map((issue) => issue.code).join(",")}`);
  return manifest;
}

export function validateStoryboardManifest(value: StoryboardManifest): { valid: boolean; issues: VideoContractIssue[] } {
  const issues: VideoContractIssue[] = [];
  if (value.schemaVersion !== "video-storyboard.v1") issues.push({ code: "schema_version_invalid" });
  if (value.intent.productionPath === "video_full_intro" && value.intent.videoMode !== "full_intro") issues.push({ code: "full_intro_mode_required" });
  const targetDuration = value.intent.targetDurationRange;
  if (!targetDuration || !validDurationRange(targetDuration)) {
    issues.push({ code: "target_duration_invalid" });
  } else if (value.intent.productionPath === "video_full_intro" && (targetDuration.minSeconds < 30 || targetDuration.maxSeconds > 90)) {
    issues.push({ code: "full_intro_target_duration_out_of_range" });
  }
  if (!value.intent.courseAnchor || !value.intent.classroomReturnQuestion || !value.intent.answerDisclosureBoundary) issues.push({ code: "course_anchor_incomplete" });
  const ids = new Set<string>();
  let previousOrdinal = 0;
  for (const shot of value.shots) {
    if (!/^shot_[a-z0-9_-]+$/i.test(shot.shotId) || ids.has(shot.shotId)) issues.push({ code: "shot_id_invalid_or_duplicate", locator: shot.shotId });
    ids.add(shot.shotId);
    if (shot.ordinal !== previousOrdinal + 1) issues.push({ code: "shot_ordinal_not_continuous", locator: shot.shotId });
    previousOrdinal = shot.ordinal;
    if (!validDurationRange(shot.durationTargetRange) || shot.durationTargetRange.minSeconds < 6 || shot.durationTargetRange.maxSeconds > 30) issues.push({ code: "shot_duration_invalid", locator: shot.shotId });
    if (![shot.sceneFunction, shot.mainSubject, shot.subjectAction, shot.cameraMotion, shot.startFrameIntent, shot.endFrameIntent, shot.modelPrompt, shot.negativePrompt].every(Boolean)) issues.push({ code: "shot_directing_fields_incomplete", locator: shot.shotId });
    if (shot.referencePolicy === "required" && shot.referenceAssetIds.length === 0) issues.push({ code: "required_reference_missing", locator: shot.shotId });
    if (shot.textPolicy !== "no_generated_text" && shot.textPolicy !== "post_production_only") issues.push({ code: "text_policy_invalid", locator: shot.shotId });
  }
  if (value.intent.productionPath === "video_full_intro" && value.shots.length < 3) issues.push({ code: "full_intro_minimum_three_shots" });
  if (value.intent.productionPath === "video_full_intro" && targetDuration && validDurationRange(targetDuration)) {
    const shotMinimum = value.shots.reduce((sum, shot) => sum + shot.durationTargetRange.minSeconds, 0);
    const shotMaximum = value.shots.reduce((sum, shot) => sum + shot.durationTargetRange.maxSeconds, 0);
    if (shotMinimum > targetDuration.maxSeconds || shotMaximum < targetDuration.minSeconds) issues.push({ code: "full_intro_shot_duration_coverage_invalid" });
  }
  for (const asset of value.references) {
    if (!asset.assetId || !asset.purpose || asset.assetDomain !== "video" || (asset.sha256 !== undefined && !/^[a-f0-9]{64}$/i.test(asset.sha256))) issues.push({ code: "reference_asset_invalid", locator: asset.assetId });
    if (!asset.applicableShotIds.length || asset.applicableShotIds.some((shotId) => !ids.has(shotId))) issues.push({ code: "reference_asset_shot_binding_invalid", locator: asset.assetId });
  }
  const referencesById = new Map(value.references.map((asset) => [asset.assetId, asset]));
  for (const shot of value.shots) {
    for (const assetId of shot.referenceAssetIds) {
      const asset = referencesById.get(assetId);
      if (!asset || !asset.applicableShotIds.includes(shot.shotId)) issues.push({ code: "shot_reference_asset_unresolved", locator: shot.shotId });
    }
  }
  const { manifestDigest, ...semantic } = value;
  if (hashRunInput(semantic) !== manifestDigest) issues.push({ code: "manifest_digest_invalid" });
  return { valid: issues.length === 0, issues };
}

export function resolveStoryboardShotDurations(manifest: StoryboardManifest): Map<string, number> {
  const validation = validateStoryboardManifest(manifest);
  if (!validation.valid) throw new Error(`video_storyboard_invalid:${validation.issues.map((issue) => issue.code).join(",")}`);
  const durations = new Map(manifest.shots.map((shot) => [shot.shotId, shot.durationTargetRange.minSeconds]));
  let remaining = Math.max(0, manifest.intent.targetDurationRange.minSeconds - [...durations.values()].reduce((sum, value) => sum + value, 0));
  for (const shot of manifest.shots) {
    if (remaining === 0) break;
    const current = durations.get(shot.shotId)!;
    const addition = Math.min(remaining, shot.durationTargetRange.maxSeconds - current);
    durations.set(shot.shotId, current + addition);
    remaining -= addition;
  }
  if (remaining !== 0) throw new Error("video_storyboard_duration_allocation_failed");
  return durations;
}

function validDurationRange(value: { minSeconds: number; maxSeconds: number }): boolean {
  return Number.isInteger(value.minSeconds) && Number.isInteger(value.maxSeconds) && value.minSeconds > 0 && value.maxSeconds >= value.minSeconds;
}
