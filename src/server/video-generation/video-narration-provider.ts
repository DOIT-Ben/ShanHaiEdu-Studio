import type { VideoNarrationScript } from "@/server/video-quality/video-narration-contract";
import { validateVideoNarrationScript } from "@/server/video-quality/video-narration-contract";
import { resolveModelGatewayConfig } from "@/server/model-gateway-config";

export type NarrationSubtitleCue = { text: string; startMs: number; endMs: number };

export type VideoNarrationProviderResult = {
  audioBuffer: Buffer;
  transcriptBuffer: Buffer;
  cues: NarrationSubtitleCue[];
  providerEvidence: {
    model: string;
    voiceId: string;
    requestedVoiceId: string;
    voiceBindingSource: "model_gateway" | "provider_ledger";
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
  let config: ReturnType<typeof resolveModelGatewayConfig>;
  try {
    config = resolveModelGatewayConfig("tts", env);
  } catch {
    throw narrationError("video_narration_provider_config_invalid", "configuration", false, false);
  }
  const apiKey = config.apiKey;
  const baseUrl = config.baseUrl;
  const model = config.model;
  const providerVoiceId = config.voiceId!;
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/audio/speech`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        input: input.script.text,
        voice: providerVoiceId,
        response_format: "mp3",
        speed: 1,
      }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch {
    throw narrationError("video_narration_submit_transport_failed", "provider_submit", true, true);
  }
  if (!response.ok) throw classifySubmitStatus(response.status);
  let audioBuffer: Buffer;
  try {
    audioBuffer = Buffer.from(await response.arrayBuffer());
  } catch {
    throw narrationError("video_narration_response_invalid", "provider_response", true, false);
  }
  const reportedDurationMs = mp3DurationMs(audioBuffer);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== "audio/mpeg" || audioBuffer.length < 512 || reportedDurationMs === null) {
    throw narrationError("video_narration_audio_invalid", "provider_response", true, false);
  }
  const cues = deriveCues(input.script.text, reportedDurationMs);
  return {
    audioBuffer,
    transcriptBuffer: Buffer.from(toSrt(cues), "utf8"),
    cues,
    providerEvidence: {
      model,
      voiceId: providerVoiceId,
      requestedVoiceId: input.script.voiceId,
      voiceBindingSource: "model_gateway",
      scriptDigest: input.script.scriptDigest,
      reportedDurationMs,
    },
  };
}

function deriveCues(text: string, durationMs: number): NarrationSubtitleCue[] {
  const segments = text.split(/(?<=[。！？!?；;])/u).map((item) => item.trim()).filter(Boolean);
  const values = segments.length ? segments : [text];
  const total = values.reduce((sum, item) => sum + [...item].length, 0);
  let cursor = 0;
  return values.map((item, index) => {
    const endMs = index === values.length - 1
      ? durationMs
      : Math.max(cursor + 1, Math.round(cursor + durationMs * [...item].length / total));
    const cue = { text: item, startMs: cursor, endMs };
    cursor = endMs;
    return cue;
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

function mp3DurationMs(bytes: Buffer): number | null {
  let offset = bytes.subarray(0, 3).toString("ascii") === "ID3" ? 10 : 0;
  let durationMs = 0;
  let frames = 0;
  const bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  while (offset + 4 <= bytes.length) {
    const header = bytes.readUInt32BE(offset);
    if ((header & 0xffe00000) >>> 0 !== 0xffe00000) { offset += 1; continue; }
    const version = (header >>> 19) & 3;
    const layer = (header >>> 17) & 3;
    const bitrateIndex = (header >>> 12) & 15;
    const sampleRateIndex = (header >>> 10) & 3;
    if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) { offset += 1; continue; }
    const mpeg1 = version === 3;
    const bitrate = bitrates[bitrateIndex];
    const sampleRate = [44_100, 48_000, 32_000][sampleRateIndex] / (mpeg1 ? 1 : version === 2 ? 2 : 4);
    if (!bitrate || !sampleRate) { offset += 1; continue; }
    const frameLength = Math.floor(((mpeg1 ? 144 : 72) * bitrate * 1000) / sampleRate) + ((header >>> 9) & 1);
    if (frameLength < 4 || offset + frameLength > bytes.length) break;
    durationMs += ((mpeg1 ? 1152 : 576) * 1000) / sampleRate;
    frames += 1;
    offset += frameLength;
  }
  return frames > 0 ? Math.max(1, Math.round(durationMs)) : null;
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
