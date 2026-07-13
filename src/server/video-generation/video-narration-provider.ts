import type { VideoNarrationScript } from "@/server/video-quality/video-narration-contract";
import { validateVideoNarrationScript } from "@/server/video-quality/video-narration-contract";

export type NarrationSubtitleCue = { text: string; startMs: number; endMs: number };

export type VideoNarrationProviderResult = {
  audioBuffer: Buffer;
  transcriptBuffer: Buffer;
  cues: NarrationSubtitleCue[];
  providerEvidence: {
    model: string;
    voiceId: string;
    scriptDigest: string;
    reportedDurationMs: number | null;
  };
};

export async function generateMiniMaxVideoNarration(input: {
  script: VideoNarrationScript;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<VideoNarrationProviderResult> {
  const validation = validateVideoNarrationScript(input.script);
  if (!validation.valid) throw new Error(`video_narration_script_invalid:${validation.issues.join(",")}`);
  const env = input.env ?? process.env;
  const apiKey = env.MINIMAX_TTS_API_KEY?.trim() || env.MINIMAX_API_KEY?.trim();
  if (!apiKey) throw new Error("video_narration_provider_env_missing");
  const baseUrl = (env.MINIMAX_TTS_BASE_URL?.trim() || env.MINIMAX_BASE_URL?.trim() || "https://api.minimaxi.com").replace(/\/+$/, "");
  const model = env.MINIMAX_TTS_MODEL?.trim() || "speech-2.8-hd";
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(`${baseUrl}/v1/t2a_v2`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      text: input.script.text,
      voice_setting: { voice_id: input.script.voiceId, speed: 1, vol: 1, pitch: 0 },
      audio_setting: { format: "mp3", sample_rate: 48000, bitrate: 128000, channel: 2 },
      language_boost: "Chinese",
      output_format: "hex",
      stream: false,
      subtitle_enable: true,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error(`video_narration_submit_failed:${response.status}`);
  const payload = await response.json() as unknown;
  const parsed = parseNarrationResponse(payload);
  const subtitleResponse = await fetchImpl(parsed.subtitleUrl, { signal: AbortSignal.timeout(30_000) });
  if (!subtitleResponse.ok) throw new Error(`video_narration_subtitle_download_failed:${subtitleResponse.status}`);
  const cues = parseSubtitleCues(await subtitleResponse.json());
  return {
    audioBuffer: parsed.audioBuffer,
    transcriptBuffer: Buffer.from(toSrt(cues), "utf8"),
    cues,
    providerEvidence: { model, voiceId: input.script.voiceId, scriptDigest: input.script.scriptDigest, reportedDurationMs: parsed.reportedDurationMs },
  };
}

function parseNarrationResponse(value: unknown) {
  const root = isRecord(value) ? value : {};
  const baseResponse = isRecord(root.base_resp) ? root.base_resp : {};
  if (typeof baseResponse.status_code === "number" && baseResponse.status_code !== 0) throw new Error("video_narration_provider_rejected");
  const data = isRecord(root.data) ? root.data : {};
  const audioHex = typeof data.audio === "string" ? data.audio.trim() : "";
  if (!audioHex || audioHex.length % 2 !== 0 || !/^[a-f0-9]+$/i.test(audioHex)) throw new Error("video_narration_audio_invalid");
  const audioBuffer = Buffer.from(audioHex, "hex");
  if (audioBuffer.length < 512) throw new Error("video_narration_audio_invalid");
  const subtitleUrl = typeof data.subtitle_file === "string" ? data.subtitle_file.trim() : "";
  if (!/^https:\/\//i.test(subtitleUrl)) throw new Error("video_narration_subtitle_url_invalid");
  const extra = isRecord(root.extra_info) ? root.extra_info : {};
  const reportedDuration = Number(extra.audio_length);
  return { audioBuffer, subtitleUrl, reportedDurationMs: Number.isFinite(reportedDuration) && reportedDuration > 0 ? Math.round(reportedDuration) : null };
}

function parseSubtitleCues(value: unknown): NarrationSubtitleCue[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("video_narration_subtitles_invalid");
  let previousEnd = 0;
  return value.map((item) => {
    if (!isRecord(item)) throw new Error("video_narration_subtitles_invalid");
    const text = typeof item.text === "string" ? item.text.trim() : "";
    const startMs = Number(item.time_begin);
    const endMs = Number(item.time_end);
    if (!text || !Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < previousEnd || endMs <= startMs) throw new Error("video_narration_subtitles_invalid");
    previousEnd = endMs;
    return { text, startMs: Math.round(startMs), endMs: Math.round(endMs) };
  });
}

function toSrt(cues: NarrationSubtitleCue[]) {
  return cues.map((cue, index) => `${index + 1}\n${formatSrtTime(cue.startMs)} --> ${formatSrtTime(cue.endMs)}\n${cue.text}`).join("\n\n");
}

function formatSrtTime(ms: number) {
  const hours = String(Math.floor(ms / 3_600_000)).padStart(2, "0");
  const minutes = String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, "0");
  const seconds = String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0");
  const millis = String(ms % 1000).padStart(3, "0");
  return `${hours}:${minutes}:${seconds},${millis}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
