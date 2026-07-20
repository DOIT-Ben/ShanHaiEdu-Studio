import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolveModelGatewayConfig } from "../src/server/model-gateway-config";
import { collectGitVerificationSubject } from "./development-gates/verification-subject.mjs";
import { gatewayConfigDigest, MODEL_GATEWAY_MODELS, MODEL_GATEWAY_SMOKE_RECEIPT_PATH } from "./development-gates/model-gateway-smoke-receipt.mjs";

const timeoutMs = 180_000;
const fetchJson = async (url: string, init: RequestInit = {}, retries = 0) => {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const text = await response.text();
    let body: unknown = null;
    try { body = JSON.parse(text); } catch { body = null; }
    if (response.ok) return { response, body: body as Record<string, unknown> };
    if (response.status >= 500 && attempt < retries) continue;
    throw new Error(`gateway_http_${response.status}`);
  }
};

function headers(apiKey: string) {
  return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
}

function digest(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function requestIdPresent(response: Response) {
  return Boolean(response.headers.get("x-request-id") || response.headers.get("x-oneapi-request-id"));
}

function validateImage(bytes: Buffer) {
  const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  const webp = bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (bytes.length < 1_024 || (!png && !jpeg && !webp)) throw new Error("invalid_image_artifact");
}

function validateMp3(bytes: Buffer, contentType: string | null) {
  const id3 = bytes.subarray(0, 3).toString("ascii") === "ID3";
  const frameSync = bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
  if (bytes.length < 1_024 || (!id3 && !frameSync) || !contentType?.toLowerCase().includes("audio")) {
    throw new Error("invalid_mp3_artifact");
  }
}

function validateMp4(bytes: Buffer, contentType: string | null) {
  const header = bytes.subarray(0, Math.min(bytes.length, 64)).toString("ascii");
  if (bytes.length < 4_096 || !header.includes("ftyp") || !bytes.subarray(0, Math.min(bytes.length, 1024 * 1024)).includes(Buffer.from("moov")) || !contentType?.toLowerCase().includes("video")) {
    throw new Error("invalid_mp4_artifact");
  }
}

async function runCheck(checks: Record<string, unknown>, name: string, operation: () => Promise<unknown>) {
  try {
    checks[name] = { ok: true, ...(await operation() as Record<string, unknown>) };
  } catch (error) {
    checks[name] = { ok: false, error: error instanceof Error ? error.message : "unknown_error" };
  }
}

async function main() {
  const agent = resolveModelGatewayConfig("agent");
  const text = resolveModelGatewayConfig("text");
  const image = resolveModelGatewayConfig("image");
  const video = resolveModelGatewayConfig("video");
  const tts = resolveModelGatewayConfig("tts");
  const base = agent.baseUrl;
  const checks: Record<string, unknown> = {};
  const result: Record<string, unknown> = { checks };
  const smokeRunId = randomUUID();

  await runCheck(checks, "models", async () => {
    const response = await fetchJson(`${base}/models`, { headers: headers(agent.apiKey) }, 2);
    const available = Array.isArray(response.body.data)
      ? response.body.data.map((item) => (item as { id?: unknown }).id).filter((id): id is string => typeof id === "string")
      : [];
    const required = [agent.model, text.model, image.model, video.model, tts.model];
    if (!required.every((model) => available.includes(model))) throw new Error("required_model_missing");
    return { status: response.response.status, availableModels: available, count: available.length, requiredModelsPresent: true };
  });

  await runCheck(checks, "agent", async () => {
    const response = await fetchJson(`${base}/responses`, {
      method: "POST", headers: headers(agent.apiKey), body: JSON.stringify({ model: agent.model, input: "只回复 OK", max_output_tokens: 16 }),
    }, 2);
    return { status: response.response.status, model: response.body.model ?? agent.model, requestIdPresent: requestIdPresent(response.response) };
  });

  await runCheck(checks, "text", async () => {
    const response = await fetchJson(`${base}/chat/completions`, {
      method: "POST", headers: headers(text.apiKey), body: JSON.stringify({ model: text.model, messages: [{ role: "user", content: "只回复 OK" }], max_tokens: 16 }),
    }, 2);
    return { status: response.response.status, model: response.body.model ?? text.model, requestIdPresent: requestIdPresent(response.response) };
  });

  await runCheck(checks, "image", async () => {
    let response: Awaited<ReturnType<typeof fetchJson>> | null = null;
    let attempts = 0;
    while (!response && attempts < 3) {
      attempts += 1;
      try {
        response = await fetchJson(`${base}/images/generations`, {
          method: "POST", headers: { ...headers(image.apiKey), "Idempotency-Key": `shanhai-gateway-smoke-image-${smokeRunId}-${attempts}` }, body: JSON.stringify({ model: image.model, prompt: "一个简单的蓝色圆形教学图标，纯色背景", size: "1024x1024", response_format: "b64_json", n: 1 }),
        });
      } catch (error) {
        if (!(error instanceof Error) || !/^gateway_http_(?:409|5\d\d)$/.test(error.message) || attempts >= 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    }
    if (!response) throw new Error("image_retry_exhausted");
    const imageData = Array.isArray(response.body.data) ? response.body.data[0] as { b64_json?: unknown } : {};
    const bytes = typeof imageData.b64_json === "string" ? Buffer.from(imageData.b64_json, "base64") : Buffer.alloc(0);
    validateImage(bytes);
    return { status: response.response.status, model: response.body.model ?? image.model, attempts, bytes: bytes.length, sha256: digest(bytes), requestIdPresent: requestIdPresent(response.response) };
  });

  await runCheck(checks, "tts", async () => {
    const response = await fetch(`${base}/audio/speech`, {
      method: "POST", headers: headers(tts.apiKey), body: JSON.stringify({ model: tts.model, input: "这是统一模型网关语音探针。", voice: tts.voiceId, response_format: "mp3" }), signal: AbortSignal.timeout(timeoutMs),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!response.ok) throw new Error(`gateway_http_${response.status}`);
    validateMp3(bytes, response.headers.get("content-type"));
    return { status: response.status, model: tts.model, bytes: bytes.length, sha256: digest(bytes), requestIdPresent: requestIdPresent(response) };
  });

  await runCheck(checks, "video", async () => {
    const submitted = await fetchJson(`${base}/videos`, {
      method: "POST", headers: { ...headers(video.apiKey), "Idempotency-Key": `shanhai-gateway-smoke-video-${smokeRunId}` }, body: JSON.stringify({ model: video.model, prompt: "一个蓝色圆形教学图标轻微旋转，纯色背景", duration: 6, quality: "480p", mode: "normal", aspect_ratio: "16:9" }),
    });
    const videoTaskId = extractId(submitted.body);
    let videoState = submitted.body;
    let pollRequestIdPresent = requestIdPresent(submitted.response);
    for (let attempt = 0; attempt < 36; attempt += 1) {
      const status = readStatus(videoState);
      if (["completed", "succeeded", "success"].includes(status)) break;
      if (["failed", "error", "cancelled", "canceled"].includes(status)) throw new Error(`video_${status}`);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      const polled = await fetchJson(`${base}/videos/${encodeURIComponent(videoTaskId)}`, { headers: headers(video.apiKey) }, 2);
      pollRequestIdPresent ||= requestIdPresent(polled.response);
      videoState = polled.body;
    }
    if (!["completed", "succeeded", "success"].includes(readStatus(videoState))) throw new Error("video_task_timeout");
    const extractedVideoUrl = extractVideoUrl(videoState);
    const videoUrl = extractedVideoUrl ?? `${base}/videos/${encodeURIComponent(videoTaskId)}/content`;
    const artifactResponse = await fetch(videoUrl, { headers: extractedVideoUrl ? { Accept: "video/mp4,application/octet-stream;q=0.9" } : headers(video.apiKey), signal: AbortSignal.timeout(timeoutMs) });
    const bytes = Buffer.from(await artifactResponse.arrayBuffer());
    if (!artifactResponse.ok) throw new Error(`video_download_http_${artifactResponse.status}`);
    validateMp4(bytes, artifactResponse.headers.get("content-type"));
    return { status: "completed", model: video.model, taskIdPresent: true, bytes: bytes.length, sha256: digest(bytes), requestIdPresent: pollRequestIdPresent };
  });

  console.log(JSON.stringify(result, null, 2));
  if (Object.values(checks).some((check) => !(check as { ok?: boolean }).ok)) {
    process.exitCode = 1;
    return;
  }
  const receiptPath = `${process.cwd()}/${MODEL_GATEWAY_SMOKE_RECEIPT_PATH}`;
  mkdirSync(receiptPath.slice(0, receiptPath.lastIndexOf("/")), { recursive: true });
  writeFileSync(receiptPath, `${JSON.stringify({
    schemaVersion: "shanhai-model-gateway-smoke-receipt.v1",
    generatedAt: new Date().toISOString(),
    subject: collectGitVerificationSubject(process.cwd()),
    models: MODEL_GATEWAY_MODELS,
    configDigest: gatewayConfigDigest({ agent, text, image, video, tts }),
    checks,
  }, null, 2)}\n`, "utf8");
}

function extractId(body: Record<string, unknown>) {
  const data = body.data as Record<string, unknown> | undefined;
  const value = body.id ?? body.task_id ?? body.taskId ?? data?.id ?? data?.task_id ?? data?.taskId;
  if (typeof value !== "string" || !value.trim()) throw new Error("video_task_id_missing");
  return value.trim();
}

function readStatus(body: Record<string, unknown>) {
  const data = body.data as Record<string, unknown> | undefined;
  return String(body.status ?? data?.status ?? "").toLowerCase();
}

function extractVideoUrl(body: Record<string, unknown>) {
  const data = body.data as Record<string, unknown> | undefined;
  const result = body.result as Record<string, unknown> | undefined;
  const dataResult = data?.result as Record<string, unknown> | undefined;
  const value = body.video_url ?? body.url ?? body.result_url ?? data?.video_url ?? data?.url ?? data?.result_url ?? result?.url ?? result?.video_url ?? dataResult?.url ?? dataResult?.video_url;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
