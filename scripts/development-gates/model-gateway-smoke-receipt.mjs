import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { collectGitVerificationSubject } from "./verification-subject.mjs";

export const MODEL_GATEWAY_SMOKE_RECEIPT_PATH = ".tmp/model-gateway-smoke/receipt.json";
export const MODEL_GATEWAY_SMOKE_RECEIPT_SCHEMA = "shanhai-model-gateway-smoke-receipt.v1";
export const MODEL_GATEWAY_MODELS = Object.freeze({
  agent: "gpt-5.6",
  text: "deepseek",
  image: "image-2",
  pptImage: "nanobanana",
  video: "video-grok",
  tts: "speech-2.8-hd",
});

export function verifyModelGatewaySmokeReceipt({ root = process.cwd(), now = new Date(), maxAgeHours = 24 } = {}) {
  const receiptPath = path.resolve(root, ...MODEL_GATEWAY_SMOKE_RECEIPT_PATH.split("/"));
  if (!existsSync(receiptPath)) throw new Error("MODEL_GATEWAY_SMOKE_RECEIPT_MISSING");
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  if (receipt?.schemaVersion !== MODEL_GATEWAY_SMOKE_RECEIPT_SCHEMA) throw new Error("MODEL_GATEWAY_SMOKE_RECEIPT_SCHEMA_INVALID");
  const generatedAt = parseTimestamp(receipt.generatedAt);
  const current = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(current.getTime()) || current.getTime() - generatedAt.getTime() > maxAgeHours * 60 * 60 * 1000 || generatedAt.getTime() > current.getTime() + 5 * 60 * 1000) {
    throw new Error("MODEL_GATEWAY_SMOKE_RECEIPT_EXPIRED");
  }
  const subject = collectGitVerificationSubject(root);
  if (!isDeepStrictEqual(receipt.subject, subject)) throw new Error("MODEL_GATEWAY_SMOKE_RECEIPT_SUBJECT_MISMATCH");
  if (!isDeepStrictEqual(receipt.models, MODEL_GATEWAY_MODELS)) throw new Error("MODEL_GATEWAY_MODEL_MAPPING_MISMATCH");
  if (!/^[a-f0-9]{64}$/u.test(receipt.configDigest ?? "")) throw new Error("MODEL_GATEWAY_CONFIG_DIGEST_INVALID");
  const checks = receipt.checks;
  for (const capability of ["models", "agent", "text", "image", "pptImage", "tts", "video"]) {
    if (checks?.[capability]?.ok !== true) throw new Error(`MODEL_GATEWAY_${capability.toUpperCase()}_CHECK_FAILED`);
  }
  if (checks.models.requiredModelsPresent !== true || checks.video.status !== "completed" ||
      !Number.isSafeInteger(checks.image.bytes) || checks.image.bytes <= 0 ||
      !Number.isSafeInteger(checks.pptImage.bytes) || checks.pptImage.bytes <= 0 ||
      !Number.isSafeInteger(checks.tts.bytes) || checks.tts.bytes <= 0 ||
      !Number.isSafeInteger(checks.video.bytes) || checks.video.bytes <= 0) {
    throw new Error("MODEL_GATEWAY_ARTIFACT_CHECK_FAILED");
  }
  if (!["agent", "text", "image", "pptImage", "tts", "video"].every((capability) => checks[capability].requestIdPresent === true)) {
    throw new Error("MODEL_GATEWAY_REQUEST_ID_MISSING");
  }
  for (const capability of ["agent", "text", "image", "pptImage", "tts", "video"]) {
    if (checks[capability].model !== MODEL_GATEWAY_MODELS[capability]) throw new Error("MODEL_GATEWAY_CHECK_MODEL_MISMATCH");
  }
  return { ok: true, passed: true, status: "passed", matchedPaths: [], verifiedAt: receipt.generatedAt, receiptPath: MODEL_GATEWAY_SMOKE_RECEIPT_PATH };
}

export function gatewayConfigDigest(configs) {
  const digest = createHash("sha256").update("shanhai.model-gateway-config.v1\0", "utf8");
  for (const capability of ["agent", "text", "image", "pptImage", "video", "tts"]) {
    const config = configs[capability];
    digest.update(`${capability}\0${config.baseUrl}\0${config.model}\0${config.apiKey}\n`, "utf8");
  }
  return digest.digest("hex");
}

function parseTimestamp(value) {
  const parsed = typeof value === "string" ? new Date(value) : new Date(Number.NaN);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) throw new Error("MODEL_GATEWAY_SMOKE_TIMESTAMP_INVALID");
  return parsed;
}
