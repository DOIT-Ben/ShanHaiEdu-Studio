import { createHash } from "node:crypto";
import { writeLocalArtifact } from "@/server/artifact-storage/local-artifact-storage";
import type { ArtifactRecord, ProjectRecord } from "@/server/workbench/types";

export type ImageGenerationResult = {
  fileName: string;
  localOutput: string;
  bytes: number;
  sha256: string;
  imageValid: true;
  mime: "image/png" | "image/jpeg";
};

type ImageProviderConfig = {
  channel: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
};

const MIN_IMAGE_BYTES = 32;

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
} as const;

export async function generateImageFromArtifact(input: {
  project: ProjectRecord;
  artifact: ArtifactRecord;
}): Promise<ImageGenerationResult> {
  const config = readConfig(process.env);
  const response = await fetch(buildImageGenerationsUrl(config.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      prompt: buildPrompt(input.project, input.artifact),
      size: "1024x1024",
      quality: "low",
      response_format: "b64_json",
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  if (!response.ok) {
    throw new Error("image_generation_request_failed");
  }

  const payload = await response.json();
  const imageResult = extractImageResult(payload);
  const buffer = imageResult.kind === "b64" ? imageResult.buffer : await downloadImage(imageResult.url, config.timeoutMs);
  const validation = validateImageBuffer(buffer);
  if (!validation.valid) {
    throw new Error("invalid_image_output");
  }

  const fileName = `${sanitizeFileSegment(input.project.id)}-${Date.now()}-classroom-visual${validation.extension}`;
  const stored = writeLocalArtifact({
    category: "image-artifacts",
    fileName,
    buffer,
  });

  return {
    fileName,
    localOutput: stored.localOutput,
    bytes: buffer.length,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    imageValid: true,
    mime: validation.mime,
  };
}

export function buildImageGenerationsUrl(baseUrl: string) {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (/\/v1\/images\/generations$/i.test(normalized)) {
    return normalized;
  }
  if (/\/v1$/i.test(normalized)) {
    return `${normalized}/images/generations`;
  }
  return `${normalized}/v1/images/generations`;
}

function readConfig(env: NodeJS.ProcessEnv): ImageProviderConfig {
  const channel = env.IMAGE_PROVIDER_CHANNEL?.trim() || "primary";
  const channelEnv = channelEnvMap[channel as keyof typeof channelEnvMap] || channelEnvMap.primary;
  const apiKey = env[channelEnv.apiKey]?.trim();
  const baseUrl = env[channelEnv.baseUrl]?.trim();
  if (!apiKey || !baseUrl) {
    throw new Error("missing_IMAGE_PROVIDER_ENV");
  }

  return {
    channel,
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    model: env[channelEnv.model]?.trim() || env.IMAGEGEN_MYSELF_MODEL?.trim() || "gpt-image-2",
    timeoutMs: Number.parseInt(env.IMAGE_SMOKE_TIMEOUT_MS || env.AIRCODE_PROVIDER_TIMEOUT || "180000", 10),
  };
}

function extractImageResult(payload: unknown): { kind: "b64"; buffer: Buffer } | { kind: "url"; url: string } {
  const value = payload as { data?: Array<{ b64_json?: unknown; url?: unknown }> };
  const first = Array.isArray(value?.data) ? value.data[0] : null;
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

function validateImageBuffer(buffer: Buffer): { valid: true; mime: "image/png" | "image/jpeg"; extension: ".png" | ".jpg" } | { valid: false } {
  if (buffer.length < MIN_IMAGE_BYTES) {
    return { valid: false };
  }

  if (isValidPng(buffer)) {
    return { valid: true, mime: "image/png", extension: ".png" };
  }

  if (isValidJpeg(buffer)) {
    return { valid: true, mime: "image/jpeg", extension: ".jpg" };
  }

  return { valid: false };
}

function isValidPng(buffer: Buffer) {
  const hasPngSignature = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const hasIhdr = buffer.subarray(12, 16).toString("ascii") === "IHDR";
  const width = buffer.length >= 24 ? buffer.readUInt32BE(16) : 0;
  const height = buffer.length >= 24 ? buffer.readUInt32BE(20) : 0;
  return hasPngSignature && hasIhdr && width > 0 && height > 0;
}

function isValidJpeg(buffer: Buffer) {
  const hasJpegSignature = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const hasEndMarker = buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
  const markerScanLimit = Math.min(buffer.length - 1, 512);
  let hasSizeMarker = false;
  for (let index = 0; index < markerScanLimit; index += 1) {
    const marker = buffer[index] === 0xff ? buffer[index + 1] : 0;
    if (marker === 0xc0 || marker === 0xc2) {
      hasSizeMarker = true;
      break;
    }
  }
  return hasJpegSignature && hasEndMarker && hasSizeMarker;
}

async function downloadImage(url: string, timeoutMs: number) {
  const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new Error("image_download_failed");
  }
  return Buffer.from(await response.arrayBuffer());
}

function buildPrompt(project: ProjectRecord, artifact: ArtifactRecord) {
  return [
    "小学六年级数学百分数公开课导入页主视觉。",
    `课题：${project.lessonTopic || "百分数导入课"}。`,
    `年级：${project.grade || "六年级"}。`,
    "纯白背景，真实课堂可理解的生活情境，一张图只表达一个核心问题。",
    "画面中不要出现品牌、二维码、网址、复杂文字。",
    "当前 PPT 大纲：",
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
      .replace(/^-|-$/g, "") || "image"
  );
}
