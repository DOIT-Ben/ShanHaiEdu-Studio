import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { writeLocalArtifact } from "@/server/artifact-storage/local-artifact-storage";
import { resolveModelGatewayConfig } from "@/server/model-gateway-config";
import type { ModelGatewayCapability } from "@/server/model-gateway-config";
import type { ArtifactRecord, ProjectRecord } from "@/server/workbench/types";
import type { BusinessSkillContext } from "@/server/agent-runtime/types";
import type { PptAssetRequest, PptGeneratedAsset } from "@/server/ppt-quality/ppt-asset-types";
import { buildPptAssetImageGenerationRequest } from "@/server/ppt-quality/ppt-image-provider-request";
export type ImageGenerationFileEvidence = {
  fileName: string;
  localOutput: string;
  bytes: number;
  sha256: string;
  mime: string;
  width?: number;
  height?: number;
};

export type ImageGenerationResult = {
  fileName: string;
  localOutput: string;
  bytes: number;
  sha256: string;
  imageValid: true;
  mime: "image/png" | "image/jpeg";
  provider: "model_gateway";
  model: string;
  width: number;
  height: number;
  promptDigest: string;
  rawAsset: ImageGenerationFileEvidence;
  normalizedAsset: ImageGenerationFileEvidence & {
    mime: "image/png" | "image/jpeg";
    width: number;
    height: number;
  };
};

type MiniMaxImageProviderConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  backgroundRemovalCommand: string | null;
};

const MIN_IMAGE_BYTES = 32;
const execFileAsync = promisify(execFile);

export async function generateImageFromArtifact(input: {
  project: ProjectRecord;
  artifact: ArtifactRecord;
  userInstruction?: string | null;
  toolInput?: Record<string, unknown>;
  businessSkillContext?: BusinessSkillContext;
}): Promise<ImageGenerationResult> {
  const prompt = buildImageGenerationPrompt(input);
  return generateImageFromPrompt({ project: input.project, prompt, aspectRatio: "16:9" });
}

export async function generateImageFromPrompt(input: {
  project: Pick<ProjectRecord, "id">;
  prompt: string;
  aspectRatio: "16:9" | "1:1";
  fileStem?: string;
  normalizeCanvas?: boolean;
  gatewayCapability?: Extract<ModelGatewayCapability, "image" | "ppt_image">;
}): Promise<ImageGenerationResult> {
  const config = readConfig(process.env, input.gatewayCapability ?? "image");
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("image_prompt_required");
  const providerBuffer = await requestMiniMaxImage({ config, prompt, aspectRatio: input.aspectRatio });
  let buffer = await normalizeMiniMaxProviderFormat(providerBuffer);
  if (input.normalizeCanvas && input.aspectRatio === "16:9") {
    buffer = await sharp(buffer).resize(1920, 1080, { fit: "cover" }).png().toBuffer();
  }
  const validation = validateImageBuffer(buffer);
  if (!validation.valid) {
    throw new Error("invalid_image_output");
  }

  const sourceMetadata = await inspectImageMetadata(providerBuffer);
  const suffix = `${sanitizeFileSegment(input.fileStem ?? input.project.id)}-${Date.now()}`;
  const rawFileName = `${suffix}-provider-raw${sourceMetadata.extension}`;
  const rawStored = writeLocalArtifact({
    category: "image-artifacts",
    fileName: rawFileName,
    buffer: providerBuffer,
  });
  const fileName = `${suffix}-normalized${validation.extension}`;
  const stored = writeLocalArtifact({
    category: "image-artifacts",
    fileName,
    buffer,
  });

  const normalizedSha256 = sha256(buffer);
  return {
    fileName,
    localOutput: stored.localOutput,
    bytes: buffer.length,
    sha256: normalizedSha256,
    imageValid: true,
    mime: validation.mime,
    provider: "model_gateway",
    model: config.model,
    width: validation.width,
    height: validation.height,
    promptDigest: sha256(Buffer.from(prompt, "utf8")),
    rawAsset: {
      fileName: rawFileName,
      localOutput: rawStored.localOutput,
      bytes: providerBuffer.length,
      sha256: sha256(providerBuffer),
      mime: sourceMetadata.mime,
      ...(sourceMetadata.width ? { width: sourceMetadata.width } : {}),
      ...(sourceMetadata.height ? { height: sourceMetadata.height } : {}),
    },
    normalizedAsset: {
      fileName,
      localOutput: stored.localOutput,
      bytes: buffer.length,
      sha256: normalizedSha256,
      mime: validation.mime,
      width: validation.width,
      height: validation.height,
    },
  };
}

