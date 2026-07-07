import { NextResponse } from "next/server";
import { buildArtifactPptxDownload, pptxDownloadHeaders } from "@/server/pptx/artifact-pptx";
import { createWorkbenchService } from "@/server/workbench/service";
import type { ArtifactRecord } from "@/server/workbench/types";

const service = createWorkbenchService();

type RouteContext = {
  params: Promise<{ projectId: string; artifactId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { projectId, artifactId } = await context.params;
    const artifact = await service.getArtifact(projectId, artifactId);
    const download = await buildArtifactPptxDownload(toPptxItem(artifact));
    return new Response(toArrayBuffer(download.buffer), {
      status: 200,
      headers: pptxDownloadHeaders(download.filename),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "PPTX download failed";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: "这个 PPT 文件暂时没有生成成功，请稍后再试。" }, { status });
  }
}

function toPptxItem(artifact: ArtifactRecord) {
  const structuredEntries = Object.entries(artifact.structuredContent ?? {}).filter(([key]) => isTeacherVisibleLabel(key));
  return {
    key: artifact.id,
    artifactId: artifact.id,
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

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);
  return arrayBuffer;
}
