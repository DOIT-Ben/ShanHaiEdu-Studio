import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import pptxgen from "pptxgenjs";
import { resolveLocalArtifactOutput } from "@/server/artifact-storage/local-artifact-storage";
import type { PptDesignPackage, PptPageSpec } from "./ppt-quality-types";
import type { PptAssetManifest, PptAssetRequestBatch } from "./ppt-asset-types";
import { validatePptAssetManifest } from "./ppt-asset-validator";

export type PptKeySampleCompositionResult = {
  pptxBuffer: Buffer;
  pptxSha256: string;
  pageEvidence: Array<{
    pageId: string;
    assetIds: string[];
    editableTextLayerIds: string[];
    editableMathLayerIds: string[];
    rasterizedExactContent: false;
  }>;
};

export type PptDeckCompositionResult = PptKeySampleCompositionResult;

export async function composePptKeySamplePptx(input: {
  designPackage: PptDesignPackage;
  requestBatch: PptAssetRequestBatch;
  manifest: PptAssetManifest;
}): Promise<PptKeySampleCompositionResult> {
  return composePptDeckPptx({ ...input, pageIds: input.designPackage.samplePlan.samplePageIds, titleSuffix: "关键样张" });
}

export async function composePptDeckPptx(input: {
  designPackage: PptDesignPackage;
  requestBatch: PptAssetRequestBatch;
  manifest: PptAssetManifest;
  pageIds: string[];
  titleSuffix?: string;
}): Promise<PptDeckCompositionResult> {
  const validation = validatePptAssetManifest(input.manifest, input.requestBatch);
  if (!validation.valid) throw new Error(`ppt_sample_manifest_invalid:${validation.issues.map((item) => item.code).join(",")}`);

  const manifestById = new Map(input.manifest.entries.map((entry) => [entry.assetId, entry]));
  const pagesById = new Map(input.designPackage.pageSpecs.map((page) => [page.pageId, page]));
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "ShanHaiEdu Studio";
  pptx.company = "ShanHaiEdu";
  pptx.subject = "PPT 关键样张";
  pptx.title = `${input.designPackage.brief.topic}${input.titleSuffix ?? "课堂课件"}`;
  pptx.theme = { headFontFace: input.designPackage.visualSystem.typography.fontFamily, bodyFontFace: input.designPackage.visualSystem.typography.fontFamily };
  const pageEvidence: PptKeySampleCompositionResult["pageEvidence"] = [];

  for (const pageId of input.pageIds) {
    const page = pagesById.get(pageId);
    if (!page) throw new Error(`ppt_sample_page_missing:${pageId}`);
    const slide = pptx.addSlide();
    const evidence = composePage(slide, page, manifestById, input.designPackage.visualSystem.typography.fontFamily);
    slide.addNotes(page.presenterNote);
    pageEvidence.push(evidence);
  }

  const output = await pptx.write({ outputType: "nodebuffer" });
  const pptxBuffer = Buffer.isBuffer(output) ? output : Buffer.from(output as Uint8Array);
  return {
    pptxBuffer,
    pptxSha256: createHash("sha256").update(pptxBuffer).digest("hex"),
    pageEvidence,
  };
}