export async function generatePptAssetImage(request: PptAssetRequest): Promise<PptGeneratedAsset> {
  const config = readConfig(process.env);
  const providerRequest = buildPptAssetImageGenerationRequest({ request, model: config.model });
  return generatePptAssetImageWithMiniMax({ request, providerRequest, config });
}

async function generatePptAssetImageWithMiniMax(input: {
  request: PptAssetRequest;
  providerRequest: ReturnType<typeof buildPptAssetImageGenerationRequest>;
  config: MiniMaxImageProviderConfig;
}): Promise<PptGeneratedAsset> {
  const prompt = input.request.transparentBackground
    ? String(buildOpaqueForegroundFallbackBody(input.providerRequest.body).prompt)
    : String(input.providerRequest.body.prompt);
  const raw = await requestMiniMaxImage({ config: input.config, prompt, aspectRatio: input.request.aspectRatio });
  const rawMetadata = await inspectPptAssetFileMetadata(raw, "ppt_asset_raw_image_evidence_incomplete");
  let processed = await normalizeMiniMaxProviderFormat(raw);
  const chain: PptGeneratedAsset["processingChain"] = [];
  if (!processed.equals(raw)) {
    chain.push({ operation: "format_conversion", sourceSha256: sha256(raw), targetSha256: sha256(processed) });
  }
  if (input.request.transparentBackground) {
    if (!input.config.backgroundRemovalCommand) throw new Error("ppt_asset_background_remover_not_configured");
    const backgroundRemoved = await removeOpaqueBackground({ buffer: processed, command: input.config.backgroundRemovalCommand });
    chain.push({ operation: "remove_background", sourceSha256: sha256(processed), targetSha256: sha256(backgroundRemoved) });
    processed = backgroundRemoved;
  }
  const buffer = await normalizePptAssetBuffer(processed, input.request);
  if (!buffer.equals(processed)) {
    chain.push({ operation: "resize", sourceSha256: sha256(processed), targetSha256: sha256(buffer) });
  }
  const validation = validateImageBuffer(buffer);
  if (!validation.valid || (input.request.transparentBackground && !hasPngAlpha(buffer))) {
    throw new Error("invalid_ppt_asset_image_output");
  }

  const suffix = `${sanitizeFileSegment(input.request.assetId)}-${Date.now()}`;
  const rawFileName = `${suffix}-provider-raw${rawMetadata.extension}`;
  const normalizedFileName = `${suffix}-normalized${validation.extension}`;
  const rawStored = writeLocalArtifact({ category: "image-artifacts", fileName: rawFileName, buffer: raw });
  const normalizedStored = writeLocalArtifact({ category: "image-artifacts", fileName: normalizedFileName, buffer });
  const rawAsset = {
    fileName: rawFileName,
    storageRef: rawStored.localOutput,
    sha256: sha256(raw),
    bytes: raw.length,
    width: rawMetadata.width,
    height: rawMetadata.height,
    mime: rawMetadata.mime,
  } as const;
  const normalizedAsset = {
    fileName: normalizedFileName,
    storageRef: normalizedStored.localOutput,
    sha256: sha256(buffer),
    bytes: buffer.length,
    width: validation.width,
    height: validation.height,
    mime: validation.mime,
  } as const;
  return {
    fileName: normalizedAsset.fileName,
    storageRef: normalizedAsset.storageRef,
    sha256: normalizedAsset.sha256,
    bytes: normalizedAsset.bytes,
    width: normalizedAsset.width,
    height: normalizedAsset.height,
    mime: normalizedAsset.mime,
    transparentBackgroundVerified: input.request.transparentBackground ? hasPngAlpha(buffer) : false,
    provider: "model_gateway",
    model: input.config.model,
    clientRequestId: randomUUID(),
    providerRequestId: null,
    providerTaskId: null,
    sentReferenceAssetIds: input.providerRequest.evidence.sentReferenceAssetIds,
    rawAsset,
    normalizedAsset,
    processingChain: chain,
  };
}

