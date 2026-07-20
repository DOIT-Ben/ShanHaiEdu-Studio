import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolveLocalArtifactOutput } from "@/server/artifact-storage/local-artifact-storage";
import { buildStoredVideoDownload } from "@/server/video-generation/artifact-video";
import type { VideoNarrationProviderResult } from "@/server/video-generation/video-narration-provider";
import { validateVideoNarrationScript, type VideoNarrationScript } from "@/server/video-quality/video-narration-contract";
import { validateStoryboardManifest, type StoryboardManifest } from "@/server/video-quality/video-production-contract";
import { assembleVideoTimeline } from "@/server/video-quality/video-timeline-assembler";
import type { ArtifactRecord } from "@/server/workbench/types";

import {
  buildArtifactTruth,
  buildBudgetEvent,
  findResolvedArtifacts,
  isRecord,
  requireArtifact,
  type PackageToolAdapterInput,
} from "./package-tool-adapter-shared";
import type { ToolExecutionResult, ToolQualityGateResult } from "./tool-types";

export async function executeConcatOnlyAssemble(input: PackageToolAdapterInput): Promise<ToolExecutionResult> {
  const segments = findResolvedArtifacts(input, "video_segment_generate");
  if (segments.length === 0) throw new Error("missing_video_segments");

  const storyboardArtifact = requireArtifact(input, "storyboard_generate");
  const storyboardManifest = storyboardArtifact.structuredContent.videoStoryboardManifest as StoryboardManifest | undefined;
  if (!storyboardManifest || !validateStoryboardManifest(storyboardManifest).valid || storyboardManifest.intent.productionPath !== "video_full_intro") {
    throw new Error("video_storyboard_final_assembly_invalid");
  }
  const clipInputs = resolveStoryboardClipInputs(segments, storyboardManifest);
  const scriptArtifact = requireArtifact(input, "video_script_generate");
  const narrationScript = scriptArtifact.structuredContent.videoNarrationScript as VideoNarrationScript | undefined;
  if (!narrationScript || !validateVideoNarrationScript(narrationScript).valid) throw new Error("video_narration_script_missing");
  const narrationArtifact = requireArtifact(input, "video_narration_generate");
  const narration = readStoredVideoNarration(narrationArtifact, narrationScript);
  const assembly = assembleVideoTimeline({ projectId: input.projectId, clips: clipInputs, narration });
  if (!assembly.transcript || !assembly.audioTrack) throw new Error("video_final_review_tracks_missing");
  assertFullIntroDuration(assembly.finalVideo.durationMs, storyboardManifest);
  const sourceArtifactIds = [...assembly.timeline.entries.map((entry) => entry.sourceArtifactId), storyboardArtifact.id, scriptArtifact.id, narrationArtifact.id];
  const artifactTruth = buildArtifactTruth(input.tool, "concat_only_assemble");
  const qualityGate = { passed: true, gates: ["storyboard_shot_coverage_verified", "full_intro_duration_verified", "ffprobe_shots_verified", "clips_normalized", "ffmpeg_timeline_assembled", "provider_audio_replaced", "controlled_audio_verified", "subtitle_timing_verified", "final_video_fully_decoded", "timeline_order_preserved", "sampled_frames_created", "awaiting_video_final_review"] } satisfies ToolQualityGateResult;

  return {
    status: "succeeded",
    toolId: input.tool.id,
    capabilityId: input.tool.capabilityId ?? "concat_only_assemble",
    artifactDraft: {
      nodeKey: "concat_only_assemble",
      kind: "concat_only_assemble",
      title: "真实导入视频成片",
      summary: "已按分镜顺序完成 FFmpeg 归一化组装、受控音轨替换和字幕校验，等待成片审查。",
      markdownContent: "# 真实导入视频成片\n\n已按镜头身份和顺序完成真实媒体组装、受控音轨替换、字幕时序校验、完整解码与采样帧校验，等待成片 Critic 独立审查。",
      structuredContent: {
        文件状态: "真实导入视频已完成技术组装",
        文件大小: `${assembly.finalVideo.bytes} bytes`,
        文件类型: "video/mp4",
        storage: {
          videoAsset: {
            fileName: `concat-${safeFileSegment(input.projectId)}.mp4`,
            localOutput: assembly.finalVideo.storageRef,
            bytes: assembly.finalVideo.bytes,
            sha256: assembly.finalVideo.sha256,
            mime: "video/mp4",
            generationMode: "ffmpeg_timeline_assembled",
            sourceArtifactIds,
          },
        },
        videoFinalReviewEvidence: {
          storyboard: {
            artifactId: storyboardArtifact.id,
            artifactVersion: storyboardArtifact.version,
            manifestDigest: storyboardManifest.manifestDigest,
            targetDurationRange: { ...storyboardManifest.intent.targetDurationRange },
            shotIds: storyboardManifest.shots.map((shot) => shot.shotId),
          },
          finalVideo: assembly.finalVideo,
          timeline: assembly.timeline,
          sampledFrames: assembly.sampledFrames,
          transcript: assembly.transcript,
          audioTrack: assembly.audioTrack,
        },
        shotProbeEvidence: assembly.shotProbes,
        normalizedClipManifest: assembly.normalizedClips,
        artifactTruth,
        qualityGate,
      },
    },
    artifactTruth,
    qualityGate,
    assistantSummary: "真实导入视频已覆盖全部分镜，并完成目标时长、受控音轨、字幕和 FFmpeg 时间线校验，等待成片独立审查。",
    budgetEvent: buildBudgetEvent(input.tool, "succeeded", "tool_succeeded"),
  };
}

