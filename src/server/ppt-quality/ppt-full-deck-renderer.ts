import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { resolveLocalArtifactOutput, writeLocalArtifact } from "@/server/artifact-storage/local-artifact-storage";

const execFileAsync = promisify(execFile);

export type PptFullDeckRenderEvidence = {
  pptx: { storageRef: string; sha256: string; bytes: number; slideCount: number };
  pdf: { storageRef: string; sha256: string; bytes: number; pageCount: number };
  pageRenders: Array<{ pageId: string; storageRef: string; sha256: string }>;
  contactSheet: { storageRef: string; sha256: string; pageIds: string[] };
};

export async function renderPptFullDeck(input: {
  pptxBuffer: Buffer;
  pageIds: string[];
  slideCount: number;
  reusePageRenders?: Array<{ pageId: string; storageRef: string; sha256: string }>;
  convert?: (input: { pptxPath: string; outputDir: string }) => Promise<{ pdfPath: string; pdfPageCount: number; renderPaths: string[] }>;
}): Promise<PptFullDeckRenderEvidence> {
  if (input.pageIds.length !== input.slideCount) throw new Error("ppt_full_render_slide_count_mismatch");
  const runId = randomUUID();
  const outputDir = path.join(/*turbopackIgnore: true*/ process.cwd(), ".tmp", "ppt-full-deck-render", runId);
  mkdirSync(outputDir, { recursive: true });
  const pptxPath = path.join(outputDir, "full-deck.pptx");
  writeFileSync(pptxPath, input.pptxBuffer);
  const converted = await (input.convert ?? convertWithLibreOffice)({ pptxPath, outputDir });
  if (converted.pdfPageCount !== input.pageIds.length || converted.renderPaths.length !== input.pageIds.length) {
    throw new Error(`ppt_full_render_page_count_mismatch:${converted.pdfPageCount}:${converted.renderPaths.length}:${input.pageIds.length}`);
  }

  const pdfBuffer = readFileSync(converted.pdfPath);
  const storedPptx = writeLocalArtifact({ category: "ppt-production-artifacts", fileName: `${runId}-full-deck.pptx`, buffer: input.pptxBuffer });
  const storedPdf = writeLocalArtifact({ category: "ppt-production-artifacts", fileName: `${runId}-full-deck.pdf`, buffer: pdfBuffer });
  const reusablePages = new Map(input.reusePageRenders?.map((page) => [page.pageId, page]));
  const pageRenders = converted.renderPaths.map((renderPath, index) => {
    const reused = reusablePages.get(input.pageIds[index]);
    if (reused) {
      const reusablePath = resolveLocalArtifactOutput(reused.storageRef);
      if (!reusablePath || !existsSync(reusablePath) || sha256(readFileSync(reusablePath)) !== reused.sha256) {
        throw new Error(`ppt_full_reused_render_invalid:${input.pageIds[index]}`);
      }
      return reused;
    }
    const buffer = readFileSync(renderPath);
    const stored = writeLocalArtifact({ category: "ppt-production-artifacts", fileName: `${runId}-${input.pageIds[index]}.png`, buffer });
    return { pageId: input.pageIds[index], storageRef: stored.localOutput, sha256: sha256(buffer) };
  });
  const contactSheet = await buildPptFullDeckContactSheet(pageRenders, `${runId}-contact-sheet.png`);
  return {
    pptx: { storageRef: storedPptx.localOutput, sha256: sha256(input.pptxBuffer), bytes: input.pptxBuffer.length, slideCount: input.slideCount },
    pdf: { storageRef: storedPdf.localOutput, sha256: sha256(pdfBuffer), bytes: pdfBuffer.length, pageCount: converted.pdfPageCount },
    pageRenders,
    contactSheet: { ...contactSheet, pageIds: [...input.pageIds] },
  };
}

export async function buildPptFullDeckContactSheet(
  pageRenders: Array<{ pageId: string; storageRef: string; sha256: string }>,
  fileName = `${randomUUID()}-contact-sheet.png`,
): Promise<{ storageRef: string; sha256: string }> {
  const renderPaths = pageRenders.map((page) => {
    const resolved = resolveLocalArtifactOutput(page.storageRef);
    if (!resolved || !existsSync(resolved) || sha256(readFileSync(resolved)) !== page.sha256) {
      throw new Error(`ppt_full_contact_render_invalid:${page.pageId}`);
    }
    return resolved;
  });
  const contactBuffer = await buildContactSheet(renderPaths);
  const storedContact = writeLocalArtifact({ category: "ppt-production-artifacts", fileName, buffer: contactBuffer });
  return { storageRef: storedContact.localOutput, sha256: sha256(contactBuffer) };
}

async function convertWithLibreOffice(input: { pptxPath: string; outputDir: string }) {
  await execFileAsync(process.env.LIBREOFFICE_BIN?.trim() || "soffice", ["--headless", "--convert-to", "pdf", "--outdir", input.outputDir, input.pptxPath], { windowsHide: true });
  const pdfPath = path.join(input.outputDir, "full-deck.pdf");
  const { stdout } = await execFileAsync(process.env.PDFINFO_BIN?.trim() || "pdfinfo", [pdfPath], { windowsHide: true });
  const pdfPageCount = Number.parseInt(stdout.match(/^Pages:\s+(\d+)/mi)?.[1] ?? "0", 10);
  const prefix = path.join(input.outputDir, "render");
  await execFileAsync(process.env.PDFTOPPM_BIN?.trim() || "pdftoppm", ["-png", "-r", "144", pdfPath, prefix], { windowsHide: true });
  const renderPaths = readdirSync(input.outputDir)
    .filter((name) => /^render-\d+\.png$/i.test(name))
    .sort((left, right) => numericSuffix(left) - numericSuffix(right))
    .map((name) => path.join(input.outputDir, name));
  return { pdfPath, pdfPageCount, renderPaths };
}

async function buildContactSheet(paths: string[]): Promise<Buffer> {
  const width = 1920;
  const columns = 4;
  const rows = Math.ceil(paths.length / columns);
  const gap = 20;
  const tileWidth = Math.floor((width - gap * (columns + 1)) / columns);
  const tileHeight = Math.round(tileWidth * 9 / 16);
  const height = gap + rows * (tileHeight + gap);
  const composites: sharp.OverlayOptions[] = [];
  for (const [index, imagePath] of paths.entries()) {
    const tile = await sharp(imagePath).resize(tileWidth, tileHeight, { fit: "contain", background: "#FFFFFF" }).png().toBuffer();
    composites.push({ input: tile, left: gap + (index % columns) * (tileWidth + gap), top: gap + Math.floor(index / columns) * (tileHeight + gap) });
  }
  return sharp({ create: { width, height, channels: 4, background: "#E8EDF0" } }).composite(composites).png().toBuffer();
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function numericSuffix(value: string): number {
  return Number.parseInt(value.match(/(\d+)(?=\.png$)/i)?.[1] ?? "0", 10);
}