async function requestMiniMaxImage(input: { config: MiniMaxImageProviderConfig; prompt: string; aspectRatio: string }): Promise<Buffer> {
  const idempotencyKey = `image-${sha256(Buffer.from(`${input.config.model}\0${input.aspectRatio}\0${input.prompt}`, "utf8")).slice(0, 48)}`;
  const response = await fetch(buildMiniMaxImageGenerationUrl(input.config.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.config.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      model: input.config.model,
      prompt: input.prompt,
      size: input.aspectRatio === "16:9" ? "1536x1024" : "1024x1024",
      response_format: "b64_json",
      n: 1,
    }),
    signal: AbortSignal.timeout(input.config.timeoutMs),
  });
  if (!response.ok) throw new Error(`minimax_image_generation_request_failed:http_${response.status}`);
  const payload = await response.json() as { data?: Array<{ b64_json?: unknown; url?: unknown }> };
  const first = payload.data?.[0];
  if (typeof first?.b64_json === "string" && first.b64_json.trim()) {
    return Buffer.from(first.b64_json.replace(/^data:image\/[A-Za-z0-9.+-]+;base64,/i, "").replace(/\s+/g, ""), "base64");
  }
  if (typeof first?.url === "string" && /^https:\/\//i.test(first.url)) {
    const imageResponse = await fetch(first.url, { signal: AbortSignal.timeout(input.config.timeoutMs) });
    if (!imageResponse.ok) throw new Error("model_gateway_image_download_failed");
    return Buffer.from(await imageResponse.arrayBuffer());
  }
  {
    throw new Error("minimax_image_generation_response_invalid");
  }
}

async function normalizeMiniMaxProviderFormat(buffer: Buffer): Promise<Buffer> {
  if (validateImageBuffer(buffer).valid) return buffer;
  try {
    return await sharp(buffer).png().toBuffer();
  } catch {
    throw new Error("invalid_ppt_asset_image_output");
  }
}

export function buildMiniMaxImageGenerationUrl(baseUrl: string) {
  const normalized = baseUrl.replace(/\/+$/, "");
  return `${normalized.endsWith("/v1") ? normalized : `${normalized}/v1`}/images/generations`;
}

