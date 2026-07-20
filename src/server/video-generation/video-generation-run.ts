import { createHash } from "node:crypto";
import { writeLocalArtifact } from "@/server/artifact-storage/local-artifact-storage";
import { resolveModelGatewayConfig } from "@/server/model-gateway-config";
import type { ArtifactRecord, ProjectRecord } from "@/server/workbench/types";
import type { EvolinkReferenceUploadEvidence } from "./evolink-reference-upload";

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
  providerEvidence: {
    name: string;
    model: string;
  };
  requestEvidence?: {
    shotId: string;
    durationSeconds: number;
    references: EvolinkReferenceUploadEvidence[];
  };
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

export type VideoGenerationTaskLifecycle = {
  providerTaskId?: string | null;
  onTaskAccepted?: (providerTaskId: string) => Promise<void>;
  onPoll?: () => Promise<void>;
};

export class VideoTaskPersistenceUnknownError extends Error {
  readonly code = "video_task_persistence_unknown";

  constructor() {
    super("video_task_persistence_unknown");
    this.name = "VideoTaskPersistenceUnknownError";
  }
}

const MIN_VIDEO_BYTES = 1024;

export async function generateVideoFromArtifact(input: {
  project: ProjectRecord;
  artifact: ArtifactRecord;
  upstreamArtifacts?: ArtifactRecord[];
  taskLifecycle?: VideoGenerationTaskLifecycle;
  shot?: ResolvedShotVideoRequest;
}): Promise<VideoGenerationResult> {
  assertVideoProviderPreconditions(input);
  const config = readConfig(process.env);
  const requestedDurationSeconds = input.shot?.durationSeconds ?? config.duration;
  const completedPayload = await executeRecoverableVideoTask({
    providerTaskId: input.taskLifecycle?.providerTaskId,
    submit: async () => extractTaskId(await submitVideoTask(config, input)),
    onTaskAccepted: input.taskLifecycle?.onTaskAccepted,
    poll: async (taskId) => pollVideoTask(config, taskId, input.taskLifecycle?.onPoll),
  });
  let videoUrl: string;
  let downloadApiKey: string | undefined;
  try {
    videoUrl = extractVideoResultUrl(completedPayload);
  } catch (error) {
    if (config.channel !== "model_gateway" || !(error instanceof Error) || error.message !== "missing_video_result_url") throw error;
    const normalizedBase = config.baseUrl.replace(/\/+$/, "");
    const apiBase = normalizedBase.endsWith("/v1") ? normalizedBase : `${normalizedBase}/v1`;
    videoUrl = `${apiBase}/videos/${encodeURIComponent(extractTaskId(completedPayload))}/content`;
    downloadApiKey = config.apiKey;
  }
  const videoBuffer = await downloadVideo(videoUrl, config.timeoutMs, downloadApiKey);
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
    providerEvidence: { name: config.channel, model: config.model },
    ...(input.shot ? { requestEvidence: { shotId: input.shot.shotId, durationSeconds: requestedDurationSeconds, references: input.shot.referenceEvidence } } : {}),
  };
}

