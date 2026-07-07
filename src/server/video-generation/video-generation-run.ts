import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ArtifactRecord, ProjectRecord } from "@/server/workbench/types";

export type VideoGenerationResult = {
  fileName: string;
  localOutput: string;
  bytes: number;
  sha256: string;
  videoValid: true;
  mime: "video/mp4";
};

type VideoProviderConfig = {
  channel: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  size: string;
  timeoutMs: number;
  pollIntervalMs: number;
  maxPolls: number;
};

const outputRoot = path.resolve(process.cwd(), ".tmp", "video-artifacts");

export async function generateVideoFromArtifact(input: {
  project: ProjectRecord;
  artifact: ArtifactRecord;
}): Promise<VideoGenerationResult> {
  const config = readConfig(process.env);
  const submitPayload = await submitVideoTask(config, input);
  const taskId = extractTaskId(submitPayload);
  const completedPayload = await pollVideoTask(config, taskId);
  const videoUrl = extractVideoResultUrl(completedPayload);
  const videoBuffer = await downloadVideo(videoUrl, config.timeoutMs);
  const validation = validateMp4Buffer(videoBuffer);
  if (!validation.valid) {
    throw new Error("invalid_video_output");
  }

  mkdirSync(outputRoot, { recursive: true });
  const fileName = `${sanitizeFileSegment(input.project.id)}-${Date.now()}-intro-video.mp4`;
  const outputPath = path.join(outputRoot, fileName);
  writeFileSync(outputPath, videoBuffer);

  return {
    fileName,
    localOutput: path.relative(process.cwd(), outputPath).replaceAll("\\", "/"),
    bytes: videoBuffer.length,
    sha256: createHash("sha256").update(videoBuffer).digest("hex"),
    videoValid: true,
    mime: "video/mp4",
  };
}

export function buildVideoEndpointUrl(baseUrl: string) {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (/\/v1\/videos$/i.test(normalized)) {
    return normalized;
  }
  if (/\/v1$/i.test(normalized)) {
    return `${normalized}/videos`;
  }
  return `${normalized}/v1/videos`;
}

export function buildVideoQueryUrl(baseUrl: string, taskId: string) {
  return `${buildVideoEndpointUrl(baseUrl)}/${encodeURIComponent(taskId)}`;
}

function readConfig(env: NodeJS.ProcessEnv): VideoProviderConfig {
  const apiKey = env.OCTO_API_KEY?.trim() || env.NEWAPI_API_KEY?.trim();
  const baseUrl = env.OCTO_BASE_URL?.trim() || env.NEWAPI_BASE_URL?.trim();
  if (!apiKey || !baseUrl) {
    throw new Error("missing_VIDEO_PROVIDER_ENV");
  }

  return {
    channel: env.OCTO_VIDEO_PROVIDER?.trim() || env.VIDEO_PROVIDER_MODE?.trim() || "octo",
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    model: env.VIDEO_MODEL?.trim() || env.OMNI_DEFAULT_MODEL?.trim() || env.NEWAPI_DEFAULT_MODEL?.trim() || "omni_flash-10s",
    size: env.OMNI_DEFAULT_SIZE?.trim() || env.NEWAPI_DEFAULT_SIZE?.trim() || "1280x720",
    timeoutMs: Number.parseInt(env.VIDEO_SMOKE_TIMEOUT_MS || "600000", 10),
    pollIntervalMs: Number.parseInt(env.VIDEO_SMOKE_POLL_INTERVAL_MS || "5000", 10),
    maxPolls: Number.parseInt(env.VIDEO_SMOKE_MAX_POLLS || "72", 10),
  };
}

