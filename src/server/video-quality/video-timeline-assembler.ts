import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { writeLocalArtifact } from "@/server/artifact-storage/local-artifact-storage";

export type VideoTimelineClipInput = {
  shotId: string;
  ordinal: number;
  sourceArtifactId: string;
  sourcePath: string;
  sourceSha256: string;
};

type VideoStreamEvidence = {
  codec: string;
  width: number;
  height: number;
  fps: number;
};

type AudioStreamEvidence = {
  codec: string;
  channels: number;
  sampleRate: number;
};

export type MediaProbeEvidence = {
  durationMs: number;
  video: VideoStreamEvidence;
  audio: AudioStreamEvidence | null;
};

export type VideoTimelineAssembly = {
  finalVideo: {
    storageRef: string;
    sha256: string;
    bytes: number;
    durationMs: number;
    video: VideoStreamEvidence;
    audio: AudioStreamEvidence;
    fullyDecoded: true;
  };
  shotProbes: Array<MediaProbeEvidence & { shotId: string; sourceArtifactId: string; sourceSha256: string }>;
  normalizedClips: {
    profile: { codec: "h264"; pixelFormat: "yuv420p"; width: number; height: number; fps: 24; audioCodec: "aac"; sampleRate: 48000; channels: 2 };
    orderedClips: Array<{ shotId: string; ordinal: number; sourceSha256: string; normalizedSha256: string; storageRef: string; durationMs: number }>;
  };
  timeline: {
    timelineId: string;
    shotIds: string[];
    durationMs: number;
    entries: Array<{ shotId: string; ordinal: number; startMs: number; endMs: number; sourceArtifactId: string; normalizedClipSha256: string }>;
  };
  sampledFrames: Array<{ shotId: string; atMs: number; storageRef: string; sha256: string }>;
  transcript?: { trackId: "caption-main"; storageRef: string; sha256: string; cueCount: number; format: "srt"; source: { model: string; voiceId: string; scriptDigest: string } };
  audioTrack?: { trackId: "audio-main"; storageRef: string; sha256: string; codec: string; sampleRate: number; channels: number };
};