export function buildVideoEndpointUrl(baseUrl: string, channel = "octo") {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (channel === "model_gateway") {
    return `${normalized.endsWith("/v1") ? normalized : `${normalized}/v1`}/videos`;
  }
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
  if (channel === "model_gateway") {
    return `${normalized.endsWith("/v1") ? normalized : `${normalized}/v1`}/videos/${encodeURIComponent(taskId)}`;
  }
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

export async function executeRecoverableVideoTask<T>(input: {
  providerTaskId?: string | null;
  submit: () => Promise<string>;
  onTaskAccepted?: (providerTaskId: string) => Promise<void>;
  poll: (providerTaskId: string) => Promise<T>;
}): Promise<T> {
  let providerTaskId = input.providerTaskId?.trim() || null;
  if (!providerTaskId) {
    providerTaskId = (await input.submit()).trim();
    if (!providerTaskId) throw new Error("missing_video_task_id");
    try {
      await input.onTaskAccepted?.(providerTaskId);
    } catch {
      throw new VideoTaskPersistenceUnknownError();
    }
  }
  return input.poll(providerTaskId);
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

export type ResolvedShotVideoRequest = {
  shotId: string;
  prompt: string;
  durationTargetRange: { minSeconds: number; maxSeconds: number };
  durationSeconds: number;
  referenceImageUrls: string[];
  referenceEvidence: EvolinkReferenceUploadEvidence[];
};

export function buildResolvedShotVideoRequest(input: {
  shotId: string;
  prompt: string;
  durationTargetRange: { minSeconds: number; maxSeconds: number };
  durationSeconds: number;
  referenceEvidence?: EvolinkReferenceUploadEvidence[];
}): ResolvedShotVideoRequest {
  const shotId = input.shotId.trim();
  const prompt = input.prompt.trim();
  if (!/^shot_[a-z0-9_-]+$/i.test(shotId) || !prompt || !isProviderDurationRange(input.durationTargetRange) ||
      !Number.isInteger(input.durationSeconds) || input.durationSeconds < input.durationTargetRange.minSeconds || input.durationSeconds > input.durationTargetRange.maxSeconds) {
    throw new Error("video_shot_request_invalid");
  }
  const referenceEvidence = input.referenceEvidence ?? [];
  for (const evidence of referenceEvidence) {
    if (evidence.shotId !== shotId) throw new Error("video_reference_evidence_shot_mismatch");
    if (evidence.assetDomain !== "video") throw new Error("video_reference_asset_domain_invalid");
    if (!/^[a-f0-9]{64}$/i.test(evidence.localSha256)) throw new Error("video_reference_evidence_hash_invalid");
    if (!/^https:\/\//i.test(evidence.uploadedUrl)) throw new Error("video_reference_upload_url_untrusted");
  }
  return {
    shotId,
    prompt,
    durationTargetRange: { ...input.durationTargetRange },
    durationSeconds: input.durationSeconds,
    referenceImageUrls: referenceEvidence.map((evidence) => evidence.uploadedUrl),
    referenceEvidence,
  };
}

export function buildVideoRequestBody(
  config: Pick<VideoProviderConfig, "channel" | "model" | "size" | "duration" | "quality" | "mode" | "aspectRatio">,
  prompt: string,
  referenceImageUrls: string[] = [],
) {
  if (config.channel === "evolink" || config.channel === "model_gateway") {
    if (referenceImageUrls.length > EVOLINK_GROK_IMAGINE_VIDEO_PROVIDER_PROFILE.imageUrls.max) {
      throw new Error("video_reference_image_limit_exceeded");
    }
    return {
      model: config.model,
      prompt,
      duration: config.duration,
      quality: config.quality,
      mode: config.mode,
      aspect_ratio: config.aspectRatio,
      ...(referenceImageUrls.length > 0 ? { image_urls: [...referenceImageUrls] } : {}),
    };
  }
  return {
    model: config.model,
    prompt,
    size: config.size,
  };
}

export function buildShotVideoRequestBody(
  config: Pick<VideoProviderConfig, "channel" | "model" | "size" | "duration" | "quality" | "mode" | "aspectRatio">,
  shot: ResolvedShotVideoRequest,
) {
  if (!/^shot_[a-z0-9_-]+$/i.test(shot.shotId) || !shot.prompt.trim()) throw new Error("video_shot_request_invalid");
  return buildVideoRequestBody({ ...config, duration: shot.durationSeconds }, shot.prompt, shot.referenceImageUrls);
}

function isProviderDurationRange(range: { minSeconds: number; maxSeconds: number }): boolean {
  return Number.isInteger(range?.minSeconds) && Number.isInteger(range?.maxSeconds) &&
    range.minSeconds >= EVOLINK_GROK_IMAGINE_VIDEO_PROVIDER_PROFILE.durationSeconds.min &&
    range.maxSeconds <= EVOLINK_GROK_IMAGINE_VIDEO_PROVIDER_PROFILE.durationSeconds.max &&
    range.maxSeconds >= range.minSeconds;
}

function readConfig(env: NodeJS.ProcessEnv): VideoProviderConfig {
  const gateway = resolveModelGatewayConfig("video", env);

  return {
    channel: "model_gateway",
    apiKey: gateway.apiKey,
    baseUrl: gateway.baseUrl,
    model: gateway.model,
    size: env.OMNI_DEFAULT_SIZE || "1280x720",
    duration: Number.parseInt(env.EVOLINK_VIDEO_DURATION || "6", 10),
    quality: env.EVOLINK_VIDEO_QUALITY || "480p",
    mode: env.EVOLINK_VIDEO_MODE || "normal",
    aspectRatio: env.EVOLINK_VIDEO_ASPECT_RATIO || "16:9",
    timeoutMs: Number.parseInt(env.VIDEO_SMOKE_TIMEOUT_MS || "600000", 10),
    pollIntervalMs: Number.parseInt(env.VIDEO_SMOKE_POLL_INTERVAL_MS || "5000", 10),
    maxPolls: Number.parseInt(env.VIDEO_SMOKE_MAX_POLLS || "72", 10),
  };
}

async function submitVideoTask(
  config: VideoProviderConfig,
  input: { project: ProjectRecord; artifact: ArtifactRecord; shot?: ResolvedShotVideoRequest },
) {
  const body = input.shot
    ? buildShotVideoRequestBody(config, input.shot)
    : buildVideoRequestBody(config, buildVideoArtifactPrompt(input.project, input.artifact));
  const idempotencyKey = `video-${createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 48)}`;
  const response = await fetch(buildVideoEndpointUrl(config.baseUrl, config.channel), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  if (!response.ok) {
    throw new Error("video_submit_failed");
  }
  return response.json();
}

async function pollVideoTask(config: VideoProviderConfig, taskId: string, onPoll?: () => Promise<void>) {
  let lastStatus = "unknown";
  for (let attempt = 0; attempt < config.maxPolls; attempt += 1) {
    await onPoll?.();
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

async function downloadVideo(url: string, timeoutMs: number, apiKey?: string) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "video/mp4,application/octet-stream;q=0.9,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0 ShanHaiEdu-MVP-VideoAdapter",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error("video_download_failed");
  }
  return Buffer.from(await response.arrayBuffer());
}

export function buildVideoArtifactPrompt(project: ProjectRecord, artifact: ArtifactRecord) {
  return [
    "课程导入视频分镜片段。",
    "只根据已确认视频_segment_plan生成单段视频；知识锚点、创意主题、视频脚本、分镜和资产图必须已在上游完成。",
    `课题：${project.lessonTopic || "未指定课题"}。`,
    `年级：${project.grade || "未指定年级"}。`,
    `学科：${project.subject || "未指定学科"}。`,
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
