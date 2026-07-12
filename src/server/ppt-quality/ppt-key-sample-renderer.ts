import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { resolveLocalArtifactOutput, writeLocalArtifact } from "@/server/artifact-storage/local-artifact-storage";
import type { PptAssetManifest, PptSampleOverviewKind } from "./ppt-asset-types";

const execFileAsync = promisify(execFile);

export type PptKeySampleRenderEvidence = {
  samplePptx: { storageRef: string; sha256: string };
  pageRenders: Array<{ pageId: string; storageRef: string; sha256: string }>;
  overviews: Array<{
    kind: PptSampleOverviewKind;
    storageRef: string;
    sha256: string;
    pageIds: string[];
  }>;
};

export async function renderPptKeySamples(input: {
  pptxBuffer: Buffer;
  samplePageIds: string[];
  manifest: PptAssetManifest;
  convertPptxToPngs?: (input: { pptxPath: string; outputDir: string }) => Promise<string[]>;
}): Promise<PptKeySampleRenderEvidence> {
  const runId = randomUUID();
  const outputDir = path.join(process.cwd(), ".tmp", "ppt-sample-render", runId);
  mkdirSync(outputDir, { recursive: true });
  const pptxPath = path.join(outputDir, "key-samples.pptx");
  writeFileSync(pptxPath, input.pptxBuffer);
  const renderPaths = await (input.convertPptxToPngs ?? convertWithLibreOffice)({ pptxPath, outputDir });
  if (renderPaths.length !== input.samplePageIds.length) throw new Error("ppt_sample_render_count_mismatch");

  const storedPptx = writeLocalArtifact({ category: "ppt-sample-artifacts", fileName: `${runId}-key-samples.pptx`, buffer: input.pptxBuffer });
  const pageRenders = renderPaths.map((renderPath, index) => {
    const buffer = readFileSync(renderPath);
    const stored = writeLocalArtifact({ category: "ppt-sample-artifacts", fileName: `${runId}-${input.samplePageIds[index]}.png`, buffer });
    return { pageId: input.samplePageIds[index], storageRef: stored.localOutput, sha256: sha256(buffer) };
  });

  const scenePaths = resolveManifestPaths(input.manifest, "AI_SCENE");
  const assetPaths = resolveManifestPaths(input.manifest, "AI_ASSET");
  const overviewInputs: Array<{ kind: PptSampleOverviewKind; paths: string[]; background: string }> = [
    { kind: "scene_and_primary_props", paths: scenePaths, background: "#F4F7F8" },
    { kind: "micro_assets", paths: assetPaths, background: "#E8EDF0" },
    { kind: "assembled_samples", paths: renderPaths, background: "#FFFFFF" },
  ];
  const overviews = [] as PptKeySampleRenderEvidence["overviews"];
  for (const overview of overviewInputs) {
    const buffer = await buildContactSheet(overview.paths, overview.background);
    const stored = writeLocalArtifact({ category: "ppt-sample-artifacts", fileName: `${runId}-${overview.kind}.png`, buffer });
    overviews.push({
      kind: overview.kind,
      storageRef: stored.localOutput,
      sha256: sha256(buffer),
      pageIds: [...input.samplePageIds],
    });
  }
  return {
    samplePptx: { storageRef: storedPptx.localOutput, sha256: sha256(input.pptxBuffer) },
    pageRenders,
    overviews,
  };
}

async function convertWithLibreOffice(input: { pptxPath: string; outputDir: string }): Promise<string[]> {
  await execFileAsync(process.env.LIBREOFFICE_BIN?.trim() || "soffice", ["--headless", "--convert-to", "pdf", "--outdir", input.outputDir, input.pptxPath], { windowsHide: true });
  const pdfPath = path.join(input.outputDir, "key-samples.pdf");
  const renderPrefix = path.join(input.outputDir, "render");
  await execFileAsync(process.env.PDFTOPPM_BIN?.trim() || "pdftoppm", ["-png", "-r", "144", pdfPath, renderPrefix], { windowsHide: true });
  return readdirSync(input.outputDir)
    .filter((name) => /^render-\d+\.png$/i.test(name))
    .sort((left, right) => numericSuffix(left) - numericSuffix(right))
    .map((name) => path.join(input.outputDir, name));
}

function resolveManifestPaths(manifest: PptAssetManifest, assetKind: "AI_SCENE" | "AI_ASSET"): string[] {
  return manifest.entries
    .filter((entry) => entry.assetKind === assetKind)
    .map((entry) => resolveLocalArtifactOutput(entry.storageRef))
    .filter((entry): entry is string => Boolean(entry));
}

async function buildContactSheet(imagePaths: string[], background: string): Promise<Buffer> {
  if (imagePaths.length === 0) throw new Error("ppt_sample_overview_source_missing");
  const width = 1600;
  const height = 900;
  const columns = Math.min(3, imagePaths.length);
  const rows = Math.ceil(imagePaths.length / columns);
  const gap = 32;
  const tileWidth = Math.floor((width - gap * (columns + 1)) / columns);
  const tileHeight = Math.floor((height - gap * (rows + 1)) / rows);
  const composites = [] as sharp.OverlayOptions[];
  for (const [index, imagePath] of imagePaths.entries()) {
    const tile = await sharp(imagePath)
      .resize(tileWidth, tileHeight, { fit: "contain", background })
      .png()
      .toBuffer();
    composites.push({
      input: tile,
      left: gap + (index % columns) * (tileWidth + gap),
      top: gap + Math.floor(index / columns) * (tileHeight + gap),
    });
  }
  return sharp({ create: { width, height, channels: 4, background } }).composite(composites).png().toBuffer();
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function numericSuffix(value: string): number {
  return Number.parseInt(value.match(/(\d+)(?=\.png$)/i)?.[1] ?? "0", 10);
}
