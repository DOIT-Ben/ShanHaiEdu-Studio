import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { resolveLocalArtifactOutput } from "@/server/artifact-storage/local-artifact-storage";
import { renderPptFullDeck } from "@/server/ppt-quality/ppt-full-deck-renderer";

describe("V1 Stage 3C full deck renderer", () => {
  it("stores PPTX, PDF, every page render, and an independent contact sheet", async () => {
    const pageIds = Array.from({ length: 12 }, (_, index) => `page_${String(index + 1).padStart(2, "0")}`);
    const result = await renderPptFullDeck({
      pptxBuffer: Buffer.from("PK full deck"),
      pageIds,
      slideCount: 12,
      convert: async ({ outputDir }) => fakeConvert(outputDir, 12),
    });

    expect(result.pptx.slideCount).toBe(12);
    expect(result.pdf.pageCount).toBe(12);
    expect(result.pageRenders).toHaveLength(12);
    expect(result.contactSheet.pageIds).toEqual(pageIds);
    expect(existsSync(resolveLocalArtifactOutput(result.contactSheet.storageRef)!)).toBe(true);
  });

  it("rejects a PDF or PNG count that differs from the design", async () => {
    const pageIds = Array.from({ length: 12 }, (_, index) => `page_${String(index + 1).padStart(2, "0")}`);
    await expect(renderPptFullDeck({
      pptxBuffer: Buffer.from("PK full deck"),
      pageIds,
      slideCount: 12,
      convert: async ({ outputDir }) => fakeConvert(outputDir, 11),
    })).rejects.toThrow(/page_count_mismatch/);
  });
});

async function fakeConvert(outputDir: string, count: number) {
  const pdfPath = path.join(outputDir, "full-deck.pdf");
  writeFileSync(pdfPath, Buffer.from("%PDF fake full deck"));
  const renderPaths: string[] = [];
  for (let index = 1; index <= count; index += 1) {
    const file = path.join(outputDir, `render-${index}.png`);
    writeFileSync(file, await sharp({ create: { width: 160, height: 90, channels: 4, background: { r: 220, g: 230, b: 240, alpha: 1 } } }).png().toBuffer());
    renderPaths.push(file);
  }
  return { pdfPath, pdfPageCount: count, renderPaths };
}
