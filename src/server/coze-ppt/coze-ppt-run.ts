import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { writeLocalArtifact } from "@/server/artifact-storage/local-artifact-storage";
import type { ArtifactRecord, ProjectRecord } from "@/server/workbench/types";

export type CozePptGenerationResult = {
  fileName: string;
  localOutput: string;
  bytes: number;
  sha256: string;
  pptxValid: true;
  hasPresentationXml: true;
};

type CozePptConfig = {
  runUrl: string;
  token: string;
  timeoutMs: number;
  deadlineSeconds: number;
};

export async function generateCozePptFromArtifact(input: {
  project: ProjectRecord;
  artifact: ArtifactRecord;
}): Promise<CozePptGenerationResult> {
  const config = readConfig(process.env);
  const response = await fetch(config.runUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      "x-deadline-sec": String(config.deadlineSeconds),
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: buildPrompt(input.project, input.artifact) }],
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  if (!response.ok) {
    throw new Error("coze_ppt_request_failed");
  }

  const payload = await response.json();
  const result = extractCozePptResult(payload);
  const pptxBuffer = await downloadPptx(result.pptxUrl, config.timeoutMs);
  const validation = await validatePptxBuffer(pptxBuffer);
  if (!validation.valid) {
    throw new Error("invalid_coze_pptx");
  }

  const outputName = `${input.project.id}-${Date.now()}-${result.fileName}`;
  const stored = writeLocalArtifact({
    category: "coze-ppt-artifacts",
    fileName: outputName,
    buffer: pptxBuffer,
  });

  return {
    fileName: result.fileName,
    localOutput: stored.localOutput,
    bytes: pptxBuffer.length,
    sha256: createHash("sha256").update(pptxBuffer).digest("hex"),
    pptxValid: true,
    hasPresentationXml: true,
  };
}

export function extractCozePptResult(payload: unknown) {
  const content = findLastContent(payload);
  const parsed = parsePossibleFencedJson(content);
  const pptxUrl = parsed.pptx_url || parsed.pptxUrl || parsed.download_url || parsed.downloadUrl;
  if (!pptxUrl || typeof pptxUrl !== "string") {
    throw new Error("missing_pptx_url");
  }

  return {
    status: typeof parsed.status === "string" ? parsed.status : "unknown",
    pptxUrl,
    fileName: sanitizePptxFileName(parsed.file_name || parsed.fileName || "coze-ppt-artifact.pptx"),
  };
}

export async function validatePptxBuffer(buffer: Buffer) {
  const hasZipHeader = buffer.subarray(0, 2).toString("ascii") === "PK";
  if (!hasZipHeader) {
    return { valid: false, hasZipHeader, hasPresentationXml: false };
  }

  try {
    const zip = await JSZip.loadAsync(buffer);
    const hasPresentationXml = Boolean(zip.file("ppt/presentation.xml"));
    return { valid: hasPresentationXml, hasZipHeader, hasPresentationXml };
  } catch {
    return { valid: false, hasZipHeader, hasPresentationXml: false };
  }
}

function readConfig(env: NodeJS.ProcessEnv): CozePptConfig {
  const runUrl = env.COZE_PPT_RUN_URL?.trim();
  const token = env.COZE_API_TOKEN?.trim();
  if (!runUrl || !token) {
    throw new Error("missing_COZE_PPT_RUN_ENV");
  }

  return {
    runUrl,
    token,
    timeoutMs: Number.parseInt(env.COZE_PPT_SMOKE_TIMEOUT_MS || "360000", 10),
    deadlineSeconds: Number.parseInt(env.COZE_PPT_DEADLINE_SECONDS || "300", 10),
  };
}

function buildPrompt(project: ProjectRecord, artifact: ArtifactRecord) {
  const promptTemplate = safeReadText(path.join(process.cwd(), "fixtures", "ppt", "template-a1-original-visual-strategy.md")).slice(0, 1600);
  const manifest = readFixtureManifest();
  const textbook = manifest.fixtures.find((fixture) => fixture.id === "sujiao-grade6-percentage-textbook");

  return [
    "请基于 ShanHaiEdu 本地真实 MVP 的项目产物，生成一份小学数学 PPTX。",
    `课题：${project.lessonTopic || "百分数导入课"}`,
    `年级：${project.grade || "六年级"}`,
    `学科：${project.subject || "数学"}`,
    "页数：1 页。",
    "要求：纯白背景、完全原创视觉策略、避免堆字、只给一个核心视觉和一句课堂问题。",
    `教材样本：${textbook?.id ?? "sujiao-grade6-percentage-textbook"}，sha256=${textbook?.sha256 ?? "unknown"}。`,
    "请返回 JSON，字段必须包含 status、pptx_url、file_name。",
    "不要返回解释文字，不要返回 Markdown 正文。",
    "当前 PPT 大纲：",
    artifact.markdownContent,
    "提示词模板节选：",
    promptTemplate,
  ].join("\n");
}

function readFixtureManifest(): { fixtures: Array<{ id: string; sha256?: string }> } {
  return JSON.parse(safeReadText(path.join(process.cwd(), "fixtures", "ppt-sample-manifest.json")));
}

function safeReadText(filePath: string) {
  return readFileSync(filePath, "utf8");
}

function findLastContent(payload: unknown): string {
  const value = payload as {
    messages?: Array<{ content?: unknown }>;
    data?: unknown;
    content?: unknown;
    output?: unknown;
  };
  const data = value?.data as { messages?: Array<{ content?: unknown }> } | Array<{ content?: unknown }> | undefined;
  const messages = Array.isArray(value?.messages)
    ? value.messages
    : Array.isArray(data)
      ? data
      : Array.isArray(data?.messages)
        ? data.messages
        : [];

  for (const message of [...messages].reverse()) {
    if (typeof message?.content === "string" && message.content.trim()) {
      return message.content;
    }
  }

  if (typeof value?.content === "string") return value.content;
  if (typeof value?.output === "string") return value.output;
  throw new Error("missing_coze_answer_content");
}

function parsePossibleFencedJson(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const jsonText = fenced ? fenced[1].trim() : trimmed;
  const parsed = JSON.parse(jsonText) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid_coze_answer_json");
  }
  return parsed as Record<string, unknown>;
}

function sanitizePptxFileName(fileName: unknown) {
  const cleaned = String(fileName).replace(/[\\/:*?"<>|]+/g, "-").trim();
  const withExtension = cleaned.toLowerCase().endsWith(".pptx") ? cleaned : `${cleaned}.pptx`;
  return withExtension || "coze-ppt-artifact.pptx";
}

async function downloadPptx(url: string, timeoutMs: number) {
  const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new Error("coze_ppt_download_failed");
  }
  return Buffer.from(await response.arrayBuffer());
}
