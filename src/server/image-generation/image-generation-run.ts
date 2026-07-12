import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { writeLocalArtifact } from "@/server/artifact-storage/local-artifact-storage";
import type { ArtifactRecord, ProjectRecord } from "@/server/workbench/types";
import type { PptAssetRequest, PptGeneratedAsset } from "@/server/ppt-quality/ppt-asset-types";
import { buildPptAssetImageGenerationRequest } from "@/server/ppt-quality/ppt-image-provider-request";
import { generateImageWithExternalWrapper, generateImageWithMiniMaxCli } from "./image-provider-wrapper-run";
import { generateImageWithCurlProvider } from "./image-provider-curl-run";

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
  transparentAssetFallbackCommand: string | null;
  wrapperScript: string | null;
  wrapperPowerShell: string;
  curlProvider: boolean;
  minimaxCliScript: string | null;
};

const MIN_IMAGE_BYTES = 32;
const execFileAsync = promisify(execFile);

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
  minimax: {
    apiKey: "MINIMAX_API_KEY",
    baseUrl: "MINIMAX_BASE_URL",
    model: "MINIMAX_IMAGE_MODEL",
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

export async function generatePptAssetImage(request: PptAssetRequest): Promise<PptGeneratedAsset> {
  const config = readConfig(process.env);
  const providerRequest = buildPptAssetImageGenerationRequest({ request, model: config.model });
  if (config.channel === "minimax") return generatePptAssetImageWithMiniMax({ request, providerRequest, config });
  if (config.curlProvider) return generatePptAssetImageWithCurl({ request, providerRequest, config });
  if (config.wrapperScript) return generatePptAssetImageWithWrapper({ request, providerRequest, config });
  let clientRequestId = randomUUID();
  let response = await requestPptAssetGeneration({ config, body: providerRequest.body, clientRequestId });
  let usedTransparencyFallback = false;

  if (!response.ok && request.transparentBackground && config.transparentAssetFallbackCommand) {
    const responseText = await response.text();
    if (isTransparentBackgroundUnsupported(responseText)) {
      clientRequestId = randomUUID();
      response = await requestPptAssetGeneration({
        config,
        clientRequestId,
        body: buildOpaqueForegroundFallbackBody(providerRequest.body),
      });
      usedTransparencyFallback = true;
    }
  }

  if (!response.ok) throw new Error(`ppt_asset_image_generation_request_failed:http_${response.status}`);

  const payload = await response.json();
  const imageResult = extractImageResult(payload);
  const rawBuffer = imageResult.kind === "b64" ? imageResult.buffer : await downloadImage(imageResult.url, config.timeoutMs);
  let processedBuffer = rawBuffer;
  const processingChain: PptGeneratedAsset["processingChain"] = [];
  if (usedTransparencyFallback) {
    processedBuffer = await removeOpaqueBackground({ buffer: rawBuffer, command: config.transparentAssetFallbackCommand! });
    processingChain.push({
      operation: "remove_background",
      sourceSha256: sha256(rawBuffer),
      targetSha256: sha256(processedBuffer),
    });
  }

  const buffer = await normalizePptAssetBuffer(processedBuffer, request);
  if (!buffer.equals(processedBuffer)) {
    processingChain.push({
      operation: "resize",
      sourceSha256: sha256(processedBuffer),
      targetSha256: sha256(buffer),
    });
  }
  const validation = validateImageBuffer(buffer);
  if (!validation.valid) throw new Error("invalid_ppt_asset_image_output");
  if (request.transparentBackground && !hasPngAlpha(buffer)) throw new Error("ppt_asset_transparent_background_not_verified");

  const fileName = `${sanitizeFileSegment(request.assetId)}-${Date.now()}${validation.extension}`;
  const stored = writeLocalArtifact({ category: "image-artifacts", fileName, buffer });
  return {
    fileName,
    storageRef: stored.localOutput,
    sha256: sha256(buffer),
    bytes: buffer.length,
    width: validation.width,
    height: validation.height,
    mime: validation.mime,
    transparentBackgroundVerified: request.transparentBackground ? hasPngAlpha(buffer) : false,
    provider: config.channel,
    model: config.model,
    clientRequestId,
    providerRequestId: extractProviderRequestId(response, payload),
    providerTaskId: null,
    sentReferenceAssetIds: providerRequest.evidence.sentReferenceAssetIds,
    processingChain,
  };
}

async function generatePptAssetImageWithMiniMax(input: { request: PptAssetRequest; providerRequest: ReturnType<typeof buildPptAssetImageGenerationRequest>; config: ImageProviderConfig }): Promise<PptGeneratedAsset> {
  if (!input.config.minimaxCliScript) throw new Error("missing_MINIMAX_CLI_SCRIPT");
  const raw = await generateImageWithMiniMaxCli({ cliScript: input.config.minimaxCliScript, prompt: input.request.transparentBackground ? String(buildOpaqueForegroundFallbackBody(input.providerRequest.body).prompt) : String(input.providerRequest.body.prompt), aspectRatio: input.request.aspectRatio, timeoutMs: input.config.timeoutMs });
  let processed = raw; const chain: PptGeneratedAsset["processingChain"] = [];
  if (!input.request.transparentBackground) {
    processed = await sharp(raw).png().toBuffer();
    if (!processed.equals(raw)) chain.push({ operation: "format_conversion", sourceSha256: sha256(raw), targetSha256: sha256(processed) });
  }
  if (input.request.transparentBackground) { if (!input.config.transparentAssetFallbackCommand) throw new Error("ppt_asset_background_remover_not_configured"); processed = await removeOpaqueBackground({ buffer: raw, command: input.config.transparentAssetFallbackCommand }); chain.push({ operation: "remove_background", sourceSha256: sha256(raw), targetSha256: sha256(processed) }); }
  const buffer = await normalizePptAssetBuffer(processed, input.request); if (!buffer.equals(processed)) chain.push({ operation: "resize", sourceSha256: sha256(processed), targetSha256: sha256(buffer) });
  const validation = validateImageBuffer(buffer); if (!validation.valid || (input.request.transparentBackground && !hasPngAlpha(buffer))) throw new Error("invalid_ppt_asset_image_output");
  const fileName = `${sanitizeFileSegment(input.request.assetId)}-${Date.now()}${validation.extension}`; const stored = writeLocalArtifact({ category: "image-artifacts", fileName, buffer });
  return { fileName, storageRef: stored.localOutput, sha256: sha256(buffer), bytes: buffer.length, width: validation.width, height: validation.height, mime: validation.mime, transparentBackgroundVerified: input.request.transparentBackground ? hasPngAlpha(buffer) : false, provider: "minimax", model: input.config.model, clientRequestId: randomUUID(), providerRequestId: null, providerTaskId: null, sentReferenceAssetIds: input.providerRequest.evidence.sentReferenceAssetIds, processingChain: chain };
}

async function generatePptAssetImageWithCurl(input: { request: PptAssetRequest; providerRequest: ReturnType<typeof buildPptAssetImageGenerationRequest>; config: ImageProviderConfig }): Promise<PptGeneratedAsset> {
  const body = input.request.transparentBackground ? buildOpaqueForegroundFallbackBody(input.providerRequest.body) : input.providerRequest.body;
  const payload = await generateImageWithCurlProvider({ url: buildImageGenerationsUrl(input.config.baseUrl), apiKey: input.config.apiKey, body, timeoutMs: input.config.timeoutMs });
  const result = extractImageResult(payload); const raw = result.kind === "b64" ? result.buffer : await downloadImage(result.url, input.config.timeoutMs);
  let processed = raw; const chain: PptGeneratedAsset["processingChain"] = [];
  if (input.request.transparentBackground) { if (!input.config.transparentAssetFallbackCommand) throw new Error("ppt_asset_background_remover_not_configured"); processed = await removeOpaqueBackground({ buffer: raw, command: input.config.transparentAssetFallbackCommand }); chain.push({ operation: "remove_background", sourceSha256: sha256(raw), targetSha256: sha256(processed) }); }
  const buffer = await normalizePptAssetBuffer(processed, input.request); if (!buffer.equals(processed)) chain.push({ operation: "resize", sourceSha256: sha256(processed), targetSha256: sha256(buffer) });
  const validation = validateImageBuffer(buffer); if (!validation.valid || (input.request.transparentBackground && !hasPngAlpha(buffer))) throw new Error("invalid_ppt_asset_image_output");
  const fileName = `${sanitizeFileSegment(input.request.assetId)}-${Date.now()}${validation.extension}`; const stored = writeLocalArtifact({ category: "image-artifacts", fileName, buffer });
  return { fileName, storageRef: stored.localOutput, sha256: sha256(buffer), bytes: buffer.length, width: validation.width, height: validation.height, mime: validation.mime, transparentBackgroundVerified: input.request.transparentBackground ? hasPngAlpha(buffer) : false, provider: `${input.config.channel}_curl`, model: input.config.model, clientRequestId: randomUUID(), providerRequestId: null, providerTaskId: null, sentReferenceAssetIds: input.providerRequest.evidence.sentReferenceAssetIds, processingChain: chain };
}

async function generatePptAssetImageWithWrapper(input: {
  request: PptAssetRequest;
  providerRequest: ReturnType<typeof buildPptAssetImageGenerationRequest>;
  config: ImageProviderConfig;
}): Promise<PptGeneratedAsset> {
  const clientRequestId = randomUUID();
  const opaqueFallback = input.request.transparentBackground;
  const prompt = opaqueFallback
    ? String(buildOpaqueForegroundFallbackBody(input.providerRequest.body).prompt)
    : String(input.providerRequest.body.prompt);
  const rawBuffer = await generateImageWithExternalWrapper({
    powerShell: input.config.wrapperPowerShell,
    script: input.config.wrapperScript!,
    apiKey: input.config.apiKey,
    baseUrl: input.config.baseUrl,
    model: input.config.model,
    prompt,
    size: String(input.providerRequest.body.size),
    quality: String(input.providerRequest.body.quality),
    timeoutMs: input.config.timeoutMs,
  });
  let processedBuffer = rawBuffer;
  const processingChain: PptGeneratedAsset["processingChain"] = [];
  if (opaqueFallback) {
    if (!input.config.transparentAssetFallbackCommand) throw new Error("ppt_asset_background_remover_not_configured");
    processedBuffer = await removeOpaqueBackground({ buffer: rawBuffer, command: input.config.transparentAssetFallbackCommand });
    processingChain.push({ operation: "remove_background", sourceSha256: sha256(rawBuffer), targetSha256: sha256(processedBuffer) });
  }
  const buffer = await normalizePptAssetBuffer(processedBuffer, input.request);
  if (!buffer.equals(processedBuffer)) processingChain.push({ operation: "resize", sourceSha256: sha256(processedBuffer), targetSha256: sha256(buffer) });
  const validation = validateImageBuffer(buffer);
  if (!validation.valid) throw new Error("invalid_ppt_asset_image_output");
  if (input.request.transparentBackground && !hasPngAlpha(buffer)) throw new Error("ppt_asset_transparent_background_not_verified");
  const fileName = `${sanitizeFileSegment(input.request.assetId)}-${Date.now()}${validation.extension}`;
  const stored = writeLocalArtifact({ category: "image-artifacts", fileName, buffer });
  return {
    fileName, storageRef: stored.localOutput, sha256: sha256(buffer), bytes: buffer.length,
    width: validation.width, height: validation.height, mime: validation.mime,
    transparentBackgroundVerified: input.request.transparentBackground ? hasPngAlpha(buffer) : false,
    provider: `${input.config.channel}_wrapper`, model: input.config.model, clientRequestId,
    providerRequestId: null, providerTaskId: null,
    sentReferenceAssetIds: input.providerRequest.evidence.sentReferenceAssetIds, processingChain,
  };
}

async function requestPptAssetGeneration(input: {
  config: ImageProviderConfig;
  body: Record<string, unknown>;
  clientRequestId: string;
}): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetch(buildImageGenerationsUrl(input.config.baseUrl), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.config.apiKey}`,
          "Content-Type": "application/json",
          "X-Client-Request-Id": input.clientRequestId,
        },
        body: JSON.stringify(input.body),
        signal: AbortSignal.timeout(input.config.timeoutMs),
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function buildOpaqueForegroundFallbackBody(providerBody: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {
    ...providerBody,
    prompt: `${String(providerBody.prompt)}\n透明背景不受该 Provider 支持。请只生成一个单独的教学教具，居中、边缘清晰、纯白且无阴影无渐变背景；不要出现文字、数字、公式、品牌或水印。`,
  };
  delete body.background;
  return body;
}

function isTransparentBackgroundUnsupported(responseText: string) {
  return /transparent background is not supported/i.test(responseText);
}

async function removeOpaqueBackground(input: { buffer: Buffer; command: string }): Promise<Buffer> {
  const workingDir = await mkdtemp(path.join(tmpdir(), "shanhaiedu-rembg-"));
  const sourcePath = path.join(workingDir, "provider-source.png");
  const targetPath = path.join(workingDir, "foreground.png");
  try {
    await writeFile(sourcePath, input.buffer);
    await execFileAsync(input.command, ["i", sourcePath, targetPath], { windowsHide: true, timeout: 180000 });
    return await readFile(targetPath);
  } catch {
    throw new Error("ppt_asset_background_removal_failed");
  } finally {
    await rm(workingDir, { recursive: true, force: true });
  }
}

async function normalizePptAssetBuffer(buffer: Buffer, request: PptAssetRequest): Promise<Buffer> {
  const target = request.aspectRatio === "16:9"
    ? { width: 1920, height: 1080 }
    : { width: 1024, height: 1024 };
  const validation = validateImageBuffer(buffer);
  if (!validation.valid || (validation.width === target.width && validation.height === target.height)) return buffer;
  return sharp(buffer)
    .resize(target.width, target.height, {
      fit: "cover",
      background: request.transparentBackground ? { r: 0, g: 0, b: 0, alpha: 0 } : "#FFFFFF",
    })
    .png()
    .toBuffer();
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
    transparentAssetFallbackCommand: env.PPT_ASSET_REMBG_COMMAND?.trim() || null,
    wrapperScript: env.PPT_ASSET_IMAGEGEN_WRAPPER_SCRIPT?.trim() || null,
    wrapperPowerShell: env.PPT_ASSET_IMAGEGEN_WRAPPER_POWERSHELL?.trim() || "powershell.exe",
    curlProvider: env.PPT_ASSET_IMAGE_PROVIDER?.trim() === "curl",
    minimaxCliScript: env.MINIMAX_CLI_POWERSHELL_SCRIPT?.trim() || null,
  };
}

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
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

function validateImageBuffer(buffer: Buffer): { valid: true; mime: "image/png" | "image/jpeg"; extension: ".png" | ".jpg"; width: number; height: number } | { valid: false } {
  if (buffer.length < MIN_IMAGE_BYTES) {
    return { valid: false };
  }

  if (isValidPng(buffer)) {
    return { valid: true, mime: "image/png", extension: ".png", width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  const jpegDimensions = readJpegDimensions(buffer);
  if (isValidJpeg(buffer) && jpegDimensions) {
    return { valid: true, mime: "image/jpeg", extension: ".jpg", ...jpegDimensions };
  }

  return { valid: false };
}

function hasPngAlpha(buffer: Buffer): boolean {
  if (!isValidPng(buffer) || buffer.length < 26) return false;
  const colorType = buffer[25];
  return colorType === 4 || colorType === 6;
}

function readJpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (segmentLength < 2 || offset + segmentLength + 2 > buffer.length) return null;
    if (marker === 0xc0 || marker === 0xc2) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += segmentLength + 2;
  }
  return null;
}

function extractProviderRequestId(response: Response, payload: unknown): string | null {
  const headerId = response.headers.get("x-request-id")?.trim() || response.headers.get("request-id")?.trim();
  if (headerId) return headerId;
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of ["request_id", "requestId", "id"]) {
      if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
    }
  }
  return null;
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
