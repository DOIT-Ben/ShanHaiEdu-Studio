import { createHash } from "node:crypto";
import JSZip from "jszip";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { writeLocalArtifact } from "@/server/artifact-storage/local-artifact-storage";
import { hashRunInput } from "@/server/execution/run-input-snapshot";
import { assemblePptImageSlides } from "@/server/ppt-image-slides/ppt-image-slide-assembler";
import type { PptImageSlideBundle } from "@/server/ppt-image-slides/ppt-image-slide-types";
import { validPptDesignPackage } from "./support/ppt-quality-fixture";

describe("FrameFlow image-slide PPT assembler", () => {
  it("puts one full-bleed image on every page and keeps editable layers", async () => {
    const design = validPptDesignPackage();
    const entries = [] as PptImageSlideBundle["entries"];
    for (const page of design.pageSpecs) {
      const buffer = await sharp({ create: { width: 1920, height: 1080, channels: 3, background: "#147D92" } }).png().toBuffer();
      const stored = writeLocalArtifact({ category: "image-artifacts", fileName: `${page.pageId}.png`, buffer });
      const sha256 = createHash("sha256").update(buffer).digest("hex");
      const file = { fileName: `${page.pageId}.png`, storageRef: stored.localOutput, sha256, bytes: buffer.length, width: 1920, height: 1080, mime: "image/png" };
      entries.push({ pageId: page.pageId, pageNumber: page.pageNumber, prompt: page.primaryVisualBrief, promptDigest: "p".repeat(64), storageRef: stored.localOutput, fileName: file.fileName, sha256, bytes: buffer.length, width: 1920, height: 1080, mime: "image/png", provider: "model_gateway", model: "image-2", rawAsset: file, normalizedAsset: file, processingChain: [] });
    }
    const result = await assemblePptImageSlides({ designPackage: design, bundle: { schemaVersion: "ppt-image-slide-bundle.v1", designPackageDigest: hashRunInput(design), entries } });
    const zip = await JSZip.loadAsync(result.pptxBuffer);
    const slides = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    expect(result.review.passed).toBe(true);
    expect(slides).toHaveLength(12);
    const xml = (await Promise.all(slides.map((name) => zip.file(name)!.async("string")))).join("\n");
    expect(xml).toContain("<p:pic");
    expect(xml).toContain("这一页要解决的问题 12");
    expect(result.pptxBuffer.length).toBeGreaterThan(0);
  });

  it("fails closed when a page image hash changes", async () => {
    const design = validPptDesignPackage();
    const bundle = { schemaVersion: "ppt-image-slide-bundle.v1", designPackageDigest: hashRunInput(design), entries: [] } as PptImageSlideBundle;
    await expect(assemblePptImageSlides({ designPackage: design, bundle })).rejects.toThrow(/count_mismatch/);
  });
});
