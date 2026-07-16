import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createVideoNarrationScript } from "@/server/video-quality/video-narration-contract";
import { executeProviderTool } from "@/server/tools/provider-tool-adapter";
import { getToolDefinition } from "@/server/tools/tool-registry";
import type { ArtifactRecord } from "@/server/workbench/types";
import { VideoNarrationProviderError } from "@/server/video-generation/video-narration-provider";

const roots: string[] = [];

afterEach(() => {
  delete process.env.ARTIFACT_STORAGE_ROOT;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("video narration Provider Tool boundary", () => {
  it("persists real audio and transcript evidence through an explicit Provider Tool", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "shanhai-narration-tool-"));
    roots.push(root);
    process.env.ARTIFACT_STORAGE_ROOT = root;
    const script = createVideoNarrationScript({
      schemaVersion: "video-narration-script.v1",
      language: "zh-CN",
      voiceId: "voice-a",
      text: "机械装置发生变化，带着问题回到课堂。",
      courseAnchor: "带着问题回到课堂",
      answerDisclosureBoundary: "不解释答案",
    });
    const source: ArtifactRecord = {
      id: "script-a", projectId: "project-a", nodeKey: "video_script_generate", kind: "video_script_generate",
      title: "脚本", status: "needs_review", summary: "脚本", markdownContent: "# 脚本", version: 1, isApproved: false,
      structuredContent: { videoNarrationScript: script, artifactQualityState: { validationStatus: "passed", reviewStatus: "passed", downstreamEligibility: "eligible" } },
      createdAt: "2026-07-15T00:00:00.000Z", updatedAt: "2026-07-15T00:00:00.000Z",
    };
    const audioBuffer = Buffer.alloc(1024, 7);
    const transcriptBuffer = Buffer.from("1\n00:00:00,000 --> 00:00:01,000\n机械装置发生变化", "utf8");

    const result = await executeProviderTool({
      tool: getToolDefinition("generate_video_narration"),
      projectId: "project-a",
      artifactRefs: [{ kind: source.kind, artifactId: source.id }],
      resolvedArtifacts: [source],
      runVideoNarration: async () => ({
        audioBuffer,
        transcriptBuffer,
        cues: [{ text: "机械装置发生变化", startMs: 0, endMs: 1000 }],
        providerEvidence: { model: "speech-test", voiceId: "ledger-voice", requestedVoiceId: script.voiceId, voiceBindingSource: "provider_ledger", scriptDigest: script.scriptDigest, reportedDurationMs: 1000 },
      }),
    });

    expect(result).toMatchObject({
      status: "succeeded",
      toolId: "generate_video_narration",
      capabilityId: "video_narration_generate",
      provider: "tts_minimax",
      artifactDraft: {
        kind: "video_narration_generate",
        structuredContent: {
          storage: {
            audioTrack: { sha256: createHash("sha256").update(audioBuffer).digest("hex") },
            transcript: { sha256: createHash("sha256").update(transcriptBuffer).digest("hex") },
          },
        },
      },
    });
  });

  it("returns a repairable typed Observation after a submitted TTS contract rejection", async () => {
    const script = createVideoNarrationScript({
      schemaVersion: "video-narration-script.v1",
      language: "zh-CN",
      voiceId: "zh-CN-warm-neutral",
      text: "机械装置发生变化，带着问题回到课堂。",
      courseAnchor: "带着问题回到课堂",
      answerDisclosureBoundary: "不解释答案",
    });
    const source: ArtifactRecord = {
      id: "script-rejected", projectId: "project-a", nodeKey: "video_script_generate", kind: "video_script_generate",
      title: "脚本", status: "needs_review", summary: "脚本", markdownContent: "# 脚本", version: 1, isApproved: false,
      structuredContent: { videoNarrationScript: script, artifactQualityState: { validationStatus: "passed", reviewStatus: "passed", downstreamEligibility: "eligible" } },
      createdAt: "2026-07-15T00:00:00.000Z", updatedAt: "2026-07-15T00:00:00.000Z",
    };

    const result = await executeProviderTool({
      tool: getToolDefinition("generate_video_narration"),
      projectId: "project-a",
      artifactRefs: [{ kind: source.kind, artifactId: source.id }],
      resolvedArtifacts: [source],
      runVideoNarration: async () => {
        throw new VideoNarrationProviderError({
          code: "video_narration_provider_rejected",
          phase: "provider_response",
          providerSubmitted: true,
          retryable: false,
        });
      },
    });

    expect(result).toMatchObject({
      status: "failed",
      errorCategory: "provider_contract_rejected",
      observation: {
        kind: "quality_gate_failed",
        reasonCode: "video_narration_provider_rejected",
        retryPolicy: { retryable: false, nextAction: "fix_inputs" },
      },
      budgetEvent: {
        status: "failed",
        kind: "quality_gate_failed",
        providerSubmitted: true,
      },
    });
  });
});
