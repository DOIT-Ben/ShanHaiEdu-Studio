import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, ".tmp", "video-smoke");

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

export function extractVideoResultUrl(payload) {
  const value = payload && typeof payload === "object" ? payload : {};
  const data = value.data && typeof value.data === "object" ? value.data : {};
  const result = value.result && typeof value.result === "object" ? value.result : {};
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
  if (!url) {
    throw new Error("missing_video_result_url");
  }
  return url.trim();
}

export function buildVideoEndpointUrl(baseUrl) {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (/\/v1\/videos$/i.test(normalized)) {
    return normalized;
  }
  if (/\/v1$/i.test(normalized)) {
    return `${normalized}/videos`;
  }
  return `${normalized}/v1/videos`;
}

export function buildVideoQueryUrl(baseUrl, taskId) {
  return `${buildVideoEndpointUrl(baseUrl)}/${encodeURIComponent(taskId)}`;
}

export function validateMp4Buffer(buffer) {
  if (buffer.length < 12) {
    return { valid: false, mime: "application/octet-stream", extension: ".bin" };
  }

  const searchLimit = Math.min(buffer.length - 4, 64);
  for (let index = 0; index <= searchLimit; index += 1) {
    if (buffer.subarray(index, index + 4).toString("ascii") === "ftyp") {
      return { valid: true, mime: "video/mp4", extension: ".mp4" };
    }
  }

  return { valid: false, mime: "application/octet-stream", extension: ".bin" };
}

function readConfig(env) {
  const apiKey = env.OCTO_API_KEY?.trim() || env.NEWAPI_API_KEY?.trim();
  const baseUrl = env.OCTO_BASE_URL?.trim() || env.NEWAPI_BASE_URL?.trim();
  if (!apiKey || !baseUrl) {
    return {
      ok: false,
      missing: ["OCTO_API_KEY", "OCTO_BASE_URL"].filter((key) => !env[key]?.trim()),
    };
  }

  return {
    ok: true,
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    channel: env.OCTO_VIDEO_PROVIDER?.trim() || env.VIDEO_PROVIDER_MODE?.trim() || "octo",
    model: env.VIDEO_MODEL?.trim() || env.OMNI_DEFAULT_MODEL?.trim() || env.NEWAPI_DEFAULT_MODEL?.trim() || "omni_flash-10s",
    size: env.OMNI_DEFAULT_SIZE?.trim() || env.NEWAPI_DEFAULT_SIZE?.trim() || "1280x720",
    timeoutMs: Number.parseInt(env.VIDEO_SMOKE_TIMEOUT_MS || "600000", 10),
    pollIntervalMs: Number.parseInt(env.VIDEO_SMOKE_POLL_INTERVAL_MS || "5000", 10),
    maxPolls: Number.parseInt(env.VIDEO_SMOKE_MAX_POLLS || "72", 10),
  };
}

async function runVideoSmoke() {
  const config = readConfig(process.env);
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

  const submitPayload = await submitVideoTask(config);
  const taskId = extractTaskId(submitPayload);
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
  const response = await fetch(buildVideoEndpointUrl(config.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      prompt: [
        "小学六年级数学百分数公开课导入视频。",
        "这是独立创意短片，只通过课程锚点回接百分数，不提前讲解知识点。",
        "画面温暖明亮，生活情境清晰，避免品牌、二维码、网址和复杂文字。",
      ].join(" "),
      size: config.size,
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`video_submit_http_${response.status}`);
  }
  return response.json();
}

async function pollVideoTask(config, taskId) {
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
      throw new Error(`video_query_http_${response.status}`);
    }

    const payload = await response.json();
    const status = normalizeVideoStatus(readStatus(payload));
    if (status === "completed") {
      return payload;
    }
    if (status === "failed") {
      throw new Error("video_task_failed");
    }
    await sleep(config.pollIntervalMs);
  }

  throw new Error("video_task_timeout");
}

function readStatus(payload) {
  const value = payload && typeof payload === "object" ? payload : {};
  const data = value.data && typeof value.data === "object" ? value.data : {};
  const result = value.result && typeof value.result === "object" ? value.result : {};
  return value.status || value.state || data.status || data.state || result.status || result.state;
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
    console.log(
      JSON.stringify({
        ok: false,
        code: "video_smoke_failed",
        provider: "video_generation",
        reason: safeErrorReason(error),
        message: "Video smoke failed; check credentials, provider status, task lifecycle, download contract, and MP4 validity.",
      }),
    );
    process.exit(1);
  }
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
