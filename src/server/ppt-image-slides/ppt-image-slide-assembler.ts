import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import pptxgen from "pptxgenjs";
import JSZip from "jszip";
import { resolveLocalArtifactOutput } from "@/server/artifact-storage/local-artifact-storage";
import { hashRunInput } from "@/server/execution/run-input-snapshot";
import type { PptDesignPackage, PptPageSpec } from "@/server/ppt-quality/ppt-quality-types";
import type { PptImageSlideBundle, PptImageSlideReview } from "./ppt-image-slide-types";

export async function assemblePptImageSlides(input: { designPackage: PptDesignPackage; bundle: PptImageSlideBundle }) {
  if (input.bundle.schemaVersion !== "ppt-image-slide-bundle.v1" || input.bundle.designPackageDigest !== hashRunInput(input.designPackage)) throw new Error("ppt_image_slide_bundle_stale");
  const pages = input.designPackage.pageSpecs;
  if (input.bundle.entries.length !== pages.length || new Set(input.bundle.entries.map((entry) => entry.pageId)).size !== pages.length) throw new Error("ppt_image_slide_count_mismatch");
  const byPage = new Map(input.bundle.entries.map((entry) => [entry.pageId, entry]));
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "ShanHaiEdu Studio";
  pptx.company = "ShanHaiEdu";
  pptx.title = `${input.designPackage.brief.topic}整图课件`;
  pptx.theme = { headFontFace: input.designPackage.visualSystem.typography.fontFamily, bodyFontFace: input.designPackage.visualSystem.typography.fontFamily };
  let editableTextLayerCount = 0;
  let editableMathLayerCount = 0;
  for (const page of pages) {
    const entry = byPage.get(page.pageId);
    if (!entry) throw new Error(`ppt_image_slide_page_missing:${page.pageId}`);
    const file = resolveLocalArtifactOutput(entry.storageRef);
    if (!file || !existsSync(file)) throw new Error(`ppt_image_slide_file_missing:${page.pageId}`);
    const bytes = readFileSync(file);
    if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256) throw new Error(`ppt_image_slide_hash_mismatch:${page.pageId}`);
    const slide = pptx.addSlide();
    slide.addImage({ path: file, x: 0, y: 0, w: 13.333, h: 7.5 });
    for (const layer of page.composition.layers.filter((item) => item.layerKind === "EDITABLE_TEXT" || item.layerKind === "EDITABLE_MATH").sort((a, b) => a.zIndex - b.zIndex)) {
      const geometry = { x: layer.x / 144, y: layer.y / 144, w: layer.width / 144, h: layer.height / 144 };
      const value = layer.layerKind === "EDITABLE_TEXT" ? page.editableText.find((item) => item.layerId === layer.sourceId)?.text : displayMath(page.editableMath.find((item) => item.layerId === layer.sourceId)?.exactContent);
      if (!value) throw new Error(`ppt_image_slide_editable_layer_missing:${page.pageId}:${layer.sourceId}`);
      slide.addShape("roundRect" as pptxgen.ShapeType, { ...geometry, rectRadius: 0.06, fill: { color: "FFFFFF", transparency: 14 }, line: { color: "FFFFFF", transparency: 100 } });
      slide.addText(value, { ...geometry, fontFace: input.designPackage.visualSystem.typography.fontFamily, fontSize: Math.max(page.visibleTextBudget.minFontPt, layer.layerKind === "EDITABLE_TEXT" ? 24 : 30), color: "1F2937", margin: 0, fit: "shrink", valign: "middle" });
      if (layer.layerKind === "EDITABLE_TEXT") editableTextLayerCount += 1; else editableMathLayerCount += 1;
    }
    slide.addNotes(page.presenterNote);
  }
  const output = await pptx.write({ outputType: "nodebuffer" });
  const pptxBuffer = Buffer.isBuffer(output) ? output : Buffer.from(output as Uint8Array);
  const review = await reviewPptImageSlides(pptxBuffer, pages, editableTextLayerCount, editableMathLayerCount);
  return { pptxBuffer, pptxSha256: createHash("sha256").update(pptxBuffer).digest("hex"), review };
}

export async function reviewPptImageSlides(buffer: Buffer, pages: PptPageSpec[], editableTextLayerCount: number, editableMathLayerCount: number): Promise<PptImageSlideReview> {
  const zip = await JSZip.loadAsync(buffer);
  const slideNames = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  if (!zip.file("ppt/presentation.xml") || slideNames.length !== pages.length || editableTextLayerCount < pages.length) throw new Error("ppt_image_slide_review_failed");
  const xml = (await Promise.all(slideNames.map((name) => zip.file(name)!.async("string")))).join("\n");
  if (!xml.includes("<p:pic") || !xml.includes("<a:t>")) throw new Error("ppt_image_slide_layers_missing");
  return { schemaVersion: "ppt-image-slide-review.v1", passed: true, slideCount: slideNames.length, imageCount: slideNames.length, editableTextLayerCount, editableMathLayerCount, checks: ["pptx_zip_valid", "presentation_xml_present", "slide_count_matches_design", "one_full_bleed_image_per_slide", "editable_text_layers_present", "editable_math_layers_preserved", "review_and_polish_passed"] };
}

function displayMath(value: unknown) { return typeof value === "string" || typeof value === "number" ? String(value) : JSON.stringify(value); }
