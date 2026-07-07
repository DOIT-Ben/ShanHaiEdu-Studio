import { existsSync, readFileSync } from "node:fs";
import pptxgen from "pptxgenjs";
import { resolveLocalArtifactOutput } from "@/server/artifact-storage/local-artifact-storage";

type PptxDownload = {
  filename: string;
  buffer: Buffer;
};

export type PptxDownloadableArtifact = {
  key: string;
  nodeKey?: string;
  kind: string;
  title: string;
  summary: string;
  updatedAt: string;
  sourceTitles: string[];
  previewFields: { label: string; value: string }[];
  content: Record<string, string | string[]>;
};

const pptxMimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export async function buildArtifactPptxDownload(item: PptxDownloadableArtifact): Promise<PptxDownload> {
  if (item.nodeKey !== "ppt_draft" && item.kind !== "ppt_draft") {
    throw new Error("Only PPT outline artifacts can be exported as PPTX.");
  }

  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "ShanHaiEdu Studio";
  pptx.company = "ShanHaiEdu";
  pptx.subject = item.summary;
  pptx.title = item.title;
  pptx.theme = {
    headFontFace: "Microsoft YaHei",
    bodyFontFace: "Microsoft YaHei",
  };

  addTitleSlide(pptx, item);
  addSummarySlide(pptx, item);
  addPreviewFieldsSlide(pptx, item);
  addContentSlides(pptx, item);
  addBoundarySlide(pptx);

  const output = await pptx.write({ outputType: "nodebuffer" });
  return {
    filename: `shanhai-${safeFileSegment(item.key)}-${dateStamp()}.pptx`,
    buffer: Buffer.isBuffer(output) ? output : Buffer.from(output as Uint8Array),
  };
}

export async function buildStoredOrGeneratedArtifactPptxDownload(artifact: {
  id: string;
  nodeKey: string;
  kind: string;
  title: string;
  summary: string;
  markdownContent: string;
  structuredContent: Record<string, unknown>;
  updatedAt: string;
}): Promise<PptxDownload> {
  const stored = readStoredCozePptx(artifact.structuredContent);
  if (stored) {
    return stored;
  }
  return buildArtifactPptxDownload(toPptxDownloadableArtifact(artifact));
}

export function pptxDownloadHeaders(filename: string) {
  return {
    "content-type": pptxMimeType,
    "content-disposition": `attachment; filename="${filename}"`,
  };
}

export function toPptxDownloadableArtifact(artifact: {
  id: string;
  nodeKey: string;
  kind: string;
  title: string;
  summary: string;
  markdownContent: string;
  structuredContent: Record<string, unknown>;
  updatedAt: string;
}): PptxDownloadableArtifact {
  const structuredEntries = Object.entries(artifact.structuredContent ?? {}).filter(([key]) => isTeacherVisibleLabel(key));
  return {
    key: artifact.id,
    nodeKey: artifact.nodeKey,
    kind: artifact.kind,
    title: artifact.title,
    summary: artifact.summary,
    updatedAt: formatDateLabel(artifact.updatedAt),
    sourceTitles: ["公开课教案"],
    previewFields: structuredEntries.length
      ? structuredEntries.slice(0, 3).map(([label, value]) => ({ label, value: Array.isArray(value) ? value.map(String).join("、") : String(value) }))
      : [{ label: "内容来源", value: "当前 PPT 大纲" }],
    content: {
      Markdown: artifact.markdownContent,
      ...Object.fromEntries(structuredEntries.map(([label, value]) => [label, Array.isArray(value) ? value.map(String) : String(value)])),
    },
  };
}

function readStoredCozePptx(structuredContent: Record<string, unknown>): PptxDownload | null {
  const storage = structuredContent.storage;
  if (!storage || typeof storage !== "object" || Array.isArray(storage)) return null;
  const cozePptx = (storage as { cozePptx?: unknown }).cozePptx;
  if (!cozePptx || typeof cozePptx !== "object" || Array.isArray(cozePptx)) return null;

  const metadata = cozePptx as { localOutput?: unknown; fileName?: unknown };
  if (typeof metadata.localOutput !== "string" || typeof metadata.fileName !== "string") return null;

  const absolutePath = resolveLocalArtifactOutput(metadata.localOutput);
  if (!absolutePath) {
    throw new Error("Stored PPTX path is outside the local artifact storage.");
  }
  if (!existsSync(absolutePath)) {
    throw new Error("Stored PPTX file is missing.");
  }

  const buffer = readFileSync(absolutePath);
  if (buffer.subarray(0, 2).toString("ascii") !== "PK") {
    throw new Error("Stored PPTX file is invalid.");
  }

  return {
    filename: safeFileName(metadata.fileName),
    buffer,
  };
}

