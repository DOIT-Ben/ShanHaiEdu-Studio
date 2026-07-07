import type { ArtifactItem } from "@/lib/types";

type MarkdownDownload = {
  filename: string;
  markdown: string;
};

type DownloadableArtifact = Pick<ArtifactItem, "key" | "title" | "summary" | "updatedAt" | "sourceTitles" | "previewFields" | "content">;

export function buildArtifactMarkdownDownload(item: DownloadableArtifact): MarkdownDownload {
  const filename = `shanhai-${safeFileSegment(item.key)}-${dateStamp()}.md`;
  const sections = [
    `# ${item.title}`,
    item.summary,
    buildPreviewFields(item),
    buildContent(item),
    buildSourceSection(item),
  ].filter(Boolean);

  return {
    filename,
    markdown: `${sections.join("\n\n")}\n`,
  };
}

function buildPreviewFields(item: DownloadableArtifact) {
  if (item.previewFields.length === 0) return "";
  const lines = item.previewFields.map((field) => `- ${field.label}：${field.value}`);
  return ["## 关键字段", ...lines].join("\n");
}

function buildContent(item: DownloadableArtifact) {
  const entries = Object.entries(item.content);
  if (entries.length === 0) return "";

  const blocks = entries.map(([title, value]) => {
    const body = Array.isArray(value) ? value.map((entry) => `- ${entry}`).join("\n") : value;
    return `### ${title}\n\n${body}`;
  });

  return ["## 正文", ...blocks].join("\n\n");
}

function buildSourceSection(item: DownloadableArtifact) {
  const sources = item.sourceTitles.join("、") || "当前项目配置";
  return ["## 上游来源", sources, `更新时间：${item.updatedAt}`].join("\n\n");
}

function safeFileSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "artifact";
}

function dateStamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}
