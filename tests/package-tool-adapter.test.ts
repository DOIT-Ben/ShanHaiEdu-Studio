import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import JSZip from "jszip";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { resolveLocalArtifactOutput, writeLocalArtifact } from "@/server/artifact-storage/local-artifact-storage";
import { executePackageTool } from "@/server/tools/package-tool-adapter";
import { getToolDefinition } from "@/server/tools/tool-registry";
import type { ArtifactRecord } from "@/server/workbench/types";
import { buildPptKeySampleCandidate } from "@/server/ppt-quality/ppt-key-sample-candidate";
import { validPptSampleFixtures } from "./support/ppt-sample-fixture";
import { createPptAssetManifestDigest } from "@/server/ppt-quality/ppt-asset-validator";
import { buildPptFullDeckCandidate, sealPptFullDeckCandidate } from "@/server/ppt-quality/ppt-full-deck-candidate";
import { validPptFullProductionFixtures } from "./support/ppt-full-production-fixture";
import { createVideoNarrationScript } from "@/server/video-quality/video-narration-contract";
import { createStoryboardManifest } from "@/server/video-quality/video-production-contract";

function artifact(kind: ArtifactRecord["kind"], id: string, overrides: Partial<ArtifactRecord> = {}): ArtifactRecord {
  return {
    id,
    projectId: "project-a",
    nodeKey: kind,
    kind,
    title: `${kind} artifact`,
    status: "approved",
    summary: `${kind} summary`,
    markdownContent: `# ${kind}`,
    structuredContent: {},
    version: 1,
    isApproved: true,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
    ...overrides,
  };
}

function mp4Buffer(label: string) {
  return Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from("ftypisom"),
    Buffer.alloc(256, 0),
    Buffer.from("moov"),
    Buffer.alloc(900, label.charCodeAt(0)),
  ]);
}

function realMp4Buffer(color: string, withAudio: boolean, durationSeconds = 0.6) {
  const root = mkdtempSync(path.join(os.tmpdir(), "shanhai-real-mp4-"));
  const output = path.join(root, "fixture.mp4");
  const ffmpeg = process.env.FFMPEG_PATH || "D:\\Soft\\ffmpeg-7.1.1-essentials_build\\bin\\ffmpeg.exe";
  const args = ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=${color}:s=320x180:r=24:d=${durationSeconds}`];
  if (withAudio) args.push("-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${durationSeconds}`, "-map", "0:v:0", "-map", "1:a:0", "-c:a", "aac");
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-shortest", "-y", output);
  const result = spawnSync(ffmpeg, args, { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(`test_ffmpeg_fixture_failed:${result.stderr}`);
  try { return readFileSync(output); } finally { rmSync(root, { recursive: true, force: true }); }
}

function fullIntroStoryboardArtifact() {
  const manifest = createStoryboardManifest({
    schemaVersion: "video-storyboard.v1",
    intent: {
      schemaVersion: "video-intent.v1",
      productionPath: "video_full_intro",
      videoMode: "full_intro",
      targetDurationRange: { minSeconds: 30, maxSeconds: 60 },
      courseAnchor: "带着问题回到课堂",
      classroomReturnQuestion: "装置为什么连续发生变化？",
      answerDisclosureBoundary: "不解释答案",
    },
    shots: [1, 2, 3].map((ordinal) => ({
      shotId: `shot_0${ordinal}`,
      ordinal,
      durationTargetRange: { minSeconds: 10, maxSeconds: 20 },
      sceneFunction: ["建立钩子", "升级阻碍", "形成悬念"][ordinal - 1],
      mainSubject: "机械装置",
      subjectAction: "发生可见状态变化",
      cameraMotion: "缓慢推进",
      continuityKeys: ["同一装置"],
      startFrameIntent: "承接上一状态",
      endFrameIntent: "留下下一变化",
      referencePolicy: "none" as const,
      referenceAssetIds: [],
      textPolicy: "post_production_only" as const,
      modelPrompt: `机械装置镜头 ${ordinal}`,
      negativePrompt: "不要课堂讲解和答案",
      retakeVariables: ["subjectAction"],
    })),
    references: [],
  });
  return artifact("storyboard_generate", "storyboard-1", { structuredContent: { videoStoryboardManifest: manifest } });
}

function realMp3Buffer(durationSeconds = 0.8) {
  const root = mkdtempSync(path.join(os.tmpdir(), "shanhai-real-mp3-"));
  const output = path.join(root, "narration.mp3");
  const ffmpeg = process.env.FFMPEG_PATH || "D:\\Soft\\ffmpeg-7.1.1-essentials_build\\bin\\ffmpeg.exe";
  const result = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `sine=frequency=660:sample_rate=48000:duration=${durationSeconds}`, "-ac", "2", "-b:a", "128k", "-y", output], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(`test_ffmpeg_audio_fixture_failed:${result.stderr}`);
  try { return readFileSync(output); } finally { rmSync(root, { recursive: true, force: true }); }
}

