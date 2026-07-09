import { createHash } from "node:crypto";
import { writeLocalArtifact } from "@/server/artifact-storage/local-artifact-storage";
import type { ArtifactRecord, ProjectRecord } from "@/server/workbench/types";

export const EVOLINK_GROK_IMAGINE_VIDEO_PROVIDER_PROFILE = {
  provider: "evolink",
  textToVideoModel: "grok-imagine-text-to-video-beta",
  imageToVideoModel: "grok-imagine-image-to-video-beta",
  requestFields: { image_urls: { min: 1, max: 7 } },
  imageUrls: { min: 1, max: 7 },
  durationSeconds: { min: 6, max: 30 },
  startEndFrame: "unverified",
  resultUrlTtlHours: 24,
  concurrency: "low",
} as const;

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
  duration: number;
  quality: string;
  mode: string;
  aspectRatio: string;
  timeoutMs: number;
  pollIntervalMs: number;
  maxPolls: number;
};

const MIN_VIDEO_BYTES = 1024;

export async function generateVideoFromArtifact(input: {
  project: ProjectRecord;
  artifact: ArtifactRecord;
  upstreamArtifacts?: ArtifactRecord[];
}): Promise<VideoGenerationResult> {
  assertVideoProviderPreconditions(input);
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

  const fileName = `${sanitizeFileSegment(input.project.id)}-${Date.now()}-intro-video.mp4`;
  const stored = writeLocalArtifact({
    category: "video-artifacts",
    fileName,
    buffer: videoBuffer,
  });

  return {
    fileName,
    localOutput: stored.localOutput,
    bytes: videoBuffer.length,
    sha256: createHash("sha256").update(videoBuffer).digest("hex"),
    videoValid: true,
    mime: "video/mp4",
  };
}

export function buildVideoEndpointUrl(baseUrl: string, channel = "octo") {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (channel === "evolink") {
    if (/\/v1\/videos\/generations$/i.test(normalized)) {
      return normalized;
    }
    if (/\/v1$/i.test(normalized)) {
      return `${normalized}/videos/generations`;
    }
    return `${normalized}/v1/videos/generations`;
  }
  if (/\/v1\/videos$/i.test(normalized)) {
    return normalized;
  }
  if (/\/v1$/i.test(normalized)) {
    return `${normalized}/videos`;
  }
  return `${normalized}/v1/videos`;
}

export function buildVideoQueryUrl(baseUrl: string, taskId: string, channel = "octo") {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (channel === "evolink") {
    const tasksBase = /\/v1\/tasks$/i.test(normalized)
      ? normalized
      : /\/v1$/i.test(normalized)
        ? `${normalized}/tasks`
        : normalized.replace(/\/v1\/videos\/generations$/i, "/v1/tasks").replace(/\/v1\/videos$/i, "/v1/tasks");
    return `${tasksBase.endsWith("/v1/tasks") ? tasksBase : `${tasksBase}/v1/tasks`}/${encodeURIComponent(taskId)}`;
  }
  return `${buildVideoEndpointUrl(baseUrl, channel)}/${encodeURIComponent(taskId)}`;
}

export function assertVideoProviderPreconditions(input: {
  artifact: ArtifactRecord;
  upstreamArtifacts?: ArtifactRecord[];
}): void {
  if (
    input.artifact.nodeKey !== "video_segment_plan" ||
    input.artifact.kind !== "video_segment_plan" ||
    !input.artifact.isApproved ||
    input.artifact.status !== "approved"
  ) {
    throw new Error("missing_video_workflow_preconditions");
  }

  const upstreamKinds = new Set(
    (input.upstreamArtifacts ?? [])
      .filter((artifact) => artifact.isApproved && artifact.status === "approved")
      .map((artifact) => artifact.kind),
  );
  const hasStoryboard = upstreamKinds.has("storyboard_generate");
  const hasAssetImages = upstreamKinds.has("asset_image_generate");

  if (!hasStoryboard || !hasAssetImages) {
    throw new Error("missing_video_workflow_preconditions");
  }
}

export function buildVideoRequestBody(config: Pick<VideoProviderConfig, "channel" | "model" | "size" | "duration" | "quality" | "mode" | "aspectRatio">, prompt: string) {
  if (config.channel === "evolink") {
    return {
      model: config.model,
      prompt,
      duration: config.duration,
      quality: config.quality,
      mode: config.mode,
      aspect_ratio: config.aspectRatio,
    };
  }
  return {
    model: config.model,
    prompt,
    size: config.size,
  };
}