function buildOpaqueForegroundFallbackBody(providerBody: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {
    ...providerBody,
    prompt: `${String(providerBody.prompt)}\n透明背景不受该 Provider 支持。请只生成一个单独的教学教具，居中、边缘清晰、纯白且无阴影无渐变背景；不要出现文字、数字、公式、品牌或水印。`,
  };
  delete body.background;
  return body;
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

function readConfig(env: NodeJS.ProcessEnv, capability: Extract<ModelGatewayCapability, "image" | "ppt_image"> = "image"): MiniMaxImageProviderConfig {
  const gateway = resolveModelGatewayConfig(capability, env);

  return {
    apiKey: gateway.apiKey,
    baseUrl: gateway.baseUrl,
    model: gateway.model,
    timeoutMs: Number.parseInt(env.IMAGE_SMOKE_TIMEOUT_MS || env.AIRCODE_PROVIDER_TIMEOUT || "180000", 10),
    backgroundRemovalCommand: env.PPT_ASSET_REMBG_COMMAND?.trim() || null,
  };
}

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
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

export function buildImageGenerationPrompt(input: {
  project: ProjectRecord;
  artifact: ArtifactRecord;
  userInstruction?: string | null;
  toolInput?: Record<string, unknown>;
  businessSkillContext?: BusinessSkillContext;
}) {
  const taskBrief = asRecord(input.toolInput?.taskBrief);
  const goal = optionalText(taskBrief?.goal) || optionalText(input.userInstruction) || input.artifact.summary || input.project.title;
  const constraints = textList(taskBrief?.constraints);
  const excludedOutputs = textList(taskBrief?.excludedOutputs);
  const isVideoAsset = input.artifact.kind === "asset_brief_generate" ||
    input.businessSkillContext?.semanticSlice.toolName === "generate_video_assets";
  const toolDetails = ["prompt", "assetType", "purpose", "style", "composition"]
    .flatMap((key) => {
      const value = optionalText(input.toolInput?.[key]);
      return value ? [`${key}: ${value}`] : [];
    });
  const skillGuidance = input.businessSkillContext?.semanticSlice.guidance
    .map((guidance) => guidance.content.trim())
    .filter(Boolean) ?? [];

  return [
    `任务目标：${goal}。`,
    isVideoAsset
      ? "用途：为脱离教材仍成立的独立创意短片生成当前镜头所需的角色、道具、场景或关键帧参考图；只保留唯一最小课程锚点，不扩张为教案、PPT、成片或整包。"
      : "用途：为当前 TaskBrief 中的课堂/PPT 视觉任务生成一张可供下游使用的图片资产。",
    input.project.subject ? `学科语境：${input.project.subject}。` : "",
    input.project.grade ? `受众语境：${input.project.grade}。` : "",
    input.project.lessonTopic ? `主题语境：${input.project.lessonTopic}。` : "",
    constraints.length ? `必须遵守：${constraints.join("；")}。` : "",
    excludedOutputs.length ? `排除输出：${excludedOutputs.join("、")}。` : "",
    ...toolDetails,
    ...skillGuidance,
    "图片中不要出现品牌、二维码、网址、水印或复杂正文；需要在PPT中编辑的文字不要烘焙进图片。",
    `可信上游 ${input.artifact.kind}：`,
    input.artifact.markdownContent.slice(0, 2000),
  ].filter(Boolean).join("\n");
}

async function inspectImageMetadata(buffer: Buffer): Promise<{
  mime: string;
  extension: string;
  width?: number;
  height?: number;
}> {
  const basic = validateImageBuffer(buffer);
  if (basic.valid) {
    return { mime: basic.mime, extension: basic.extension, width: basic.width, height: basic.height };
  }
  try {
    const metadata = await sharp(buffer).metadata();
    const format = metadata.format?.toLowerCase();
    const extension = format === "jpeg" ? ".jpg" : format ? `.${format}` : ".bin";
    return {
      mime: format ? `image/${format === "jpg" ? "jpeg" : format}` : "application/octet-stream",
      extension,
      ...(metadata.width ? { width: metadata.width } : {}),
      ...(metadata.height ? { height: metadata.height } : {}),
    };
  } catch {
    return { mime: "application/octet-stream", extension: ".bin" };
  }
}

async function inspectPptAssetFileMetadata(
  buffer: Buffer,
  reasonCode: string,
): Promise<{
  mime: "image/png" | "image/jpeg" | "image/webp";
  extension: ".png" | ".jpg" | ".webp";
  width: number;
  height: number;
}> {
  const metadata = await inspectImageMetadata(buffer);
  if (!metadata.width || !metadata.height) throw new Error(reasonCode);
  if (metadata.mime === "image/png") {
    return { mime: metadata.mime, extension: ".png", width: metadata.width, height: metadata.height };
  }
  if (metadata.mime === "image/jpeg") {
    return { mime: metadata.mime, extension: ".jpg", width: metadata.width, height: metadata.height };
  }
  if (metadata.mime === "image/webp") {
    return { mime: metadata.mime, extension: ".webp", width: metadata.width, height: metadata.height };
  }
  throw new Error(reasonCode);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function textList(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.map(optionalText).filter(Boolean))] : [];
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