function pngBuffer() {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0, 0, 0, 13]),
    Buffer.from("IHDR"),
    Buffer.from([0, 0, 0, 1, 0, 0, 0, 1]),
    Buffer.alloc(64),
  ]);
}

async function pptxBuffer() {
  const zip = new JSZip();
  zip.file("ppt/presentation.xml", "<presentation />");
  zip.file("[Content_Types].xml", "<Types />");
  const output = await zip.generateAsync({ type: "nodebuffer" });
  return Buffer.isBuffer(output) ? output : Buffer.from(output);
}

async function withArtifactStorage<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.ARTIFACT_STORAGE_ROOT;
  const root = mkdtempSync(path.join(os.tmpdir(), "shanhai-m68-"));
  process.env.ARTIFACT_STORAGE_ROOT = root;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.ARTIFACT_STORAGE_ROOT;
    else process.env.ARTIFACT_STORAGE_ROOT = previous;
    rmSync(root, { recursive: true, force: true });
  }
}

async function versionedFinalPackageFixture() {
  const fixtures = validPptFullProductionFixtures();
  const pageIds = fixtures.designPackage.pageSpecs.map((page) => page.pageId);
  const pptxBufferValue = await pptxBuffer();
  const pdfBuffer = Buffer.from("%PDF-1.7\nreal-pdf-fixture\n%%EOF", "utf8");
  const imageBuffer = pngBuffer();
  const videoBuffer = mp4Buffer("final-video");
  const pptxStored = writeLocalArtifact({ category: "ppt-production-artifacts", fileName: "lesson.pptx", buffer: pptxBufferValue });
  const pdfStored = writeLocalArtifact({ category: "ppt-production-artifacts", fileName: "lesson.pdf", buffer: pdfBuffer });
  const imageStored = writeLocalArtifact({ category: "image-artifacts", fileName: "visual.png", buffer: imageBuffer });
  const videoStored = writeLocalArtifact({ category: "video-artifacts", fileName: "intro.mp4", buffer: videoBuffer });
  const pptxSha256 = createHash("sha256").update(pptxBufferValue).digest("hex");
  const pdfSha256 = createHash("sha256").update(pdfBuffer).digest("hex");
  const imageSha256 = createHash("sha256").update(imageBuffer).digest("hex");
  const videoSha256 = createHash("sha256").update(videoBuffer).digest("hex");
  const candidate = buildPptFullDeckCandidate({
    ...fixtures,
    sampleApproval: fixtures.approval,
    composition: {
      pptxBuffer: pptxBufferValue,
      pptxSha256,
      pageEvidence: fixtures.designPackage.pageSpecs.map((page) => ({
        pageId: page.pageId,
        assetIds: fixtures.manifest.entries.filter((entry) => entry.pageIds.includes(page.pageId)).map((entry) => entry.assetId),
        editableTextLayerIds: page.editableText.map((layer) => layer.layerId),
        editableMathLayerIds: page.editableMath.map((layer) => layer.layerId),
        rasterizedExactContent: false as const,
      })),
    },
    renderEvidence: {
      pptx: { storageRef: pptxStored.localOutput, sha256: pptxSha256, bytes: pptxBufferValue.length, slideCount: 12 },
      pdf: { storageRef: pdfStored.localOutput, sha256: pdfSha256, bytes: pdfBuffer.length, pageCount: 12 },
      pageRenders: pageIds.map((pageId, index) => ({ pageId, storageRef: `renders/${pageId}.png`, sha256: (index + 10).toString(16).padStart(2, "0").repeat(32).slice(0, 64) })),
      contactSheet: { storageRef: "renders/contact.png", sha256: "c".repeat(64), pageIds },
    },
  });
  const qa = pageIds.map((pageId) => ({ pageId, design: "passed" as const, visual: "passed" as const, provenance: "passed" as const, readability: "passed" as const, findings: [] }));
  const pptPackage = sealPptFullDeckCandidate(candidate, qa);
  const narrationScript = createVideoNarrationScript({ schemaVersion: "video-narration-script.v1", language: "zh-CN", voiceId: "Chinese (Mandarin)_Gentleman", text: "装置为什么会连续变化？带着这个问题回到课堂。", courseAnchor: "带着这个问题回到课堂", answerDisclosureBoundary: "不解释答案" });
  const videoReviewDigest = "e".repeat(64);
  const artifacts = [
    artifact("requirement_spec", "req"),
    artifact("lesson_plan", "lesson", { markdownContent: "# 公开课教案\n\n完整课堂教学设计。" }),
    artifact("ppt_design_draft", "design"),
    artifact("pptx_artifact", "pptx", { structuredContent: {
      pptFullDeckCandidate: candidate,
      pptFullDeckPackage: pptPackage,
      pptFullDeckReview: {
        schemaVersion: "ppt-full-deck-review.v1",
        overallStatus: "passed",
        candidateDigest: candidate.candidateDigest,
        reviewSource: "teacher",
        reviewerMessageId: "teacher-full-deck-review",
        qa,
        reviewedAt: "2026-07-13T00:00:00.000Z",
      },
    } }),
    artifact("image_prompts", "image", { structuredContent: { storage: { imageAsset: { fileName: "visual.png", localOutput: imageStored.localOutput, sha256: imageSha256, mime: "image/png" } } } }),
    artifact("video_script_generate", "script", { structuredContent: { videoNarrationScript: narrationScript } }),
    artifact("concat_only_assemble", "video", { structuredContent: {
      storage: { videoAsset: { fileName: "intro.mp4", localOutput: videoStored.localOutput, sha256: videoSha256, mime: "video/mp4" } },
      videoFinalReviewEvidence: {
        storyboard: { artifactId: "storyboard-a", artifactVersion: 1, manifestDigest: "d".repeat(64), targetDurationRange: { minSeconds: 30, maxSeconds: 60 }, shotIds: ["shot_01", "shot_02", "shot_03"] },
        finalVideo: { storageRef: videoStored.localOutput, sha256: videoSha256, durationMs: 42000 },
        timeline: { timelineId: "timeline-a", shotIds: ["shot_01", "shot_02", "shot_03"], durationMs: 42000 },
        sampledFrames: [{ shotId: "shot_01", storageRef: "frames/shot_01.png", sha256: "a".repeat(64) }],
        transcript: { trackId: "caption-main", storageRef: "tracks/captions.srt", sha256: "b".repeat(64) },
        audioTrack: { trackId: "audio-main", storageRef: "tracks/audio.aac", sha256: "c".repeat(64) },
      },
      videoFinalReview: { overallStatus: "passed", evidenceDigest: videoReviewDigest },
      videoFinalApproval: { decision: "approved", reviewEvidenceDigest: videoReviewDigest },
    } }),
  ];
  return {
    artifacts,
    classroomRunSpecDraft: {
      schemaVersion: "classroom-run-spec-draft.v1",
      courseAnchor: narrationScript.courseAnchor,
      sequence: [
        { ordinal: 1, action: "play_intro_video", artifactRole: "video", pptPage: null, instruction: "播放独立导入视频。" },
        { ordinal: 2, action: "ask_return_question", artifactRole: null, pptPage: null, instruction: "提出唯一课程回接问题。" },
        { ordinal: 3, action: "open_ppt", artifactRole: "pptx", pptPage: 1, instruction: "打开课件第一页。" },
        { ordinal: 4, action: "teacher_explain", artifactRole: "pptx", pptPage: 2, instruction: "组织观察与讨论。" },
        { ordinal: 5, action: "reveal_answer", artifactRole: "pptx", pptPage: 6, instruction: "讨论后揭示答案。" },
      ],
    },
    inspectors: {
      pptx: async () => ({ slideCount: 12 }),
      pdf: () => ({ pageCount: 12 }),
      video: () => ({ durationSeconds: 42, width: 752, height: 416, fps: 24, videoCodec: "h264", audioCodec: "aac" }),
    },
  };
}