function readConfig(env: NodeJS.ProcessEnv): VideoProviderConfig {
  const wantsEvolink = env.VIDEO_PROVIDER_MODE?.trim() === "evolink" || Boolean(env.EVOLINK_API_KEY?.trim() || env.EVOLINK_VIDEO_API_KEY?.trim());
  const apiKey = wantsEvolink ? env.EVOLINK_VIDEO_API_KEY?.trim() || env.EVOLINK_API_KEY?.trim() : env.OCTO_API_KEY?.trim() || env.NEWAPI_API_KEY?.trim();
  const baseUrl = wantsEvolink ? env.EVOLINK_VIDEO_BASE_URL?.trim() || env.EVOLINK_BASE_URL?.trim() || "https://api.evolink.ai" : env.OCTO_BASE_URL?.trim() || env.NEWAPI_BASE_URL?.trim();
  if (!apiKey || !baseUrl) {
    throw new Error("missing_VIDEO_PROVIDER_ENV");
  }

  return {
    channel: wantsEvolink ? "evolink" : env.OCTO_VIDEO_PROVIDER?.trim() || env.VIDEO_PROVIDER_MODE?.trim() || "octo",
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    model: env.EVOLINK_VIDEO_MODEL?.trim() || env.VIDEO_MODEL?.trim() || env.OMNI_DEFAULT_MODEL?.trim() || env.NEWAPI_DEFAULT_MODEL?.trim() || (wantsEvolink ? "grok-imagine-text-to-video-beta" : "omni_flash-10s"),
    size: env.OMNI_DEFAULT_SIZE?.trim() || env.NEWAPI_DEFAULT_SIZE?.trim() || "1280x720",
    duration: Number.parseInt(env.EVOLINK_VIDEO_DURATION_SECONDS || env.VIDEO_DURATION_SECONDS || "6", 10),
    quality: env.EVOLINK_VIDEO_QUALITY?.trim() || env.VIDEO_QUALITY?.trim() || "480p",
    mode: env.EVOLINK_VIDEO_STYLE_MODE?.trim() || env.VIDEO_STYLE_MODE?.trim() || "normal",
    aspectRatio: env.EVOLINK_VIDEO_ASPECT_RATIO?.trim() || env.VIDEO_ASPECT_RATIO?.trim() || "16:9",
    timeoutMs: Number.parseInt(env.VIDEO_SMOKE_TIMEOUT_MS || "600000", 10),
    pollIntervalMs: Number.parseInt(env.VIDEO_SMOKE_POLL_INTERVAL_MS || "5000", 10),
    maxPolls: Number.parseInt(env.VIDEO_SMOKE_MAX_POLLS || "72", 10),
  };
}

async function submitVideoTask(
  config: VideoProviderConfig,
  input: { project: ProjectRecord; artifact: ArtifactRecord },
) {
  const response = await fetch(buildVideoEndpointUrl(config.baseUrl, config.channel), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildVideoRequestBody(config, buildPrompt(input.project, input.artifact))),
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
    const response = await fetch(buildVideoQueryUrl(config.baseUrl, taskId, config.channel), {
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
  const results = Array.isArray(value.results) ? value.results : [];
  const candidates = [
    value.video_url,
    value.url,
    value.result_url,
    results[0],
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
  if (["pending", "queued", "submitted", "processing", "in_progress", "running"].includes(normalized)) {
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
  if (buffer.length < MIN_VIDEO_BYTES) {
    return { valid: false };
  }

  let hasFtyp = false;
  const searchLimit = Math.min(buffer.length - 4, 64);
  for (let index = 0; index <= searchLimit; index += 1) {
    if (buffer.subarray(index, index + 4).toString("ascii") === "ftyp") {
      hasFtyp = true;
      break;
    }
  }

  const moovSearchLimit = Math.min(buffer.length - 4, 1024 * 1024);
  let hasMoov = false;
  for (let index = 0; index <= moovSearchLimit; index += 1) {
    if (buffer.subarray(index, index + 4).toString("ascii") === "moov") {
      hasMoov = true;
      break;
    }
  }

  if (hasFtyp && hasMoov) {
    return { valid: true };
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
    "小学公开课导入视频分镜片段。",
    "只根据已确认视频_segment_plan生成单段视频；知识锚点、创意主题、视频脚本、分镜和资产图必须已在上游完成。",
    `课题：${project.lessonTopic || "百分数导入课"}。`,
    `年级：${project.grade || "六年级"}。`,
    "画面温暖明亮，生活情境清晰，避免品牌、二维码、网址和复杂文字。",
    "当前分镜视频计划：",
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
