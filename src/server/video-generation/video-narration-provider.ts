import type { VideoNarrationScript } from "@/server/video-quality/video-narration-contract";
import { validateVideoNarrationScript } from "@/server/video-quality/video-narration-contract";
import {
  resolveProviderLedgerRuntimeContract,
  resolveProviderLedgerValueBag,
} from "@/server/provider-ledger/provider-ledger-adapter";

export type NarrationSubtitleCue = { text: string; startMs: number; endMs: number };

export type VideoNarrationProviderResult = {
  audioBuffer: Buffer;
  transcriptBuffer: Buffer;
  cues: NarrationSubtitleCue[];
  providerEvidence: {
    model: string;
    voiceId: string;
    requestedVoiceId: string;
    voiceBindingSource: "provider_ledger";
    scriptDigest: string;
    reportedDurationMs: number | null;
  };
};

export type VideoNarrationProviderPhase =
  | "configuration"
  | "provider_submit"
  | "provider_response"
  | "subtitle_download"
  | "subtitle_validation";

export class VideoNarrationProviderError extends Error {
  readonly code: string;
  readonly phase: VideoNarrationProviderPhase;
  readonly providerSubmitted: boolean;
  readonly retryable: boolean;

  constructor(input: {
    code: string;
    phase: VideoNarrationProviderPhase;
    providerSubmitted: boolean;
    retryable: boolean;
  }) {
    super(input.code);
    this.name = "VideoNarrationProviderError";
    this.code = input.code;
    this.phase = input.phase;
    this.providerSubmitted = input.providerSubmitted;
    this.retryable = input.retryable;
  }
}

