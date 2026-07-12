import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
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
import { buildPptFullDeckCandidate } from "@/server/ppt-quality/ppt-full-deck-candidate";
import { validPptFullProductionFixtures } from "./support/ppt-full-production-fixture";

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
      const first = writeLocalArtifact({ category: "video-artifacts", fileName: "s1.mp4", buffer: mp4Buffer("a") });
      const second = writeLocalArtifact({ category: "video-artifacts", fileName: "s2.mp4", buffer: mp4Buffer("b") });
      const segments = [
        artifact("video_segment_generate", "segment-1", {
          version: 1,
          structuredContent: { storage: { videoAsset: { fileName: "s1.mp4", localOutput: first.localOutput, mime: "video/mp4" } } },
        }),
        artifact("video_segment_generate", "segment-2", {
          version: 2,
          structuredContent: { storage: { videoAsset: { fileName: "s2.mp4", localOutput: second.localOutput, mime: "video/mp4" } } },
        }),
      ];

      const result = await executePackageTool({
        tool: getToolDefinition("concat_only_assemble"),
        projectId: "project-a",
        artifactRefs: [
          { kind: "video_segment_generate", artifactId: "segment-1" },
          { kind: "video_segment_generate", artifactId: "segment-2" },
        ],
        resolvedArtifacts: segments,
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
                generationMode: "concat_only_assembled",
                sourceArtifactIds: ["segment-1", "segment-2"],
              },
            },
          },
        },
        artifactTruth: { created: true, persisted: true, placeholder: false, producedArtifactKind: "concat_only_assemble" },
        qualityGate: { passed: true, gates: expect.arrayContaining(["mp4_ftyp_present", "mp4_moov_present", "concat_only_order_preserved"]) },
      });
      expect(result.status).toBe("succeeded");
      if (result.status === "succeeded") {
        const output = result.artifactDraft.structuredContent?.storage as { videoAsset?: { localOutput?: string } };
        const absolutePath = resolveLocalArtifactOutput(output.videoAsset?.localOutput ?? "");
        expect(absolutePath && existsSync(absolutePath)).toBe(true);
        expect(readFileSync(absolutePath!).length).toBe(mp4Buffer("a").length + mp4Buffer("b").length);
      }
    });
  });

  it("builds a persisted final package only when pptx, image, and video assets exist", async () => {
    await withArtifactStorage(async () => {
      const pptx = writeLocalArtifact({ category: "coze-ppt-artifacts", fileName: "lesson.pptx", buffer: await pptxBuffer() });
      const image = writeLocalArtifact({ category: "image-artifacts", fileName: "visual.png", buffer: pngBuffer() });
      const video = writeLocalArtifact({ category: "video-artifacts", fileName: "intro.mp4", buffer: mp4Buffer("v") });
      const resolvedArtifacts = [
        artifact("requirement_spec", "req"),
        artifact("lesson_plan", "lesson"),
        artifact("ppt_design_draft", "design"),
        artifact("pptx_artifact", "pptx", {
          structuredContent: { storage: { cozePptx: { fileName: "lesson.pptx", localOutput: pptx.localOutput } } },
        }),
        artifact("image_prompts", "image", {
          structuredContent: { storage: { imageAsset: { fileName: "visual.png", localOutput: image.localOutput, mime: "image/png" } } },
        }),
        artifact("concat_only_assemble", "video", {
          structuredContent: { storage: { videoAsset: { fileName: "intro.mp4", localOutput: video.localOutput, mime: "video/mp4" } } },
        }),
      ];

      const result = await executePackageTool({
        tool: getToolDefinition("create_final_package"),
        projectId: "project-a",
        artifactRefs: resolvedArtifacts.map((item) => ({ kind: item.kind, artifactId: item.id })),
        resolvedArtifacts,
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
                generationMode: "final_package_generated",
                sourceArtifactIds: ["req", "lesson", "design", "pptx", "image", "video"],
              },
            },
          },
        },
        artifactTruth: { created: true, persisted: true, placeholder: false, producedArtifactKind: "final_delivery" },
        qualityGate: { passed: true, gates: expect.arrayContaining(["zip_valid", "pptx_included", "image_included", "video_included", "manifest_included"]) },
      });
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
