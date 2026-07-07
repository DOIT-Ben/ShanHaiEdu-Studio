import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, ".tmp", "image-smoke");
const channelEnvMap = {
  primary: {
    apiKey: "IMAGEGEN_MYSELF_PRIMARY_API_KEY",
    baseUrl: "IMAGEGEN_MYSELF_PRIMARY_BASE_URL",
    model: "IMAGEGEN_MYSELF_MODEL",
  },
  free: {
    apiKey: "IMAGEGEN_FREE_API_KEY",
    baseUrl: "IMAGEGEN_FREE_BASE_URL",
    model: "IMAGEGEN_FREE_MODEL",
  },
  free_primary: {
    apiKey: "IMAGEGEN_FREE_PRIMARY_API_KEY",
    baseUrl: "IMAGEGEN_FREE_PRIMARY_BASE_URL",
    model: "IMAGEGEN_FREE_PRIMARY_MODEL",
  },
  myself_fallback: {
    apiKey: "IMAGEGEN_MYSELF_FALLBACK_API_KEY",
    baseUrl: "IMAGEGEN_MYSELF_FALLBACK_BASE_URL",
    model: "IMAGEGEN_MYSELF_FALLBACK_MODEL",
  },
};

if (process.env.SHANHAI_IMAGE_SKIP_DOTENV !== "1") {
  await import("dotenv/config");
}

export function extractImageResult(payload) {
  const first = Array.isArray(payload?.data) ? payload.data[0] : null;
  if (!first || typeof first !== "object") {
    throw new Error("missing_image_result");
  }

  if (typeof first.b64_json === "string" && first.b64_json.trim()) {
    return {
      kind: "b64",
      buffer: Buffer.from(first.b64_json, "base64"),
    };
  }

  if (typeof first.url === "string" && first.url.trim()) {
    return {
      kind: "url",
      url: first.url,
    };
  }

  throw new Error("missing_image_payload");
}

export function validateImageBuffer(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { valid: true, mime: "image/png", extension: ".png" };
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { valid: true, mime: "image/jpeg", extension: ".jpg" };
  }

  return { valid: false, mime: "application/octet-stream", extension: ".bin" };
}

export function buildImageGenerationsUrl(baseUrl) {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (/\/v1\/images\/generations$/i.test(normalized)) {
    return normalized;
  }
  if (/\/v1$/i.test(normalized)) {
    return `${normalized}/images/generations`;
  }
  return `${normalized}/v1/images/generations`;
}

function normalizeChannel(value) {
  return value?.trim() || "primary";
}

function readConfig(env) {
  const channel = normalizeChannel(env.IMAGE_PROVIDER_CHANNEL);
  const channelEnv = channelEnvMap[channel] || channelEnvMap.primary;
  const apiKey = env[channelEnv.apiKey]?.trim();
  const baseUrl = env[channelEnv.baseUrl]?.trim();
  if (!apiKey || !baseUrl) {
    return {
      ok: false,
      channel,
      missing: [channelEnv.apiKey, channelEnv.baseUrl].filter((key) => !env[key]?.trim()),
    };
  }

  return {
    ok: true,
    channel,
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    model: env[channelEnv.model]?.trim() || env.IMAGEGEN_MYSELF_MODEL?.trim() || "gpt-image-2",
    timeoutMs: Number.parseInt(env.IMAGE_SMOKE_TIMEOUT_MS || env.AIRCODE_PROVIDER_TIMEOUT || "180000", 10),
  };
}

async function runImageSmoke() {
  const config = readConfig(process.env);
  if (!config.ok) {
    console.log(
      JSON.stringify({
        ok: false,
        code: "missing_IMAGE_PROVIDER_ENV",
        channel: config.channel,
        missing: config.missing,
        message: "Set the selected image provider env to run a real image smoke.",
      }),
    );
    process.exit(2);
  }

  const response = await fetch(buildImageGenerationsUrl(config.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      prompt: [
        "小学六年级数学百分数公开课导入页主视觉。",
        "纯白背景，真实课堂可理解的生活情境，一张图只表达一个核心问题。",
        "画面中不要出现品牌、二维码、网址、复杂文字。",
      ].join(" "),
      size: "1024x1024",
      quality: "low",
      response_format: "b64_json",
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`image_generation_http_${response.status}`);
  }

  const payload = await response.json();
  const imageResult = extractImageResult(payload);
  const buffer = imageResult.kind === "b64" ? imageResult.buffer : await downloadImage(imageResult.url, config.timeoutMs);
  const validation = validateImageBuffer(buffer);

  if (!validation.valid) {
    throw new Error("invalid_image_output");
  }

  mkdirSync(outputDir, { recursive: true });
  const fileName = `m18-${Date.now()}-percentage-intro${validation.extension}`;
  const outputPath = path.join(outputDir, fileName);
  writeFileSync(outputPath, buffer);

  console.log(
    JSON.stringify({
      ok: true,
      provider: "image_generation",
      channel: config.channel,
      model: config.model,
      fileName,
      localOutput: path.relative(root, outputPath).replaceAll("\\", "/"),
      bytes: buffer.length,
      sha256: createHash("sha256").update(buffer).digest("hex"),
      imageValid: true,
      mime: validation.mime,
    }),
  );
}

async function downloadImage(url, timeoutMs) {
  const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new Error(`image_download_http_${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function isMainModule() {
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  try {
    await runImageSmoke();
  } catch {
    console.log(
      JSON.stringify({
        ok: false,
        code: "image_smoke_failed",
        provider: "image_generation",
        channel: normalizeChannel(process.env.IMAGE_PROVIDER_CHANNEL),
        message: "Image smoke failed; check credentials, provider status, output contract, and image validity.",
      }),
    );
    process.exit(1);
  }
}