async function submitVideoTask(
  config: VideoProviderConfig,
  input: { project: ProjectRecord; artifact: ArtifactRecord },
) {
  const response = await fetch(buildVideoEndpointUrl(config.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      prompt: buildPrompt(input.project, input.artifact),
      size: config.size,
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  if (!response.ok) {
    throw new Error("video_submit_failed");
  }
  return response.json();
}

async function pollVideoTask(config: VideoProviderConfig, taskId: string) {
  let lastStatus = "unknown";
  for (let attempt = 0; attempt < config.maxPolls; attempt += 1) {
    const response = await fetch(buildVideoQueryUrl(config.baseUrl, taskId), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(config.timeoutMs),
    });

    if (!response.ok) {
      throw new Error("video_query_failed");
    }

    const payload = await response.json();
    lastStatus = normalizeVideoStatus(readStatus(payload));
    if (lastStatus === "completed") {
      return payload;
    }
    if (lastStatus === "failed") {
      throw new Error("video_task_failed");
    }
    await sleep(config.pollIntervalMs);
  }

  throw new Error(lastStatus === "processing" ? "video_task_stuck" : "video_task_timeout");
}

function extractTaskId(payload: unknown) {
  const value = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const data = value.data && typeof value.data === "object" ? (value.data as Record<string, unknown>) : {};
  const taskId = value.id || value.task_id || value.taskId || data.id || data.task_id || data.taskId;
  if (typeof taskId !== "string" || !taskId.trim()) {
    throw new Error("missing_video_task_id");
  }
  return taskId.trim();
}

function extractVideoResultUrl(payload: unknown) {
  const value = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const data = value.data && typeof value.data === "object" ? (value.data as Record<string, unknown>) : {};
  const result = value.result && typeof value.result === "object" ? (value.result as Record<string, unknown>) : {};
  const candidates = [
    value.video_url,
    value.url,
    value.result_url,
    data.video_url,
    data.url,
    data.result_url,
    data.first_video_url,
    result.video_url,
    result.url,
  ];
  const url = candidates.find((item) => typeof item === "string" && item.trim());
  if (typeof url !== "string" || !url.trim()) {
    throw new Error("missing_video_result_url");
  }
  return url.trim();
}

function normalizeVideoStatus(status: unknown) {
  const normalized = String(status || "").trim().toLowerCase();
  if (["queued", "submitted", "processing", "in_progress", "running"].includes(normalized)) {
    return "processing";
  }
  if (["completed", "complete", "success", "succeeded"].includes(normalized)) {
    return "completed";
  }
  if (["failed", "failure", "error", "cancelled", "canceled"].includes(normalized)) {
    return "failed";
  }
  return normalized || "unknown";
}

function readStatus(payload: unknown) {
  const value = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const data = value.data && typeof value.data === "object" ? (value.data as Record<string, unknown>) : {};
  const result = value.result && typeof value.result === "object" ? (value.result as Record<string, unknown>) : {};
  return value.status || value.state || data.status || data.state || result.status || result.state;
}

function validateMp4Buffer(buffer: Buffer): { valid: true } | { valid: false } {
  if (buffer.length < 12) {
    return { valid: false };
  }

  const searchLimit = Math.min(buffer.length - 4, 64);
  for (let index = 0; index <= searchLimit; index += 1) {
    if (buffer.subarray(index, index + 4).toString("ascii") === "ftyp") {
      return { valid: true };
    }
  }

  return { valid: false };
}

async function downloadVideo(url: string, timeoutMs: number) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "video/mp4,application/octet-stream;q=0.9,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0 ShanHaiEdu-MVP-VideoAdapter",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error("video_download_failed");
  }
  return Buffer.from(await response.arrayBuffer());
}

function buildPrompt(project: ProjectRecord, artifact: ArtifactRecord) {
  return [
    "小学六年级数学百分数公开课导入视频。",
    "这是独立创意短片，只通过课程锚点回接百分数，不提前讲解知识点。",
    `课题：${project.lessonTopic || "百分数导入课"}。`,
    `年级：${project.grade || "六年级"}。`,
    "画面温暖明亮，生活情境清晰，避免品牌、二维码、网址和复杂文字。",
    "当前导入视频方案：",
    artifact.markdownContent.slice(0, 1600),
  ].join("\n");
}

function sanitizeFileSegment(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-")
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "video"
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
