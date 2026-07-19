import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { omitFixtureFields } from "./support/omit-fixture-fields";
import { writeLocalArtifact } from "@/server/artifact-storage/local-artifact-storage";
import { renderPptKeySamples } from "@/server/ppt-quality/ppt-key-sample-renderer";
import { createPptAssetManifestDigest } from "@/server/ppt-quality/ppt-asset-validator";
import { validPptSampleFixtures } from "./support/ppt-sample-fixture";

describe("V1 Stage 3B key sample render evidence", () => {
  it("stores page renders and three independent overview files", async () => {
    const fixtures = validPptSampleFixtures();
    await materializeManifestImages(fixtures.manifest);
    const fakePptx = Buffer.from("PK fake sample pptx payload");
    const evidence = await renderPptKeySamples({
      pptxBuffer: fakePptx,
      samplePageIds: fixtures.designPackage.samplePlan.samplePageIds,
      manifest: fixtures.manifest,
      convertPptxToPngs: async ({ outputDir }) => {
        const paths: string[] = [];
        for (const [index] of fixtures.designPackage.samplePlan.samplePageIds.entries()) {
          const output = path.join(outputDir, `render-${index + 1}.png`);
          await sharp({ create: { width: 320, height: 180, channels: 4, background: { r: 245, g: 248, b: 250, alpha: 1 } } }).png().toFile(output);
          paths.push(output);
        }
        return paths;
      },
    });

    expect(evidence.pageRenders).toHaveLength(3);
    expect(evidence.overviews.map((overview) => overview.kind)).toEqual([
      "scene_and_primary_props",
      "micro_assets",
      "assembled_samples",
    ]);
    expect(new Set(evidence.overviews.map((overview) => overview.storageRef)).size).toBe(3);
    expect(new Set(evidence.overviews.map((overview) => overview.sha256)).size).toBe(3);
  });

  it("fails when rendered page count differs from the approved sample plan", async () => {
    const fixtures = validPptSampleFixtures();
    await materializeManifestImages(fixtures.manifest);

    await expect(renderPptKeySamples({
      pptxBuffer: Buffer.from("PK fake"),
      samplePageIds: fixtures.designPackage.samplePlan.samplePageIds,
      manifest: fixtures.manifest,
      convertPptxToPngs: async () => [],
    })).rejects.toThrow(/render_count_mismatch/);
  });

  it("reports a stable phase when the real office converter cannot run", async () => {
    const fixtures = validPptSampleFixtures();
    const previous = process.env.LIBREOFFICE_BIN;
    process.env.LIBREOFFICE_BIN = process.execPath;
    try {
      await expect(renderPptKeySamples({
        pptxBuffer: Buffer.from("PK invalid office input"),
        samplePageIds: fixtures.designPackage.samplePlan.samplePageIds,
        manifest: fixtures.manifest,
      })).rejects.toThrow("ppt_sample_libreoffice_convert_failed");
    } finally {
      if (previous === undefined) delete process.env.LIBREOFFICE_BIN;
      else process.env.LIBREOFFICE_BIN = previous;
    }
  });
});

async function materializeManifestImages(manifest: ReturnType<typeof validPptSampleFixtures>["manifest"]): Promise<void> {
  for (const [index, entry] of manifest.entries.entries()) {
    const buffer = await sharp({ create: { width: 48, height: 32, channels: 4, background: { r: 60 + index, g: 130, b: 170, alpha: entry.transparentBackground ? 0 : 1 } } }).png().toBuffer();
    const stored = writeLocalArtifact({ category: "image-artifacts", fileName: `sample-renderer-${entry.assetId}.png`, buffer });
    entry.fileName = `sample-renderer-${entry.assetId}.png`;
    entry.storageRef = stored.localOutput;
    entry.sha256 = createHash("sha256").update(buffer).digest("hex");
    entry.bytes = buffer.length;
    entry.width = 48;
    entry.height = 32;
  }
  const semantic = omitFixtureFields(manifest, "manifestDigest");
  manifest.manifestDigest = createPptAssetManifestDigest(semantic);
}
