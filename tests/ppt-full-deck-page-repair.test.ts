import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { omitFixtureFields } from "./support/omit-fixture-fields";
import { writeLocalArtifact } from "@/server/artifact-storage/local-artifact-storage";
import { buildPptFullDeckCandidate } from "@/server/ppt-quality/ppt-full-deck-candidate";
import { composePptFullDeckPptx } from "@/server/ppt-quality/ppt-full-deck-composer";
import { repairPptFullDeckPages } from "@/server/ppt-quality/ppt-full-deck-page-repair";
import { renderPptFullDeck } from "@/server/ppt-quality/ppt-full-deck-renderer";
import { createPptAssetManifestDigest } from "@/server/ppt-quality/ppt-asset-validator";
import { validPptFullProductionFixtures } from "./support/ppt-full-production-fixture";
import { setMaterializedPptAssetFixtureEvidence } from "./support/ppt-sample-fixture";

describe("V1 Stage 3C page-scoped full deck repair", () => {
  it("recomposes the deliverable while reusing unaffected page evidence", async () => {
    const fixtures = validPptFullProductionFixtures();
    await materialize(fixtures.manifest);
    const productionInput = { ...fixtures, sampleApproval: fixtures.approval };
    const initialComposition = await composePptFullDeckPptx(productionInput);
    const initialRender = await renderPptFullDeck({
      pptxBuffer: initialComposition.pptxBuffer,
      pageIds: fixtures.designPackage.pageSpecs.map((page) => page.pageId),
      slideCount: initialComposition.slideCount,
      convert: seededConvert,
    });
    const previousCandidate = buildPptFullDeckCandidate({ ...productionInput, composition: initialComposition, renderEvidence: initialRender });

    fixtures.designPackage.pageSpecs[5].editableText[0].text = "这一页已按审查意见调整后的可编辑说明";
    const repaired = await repairPptFullDeckPages({ ...productionInput, previousCandidate, repairedPageIds: ["page_06"], convert: seededConvert });
    const nextCandidate = buildPptFullDeckCandidate({ ...productionInput, composition: repaired.composition, renderEvidence: repaired.renderEvidence });
    const before = new Map(previousCandidate.pages.map((page) => [page.pageId, page]));
    const after = new Map(nextCandidate.pages.map((page) => [page.pageId, page]));

    expect(nextCandidate.candidateDigest).not.toBe(previousCandidate.candidateDigest);
    expect(nextCandidate.pptx.sha256).not.toBe(previousCandidate.pptx.sha256);
    expect(nextCandidate.pdf.sha256).not.toBe(previousCandidate.pdf.sha256);
    expect(after.get("page_06")?.renderSha256).not.toBe(before.get("page_06")?.renderSha256);
    for (const pageId of previousCandidate.pageIds.filter((pageId) => pageId !== "page_06")) {
      expect(after.get(pageId)?.renderRef).toBe(before.get(pageId)?.renderRef);
      expect(after.get(pageId)?.renderSha256).toBe(before.get(pageId)?.renderSha256);
    }
  });
});

async function materialize(manifest: ReturnType<typeof validPptFullProductionFixtures>["manifest"]) {
  for (const [index, entry] of manifest.entries.entries()) {
    const buffer = await sharp({ create: { width: 32, height: 32, channels: 4, background: { r: 30 + index, g: 110, b: 150, alpha: entry.transparentBackground ? 0 : 1 } } }).png().toBuffer();
    const normalizedFileName = entry.fileName;
    const rawFileName = entry.rawAsset.fileName;
    const normalizedStored = writeLocalArtifact({ category: "image-artifacts", fileName: normalizedFileName, buffer });
    const rawStored = writeLocalArtifact({ category: "image-artifacts", fileName: rawFileName, buffer });
    const sha256 = sha(buffer);
    setMaterializedPptAssetFixtureEvidence({
      entry,
      rawAsset: {
        fileName: rawFileName,
        storageRef: rawStored.localOutput,
        sha256,
        bytes: buffer.length,
        width: 32,
        height: 32,
        mime: "image/png",
      },
      normalizedAsset: {
        fileName: normalizedFileName,
        storageRef: normalizedStored.localOutput,
        sha256,
        bytes: buffer.length,
        width: 32,
        height: 32,
        mime: "image/png",
      },
    });
  }
  const semantic = omitFixtureFields(manifest, "manifestDigest");
  manifest.manifestDigest = createPptAssetManifestDigest(semantic);
}

async function seededConvert(input: { pptxPath: string; outputDir: string }) {
  const seed = readFileSync(input.pptxPath).reduce((sum, value) => (sum + value) % 256, 0);
  const pdfPath = path.join(input.outputDir, "full-deck.pdf");
  writeFileSync(pdfPath, Buffer.from(`%PDF fake-${seed}`));
  const renderPaths: string[] = [];
  for (let index = 1; index <= 12; index += 1) {
    const file = path.join(input.outputDir, `render-${index}.png`);
    writeFileSync(file, await sharp({ create: { width: 160, height: 90, channels: 4, background: { r: seed, g: 230, b: 240, alpha: 1 } } }).png().toBuffer());
    renderPaths.push(file);
  }
  return { pdfPath, pdfPageCount: 12, renderPaths };
}

function sha(buffer: Buffer) { return createHash("sha256").update(buffer).digest("hex"); }
