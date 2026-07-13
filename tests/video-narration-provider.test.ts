import { describe, expect, it, vi } from "vitest";
import { generateMiniMaxVideoNarration } from "@/server/video-generation/video-narration-provider";
import { createVideoNarrationScript } from "@/server/video-quality/video-narration-contract";

function script() {
  return createVideoNarrationScript({ schemaVersion: "video-narration-script.v1", language: "zh-CN", voiceId: "Chinese (Mandarin)_Gentleman", text: "装置为什么会连续发生三次变化？先别急着下结论，带着这个问题回到课堂。", courseAnchor: "带着问题回到课堂", answerDisclosureBoundary: "不解释课程答案" });
}

describe("V1-9C MiniMax controlled narration provider", () => {
  it("returns same-run audio and subtitle timing evidence", async () => {
    const audio = Buffer.alloc(2048, 9);
    const fetchImpl = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      if (String(url).includes("/v1/t2a_v2")) return new Response(JSON.stringify({ data: { audio: audio.toString("hex"), subtitle_file: "https://files.example/subtitles.json" }, extra_info: { audio_length: 6500 }, base_resp: { status_code: 0 } }), { status: 200 });
      return new Response(JSON.stringify([{ text: "装置为什么会连续发生三次变化？", time_begin: 0, time_end: 3000 }, { text: "带着这个问题回到课堂。", time_begin: 3200, time_end: 6200 }]), { status: 200 });
    });
    const result = await generateMiniMaxVideoNarration({ script: script(), env: { NODE_ENV: "test", MINIMAX_TTS_API_KEY: "test-only", MINIMAX_TTS_BASE_URL: "https://api.example" }, fetchImpl: fetchImpl as typeof fetch });
    expect(result.audioBuffer).toEqual(audio);
    expect(result.transcriptBuffer.toString("utf8")).toContain("00:00:03,200 --> 00:00:06,200");
    expect(result).toMatchObject({ cues: [{ startMs: 0, endMs: 3000 }, { startMs: 3200, endMs: 6200 }], providerEvidence: { model: "speech-2.8-hd", reportedDurationMs: 6500 } });
    const request = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(request).toMatchObject({ subtitle_enable: true, language_boost: "Chinese", output_format: "hex", audio_setting: { sample_rate: 48000, channel: 2 } });
  });

  it("rejects missing config, missing subtitles, and invalid timing", async () => {
    await expect(generateMiniMaxVideoNarration({ script: script(), env: { NODE_ENV: "test" }, fetchImpl: vi.fn() as typeof fetch })).rejects.toThrow("provider_env_missing");
    const noSubtitle = vi.fn(async () => new Response(JSON.stringify({ data: { audio: Buffer.alloc(1024).toString("hex") }, base_resp: { status_code: 0 } }), { status: 200 }));
    await expect(generateMiniMaxVideoNarration({ script: script(), env: { NODE_ENV: "test", MINIMAX_API_KEY: "test-only" }, fetchImpl: noSubtitle as typeof fetch })).rejects.toThrow("subtitle_url_invalid");
    const badTiming = vi.fn(async (url: string | URL | Request) => String(url).includes("t2a_v2")
      ? new Response(JSON.stringify({ data: { audio: Buffer.alloc(1024).toString("hex"), subtitle_file: "https://files.example/subtitles.json" }, base_resp: { status_code: 0 } }), { status: 200 })
      : new Response(JSON.stringify([{ text: "第二句", time_begin: 2000, time_end: 3000 }, { text: "倒序", time_begin: 1000, time_end: 1500 }]), { status: 200 }));
    await expect(generateMiniMaxVideoNarration({ script: script(), env: { NODE_ENV: "test", MINIMAX_API_KEY: "test-only" }, fetchImpl: badTiming as typeof fetch })).rejects.toThrow("subtitles_invalid");
  });
});
