import { describe, expect, it } from "vitest";
import { createStoryboardManifest, validateStoryboardManifest } from "@/server/video-quality/video-production-contract";
import { buildResolvedShotVideoRequest, buildShotVideoRequestBody } from "@/server/video-generation/video-generation-run";
import { buildVideoShotGenerationJobs } from "@/server/video-quality/video-shot-job-planner";

function validManifest() {
  return createStoryboardManifest({
    schemaVersion: "video-storyboard.v1",
    intent: { schemaVersion: "video-intent.v1", productionPath: "video_full_intro", videoMode: "full_intro", courseAnchor: "百分数与生活情境", classroomReturnQuestion: "这些标记表示什么", answerDisclosureBoundary: "不得提前解释百分数定义" },
    shots: [1, 2, 3].map((ordinal) => ({ shotId: `shot_${ordinal}`, ordinal, durationTargetRange: { minSeconds: 6, maxSeconds: 10 }, sceneFunction: "制造观察", mainSubject: "生活物品", subjectAction: "出现并变化", cameraMotion: "缓慢推进", continuityKeys: ["明亮教室"], startFrameIntent: "观察开始", endFrameIntent: "提出问题", referencePolicy: ordinal === 1 ? "required" as const : "none" as const, referenceAssetIds: ordinal === 1 ? ["asset_character"] : [], textPolicy: "post_production_only" as const, modelPrompt: "无文字画面", negativePrompt: "不要文字答案", retakeVariables: ["cameraMotion"] })),
    references: [{ assetId: "asset_character", assetDomain: "video", sha256: "a".repeat(64), applicableShotIds: ["shot_1"], purpose: "角色连续性" }],
  });
}

describe("V1 Stage 4A video production contract", () => {
  it("accepts a three-shot Full Intro with video-domain reference evidence", () => {
    expect(validateStoryboardManifest(validManifest()).valid).toBe(true);
  });

  it("blocks a Full Intro that lacks required reference or enough shots", () => {
    const value = validManifest();
    value.shots = value.shots.slice(0, 2);
    value.shots[0].referenceAssetIds = [];
    const { manifestDigest: _digest, ...semantic } = value;
    const invalid = { ...semantic, manifestDigest: JSON.parse(JSON.stringify(semantic)) && value.manifestDigest };
    const result = validateStoryboardManifest(invalid);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["full_intro_minimum_three_shots", "required_reference_missing", "manifest_digest_invalid"]));
  });

  it("keeps resolved shot reference URLs in the Evolink provider request", () => {
    const shot = buildResolvedShotVideoRequest({ shotId: "shot_1", prompt: "角色观察生活情境", referenceEvidence: [{
      shotId: "shot_1", assetId: "asset_character", assetDomain: "video", purpose: "角色连续性",
      localSha256: "a".repeat(64), uploadFileId: "file_character", uploadedUrl: "https://trusted.example/character.png",
      downloadUrl: null, expiresAt: null,
    }] });
    const body = buildShotVideoRequestBody({ channel: "evolink", model: "video", size: "1280x720", duration: 6, quality: "480p", mode: "normal", aspectRatio: "16:9" }, shot);
    expect(body).toMatchObject({ prompt: "角色观察生活情境", image_urls: ["https://trusted.example/character.png"] });
    expect(shot.referenceEvidence[0]).toMatchObject({ assetId: "asset_character", localSha256: "a".repeat(64), shotId: "shot_1" });
  });

  it("rejects reference evidence bound to a different shot", () => {
    expect(() => buildResolvedShotVideoRequest({ shotId: "shot_1", prompt: "角色观察生活情境", referenceEvidence: [{
      shotId: "shot_2", assetId: "asset_character", assetDomain: "video", purpose: "角色连续性",
      localSha256: "a".repeat(64), uploadFileId: "file_character", uploadedUrl: "https://trusted.example/character.png",
      downloadUrl: null, expiresAt: null,
    }] })).toThrow("video_reference_evidence_shot_mismatch");
  });

  it("creates isolated idempotent jobs with only each shot's video references", () => {
    const manifest = validManifest();
    const jobs = buildVideoShotGenerationJobs({ sourceArtifactId: "storyboard-artifact", manifest });
    expect(jobs).toHaveLength(3);
    expect(jobs.map((job) => job.unitId)).toEqual(["shot_1", "shot_2", "shot_3"]);
    expect(new Set(jobs.map((job) => job.idempotencyKey)).size).toBe(3);
    expect(jobs[0].inputSnapshot?.references).toHaveLength(1);
    expect(jobs[1].inputSnapshot?.references).toEqual([]);
  });
});