function safeFileName(value: string) {
  const cleaned = value.replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-").trim();
  return cleaned.toLowerCase().endsWith(".pptx") ? cleaned : `${cleaned || "coze-ppt"}.pptx`;
}

function addTitleSlide(pptx: pptxgen, item: PptxDownloadableArtifact) {
  const slide = pptx.addSlide();
  addSlideTitle(slide, item.title);
  slide.addText(item.summary, {
    x: 0.8,
    y: 2.3,
    w: 11.6,
    h: 0.8,
    fontSize: 18,
    color: "4B5563",
    breakLine: false,
    fit: "shrink",
  });
  slide.addText(`上游来源：${item.sourceTitles.join("、") || "当前项目配置"}`, {
    x: 0.8,
    y: 6.5,
    w: 11.6,
    h: 0.3,
    fontSize: 11,
    color: "6B7280",
  });
}

function addSummarySlide(pptx: pptxgen, item: PptxDownloadableArtifact) {
  const slide = pptx.addSlide();
  addSlideTitle(slide, "PPT 文件说明");
  addBullets(slide, [
    "本文件由当前 PPT 大纲与逐页脚本生成，用于本地备课流转。",
    "当前阶段只保证 PPTX 文件可打开、内容可读、来源可追溯。",
    "图片文件、视频成片和精修视觉设计未在本文件中冒充完成。",
    `更新时间：${item.updatedAt}`,
  ]);
}

function addPreviewFieldsSlide(pptx: pptxgen, item: PptxDownloadableArtifact) {
  const slide = pptx.addSlide();
  addSlideTitle(slide, "关键字段");
  const lines = item.previewFields.length
    ? item.previewFields.map((field) => `${field.label}：${field.value}`)
    : ["当前产物暂未提供关键字段。"];
  addBullets(slide, lines);
}

function addContentSlides(pptx: pptxgen, item: PptxDownloadableArtifact) {
  for (const [title, value] of Object.entries(item.content)) {
    const slide = pptx.addSlide();
    addSlideTitle(slide, title);
    addBullets(slide, normalizeValue(value));
  }
}

function addBoundarySlide(pptx: pptxgen) {
  const slide = pptx.addSlide();
  addSlideTitle(slide, "交付边界");
  addBullets(slide, [
    "这是根据文本大纲生成的最小 PPTX 文件。",
    "正式授课前应由教师核对教材、页码、例题和课堂节奏。",
    "后续图片、视频和视觉精修能力需要单独真实接入后再标记完成。",
  ]);
}

function addSlideTitle(slide: pptxgen.Slide, title: string) {
  slide.background = { color: "FFFFFF" };
  slide.addText(title, {
    x: 0.7,
    y: 0.55,
    w: 11.9,
    h: 0.55,
    fontFace: "Microsoft YaHei",
    fontSize: 25,
    bold: true,
    color: "111827",
    fit: "shrink",
  });
}

function addBullets(slide: pptxgen.Slide, lines: string[]) {
  slide.addText(lines.map((line) => ({ text: line, options: { breakLine: true, bullet: { indent: 16 } } })), {
    x: 0.85,
    y: 1.65,
    w: 11.3,
    h: 5.2,
    fontFace: "Microsoft YaHei",
    fontSize: 15,
    color: "1F2937",
    breakLine: false,
    fit: "shrink",
    valign: "top",
  });
}

function normalizeValue(value: string | string[]) {
  return Array.isArray(value) ? value : [value];
}

function safeFileSegment(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-")
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "ppt"
  );
}

function dateStamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function isTeacherVisibleLabel(label: string) {
  const lower = label.toLowerCase();
  const internalTerms = ["schema", "manifest", "provider", "node_id", "storage", "api", "debug", "local path", "generationmode", "nextsuggestedaction"];
  return !internalTerms.some((term) => lower.includes(term));
}

function formatDateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