function composePage(
  slide: pptxgen.Slide,
  page: PptPageSpec,
  manifestById: Map<string, PptAssetManifest["entries"][number]>,
  fontFace: string,
): PptKeySampleCompositionResult["pageEvidence"][number] {
  const assetIds: string[] = [];
  const editableTextLayerIds: string[] = [];
  const editableMathLayerIds: string[] = [];
  const textById = new Map(page.editableText.map((layer) => [layer.layerId, layer.text]));
  const textRoleById = new Map(page.editableText.map((layer) => [layer.layerId, layer.role]));
  const mathById = new Map(page.editableMath.map((layer) => [layer.layerId, layer.exactContent]));

  for (const layer of [...page.composition.layers].sort((left, right) => left.zIndex - right.zIndex)) {
    const geometry = toSlideGeometry(layer);
    if (layer.layerKind === "AI_SCENE" || layer.layerKind === "AI_ASSET") {
      const entry = manifestById.get(layer.sourceId);
      if (!entry || !entry.pageIds.includes(page.pageId)) throw new Error(`ppt_sample_asset_unbound:${page.pageId}:${layer.sourceId}`);
      const resolved = resolveLocalArtifactOutput(entry.storageRef);
      if (!resolved || !existsSync(resolved)) throw new Error(`ppt_sample_asset_file_missing:${layer.sourceId}`);
      slide.addImage({ path: resolved, ...geometry });
      assetIds.push(layer.sourceId);
      continue;
    }

    const content = layer.layerKind === "EDITABLE_TEXT" ? textById.get(layer.sourceId) : mathById.get(layer.sourceId);
    if (content === undefined) throw new Error(`ppt_sample_editable_layer_missing:${page.pageId}:${layer.sourceId}`);
    if (layer.layerKind === "EDITABLE_MATH" && isHundredGrid(content)) {
      addHundredGrid(slide, geometry, content, fontFace);
      editableMathLayerIds.push(layer.sourceId);
      continue;
    }
    const text = layer.layerKind === "EDITABLE_TEXT" ? content as string : displayMath(content);
    const role = textRoleById.get(layer.sourceId);
    slide.addText(text, {
      ...geometry,
      fontFace,
      fontSize: layer.layerKind === "EDITABLE_TEXT"
        ? role === "takeaway_title"
          ? Math.max(page.visibleTextBudget.minFontPt, 35)
          : Math.max(page.visibleTextBudget.minFontPt, 24)
        : Math.max(page.visibleTextBudget.minFontPt, 30),
      color: "1F2937",
      margin: 0,
      valign: "middle",
      align: layer.layerKind === "EDITABLE_MATH" ? "center" : "left",
      fit: "shrink",
      breakLine: false,
    });
    if (layer.layerKind === "EDITABLE_TEXT") editableTextLayerIds.push(layer.sourceId);
    else editableMathLayerIds.push(layer.sourceId);
  }

  return {
    pageId: page.pageId,
    assetIds: [...new Set(assetIds)],
    editableTextLayerIds: [...new Set(editableTextLayerIds)],
    editableMathLayerIds: [...new Set(editableMathLayerIds)],
    rasterizedExactContent: false,
  };
}

function toSlideGeometry(layer: PptPageSpec["composition"]["layers"][number]) {
  return {
    x: layer.x / 144,
    y: layer.y / 144,
    w: layer.width / 144,
    h: layer.height / 144,
  };
}

function displayMath(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return JSON.stringify(value);
}

type HundredGridContent = {
  type: "hundred_grid";
  highlightedCells: number;
  label: string;
};

function isHundredGrid(value: unknown): value is HundredGridContent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<HundredGridContent>;
  return item.type === "hundred_grid" && typeof item.highlightedCells === "number" && Number.isInteger(item.highlightedCells) && item.highlightedCells >= 0 && item.highlightedCells <= 100 && typeof item.label === "string";
}

function addHundredGrid(
  slide: pptxgen.Slide,
  geometry: { x: number; y: number; w: number; h: number },
  content: HundredGridContent,
  fontFace: string,
): void {
  const gridSize = Math.min(geometry.w, Math.max(0.5, geometry.h - 0.42));
  const cell = gridSize / 10;
  for (let index = 0; index < 100; index += 1) {
    const row = Math.floor(index / 10);
    const column = index % 10;
    slide.addShape("rect" as pptxgen.ShapeType, {
      x: geometry.x + column * cell,
      y: geometry.y + row * cell,
      w: cell - 0.01,
      h: cell - 0.01,
      fill: { color: index < content.highlightedCells ? "F2C14E" : "FFFFFF" },
      line: { color: "147D92", transparency: 30, width: 0.35 },
    });
  }
  slide.addText(content.label, {
    x: geometry.x + gridSize + 0.22,
    y: geometry.y + Math.max(0, (gridSize - 0.42) / 2),
    w: Math.max(0.8, geometry.w - gridSize - 0.22),
    h: 0.42,
    fontFace,
    fontSize: 30,
    color: "1F2937",
    margin: 0,
    valign: "middle",
    fit: "shrink",
  });
}