describe("M68 PackageToolAdapter", () => {
  it("runs the real PPT sample composer, LibreOffice renderer, and three-overview pipeline", async () => {
    await withArtifactStorage(async () => {
      const fixtures = validPptSampleFixtures();
      for (const entry of fixtures.manifest.entries) {
        const width = entry.assetKind === "AI_SCENE" ? 1920 : 1024;
        const height = entry.assetKind === "AI_SCENE" ? 1080 : 1024;
        const buffer = await sharp({
          create: {
            width,
            height,
            channels: 4,
            background: entry.assetKind === "AI_SCENE" ? { r: 225, g: 238, b: 242, alpha: 1 } : { r: 50, g: 120, b: 105, alpha: 0 },
          },
        }).png().toBuffer();
        const stored = writeLocalArtifact({ category: "image-artifacts", fileName: entry.fileName, buffer });
        entry.storageRef = stored.localOutput;
        entry.sha256 = createHash("sha256").update(buffer).digest("hex");
        entry.bytes = buffer.length;
        entry.width = width;
        entry.height = height;
      }
      const { manifestDigest: _digest, ...semanticManifest } = fixtures.manifest;
      fixtures.manifest.manifestDigest = createPptAssetManifestDigest(semanticManifest);
      const design = artifact("ppt_design_draft", "design-real", { structuredContent: { pptDesignPackage: fixtures.designPackage } });
      const assets = artifact("image_prompts", "assets-real", {
        structuredContent: { pptAssetRequestBatch: fixtures.requestBatch, pptAssetManifest: fixtures.manifest },
      });

      const result = await executePackageTool({
        tool: getToolDefinition("assemble_ppt_key_samples"),
        projectId: "project-a",
        artifactRefs: [{ kind: design.kind, artifactId: design.id }, { kind: assets.kind, artifactId: assets.id }],
        resolvedArtifacts: [design, assets],
      });

      if (result.status !== "succeeded") {
        throw new Error(result.observation.internalReasonSanitized);
      }

      expect(result).toMatchObject({
        status: "succeeded",
        artifactDraft: {
          structuredContent: {
            pptKeySampleCandidate: {
              reviewStatus: "awaiting_dvp_review",
              samplePageIds: fixtures.designPackage.samplePlan.samplePageIds,
              overviews: expect.arrayContaining([
                expect.objectContaining({ kind: "scene_and_primary_props" }),
                expect.objectContaining({ kind: "micro_assets" }),
                expect.objectContaining({ kind: "assembled_samples" }),
              ]),
            },
          },
        },
      });
      if (result.status === "succeeded") {
        const candidate = result.artifactDraft.structuredContent?.pptKeySampleCandidate as { samplePptx: { storageRef: string }; assembledPages: Array<{ renderRef: string }> };
        expect(existsSync(resolveLocalArtifactOutput(candidate.samplePptx.storageRef)!)).toBe(true);
        expect(candidate.assembledPages.every((page) => existsSync(resolveLocalArtifactOutput(page.renderRef)!))).toBe(true);
      }
    });
  }, 60_000);

  it("assembles a PPT key sample review candidate without self-approving D/V/P", async () => {
    const fixtures = validPptSampleFixtures();
    const design = artifact("ppt_design_draft", "design", {
      structuredContent: { pptDesignPackage: fixtures.designPackage },
    });
    const assets = artifact("image_prompts", "assets", {
      structuredContent: {
        pptAssetRequestBatch: fixtures.requestBatch,
        pptAssetManifest: fixtures.manifest,
      },
    });
    const candidate = buildPptKeySampleCandidate({
      designPackage: fixtures.designPackage,
      requestBatch: fixtures.requestBatch,
      manifest: fixtures.manifest,
      composition: {
        pptxBuffer: Buffer.from("PK candidate"),
        pptxSha256: fixtures.sampleSet.samplePptx.sha256,
        pageEvidence: fixtures.sampleSet.assembledPages.map(({ renderRef: _renderRef, renderSha256: _renderSha256, ...page }) => page),
      },
      renderEvidence: {
        samplePptx: fixtures.sampleSet.samplePptx,
        pageRenders: fixtures.sampleSet.assembledPages.map((page) => ({ pageId: page.pageId, storageRef: page.renderRef, sha256: page.renderSha256 })),
        overviews: fixtures.sampleSet.overviews,
      },
    });

    const result = await executePackageTool({
      tool: getToolDefinition("assemble_ppt_key_samples"),
      projectId: "project-a",
      artifactRefs: [{ kind: design.kind, artifactId: design.id }, { kind: assets.kind, artifactId: assets.id }],
      resolvedArtifacts: [design, assets],
      runPptKeySampleAssembly: async () => candidate,
    });

    expect(result).toMatchObject({
      status: "succeeded",
      toolId: "assemble_ppt_key_samples",
      capabilityId: "ppt_key_samples",
      artifactDraft: {
        nodeKey: "image_prompts",
        kind: "image_prompts",
        structuredContent: {
          pptKeySampleCandidate: {
            candidateDigest: candidate.candidateDigest,
            reviewStatus: "awaiting_dvp_review",
          },
        },
      },
      qualityGate: { passed: true, gates: expect.arrayContaining(["awaiting_dvp_review"]) },
    });
    if (result.status === "succeeded") {
      expect(result.artifactDraft.structuredContent).not.toHaveProperty("pptKeySampleSet");
      expect(result.artifactDraft.structuredContent).not.toHaveProperty("pptSampleApproval");
    }
  });

  it("assembles a full PPT delivery-review candidate without self-approving Delivery Critic", async () => {
    const fixtures = validPptFullProductionFixtures();
    const pageIds = fixtures.designPackage.pageSpecs.map((page) => page.pageId);
    const composition = {
      pptxBuffer: Buffer.from("PK full deck"),
      pptxSha256: "a".repeat(64),
      pageEvidence: fixtures.designPackage.pageSpecs.map((page) => ({
        pageId: page.pageId,
        assetIds: fixtures.manifest.entries.filter((entry) => entry.pageIds.includes(page.pageId)).map((entry) => entry.assetId),
        editableTextLayerIds: page.editableText.map((layer) => layer.layerId),
        editableMathLayerIds: page.editableMath.map((layer) => layer.layerId),
        rasterizedExactContent: false as const,
      })),
    };
    const renderEvidence = {
      pptx: { storageRef: "artifact-storage/ppt-production-artifacts/deck.pptx", sha256: "a".repeat(64), bytes: 1000, slideCount: 12 },
      pdf: { storageRef: "artifact-storage/ppt-production-artifacts/deck.pdf", sha256: "b".repeat(64), bytes: 900, pageCount: 12 },
      pageRenders: pageIds.map((pageId, index) => ({ pageId, storageRef: `artifact-storage/ppt-production-artifacts/${pageId}.png`, sha256: (index + 10).toString(16).padStart(2, "0").repeat(32).slice(0, 64) })),
      contactSheet: { storageRef: "artifact-storage/ppt-production-artifacts/contact.png", sha256: "c".repeat(64), pageIds },
    };
    const candidate = buildPptFullDeckCandidate({ ...fixtures, sampleApproval: fixtures.approval, composition, renderEvidence });
    const design = artifact("ppt_design_draft", "design-full", { structuredContent: { pptDesignPackage: fixtures.designPackage } });
    const assets = artifact("image_prompts", "assets-full", { structuredContent: {
      pptAssetRequestBatch: fixtures.requestBatch,
      pptAssetManifest: fixtures.manifest,
      pptKeySampleSet: fixtures.sampleSet,
      pptSampleApproval: fixtures.approval,
    } });

    const result = await executePackageTool({
      tool: getToolDefinition("assemble_ppt_full_deck"),
      projectId: "project-a",
      artifactRefs: [{ kind: design.kind, artifactId: design.id }, { kind: assets.kind, artifactId: assets.id }],
      resolvedArtifacts: [design, assets],
      runPptFullDeckAssembly: async () => candidate,
    });

    expect(result).toMatchObject({
      status: "succeeded",
      capabilityId: "ppt_full_deck",
      artifactDraft: { kind: "pptx_artifact", structuredContent: { pptFullDeckCandidate: { reviewStatus: "awaiting_delivery_review" } } },
      qualityGate: { passed: true, gates: expect.arrayContaining(["awaiting_delivery_review"]) },
    });
    if (result.status === "succeeded") {
      expect(result.artifactDraft.structuredContent).not.toHaveProperty("pptFullDeckPackage");
    }
  });

  it("assembles approved video segments into a persisted concat_only_assemble artifact", async () => {
    await withArtifactStorage(async () => {
      const secondBuffer = realMp4Buffer("blue", true, 10);
      const thirdBuffer = realMp4Buffer("green", false, 10);
      const firstLongBuffer = realMp4Buffer("red", false, 10);
      const first = writeLocalArtifact({ category: "video-artifacts", fileName: "s1.mp4", buffer: firstLongBuffer });
      const second = writeLocalArtifact({ category: "video-artifacts", fileName: "s2.mp4", buffer: secondBuffer });
      const third = writeLocalArtifact({ category: "video-artifacts", fileName: "s3.mp4", buffer: thirdBuffer });
      const segments = [
        artifact("video_segment_generate", "segment-1", {
          version: 1,
          structuredContent: { storage: { videoAsset: { fileName: "s1.mp4", localOutput: first.localOutput, mime: "video/mp4", sha256: createHash("sha256").update(firstLongBuffer).digest("hex"), requestEvidence: { shotId: "shot_01", durationSeconds: 10, references: [] } } } },
        }),
        artifact("video_segment_generate", "segment-2", {
          version: 2,
          structuredContent: { storage: { videoAsset: { fileName: "s2.mp4", localOutput: second.localOutput, mime: "video/mp4", sha256: createHash("sha256").update(secondBuffer).digest("hex"), requestEvidence: { shotId: "shot_02", durationSeconds: 10, references: [] } } } },
        }),
        artifact("video_segment_generate", "segment-3", {
          version: 3,
          structuredContent: { storage: { videoAsset: { fileName: "s3.mp4", localOutput: third.localOutput, mime: "video/mp4", sha256: createHash("sha256").update(thirdBuffer).digest("hex"), requestEvidence: { shotId: "shot_03", durationSeconds: 10, references: [] } } } },
        }),
      ];
      const storyboardArtifact = fullIntroStoryboardArtifact();
      const narrationScript = createVideoNarrationScript({ schemaVersion: "video-narration-script.v1", language: "zh-CN", voiceId: "Chinese (Mandarin)_Gentleman", text: "装置为什么连续发生变化？带着这个问题回到课堂。", courseAnchor: "带着问题回到课堂", answerDisclosureBoundary: "不解释答案" });
      const scriptArtifact = artifact("video_script_generate", "script-1", { structuredContent: { videoNarrationScript: narrationScript } });
      const audioBuffer = realMp3Buffer();
      const transcriptBuffer = Buffer.from("1\n00:00:00,000 --> 00:00:00,750\n装置为什么连续发生变化？", "utf8");

      const result = await executePackageTool({
        tool: getToolDefinition("concat_only_assemble"),
        projectId: "project-a",
        artifactRefs: [
          { kind: "video_segment_generate", artifactId: "segment-1" },
          { kind: "video_segment_generate", artifactId: "segment-2" },
          { kind: "video_segment_generate", artifactId: "segment-3" },
          { kind: "storyboard_generate", artifactId: storyboardArtifact.id },
          { kind: "video_script_generate", artifactId: "script-1" },
        ],
        resolvedArtifacts: [...segments, storyboardArtifact, scriptArtifact],
        runVideoNarration: async () => ({ audioBuffer, transcriptBuffer, cues: [{ text: "装置为什么连续发生变化？", startMs: 0, endMs: 750 }], providerEvidence: { model: "speech-test", voiceId: narrationScript.voiceId, scriptDigest: narrationScript.scriptDigest, reportedDurationMs: 800 } }),
      });

      expect(result).toMatchObject({
        status: "succeeded",
        toolId: "concat_only_assemble",
        capabilityId: "concat_only_assemble",
        artifactDraft: {
          nodeKey: "concat_only_assemble",
          kind: "concat_only_assemble",
          structuredContent: {
            storage: {
              videoAsset: {
                generationMode: "ffmpeg_timeline_assembled",
                sourceArtifactIds: ["segment-1", "segment-2", "segment-3", "storyboard-1", "script-1"],
              },
            },
            videoFinalReviewEvidence: {
              finalVideo: { fullyDecoded: true, audio: { codec: "aac" } },
              storyboard: { manifestDigest: expect.stringMatching(/^[a-f0-9]{64}$/), targetDurationRange: { minSeconds: 30, maxSeconds: 60 }, shotIds: ["shot_01", "shot_02", "shot_03"] },
              timeline: { shotIds: ["shot_01", "shot_02", "shot_03"], entries: [{ shotId: "shot_01" }, { shotId: "shot_02" }, { shotId: "shot_03" }] },
              sampledFrames: [{ shotId: "shot_01" }, { shotId: "shot_02" }, { shotId: "shot_03" }],
              transcript: { trackId: "caption-main", format: "srt", cueCount: 1 },
              audioTrack: { trackId: "audio-main", codec: "aac", sampleRate: 48000, channels: 2 },
            },
          },
        },
        artifactTruth: { created: true, persisted: true, placeholder: false, producedArtifactKind: "concat_only_assemble" },
        qualityGate: { passed: true, gates: expect.arrayContaining(["ffprobe_shots_verified", "ffmpeg_timeline_assembled", "provider_audio_replaced", "controlled_audio_verified", "subtitle_timing_verified"]) },
      });
      expect(result.status).toBe("succeeded");
      if (result.status === "succeeded") {
        const output = result.artifactDraft.structuredContent?.storage as { videoAsset?: { localOutput?: string } };
        const absolutePath = resolveLocalArtifactOutput(output.videoAsset?.localOutput ?? "");
        expect(absolutePath && existsSync(absolutePath)).toBe(true);
        expect(readFileSync(absolutePath!).length).toBeGreaterThan(1024);
        expect(result.artifactDraft.structuredContent?.videoFinalReviewEvidence).toHaveProperty("transcript.sha256");
        expect(result.artifactDraft.structuredContent?.videoFinalReviewEvidence).toHaveProperty("audioTrack.sha256");
        const evidence = result.artifactDraft.structuredContent?.videoFinalReviewEvidence as { transcript: { storageRef: string; sha256: string }; audioTrack: { storageRef: string; sha256: string } };
        for (const track of [evidence.transcript, evidence.audioTrack]) {
          const trackPath = resolveLocalArtifactOutput(track.storageRef);
          expect(trackPath && existsSync(trackPath)).toBe(true);
          expect(createHash("sha256").update(readFileSync(trackPath!)).digest("hex")).toBe(track.sha256);
        }
      }
    });
  }, 40_000);

  it("blocks final video assembly before FFmpeg when any storyboard shot is missing", async () => {
    await withArtifactStorage(async () => {
      const buffer = realMp4Buffer("red", false);
      const stored = writeLocalArtifact({ category: "video-artifacts", fileName: "only-one.mp4", buffer });
      const storyboardArtifact = fullIntroStoryboardArtifact();
      const narrationScript = createVideoNarrationScript({ schemaVersion: "video-narration-script.v1", language: "zh-CN", voiceId: "Chinese (Mandarin)_Gentleman", text: "装置为什么连续发生变化？带着这个问题回到课堂。", courseAnchor: "带着问题回到课堂", answerDisclosureBoundary: "不解释答案" });
      let narrationCalls = 0;
      const result = await executePackageTool({
        tool: getToolDefinition("concat_only_assemble"),
        projectId: "project-a",
        artifactRefs: [
          { kind: "video_segment_generate", artifactId: "segment-1" },
          { kind: "storyboard_generate", artifactId: storyboardArtifact.id },
          { kind: "video_script_generate", artifactId: "script-1" },
        ],
        resolvedArtifacts: [
          artifact("video_segment_generate", "segment-1", { structuredContent: { storage: { videoAsset: { fileName: "only-one.mp4", localOutput: stored.localOutput, mime: "video/mp4", sha256: createHash("sha256").update(buffer).digest("hex"), requestEvidence: { shotId: "shot_01", durationSeconds: 10, references: [] } } } } }),
          storyboardArtifact,
          artifact("video_script_generate", "script-1", { structuredContent: { videoNarrationScript: narrationScript } }),
        ],
        runVideoNarration: async () => { narrationCalls += 1; throw new Error("must_not_run"); },
      });
      expect(narrationCalls).toBe(0);
      expect(result).toMatchObject({ status: "failed", observation: { kind: "quality_gate_failed" } });
    });
  });

  it("rejects video timeline assembly when a segment has no persisted shot binding", async () => {
    await withArtifactStorage(async () => {
      const buffer = realMp4Buffer("green", true);
      const stored = writeLocalArtifact({ category: "video-artifacts", fileName: "unbound.mp4", buffer });
      const result = await executePackageTool({
        tool: getToolDefinition("concat_only_assemble"), projectId: "project-a",
        artifactRefs: [{ kind: "video_segment_generate", artifactId: "segment-unbound" }],
        resolvedArtifacts: [artifact("video_segment_generate", "segment-unbound", { structuredContent: { storage: { videoAsset: { fileName: "unbound.mp4", localOutput: stored.localOutput, sha256: createHash("sha256").update(buffer).digest("hex"), mime: "video/mp4" } } } })],
      });
      expect(result).toMatchObject({ status: "failed", observation: { kind: "quality_gate_failed" } });
    });
  });

  it("builds a persisted version-bound final package only from reviewed and approved assets", async () => {
    await withArtifactStorage(async () => {
      const fixture = await versionedFinalPackageFixture();

      const result = await executePackageTool({
        tool: getToolDefinition("create_final_package"),
        projectId: "project-a",
        artifactRefs: fixture.artifacts.map((item) => ({ kind: item.kind, artifactId: item.id })),
        resolvedArtifacts: fixture.artifacts,
        toolInput: { classroomRunSpecDraft: fixture.classroomRunSpecDraft },
        finalPackageInspectors: fixture.inspectors,
      });

      expect(result).toMatchObject({
        status: "succeeded",
        toolId: "create_final_package",
        capabilityId: "final_package",
        artifactDraft: {
          nodeKey: "final_delivery",
          kind: "final_delivery",
          structuredContent: {
            storage: {
              packageAsset: {
                generationMode: "versioned_final_package_generated",
                sourceArtifactIds: expect.arrayContaining(["req", "lesson", "design", "pptx", "image", "script", "video"]),
              },
            },
            finalPackageManifest: { requiredRoles: ["lesson_plan", "pptx", "pdf", "image", "video"], teacherSignoff: false },
            classroomRunSpec: { schemaVersion: "classroom-run-spec.v1", courseAnchor: fixture.classroomRunSpecDraft.courseAnchor },
          },
        },
        artifactTruth: { created: true, persisted: true, placeholder: false, producedArtifactKind: "final_delivery" },
        qualityGate: { passed: true, gates: expect.arrayContaining(["version_binding_verified", "review_batch_verified", "classroom_run_spec_verified", "manifest_reverse_verified"]) },
      });
      if (result.status === "succeeded") {
        const storage = result.artifactDraft.structuredContent?.storage as { packageAsset: { localOutput: string } };
        const packagePath = resolveLocalArtifactOutput(storage.packageAsset.localOutput)!;
        const zip = await JSZip.loadAsync(readFileSync(packagePath));
        expect(Object.keys(zip.files)).toEqual(expect.arrayContaining(["manifest.json", "classroom-run-spec.json", "lesson-plan.md", "lesson-slides.pptx", "lesson-slides.pdf", "visual.png", "intro-video.mp4"]));
      }
    });
  });

  it("blocks final packaging when the Main Agent run spec changes the approved course anchor", async () => {
    await withArtifactStorage(async () => {
      const fixture = await versionedFinalPackageFixture();
      const result = await executePackageTool({
        tool: getToolDefinition("create_final_package"),
        projectId: "project-a",
        artifactRefs: fixture.artifacts.map((item) => ({ kind: item.kind, artifactId: item.id })),
        resolvedArtifacts: fixture.artifacts,
        toolInput: { classroomRunSpecDraft: { ...fixture.classroomRunSpecDraft, courseAnchor: "另一个未经批准的回接" } },
        finalPackageInspectors: fixture.inspectors,
      });
      expect(result).toMatchObject({ status: "failed", artifactCreated: false, errorCategory: "quality_gate_failed" });
    });
  });

  it("blocks final packaging until the final video review has explicit teacher approval", async () => {
    await withArtifactStorage(async () => {
      const fixture = await versionedFinalPackageFixture();
      const video = fixture.artifacts.find((item) => item.kind === "concat_only_assemble")!;
      delete video.structuredContent.videoFinalApproval;
      const result = await executePackageTool({
        tool: getToolDefinition("create_final_package"),
        projectId: "project-a",
        artifactRefs: fixture.artifacts.map((item) => ({ kind: item.kind, artifactId: item.id })),
        resolvedArtifacts: fixture.artifacts,
        toolInput: { classroomRunSpecDraft: fixture.classroomRunSpecDraft },
        finalPackageInspectors: fixture.inspectors,
      });
      expect(result).toMatchObject({ status: "failed", artifactCreated: false, errorCategory: "quality_gate_failed" });
    });
  });

  it("blocks final packaging when the PPT review is not bound to the reviewed candidate", async () => {
    await withArtifactStorage(async () => {
      const fixture = await versionedFinalPackageFixture();
      const pptx = fixture.artifacts.find((item) => item.kind === "pptx_artifact")!;
      const review = pptx.structuredContent.pptFullDeckReview as Record<string, unknown>;
      review.candidateDigest = "f".repeat(64);
      const result = await executePackageTool({
        tool: getToolDefinition("create_final_package"),
        projectId: "project-a",
        artifactRefs: fixture.artifacts.map((item) => ({ kind: item.kind, artifactId: item.id })),
        resolvedArtifacts: fixture.artifacts,
        toolInput: { classroomRunSpecDraft: fixture.classroomRunSpecDraft },
        finalPackageInspectors: fixture.inspectors,
      });
      expect(result).toMatchObject({ status: "failed", artifactCreated: false, errorCategory: "quality_gate_failed" });
    });
  });

  it("blocks final packaging when the PPT review QA differs from the sealed package QA", async () => {
    await withArtifactStorage(async () => {
      const fixture = await versionedFinalPackageFixture();
      const pptx = fixture.artifacts.find((item) => item.kind === "pptx_artifact")!;
      const review = pptx.structuredContent.pptFullDeckReview as { qa: Array<Record<string, unknown>> };
      review.qa = review.qa.map((entry, index) => index === 0 ? { ...entry, findings: ["未关闭问题"] } : entry);
      const result = await executePackageTool({
        tool: getToolDefinition("create_final_package"),
        projectId: "project-a",
        artifactRefs: fixture.artifacts.map((item) => ({ kind: item.kind, artifactId: item.id })),
        resolvedArtifacts: fixture.artifacts,
        toolInput: { classroomRunSpecDraft: fixture.classroomRunSpecDraft },
        finalPackageInspectors: fixture.inspectors,
      });
      expect(result).toMatchObject({ status: "failed", artifactCreated: false, errorCategory: "quality_gate_failed" });
    });
  });

  it("fails final package creation when the classroom image is missing", async () => {
    const result = await executePackageTool({
      tool: getToolDefinition("create_final_package"),
      projectId: "project-a",
      artifactRefs: [
        { kind: "requirement_spec", artifactId: "req" },
        { kind: "lesson_plan", artifactId: "lesson" },
        { kind: "ppt_design_draft", artifactId: "design" },
        { kind: "pptx_artifact", artifactId: "pptx" },
        { kind: "concat_only_assemble", artifactId: "video" },
      ],
      resolvedArtifacts: [
        artifact("requirement_spec", "req"),
        artifact("lesson_plan", "lesson"),
        artifact("ppt_design_draft", "design"),
        artifact("pptx_artifact", "pptx"),
        artifact("concat_only_assemble", "video"),
      ],
    });

    expect(result).toMatchObject({
      status: "failed",
      toolId: "create_final_package",
      capabilityId: "final_package",
      artifactCreated: false,
      errorCategory: "quality_gate_failed",
    });
  });
});