export async function generateMiniMaxVideoNarration(input: {
  script: VideoNarrationScript;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<VideoNarrationProviderResult> {
  const validation = validateVideoNarrationScript(input.script);
  if (!validation.valid) throw new Error(`video_narration_script_invalid:${validation.issues.join(",")}`);
  const env = input.env ?? process.env;
  let values: ReturnType<typeof resolveProviderLedgerValueBag>;
  let runtimeContract: ReturnType<typeof resolveProviderLedgerRuntimeContract>;
  try {
    values = resolveProviderLedgerValueBag({ capability: "tts_minimax", ambientEnv: env });
    runtimeContract = resolveProviderLedgerRuntimeContract({ capability: "tts_minimax", ambientEnv: env });
  } catch {
    throw narrationError("video_narration_provider_config_invalid", "configuration", false, false);
  }
  if (runtimeContract.kind !== "minimax_tts") {
    throw narrationError("video_narration_provider_config_invalid", "configuration", false, false);
  }
  const selectedMode = env[runtimeContract.selectedModeEnv]?.trim().toLowerCase() ||
    values.get(runtimeContract.selectedModeEnv)?.trim().toLowerCase();
  const apiKey = values.get(runtimeContract.credentialEnv);
  const baseUrl = values.get(runtimeContract.baseUrlEnv)?.replace(/\/+$/, "");
  const model = values.get(runtimeContract.modelEnv);
  const providerVoiceId = values.get("MINIMAX_TTS_VOICE_ID");
  if (selectedMode !== runtimeContract.requiredMode || !apiKey || !baseUrl || !model || !providerVoiceId) {
    throw narrationError("video_narration_provider_env_missing", "configuration", false, false);
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/v1/t2a_v2`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        text: input.script.text,
        voice_setting: { voice_id: providerVoiceId, speed: 1, vol: 1, pitch: 0 },
        audio_setting: { format: "mp3", sample_rate: 32000, bitrate: 128000, channel: 1 },
        language_boost: "Chinese",
        output_format: "hex",
        stream: false,
        subtitle_enable: true,
      }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch {
    throw narrationError("video_narration_submit_transport_failed", "provider_submit", true, true);
  }
  if (!response.ok) throw classifySubmitStatus(response.status);
  let payload: unknown;
  try {
    payload = await response.json() as unknown;
  } catch {
    throw narrationError("video_narration_response_invalid", "provider_response", true, false);
  }
  const parsed = parseNarrationResponse(payload);
  let subtitleResponse: Response;
  try {
    subtitleResponse = await fetchImpl(parsed.subtitleUrl, { signal: AbortSignal.timeout(30_000) });
  } catch {
    throw narrationError("video_narration_subtitle_download_failed", "subtitle_download", true, true);
  }
  if (!subtitleResponse.ok) throw narrationError("video_narration_subtitle_download_failed", "subtitle_download", true, subtitleResponse.status === 429 || subtitleResponse.status >= 500);
  let subtitlePayload: unknown;
  try {
    subtitlePayload = await subtitleResponse.json();
  } catch {
    throw narrationError("video_narration_subtitles_invalid", "subtitle_validation", true, false);
  }
  const cues = parseSubtitleCues(subtitlePayload);
  return {
    audioBuffer: parsed.audioBuffer,
    transcriptBuffer: Buffer.from(toSrt(cues), "utf8"),
    cues,
    providerEvidence: {
      model,
      voiceId: providerVoiceId,
      requestedVoiceId: input.script.voiceId,
      voiceBindingSource: "provider_ledger",
      scriptDigest: input.script.scriptDigest,
      reportedDurationMs: parsed.reportedDurationMs,
    },
  };
}

function parseNarrationResponse(value: unknown) {
  const root = isRecord(value) ? value : {};
  const baseResponse = isRecord(root.base_resp) ? root.base_resp : {};
  if (typeof baseResponse.status_code === "number" && baseResponse.status_code !== 0) {
    throw narrationError("video_narration_provider_rejected", "provider_response", true, false);
  }
  const data = isRecord(root.data) ? root.data : {};
  const audioHex = typeof data.audio === "string" ? data.audio.trim() : "";
  if (!audioHex || audioHex.length % 2 !== 0 || !/^[a-f0-9]+$/i.test(audioHex)) throw narrationError("video_narration_audio_invalid", "provider_response", true, false);
  const audioBuffer = Buffer.from(audioHex, "hex");
  if (audioBuffer.length < 512) throw narrationError("video_narration_audio_invalid", "provider_response", true, false);
  const subtitleUrl = typeof data.subtitle_file === "string" ? data.subtitle_file.trim() : "";
  if (!/^https:\/\//i.test(subtitleUrl)) throw narrationError("video_narration_subtitle_url_invalid", "provider_response", true, false);
  const extra = isRecord(root.extra_info) ? root.extra_info : {};
  const reportedDuration = Number(extra.audio_length);
  return { audioBuffer, subtitleUrl, reportedDurationMs: Number.isFinite(reportedDuration) && reportedDuration > 0 ? Math.round(reportedDuration) : null };
}

function parseSubtitleCues(value: unknown): NarrationSubtitleCue[] {
  if (!Array.isArray(value) || value.length === 0) throw narrationError("video_narration_subtitles_invalid", "subtitle_validation", true, false);
  let previousEnd = 0;
  return value.map((item) => {
    if (!isRecord(item)) throw narrationError("video_narration_subtitles_invalid", "subtitle_validation", true, false);
    const text = typeof item.text === "string" ? item.text.trim() : "";
    const startMs = Number(item.time_begin);
    const endMs = Number(item.time_end);
    if (!text || !Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < previousEnd || endMs <= startMs) throw narrationError("video_narration_subtitles_invalid", "subtitle_validation", true, false);
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

function classifySubmitStatus(status: number): VideoNarrationProviderError {
  if (status === 401 || status === 403) return narrationError("video_narration_authorization_failed", "provider_submit", true, false);
  if (status === 429) return narrationError("video_narration_rate_limited", "provider_submit", true, true);
  if (status >= 500) return narrationError("video_narration_submit_unavailable", "provider_submit", true, true);
  return narrationError("video_narration_submit_rejected", "provider_submit", true, false);
}

function narrationError(
  code: string,
  phase: VideoNarrationProviderPhase,
  providerSubmitted: boolean,
  retryable: boolean,
): VideoNarrationProviderError {
  return new VideoNarrationProviderError({ code, phase, providerSubmitted, retryable });
}
