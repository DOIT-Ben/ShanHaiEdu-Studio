import JSZip from "jszip";

type MaterialPackageDownload = {
  filename: string;
  buffer: Buffer;
};

type MaterialPackageArtifact = {
  id?: string;
  key?: string;
  nodeKey?: string;
  kind: string;
  title: string;
  summary: string;
  markdownContent: string;
  updatedAt: string;
};

type PackagePart = {
  filename: string;
  buffer: Buffer;
};

const zipMimeType = "application/zip";

export async function buildFinalMaterialPackageDownload(input: {
  finalDelivery: MaterialPackageArtifact;
  pptx: PackagePart;
  video?: PackagePart | null;
}): Promise<MaterialPackageDownload> {
  if (input.finalDelivery.nodeKey !== "final_delivery" && input.finalDelivery.kind !== "final_delivery") {
    throw new Error("Only final delivery artifacts can be exported as material packages.");
  }

  if (!input.pptx?.buffer?.length) {
    throw new Error("PPTX file is required before exporting the material package.");
  }

  const zip = new JSZip();
  zip.file("README.md", buildReadme(input.finalDelivery, Boolean(input.video?.buffer?.length)));
  zip.file("final-delivery.md", buildFinalDeliveryMarkdown(input.finalDelivery));
  zip.file("ppt-outline.pptx", input.pptx.buffer);
  if (input.video?.buffer?.length) {
    zip.file("intro-video.mp4", input.video.buffer);
  }

  const output = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  return {
    filename: `shanhai-${safeFileSegment(input.finalDelivery.id ?? input.finalDelivery.key ?? "final-delivery")}-${dateStamp()}.zip`,
    buffer: Buffer.isBuffer(output) ? output : Buffer.from(output),
  };
}

export function materialPackageDownloadHeaders(filename: string) {
  return {
    "content-type": zipMimeType,
    "content-disposition": `attachment; filename="${filename}"`,
  };
}

function buildReadme(finalDelivery: MaterialPackageArtifact, hasVideo: boolean) {
  return [
    "# ShanHaiEdu 最终材料包",
    "",
    hasVideo ? "本材料包包含最终交付清单、最小 PPTX 文件和导入视频文件。" : "本材料包包含最终交付清单和最小 PPTX 文件。",
    "",
    "## 已包含",
    "",
    "- final-delivery.md：最终交付清单正文。",
    "- ppt-outline.pptx：根据 PPT 大纲与逐页脚本生成的最小 PPTX 文件。",
    ...(hasVideo ? ["- intro-video.mp4：基于导入视频方案生成的本地导入视频文件。"] : []),
    "",
    "## 仍需教师核对",
    "",
    "- 当前 PPTX 只保证根据文本大纲生成可打开、可阅读的最小文件。",
    hasVideo ? "- 已包含导入视频文件；正式授课前请核对视频质量、节奏和课堂锚点。" : "- 图片文件、视频成片、动画和视觉精修仍待生成或完善。",
    "- 正式授课前请核对教材、页码、例题、页面顺序和课堂节奏。",
    "",
    `来源：${finalDelivery.title}`,
    `更新时间：${formatDateLabel(finalDelivery.updatedAt)}`,
    "",
  ].join("\n");
}

function buildFinalDeliveryMarkdown(finalDelivery: MaterialPackageArtifact) {
  const body = finalDelivery.markdownContent.trim() || `# ${finalDelivery.title}\n\n${finalDelivery.summary}`;
  return `${body}\n`;
}

function safeFileSegment(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-")
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "final-delivery"
  );
}

function dateStamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function formatDateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
