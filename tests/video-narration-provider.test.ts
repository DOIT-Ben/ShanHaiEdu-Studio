import { describe, expect, it, vi } from "vitest";
import { generateMiniMaxVideoNarration, VideoNarrationProviderError } from "@/server/video-generation/video-narration-provider";
import { createVideoNarrationScript } from "@/server/video-quality/video-narration-contract";

function script() {
  return createVideoNarrationScript({ schemaVersion: "video-narration-script.v1", language: "zh-CN", voiceId: "zh-CN-warm-neutral", text: "装置为什么会连续发生三次变化？先别急着下结论，带着这个问题回到课堂。", courseAnchor: "带着问题回到课堂", answerDisclosureBoundary: "不解释课程答案" });
}

function providerEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    MODEL_GATEWAY_BASE_URL: "https://gateway.example/v1",
    MODEL_GATEWAY_API_KEY: "test-only",
    MODEL_GATEWAY_TTS_MODEL: "speech-2.8-hd",
    MODEL_GATEWAY_TTS_VOICE_ID: "male-qn-qingse",
  };
}

function mp3Frames(count = 12) {
  const frames: Buffer[] = [];
  for (let index = 0; index < count; index += 1) {
    const frame = Buffer.alloc(417);
    frame.writeUInt32BE(0xfffb9000, 0);
    frames.push(frame);
  }
  return Buffer.concat(frames);
}

describe("unified gateway narration provider", () => {
  it("accepts an MP3 response and derives deterministic subtitle timing", async () => {
    const audio = mp3Frames();
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(audio, { status: 200, headers: { "Content-Type": "audio/mpeg", "x-request-id": "request-fixture" } }));
    const result = await generateMiniMaxVideoNarration({ script: script(), env: providerEnv(), fetchImpl });
    expect(result.audioBuffer).toEqual(audio);
    expect(result.transcriptBuffer.toString("utf8")).toContain("-->");
    expect(result.providerEvidence).toMatchObject({ model: "speech-2.8-hd", voiceId: "male-qn-qingse", voiceBindingSource: "model_gateway" });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://gateway.example/v1/audio/speech");
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toMatchObject({ model: "speech-2.8-hd", input: script().text, voice: "male-qn-qingse", response_format: "mp3" });
  });

  it("fails closed when gateway configuration is absent", async () => {
    await expect(generateMiniMaxVideoNarration({ script: script(), env: { NODE_ENV: "test" }, fetchImpl: vi.fn() as typeof fetch })).rejects.toThrow("provider_config_invalid");
  });

  it("preserves provider rejection phase and submission truth", async () => {
    const rejected = vi.fn<typeof fetch>(async () => new Response("unavailable", { status: 503 }));
    const error = await generateMiniMaxVideoNarration({ script: script(), env: providerEnv(), fetchImpl: rejected }).catch((caught) => caught);
    expect(error).toBeInstanceOf(VideoNarrationProviderError);
    expect(error).toMatchObject({ code: "video_narration_submit_unavailable", phase: "provider_submit", providerSubmitted: true, retryable: true });
  });
});