function readStoredVideoNarration(artifact: ArtifactRecord, script: VideoNarrationScript): VideoNarrationProviderResult {
  const storage = isRecord(artifact.structuredContent.storage) ? artifact.structuredContent.storage : null;
  const audio = storage && isRecord(storage.audioTrack) ? storage.audioTrack : null;
  const transcript = storage && isRecord(storage.transcript) ? storage.transcript : null;
  const providerEvidence = isRecord(artifact.structuredContent.narrationProviderEvidence) ? artifact.structuredContent.narrationProviderEvidence : null;
  const cues = artifact.structuredContent.cues;
  if (!audio || !transcript || !providerEvidence || !Array.isArray(cues) || providerEvidence.scriptDigest !== script.scriptDigest || providerEvidence.requestedVoiceId !== script.voiceId || providerEvidence.voiceBindingSource !== "provider_ledger") {
    throw new Error("video_narration_artifact_invalid");
  }
  const audioBuffer = readStoredBuffer(audio, "video_narration_audio_invalid");
  const transcriptBuffer = readStoredBuffer(transcript, "video_narration_transcript_invalid");
  const parsedCues = cues.map((cue) => {
    if (!isRecord(cue) || typeof cue.text !== "string" || typeof cue.startMs !== "number" || typeof cue.endMs !== "number" || cue.endMs <= cue.startMs) throw new Error("video_narration_cues_invalid");
    return { text: cue.text, startMs: cue.startMs, endMs: cue.endMs };
  });
  if (parsedCues.length === 0) throw new Error("video_narration_cues_invalid");
  return {
    audioBuffer,
    transcriptBuffer,
    cues: parsedCues,
    providerEvidence: {
      model: typeof providerEvidence.model === "string" ? providerEvidence.model : "",
      voiceId: typeof providerEvidence.voiceId === "string" ? providerEvidence.voiceId : "",
      requestedVoiceId: script.voiceId,
      voiceBindingSource: "provider_ledger",
      scriptDigest: script.scriptDigest,
      reportedDurationMs: typeof providerEvidence.reportedDurationMs === "number" ? providerEvidence.reportedDurationMs : null,
    },
  };
}

