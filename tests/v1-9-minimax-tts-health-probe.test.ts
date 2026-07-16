import { describe, expect, it } from "vitest";

import { runMinimaxTtsHealthProbe } from "@/../scripts/v1-9-minimax-tts-health-probe";

describe("V1-9 MiniMax TTS health probe", () => {
  it("records one provider request, zero retries, and validated binding evidence", async () => {
    let written = "";
    const result = await runMinimaxTtsHealthProbe({
      now: new Date("2026-07-15T03:00:00.000Z"),
      runNarration: async ({ script }) => ({
        audioBuffer: Buffer.concat([Buffer.from("ID3"), Buffer.alloc(1024)]),
        transcriptBuffer: Buffer.from("1\n00:00:00,000 --> 00:00:01,000\n灯塔亮起", "utf8"),
        cues: [{ text: "灯塔亮起", startMs: 0, endMs: 1000 }],
        providerEvidence: {
          model: "speech-test",
          voiceId: "ledger-voice",
          requestedVoiceId: script.voiceId,
          voiceBindingSource: "provider_ledger",
          scriptDigest: script.scriptDigest,
          reportedDurationMs: 1000,
        },
      }),
      writeEvidence: async (_path, content) => { written = content; },
    });

    expect(result.evidence).toMatchObject({
      status: "passed",
      requestCount: 1,
      retryCount: 0,
      downloadRequestCount: 1,
      result: { requestedVoiceId: "zh-CN-warm-neutral", voiceId: "ledger-voice", voiceBindingSource: "provider_ledger" },
    });
    expect(written).not.toMatch(/api[_-]?key|bearer|secret/i);
  });
});
