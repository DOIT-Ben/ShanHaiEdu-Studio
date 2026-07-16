import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  generateMiniMaxVideoNarration,
  VideoNarrationProviderError,
  type VideoNarrationProviderResult,
} from "@/server/video-generation/video-narration-provider";
import { resolveProviderLedgerValueBag } from "@/server/provider-ledger/provider-ledger-adapter";
import { createVideoNarrationScript } from "@/server/video-quality/video-narration-contract";

type ProbeEvidence = {
  schemaVersion: "provider-adapter-evidence.v1";
  evidenceId: string;
  providerId: "tts_minimax";
  capability: "tts_minimax";
  purpose: "video_narration";
  model: string;
  endpointCategory: "minimax_native_t2a_v2";
  status: "passed" | "failed";
  testedAt: string;
  errorCategory: string;
  requestCount: 0 | 1;
  retryCount: 0;
  downloadRequestCount: 0 | 1;
  result: Record<string, unknown>;
};

export async function runMinimaxTtsHealthProbe(input: {
  now?: Date;
  runNarration?: typeof generateMiniMaxVideoNarration;
  writeEvidence?: (path: string, content: string) => Promise<void>;
} = {}): Promise<{ evidence: ProbeEvidence; evidencePath: string }> {
  const testedAt = input.now ?? new Date();
  const stamp = testedAt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const evidenceId = `minimax-tts-health-${stamp}`;
  const values = resolveProviderLedgerValueBag({ capability: "tts_minimax" });
  const model = values.get("MINIMAX_TTS_MODEL") || "speech-2.8-hd";
  const script = createVideoNarrationScript({
    schemaVersion: "video-narration-script.v1",
    language: "zh-CN",
    voiceId: "zh-CN-warm-neutral",
    text: "暴雨退到海面尽头，灯塔重新亮起。带着这个问题，回到课堂继续寻找答案。",
    courseAnchor: "回到课堂继续寻找答案",
    answerDisclosureBoundary: "不解释课程答案",
  });

  let evidence: ProbeEvidence;
  try {
    const result = await (input.runNarration ?? generateMiniMaxVideoNarration)({ script });
    assertProbeResult(result);
    evidence = {
      ...baseEvidence(evidenceId, model, testedAt),
      status: "passed",
      errorCategory: "none",
      requestCount: 1,
      downloadRequestCount: 1,
      result: {
        audioBytes: result.audioBuffer.length,
        audioSha256: sha256(result.audioBuffer),
        mp3HeaderValid: true,
        subtitleCueCount: result.cues.length,
        transcriptBytes: result.transcriptBuffer.length,
        transcriptSha256: sha256(result.transcriptBuffer),
        reportedDurationMs: result.providerEvidence.reportedDurationMs,
        requestedVoiceId: result.providerEvidence.requestedVoiceId,
        voiceId: result.providerEvidence.voiceId,
        voiceBindingSource: result.providerEvidence.voiceBindingSource,
        scriptDigest: result.providerEvidence.scriptDigest,
      },
    };
  } catch (error) {
    const typed = error instanceof VideoNarrationProviderError ? error : null;
    evidence = {
      ...baseEvidence(evidenceId, model, testedAt),
      status: "failed",
      errorCategory: typed?.code ?? "probe_validation_failed",
      requestCount: typed && !typed.providerSubmitted ? 0 : 1,
      downloadRequestCount: typed && (typed.phase === "subtitle_download" || typed.phase === "subtitle_validation") ? 1 : 0,
      result: typed ? { phase: typed.phase, providerSubmitted: typed.providerSubmitted, retryable: typed.retryable } : {},
    };
  }

  const evidencePath = path.resolve("API台账系统", "evidence", "provider-adapter-tests", `${evidenceId}.json`);
  const content = `${JSON.stringify(evidence, null, 2)}\n`;
  if (input.writeEvidence) await input.writeEvidence(evidencePath, content);
  else await writeFile(evidencePath, content, { encoding: "utf8", flag: "wx" });
  return { evidence, evidencePath };
}

function baseEvidence(evidenceId: string, model: string, testedAt: Date) {
  return {
    schemaVersion: "provider-adapter-evidence.v1" as const,
    evidenceId,
    providerId: "tts_minimax" as const,
    capability: "tts_minimax" as const,
    purpose: "video_narration" as const,
    model,
    endpointCategory: "minimax_native_t2a_v2" as const,
    testedAt: testedAt.toISOString(),
    retryCount: 0 as const,
  };
}

function assertProbeResult(result: VideoNarrationProviderResult): void {
  const header = result.audioBuffer.subarray(0, 3).toString("hex");
  const mp3HeaderValid = header === "494433" || (result.audioBuffer[0] === 0xff && (result.audioBuffer[1] & 0xe0) === 0xe0);
  if (!mp3HeaderValid || result.cues.length === 0 || result.transcriptBuffer.length === 0) {
    throw new Error("probe_output_invalid");
  }
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function main() {
  const result = await runMinimaxTtsHealthProbe();
  console.log(JSON.stringify({ evidencePath: result.evidencePath, ...result.evidence }));
  if (result.evidence.status !== "passed") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.includes("--self-check")) {
    console.log(JSON.stringify({ status: "ready", providerRequestCount: 0 }));
  } else {
    void main().catch((error) => {
      console.error(error instanceof Error ? error.message : "minimax_tts_probe_failed");
      process.exitCode = 1;
    });
  }
}
