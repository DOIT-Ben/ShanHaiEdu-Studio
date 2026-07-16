import { createHash } from "node:crypto";
import JSZip from "jszip";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { writeLocalArtifact } from "@/server/artifact-storage/local-artifact-storage";
import { composePptKeySamplePptx } from "@/server/ppt-quality/ppt-key-sample-composer";
import { createPptAssetManifestDigest } from "@/server/ppt-quality/ppt-asset-validator";
import { validPptSampleFixtures } from "./support/ppt-sample-fixture";

describe("V1 Stage 3B key sample PPTX composer", () => {
  it("uses exact composition coordinates and keeps text and math editable", async () => {
    const fixtures = validPptSampleFixtures();
    await materializeManifestImages(fixtures.manifest);

    const result = await composePptKeySamplePptx(fixtures);
    const zip = await JSZip.loadAsync(result.pptxBuffer);
    const slidePaths = Object.keys(zip.files).filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path));
    const slideXml = await Promise.all(slidePaths.map((path) => zip.file(path)!.async("string")));

    expect(slidePaths).toHaveLength(3);
    expect(result.pptxSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.pageEvidence.every((page) => page.editableTextLayerIds.length > 0 && page.editableMathLayerIds.length > 0 && page.rasterizedExactContent === false)).toBe(true);
    expect(slideXml.join("\n")).toContain("这一页要解决的问题");
    expect(slideXml.join("\n")).toContain("2%");
  });

  it("refuses to compose when a manifest file is not resolvable", async () => {
    const fixtures = validPptSampleFixtures();
    fixtures.manifest.entries[0].storageRef = "image-artifacts/does-not-exist.png";
    fixtures.manifest.entries[0].normalizedAsset.storageRef = "image-artifacts/does-not-exist.png";
    refreshManifestDigest(fixtures.manifest);

    await expect(composePptKeySamplePptx(fixtures)).rejects.toThrow(/asset_file_missing/);
  });

  it("renders a hundred-grid as native editable cells instead of serializing the object", async () => {
    const fixtures = validPptSampleFixtures();
    await materializeManifestImages(fixtures.manifest);
    fixtures.designPackage.pageSpecs[1].editableMath[0].exactContent = {
      type: "hundred_grid",
      highlightedCells: 25,
      label: "25/100 = 25%",
    };

    const result = await composePptKeySamplePptx(fixtures);
    const zip = await JSZip.loadAsync(result.pptxBuffer);
    const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");

    expect(xml).toContain("25/100 = 25%");
    expect(xml).not.toContain("[object Object]");
    expect((xml.match(/<p:sp>/g) ?? []).length).toBeGreaterThanOrEqual(100);
  });
});

async function materializeManifestImages(manifest: ReturnType<typeof validPptSampleFixtures>["manifest"]): Promise<void> {
  for (const [index, entry] of manifest.entries.entries()) {
    const buffer = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 4,
        background: { r: 40 + index, g: 120, b: 160, alpha: entry.transparentBackground ? 0 : 1 },
      },
    }).png().toBuffer();
    const stored = writeLocalArtifact({ category: "image-artifacts", fileName: `sample-composer-${entry.assetId}.png`, buffer });
    const rawStored = writeLocalArtifact({ category: "image-artifacts", fileName: `sample-composer-${entry.assetId}-provider-raw.png`, buffer });
    const digest = createHash("sha256").update(buffer).digest("hex");
    entry.fileName = `sample-composer-${entry.assetId}.png`;
    entry.storageRef = stored.localOutput;
    entry.sha256 = digest;
    entry.bytes = buffer.length;
    entry.width = 32;
    entry.height = 32;
    entry.rawAsset = {
      fileName: `sample-composer-${entry.assetId}-provider-raw.png`,
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
  refreshManifestDigest(manifest);
}

function refreshManifestDigest(manifest: ReturnType<typeof validPptSampleFixtures>["manifest"]): void {
  const { manifestDigest: _digest, ...semantic } = manifest;
  manifest.manifestDigest = createPptAssetManifestDigest(semantic);
}
