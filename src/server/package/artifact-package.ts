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
  image?: PackagePart | null;
  video?: PackagePart | null;
}): Promise<MaterialPackageDownload> {
  if (input.finalDelivery.nodeKey !== "final_delivery" && input.finalDelivery.kind !== "final_delivery") {
    throw new Error("Only final delivery artifacts can be exported as material packages.");
  }

  if (!input.pptx?.buffer?.length) {
    throw new Error("PPTX file is required before exporting the material package.");
  }
  if (!input.image?.buffer?.length) {
    throw new Error("Classroom visual image is required before exporting the material package.");
  }
  if (!input.video?.buffer?.length) {
    throw new Error("Intro video file is required before exporting the material package.");
  }
  const image = input.image;
  const video = input.video;

  const zip = new JSZip();
  zip.file("README.md", buildReadme(input.finalDelivery));
  zip.file("final-delivery.md", buildFinalDeliveryMarkdown(input.finalDelivery));
  zip.file("manifest.json", JSON.stringify(buildManifest({ pptx: input.pptx, image, video }), null, 2));
  zip.file("ppt-outline.pptx", input.pptx.buffer);
  zip.file(imagePackageFilename(image), image.buffer);
  zip.file("intro-video.mp4", video.buffer);

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

function buildReadme(finalDelivery: MaterialPackageArtifact) {
  return [
    "# ShanHaiEdu 最终材料包",
    "",
    "本材料包包含最终交付清单、真实 PPTX 文件、课堂视觉图、导入视频文件。",
    "",
    "## 已包含",
    "",
    "- final-delivery.md：最终交付清单正文。",
    "- manifest.json：材料包清单、必需资产和文件名 metadata。",
    "- ppt-outline.pptx：真实生成并通过 PPTX 结构校验的课件文件。",
    "- classroom-visual.png / classroom-visual.jpg：基于课堂视觉需求生成的本地课堂视觉图。",
    "- intro-video.mp4：基于导入视频方案生成的本地导入视频文件。",
    "",
    "## 仍需教师核对",
    "",
    "- 当前 PPTX 已通过文件结构校验；正式授课前仍需教师核对内容与节奏。",
    "- 已包含课堂视觉图；正式授课前请核对视觉准确性、版权和课堂适配。",
    "- 已包含导入视频文件；正式授课前请核对视频质量、节奏和课堂锚点。",
    "- 正式授课前请核对教材、页码、例题、页面顺序和课堂节奏。",
    "",
    `来源：${finalDelivery.title}`,
    `更新时间：${formatDateLabel(finalDelivery.updatedAt)}`,
    "",
  ].join("\n");
}

function buildManifest(input: { pptx: PackagePart; image: PackagePart; video: PackagePart }) {
  return {
    packageType: "shanhai-final-materials",
    requiredAssets: ["pptx", "image", "video"],
    assets: {
      pptx: { filename: "ppt-outline.pptx", bytes: input.pptx.buffer.length },
      image: { filename: imagePackageFilename(input.image), bytes: input.image.buffer.length },
      video: { filename: "intro-video.mp4", bytes: input.video.buffer.length },
    },
  };
}

function buildFinalDeliveryMarkdown(finalDelivery: MaterialPackageArtifact) {
  const body = finalDelivery.markdownContent.trim() || `# ${finalDelivery.title}\n\n${finalDelivery.summary}`;
  return `${body}\n`;
}

function imagePackageFilename(image: PackagePart) {
  const lower = image.filename.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "classroom-visual.jpg";
  }
  return "classroom-visual.png";
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