export function assembleVideoTimeline(input: {
  projectId: string;
  clips: VideoTimelineClipInput[];
  narration?: {
    audioBuffer: Buffer;
    transcriptBuffer: Buffer;
    cues: Array<{ text: string; startMs: number; endMs: number }>;
    providerEvidence: { model: string; voiceId: string; scriptDigest: string; reportedDurationMs: number | null };
  };
  env?: NodeJS.ProcessEnv;
}): VideoTimelineAssembly {
  const clips = validateAndSortClips(input.clips);
  const ffmpeg = resolveMediaBinary("ffmpeg", input.env ?? process.env);
  const ffprobe = resolveMediaBinary("ffprobe", input.env ?? process.env);
  const workDir = mkdtempSync(path.join(tmpdir(), "shanhai-video-timeline-"));
  try {
    const probes = clips.map((clip) => ({
      ...probeMedia(ffprobe, clip.sourcePath),
      shotId: clip.shotId,
      sourceArtifactId: clip.sourceArtifactId,
      sourceSha256: clip.sourceSha256,
    }));
    const target = evenDimensions(probes[0].video.width, probes[0].video.height);
    const normalized = clips.map((clip, index) => {
      const outputPath = path.join(workDir, `clip-${String(index + 1).padStart(2, "0")}.mp4`);
      normalizeClip({ ffmpeg, clip, probe: probes[index], outputPath, width: target.width, height: target.height });
      const evidence = probeMedia(ffprobe, outputPath);
      assertNormalizedProbe(evidence, target.width, target.height);
      const buffer = readFileSync(outputPath);
      const fileName = `${safeSegment(input.projectId)}-${clip.shotId}-normalized-${randomUUID()}.mp4`;
      const stored = writeLocalArtifact({ category: "video-artifacts", fileName, buffer, env: input.env });
      return { clip, outputPath, evidence, buffer, storageRef: stored.localOutput, sha256: sha256(buffer) };
    });

    const concatList = path.join(workDir, "concat.txt");
    writeFileSync(concatList, normalized.map((item) => `file '${escapeConcatPath(item.outputPath)}'`).join("\n"), "utf8");
    const concatPath = path.join(workDir, "concat.mp4");
    run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", concatList, "-c", "copy", "-movflags", "+faststart", "-y", concatPath], "video_timeline_concat_failed");
    const concatProbe = probeMedia(ffprobe, concatPath);
    const controlledTracks = input.narration
      ? applyControlledNarration({ ffmpeg, ffprobe, workDir, concatPath, videoDurationMs: concatProbe.durationMs, narration: input.narration, projectId: input.projectId, env: input.env })
      : null;
    const finalPath = controlledTracks?.finalPath ?? concatPath;
    run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", finalPath, "-f", "null", "-"], "video_timeline_decode_failed");
    const finalProbe = probeMedia(ffprobe, finalPath);
    if (!finalProbe.audio) throw new Error("video_timeline_final_audio_missing");

    let cursorMs = 0;
    const entries = normalized.map((item) => {
      const startMs = cursorMs;
      cursorMs += item.evidence.durationMs;
      return {
        shotId: item.clip.shotId,
        ordinal: item.clip.ordinal,
        startMs,
        endMs: cursorMs,
        sourceArtifactId: item.clip.sourceArtifactId,
        normalizedClipSha256: item.sha256,
      };
    });
    if (Math.abs(finalProbe.durationMs - cursorMs) > Math.max(250, normalized.length * 100)) throw new Error("video_timeline_duration_mismatch");

    const finalBuffer = readFileSync(finalPath);
    const finalName = `concat-${safeSegment(input.projectId)}-${randomUUID()}.mp4`;
    const finalStored = writeLocalArtifact({ category: "video-artifacts", fileName: finalName, buffer: finalBuffer, env: input.env });
    const sampledFrames = entries.map((entry) => {
      const atMs = Math.floor((entry.startMs + entry.endMs) / 2);
      const framePath = path.join(workDir, `${entry.shotId}.png`);
      run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-ss", (atMs / 1000).toFixed(3), "-i", finalPath, "-frames:v", "1", "-y", framePath], "video_timeline_frame_extract_failed");
      const buffer = readFileSync(framePath);
      if (buffer.length < 100 || buffer.subarray(1, 4).toString("ascii") !== "PNG") throw new Error("video_timeline_frame_invalid");
      const stored = writeLocalArtifact({ category: "video-artifacts", fileName: `${safeSegment(input.projectId)}-${entry.shotId}-${randomUUID()}.png`, buffer, env: input.env });
      return { shotId: entry.shotId, atMs, storageRef: stored.localOutput, sha256: sha256(buffer) };
    });
    const timelineSeed = { projectId: input.projectId, entries, finalSha256: sha256(finalBuffer) };

    return {
      finalVideo: { storageRef: finalStored.localOutput, sha256: sha256(finalBuffer), bytes: finalBuffer.length, durationMs: finalProbe.durationMs, video: finalProbe.video, audio: finalProbe.audio, fullyDecoded: true },
      shotProbes: probes,
      normalizedClips: {
        profile: { codec: "h264", pixelFormat: "yuv420p", width: target.width, height: target.height, fps: 24, audioCodec: "aac", sampleRate: 48000, channels: 2 },
        orderedClips: normalized.map((item) => ({ shotId: item.clip.shotId, ordinal: item.clip.ordinal, sourceSha256: item.clip.sourceSha256, normalizedSha256: item.sha256, storageRef: item.storageRef, durationMs: item.evidence.durationMs })),
      },
      timeline: { timelineId: `timeline-${sha256(Buffer.from(JSON.stringify(timelineSeed))).slice(0, 16)}`, shotIds: entries.map((entry) => entry.shotId), durationMs: finalProbe.durationMs, entries },
      sampledFrames,
      ...(controlledTracks ? { transcript: controlledTracks.transcript, audioTrack: controlledTracks.audioTrack } : {}),
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

function applyControlledNarration(input: {
  ffmpeg: string;
  ffprobe: string;
  workDir: string;
  concatPath: string;
  videoDurationMs: number;
  narration: NonNullable<Parameters<typeof assembleVideoTimeline>[0]["narration"]>;
  projectId: string;
  env?: NodeJS.ProcessEnv;
}) {
  if (input.narration.audioBuffer.length < 512 || input.narration.transcriptBuffer.length < 20 || input.narration.cues.length === 0) throw new Error("video_narration_evidence_invalid");
  const transcriptText = input.narration.transcriptBuffer.toString("utf8");
  let previousEnd = 0;
  for (const cue of input.narration.cues) {
    if (!cue.text.trim() || !transcriptText.includes(cue.text.trim()) || cue.startMs < previousEnd || cue.endMs <= cue.startMs || cue.endMs > input.videoDurationMs) throw new Error("video_narration_cue_out_of_range");
    previousEnd = cue.endMs;
  }
  const narrationPath = path.join(input.workDir, "narration.mp3");
  writeFileSync(narrationPath, input.narration.audioBuffer);
  const narrationDurationMs = probeFormatDuration(input.ffprobe, narrationPath);
  if (narrationDurationMs > input.videoDurationMs + 100) throw new Error("video_narration_longer_than_video");
  if (input.narration.providerEvidence.reportedDurationMs && Math.abs(input.narration.providerEvidence.reportedDurationMs - narrationDurationMs) > 500) throw new Error("video_narration_duration_evidence_mismatch");

  const finalPath = path.join(input.workDir, "final-controlled-audio.mp4");
  const durationSeconds = (input.videoDurationMs / 1000).toFixed(3);
  run(input.ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", input.concatPath, "-i", narrationPath, "-filter_complex", "[1:a]apad[narration]", "-map", "0:v:0", "-map", "[narration]", "-c:v", "copy", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-t", durationSeconds, "-movflags", "+faststart", "-y", finalPath], "video_narration_mux_failed");

  const audioPath = path.join(input.workDir, "final-audio.m4a");
  run(input.ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", finalPath, "-vn", "-c:a", "copy", "-y", audioPath], "video_narration_audio_extract_failed");
  const audioBuffer = readFileSync(audioPath);
  const audioStored = writeLocalArtifact({ category: "video-artifacts", fileName: `${safeSegment(input.projectId)}-audio-${randomUUID()}.m4a`, buffer: audioBuffer, env: input.env });
  const transcriptStored = writeLocalArtifact({ category: "video-artifacts", fileName: `${safeSegment(input.projectId)}-captions-${randomUUID()}.srt`, buffer: input.narration.transcriptBuffer, env: input.env });
  const finalProbe = probeMedia(input.ffprobe, finalPath);
  if (!finalProbe.audio || finalProbe.audio.codec !== "aac" || finalProbe.audio.sampleRate !== 48000 || finalProbe.audio.channels !== 2) throw new Error("video_narration_final_audio_invalid");
  return {
    finalPath,
    transcript: { trackId: "caption-main" as const, storageRef: transcriptStored.localOutput, sha256: sha256(input.narration.transcriptBuffer), cueCount: input.narration.cues.length, format: "srt" as const, source: { model: input.narration.providerEvidence.model, voiceId: input.narration.providerEvidence.voiceId, scriptDigest: input.narration.providerEvidence.scriptDigest } },
    audioTrack: { trackId: "audio-main" as const, storageRef: audioStored.localOutput, sha256: sha256(audioBuffer), codec: finalProbe.audio.codec, sampleRate: finalProbe.audio.sampleRate, channels: finalProbe.audio.channels },
  };
}

function probeFormatDuration(ffprobe: string, filePath: string) {
  const result = run(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath], "video_narration_probe_failed");
  const durationMs = Math.round(Number(result.stdout.trim()) * 1000);
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error("video_narration_duration_invalid");
  return durationMs;
}

function validateAndSortClips(clips: VideoTimelineClipInput[]) {
  if (clips.length === 0) throw new Error("video_timeline_clips_missing");
  const sorted = [...clips].sort((left, right) => left.ordinal - right.ordinal);
  const ids = new Set<string>();
  sorted.forEach((clip, index) => {
    if (!/^shot_[a-z0-9_-]+$/i.test(clip.shotId) || ids.has(clip.shotId)) throw new Error("video_timeline_shot_id_invalid");
    if (clip.ordinal !== index + 1) throw new Error("video_timeline_ordinal_invalid");
    if (!clip.sourceArtifactId.trim() || !existsSync(clip.sourcePath) || !/^[a-f0-9]{64}$/i.test(clip.sourceSha256)) throw new Error("video_timeline_source_invalid");
    const actualSha256 = sha256(readFileSync(clip.sourcePath));
    if (actualSha256 !== clip.sourceSha256.toLowerCase()) throw new Error("video_timeline_source_digest_mismatch");
    ids.add(clip.shotId);
  });
  return sorted;
}

function probeMedia(ffprobe: string, filePath: string): MediaProbeEvidence {
  const result = run(ffprobe, ["-v", "error", "-show_entries", "format=duration:stream=codec_name,codec_type,width,height,r_frame_rate,channels,sample_rate", "-of", "json", filePath], "video_timeline_ffprobe_failed");
  let parsed: { format?: { duration?: string }; streams?: Array<Record<string, unknown>> };
  try { parsed = JSON.parse(result.stdout); } catch { throw new Error("video_timeline_ffprobe_invalid_json"); }
  const durationMs = Math.round(Number(parsed.format?.duration) * 1000);
  const video = parsed.streams?.find((stream) => stream.codec_type === "video");
  const audio = parsed.streams?.find((stream) => stream.codec_type === "audio");
  if (!video || !Number.isFinite(durationMs) || durationMs <= 0) throw new Error("video_timeline_probe_invalid");
  const fps = parseRate(video.r_frame_rate);
  const videoEvidence = { codec: String(video.codec_name ?? ""), width: Number(video.width), height: Number(video.height), fps };
  if (!videoEvidence.codec || !Number.isInteger(videoEvidence.width) || !Number.isInteger(videoEvidence.height) || !Number.isFinite(fps)) throw new Error("video_timeline_video_stream_invalid");
  return {
    durationMs,
    video: videoEvidence,
    audio: audio ? { codec: String(audio.codec_name ?? ""), channels: Number(audio.channels), sampleRate: Number(audio.sample_rate) } : null,
  };
}

function normalizeClip(input: { ffmpeg: string; clip: VideoTimelineClipInput; probe: MediaProbeEvidence; outputPath: string; width: number; height: number }) {
  const videoArgs = ["-map", "0:v:0", "-vf", `scale=${input.width}:${input.height}:force_original_aspect_ratio=decrease,pad=${input.width}:${input.height}:(ow-iw)/2:(oh-ih)/2,fps=24,format=yuv420p`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20"];
  const audioArgs = input.probe.audio
    ? ["-map", "0:a:0", "-c:a", "aac", "-ar", "48000", "-ac", "2"]
    : ["-f", "lavfi", "-t", (input.probe.durationMs / 1000).toFixed(3), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000", "-map", "1:a:0", "-c:a", "aac", "-ar", "48000", "-ac", "2"];
  run(input.ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", input.clip.sourcePath, ...audioArgs, ...videoArgs, "-shortest", "-movflags", "+faststart", "-y", input.outputPath], "video_timeline_normalize_failed");
}

function assertNormalizedProbe(probe: MediaProbeEvidence, width: number, height: number) {
  if (probe.video.codec !== "h264" || probe.video.width !== width || probe.video.height !== height || Math.abs(probe.video.fps - 24) > 0.01) throw new Error("video_timeline_normalized_video_invalid");
  if (!probe.audio || probe.audio.codec !== "aac" || probe.audio.channels !== 2 || probe.audio.sampleRate !== 48000) throw new Error("video_timeline_normalized_audio_invalid");
}

function resolveMediaBinary(name: "ffmpeg" | "ffprobe", env: NodeJS.ProcessEnv) {
  const configured = env[name === "ffmpeg" ? "FFMPEG_PATH" : "FFPROBE_PATH"]?.trim();
  const sibling = name === "ffprobe" && env.FFMPEG_PATH?.trim() ? path.join(path.dirname(env.FFMPEG_PATH), "ffprobe.exe") : null;
  for (const candidate of [configured, sibling]) if (candidate && existsSync(candidate)) return candidate;
  const probe = spawnSync(name, ["-version"], { encoding: "utf8", windowsHide: true });
  if (probe.status === 0) return name;
  throw new Error(`video_timeline_${name}_missing`);
}

function run(command: string, args: string[], errorCode: string) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${errorCode}:${String(result.stderr || result.error?.message || "unknown").trim().slice(0, 500)}`);
  return { stdout: String(result.stdout ?? "") };
}

function parseRate(value: unknown) {
  const [left, right = "1"] = String(value ?? "").split("/");
  const result = Number(left) / Number(right);
  return Number.isFinite(result) && result > 0 ? result : Number.NaN;
}

function evenDimensions(width: number, height: number) {
  return { width: Math.max(2, Math.floor(width / 2) * 2), height: Math.max(2, Math.floor(height / 2) * 2) };
}

function escapeConcatPath(value: string) {
  return value.replaceAll("\\", "/").replaceAll("'", "'\\''");
}

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function safeSegment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "video";
}
