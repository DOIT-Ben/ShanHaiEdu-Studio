import { createHash } from "node:crypto";
import JSZip from "jszip";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { omitFixtureFields } from "./support/omit-fixture-fields";
import { writeLocalArtifact } from "@/server/artifact-storage/local-artifact-storage";
import { composePptFullDeckPptx } from "@/server/ppt-quality/ppt-full-deck-composer";
import { createPptAssetManifestDigest } from "@/server/ppt-quality/ppt-asset-validator";
import { validPptFullProductionFixtures } from "./support/ppt-full-production-fixture";

describe("V1 Stage 3C full PPT deck composer", () => {
  it("creates a real 12-slide PPTX with editable page layers", async () => {
    const fixtures = validPptFullProductionFixtures();
    await materialize(fixtures.manifest);

    const result = await composePptFullDeckPptx({
      designPackage: fixtures.designPackage,
      requestBatch: fixtures.requestBatch,
      manifest: fixtures.manifest,
      sampleSet: fixtures.sampleSet,
      sampleApproval: fixtures.approval,
    });
    const zip = await JSZip.loadAsync(result.pptxBuffer);
    const slides = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    const xml = (await Promise.all(slides.map((name) => zip.file(name)!.async("string")))).join("\n");

    expect(result.slideCount).toBe(12);
    expect(slides).toHaveLength(12);
    expect(result.pageEvidence).toHaveLength(12);
    expect(result.pageEvidence.every((page) => page.rasterizedExactContent === false)).toBe(true);
    expect(xml).toContain("这一页要解决的问题 12");
    expect(xml).toContain("12%");
  });

  it("requires a current explicit sample approval", async () => {
    const fixtures = validPptFullProductionFixtures();
    fixtures.approval.sampleSetDigest = "f".repeat(64);

    await expect(composePptFullDeckPptx({
      designPackage: fixtures.designPackage,
      requestBatch: fixtures.requestBatch,
      manifest: fixtures.manifest,
      sampleSet: fixtures.sampleSet,
      sampleApproval: fixtures.approval,
    })).rejects.toThrow(/sample_approval_invalid/);
  });

  it("rejects a key-sample asset scope as full production", async () => {
    const fixtures = validPptFullProductionFixtures();
    fixtures.requestBatch.scope = "key_samples";

    await expect(composePptFullDeckPptx({
      designPackage: fixtures.designPackage,
      requestBatch: fixtures.requestBatch,
      manifest: fixtures.manifest,
      sampleSet: fixtures.sampleSet,
      sampleApproval: fixtures.approval,
    })).rejects.toThrow(/full_production_scope_required/);
  });
});

async function materialize(manifest: ReturnType<typeof validPptFullProductionFixtures>["manifest"]) {
  for (const [index, entry] of manifest.entries.entries()) {
    const buffer = await sharp({
      create: { width: 32, height: 32, channels: 4, background: { r: 30 + index, g: 110, b: 150, alpha: entry.transparentBackground ? 0 : 1 } },
    }).png().toBuffer();
    const stored = writeLocalArtifact({ category: "image-artifacts", fileName: entry.fileName, buffer });
    const rawStored = writeLocalArtifact({ category: "image-artifacts", fileName: entry.rawAsset.fileName, buffer });
    const digest = createHash("sha256").update(buffer).digest("hex");
    entry.storageRef = stored.localOutput;
    entry.sha256 = digest;
    entry.bytes = buffer.length;
    entry.width = 32;
    entry.height = 32;
    entry.rawAsset = {
      fileName: entry.rawAsset.fileName,
      storageRef: rawStored.localOutput,
      sha256: digest,
      bytes: buffer.length,
      width: 32,
      height: 32,
      mime: "image/png",
    };
    entry.normalizedAsset = {
      fileName: entry.fileName,
      storageRef: entry.storageRef,
      sha256: digest,
      bytes: buffer.length,
      width: 32,
      height: 32,
      mime: "image/png",
    };
  }
  const semantic = omitFixtureFields(manifest, "manifestDigest");
  manifest.manifestDigest = createPptAssetManifestDigest(semantic);
}
