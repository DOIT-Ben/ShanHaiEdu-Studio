import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, ".tmp", "video-smoke");
const lastTaskPath = path.join(outputDir, "last-task.json");
const MIN_VIDEO_BYTES = 1024;

if (process.env.SHANHAI_VIDEO_SKIP_DOTENV !== "1") {
  await import("dotenv/config");
}

export function extractTaskId(payload) {
  const value = payload && typeof payload === "object" ? payload : {};
  const data = value.data && typeof value.data === "object" ? value.data : {};
  const taskId = value.id || value.task_id || value.taskId || data.id || data.task_id || data.taskId;
  if (typeof taskId !== "string" || !taskId.trim()) {
    throw new Error("missing_video_task_id");
  }
  return taskId.trim();
}

export function normalizeVideoStatus(status) {
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

export function extractVideoResultUrl(payload) {
  const value = payload && typeof payload === "object" ? payload : {};
  const data = value.data && typeof value.data === "object" ? value.data : {};
  const result = value.result && typeof value.result === "object" ? value.result : {};
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
  if (!url) {
    throw new Error("missing_video_result_url");
  }
  return url.trim();
}

export function buildVideoEndpointUrl(baseUrl, channel = "octo") {
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

export function buildVideoQueryUrl(baseUrl, taskId, channel = "octo") {
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

export function buildVideoRequestBody(config, prompt) {
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

export function resolveVideoTaskId(env, cachedTask) {
  const explicitTaskId = env.VIDEO_SMOKE_TASK_ID?.trim();
  if (explicitTaskId) {
    return { taskId: explicitTaskId, source: "env" };
  }

  const cachedTaskId = cachedTask && typeof cachedTask === "object" ? cachedTask.taskId?.trim() : "";
  if (cachedTaskId) {
    return { taskId: cachedTaskId, source: "cache" };
  }

  return null;
}

export function summarizeVideoTaskPayload(payload) {
  return {
    status: normalizeVideoStatus(readStatus(payload)),
    progress: readProgress(payload),
    hasResultUrl: hasVideoResultUrl(payload),
  };
}

export function classifyVideoWaitFailure({ lastStatus, hasTaskId }) {
  if (hasTaskId && normalizeVideoStatus(lastStatus) === "processing") {
    return "video_task_stuck";
  }
  return "video_task_timeout";
}

export function validateMp4Buffer(buffer) {
  if (buffer.length < MIN_VIDEO_BYTES) {
    return { valid: false, mime: "application/octet-stream", extension: ".bin" };
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
    return { valid: true, mime: "video/mp4", extension: ".mp4" };
  }

  return { valid: false, mime: "application/octet-stream", extension: ".bin" };
}

export function readVideoConfig(env) {
  const wantsEvolink = env.VIDEO_PROVIDER_MODE?.trim() === "evolink" || Boolean(env.EVOLINK_API_KEY?.trim() || env.EVOLINK_VIDEO_API_KEY?.trim());
  const apiKey = wantsEvolink ? env.EVOLINK_VIDEO_API_KEY?.trim() || env.EVOLINK_API_KEY?.trim() : env.OCTO_API_KEY?.trim() || env.NEWAPI_API_KEY?.trim();
  const baseUrl = wantsEvolink ? env.EVOLINK_VIDEO_BASE_URL?.trim() || env.EVOLINK_BASE_URL?.trim() || "https://api.evolink.ai" : env.OCTO_BASE_URL?.trim() || env.NEWAPI_BASE_URL?.trim();
  if (!apiKey || !baseUrl) {
    return {
      ok: false,
      missing: wantsEvolink ? ["EVOLINK_VIDEO_API_KEY"].filter(() => !(env.EVOLINK_VIDEO_API_KEY?.trim() || env.EVOLINK_API_KEY?.trim())) : ["OCTO_API_KEY", "OCTO_BASE_URL"].filter((key) => !env[key]?.trim()),
    };
  }

  return {
    ok: true,
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    channel: wantsEvolink ? "evolink" : env.OCTO_VIDEO_PROVIDER?.trim() || env.VIDEO_PROVIDER_MODE?.trim() || "octo",
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

async function runVideoSmoke() {
  const config = readVideoConfig(process.env);
  if (!config.ok) {
    console.log(
      JSON.stringify({
        ok: false,
        code: "missing_VIDEO_PROVIDER_ENV",
        missing: config.missing,
        message: "Set the selected video provider env to run a real video smoke.",
      }),
    );
    process.exit(2);
  }

  const cachedTask = process.env.VIDEO_SMOKE_RESUME_LAST === "1" ? readCachedVideoTask() : null;
  const resumeTask = resolveVideoTaskId(process.env, cachedTask);
  const submitPayload = resumeTask ? null : await submitVideoTask(config);
  const taskId = resumeTask?.taskId || extractTaskId(submitPayload);
  const taskSource = resumeTask?.source || "submit";
  saveCachedVideoTask({ taskId, config, status: "submitted" });

  const completedPayload = await pollVideoTask(config, taskId);
  const videoUrl = extractVideoResultUrl(completedPayload);
  const videoBuffer = await downloadVideo(videoUrl, config.timeoutMs);
  const validation = validateMp4Buffer(videoBuffer);
  if (!validation.valid) {
    throw new Error("invalid_video_output");
  }

  mkdirSync(outputDir, { recursive: true });
  const fileName = `m20-${Date.now()}-intro-video${validation.extension}`;
  const outputPath = path.join(outputDir, fileName);
  writeFileSync(outputPath, videoBuffer);

  console.log(
    JSON.stringify({
      ok: true,
      provider: "video_generation",
      channel: config.channel,
      model: config.model,
      taskSource,
      taskStatus: "completed",
      fileName,
      localOutput: path.relative(root, outputPath).replaceAll("\\", "/"),
      bytes: videoBuffer.length,
      sha256: createHash("sha256").update(videoBuffer).digest("hex"),
      videoValid: true,
      mime: validation.mime,
    }),
  );
}

async function submitVideoTask(config) {
  const response = await fetch(buildVideoEndpointUrl(config.baseUrl, config.channel), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildVideoRequestBody(config, [
        "小学六年级数学百分数公开课导入视频。",
        "这是独立创意短片，只通过课程锚点回接百分数，不提前讲解知识点。",
        "画面温暖明亮，生活情境清晰，避免品牌、二维码、网址和复杂文字。",
      ].join(" "))),
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`video_submit_http_${response.status}`);
  }
  return response.json();
}

async function pollVideoTask(config, taskId) {
  let lastSummary = null;
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
      throw new Error(`video_query_http_${response.status}`);
    }

    const payload = await response.json();
    lastSummary = summarizeVideoTaskPayload(payload);
    saveCachedVideoTask({ taskId, config, status: lastSummary.status, progress: lastSummary.progress });
    const status = lastSummary.status;
    if (status === "completed") {
      return payload;
    }
    if (status === "failed") {
      throw new Error("video_task_failed");
    }
    await sleep(config.pollIntervalMs);
  }

  throw createVideoSmokeError(
    classifyVideoWaitFailure({ lastStatus: lastSummary?.status, hasTaskId: Boolean(taskId) }),
    lastSummary,
  );
}

function readStatus(payload) {
  const value = payload && typeof payload === "object" ? payload : {};
  const data = value.data && typeof value.data === "object" ? value.data : {};
  const result = value.result && typeof value.result === "object" ? value.result : {};
  return value.status || value.state || data.status || data.state || result.status || result.state;
}

function readProgress(payload) {
  const value = payload && typeof payload === "object" ? payload : {};
  const data = value.data && typeof value.data === "object" ? value.data : {};
  const result = value.result && typeof value.result === "object" ? value.result : {};
  const progress = value.progress ?? data.progress ?? result.progress;
  if (typeof progress === "number" && Number.isFinite(progress)) {
    return progress;
  }
  if (typeof progress === "string" && progress.trim()) {
    const parsed = Number.parseFloat(progress);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function hasVideoResultUrl(payload) {
  try {
    extractVideoResultUrl(payload);
    return true;
  } catch {
    return false;
  }
}

function readCachedVideoTask() {
  if (!existsSync(lastTaskPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(lastTaskPath, "utf8"));
  } catch {
    return null;
  }
}

function saveCachedVideoTask({ taskId, config, status, progress }) {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(
    lastTaskPath,
    JSON.stringify(
      {
        taskId,
        channel: config.channel,
        model: config.model,
        size: config.size,
        status,
        progress: progress ?? null,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

async function downloadVideo(url, timeoutMs) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "video/mp4,application/octet-stream;q=0.9,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0 ShanHaiEdu-MVP-VideoSmoke",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`video_download_http_${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isMainModule() {
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  try {
    await runVideoSmoke();
  } catch (error) {
    const taskSummary = error && typeof error === "object" ? error.publicSummary : null;
    console.log(
      JSON.stringify({
        ok: false,
        code: "video_smoke_failed",
        provider: "video_generation",
        reason: safeErrorReason(error),
        taskSummary,
        message: "Video smoke failed; check credentials, provider status, task lifecycle, download contract, and MP4 validity.",
      }),
    );
    process.exit(1);
  }
}

function createVideoSmokeError(reason, publicSummary) {
  const error = new Error(reason);
  error.publicSummary = publicSummary || null;
  return error;
}

function safeErrorReason(error) {
  const message = error instanceof Error ? error.message : "unknown_error";
  if (/^(video_|missing_|invalid_)/.test(message)) {
    return message;
  }
  if (/timeout/i.test(message)) {
    return "video_request_timeout";
  }
  return "video_unknown_failure";
}