function readStoredBuffer(asset: Record<string, unknown>, errorCode: string): Buffer {
  const localOutput = typeof asset.localOutput === "string" ? asset.localOutput : "";
  const expectedDigest = typeof asset.sha256 === "string" ? asset.sha256.toLowerCase() : "";
  const absolutePath = resolveLocalArtifactOutput(localOutput);
  if (!absolutePath || !/^[a-f0-9]{64}$/.test(expectedDigest)) throw new Error(errorCode);
  const buffer = readFileSync(absolutePath);
  if (createHash("sha256").update(buffer).digest("hex") !== expectedDigest) throw new Error(errorCode);
  return buffer;
}

function resolveStoryboardClipInputs(segments: ArtifactRecord[], manifest: StoryboardManifest) {
  const byShotId = new Map<string, ArtifactRecord>();
  for (const artifact of segments) {
    const shotId = readSegmentShotId(artifact);
    if (byShotId.has(shotId)) throw new Error(`video_segment_shot_duplicate:${shotId}`);
    byShotId.set(shotId, artifact);
  }
  const expectedShotIds = new Set(manifest.shots.map((shot) => shot.shotId));
  if (segments.length !== manifest.shots.length || [...byShotId.keys()].some((shotId) => !expectedShotIds.has(shotId))) throw new Error("video_storyboard_shot_coverage_mismatch");
  return manifest.shots.map((shot) => {
    const artifact = byShotId.get(shot.shotId);
    if (!artifact) throw new Error(`video_storyboard_shot_missing:${shot.shotId}`);
    return buildTimelineClipInput(artifact, shot.ordinal);
  });
}

function readSegmentShotId(artifact: ArtifactRecord): string {
  const storage = isRecord(artifact.structuredContent.storage) ? artifact.structuredContent.storage : null;
  const videoAsset = storage && isRecord(storage.videoAsset) ? storage.videoAsset : null;
  const requestEvidence = videoAsset && isRecord(videoAsset.requestEvidence) ? videoAsset.requestEvidence : null;
  const shotId = requestEvidence?.shotId;
  if (typeof shotId !== "string" || !/^shot_[a-z0-9_-]+$/i.test(shotId)) throw new Error("video_segment_shot_binding_missing");
  return shotId;
}

function buildTimelineClipInput(artifact: ArtifactRecord, ordinal: number) {
  const storage = isRecord(artifact.structuredContent.storage) ? artifact.structuredContent.storage : null;
  const videoAsset = storage && isRecord(storage.videoAsset) ? storage.videoAsset : null;
  const shotId = readSegmentShotId(artifact);
  const localOutput = typeof videoAsset?.localOutput === "string" ? videoAsset.localOutput : "";
  const sourcePath = resolveLocalArtifactOutput(localOutput);
  if (!sourcePath) throw new Error("video_segment_storage_invalid");
  const buffer = buildStoredVideoDownload(artifact).buffer;
  const storedDigest = typeof videoAsset?.sha256 === "string" ? videoAsset.sha256.toLowerCase() : "";
  const actualDigest = createHash("sha256").update(buffer).digest("hex");
  if (storedDigest && storedDigest !== actualDigest) throw new Error("video_segment_digest_mismatch");
  return { shotId, ordinal, sourceArtifactId: artifact.id, sourcePath, sourceSha256: actualDigest };
}

function assertFullIntroDuration(durationMs: number, manifest: StoryboardManifest): void {
  const target = manifest.intent.targetDurationRange;
  const toleranceMs = Math.max(1000, manifest.shots.length * 250);
  if (durationMs < target.minSeconds * 1000 - toleranceMs || durationMs > target.maxSeconds * 1000 + toleranceMs) throw new Error("video_final_duration_out_of_target");
}

function safeFileSegment(value: string) {
  return value.trim().toLowerCase().replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-").replace(/[^a-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "project";
}
