import { hashRunInput } from "@/server/execution/run-input-snapshot";
import type { PptAssetRequest, PptImageProviderRequestEvidence } from "./ppt-asset-types";

export class PptAssetReferenceTransportRequiredError extends Error {
  constructor(readonly assetId: string) {
    super(`ppt_asset_reference_transport_required:${assetId}`);
  }
}

export function buildPptAssetImageGenerationRequest(input: {
  request: PptAssetRequest;
  model: string;
}): {
  body: Record<string, unknown>;
  evidence: PptImageProviderRequestEvidence;
} {
  if (input.request.referenceAssetIds.length > 0) {
    throw new PptAssetReferenceTransportRequiredError(input.request.assetId);
  }

  const body = {
    model: input.model,
    prompt: [
      input.request.promptBrief,
      `构图安全区：${input.request.compositionSafeZone.join("；")}`,
      `禁止内容：${input.request.negativePrompt}`,
    ].join("\n"),
    size: input.request.aspectRatio === "16:9" ? "1536x1024" : "1024x1024",
    quality: "high",
    response_format: "b64_json",
    ...(input.request.transparentBackground ? { background: "transparent" } : {}),
  };
  return {
    body,
    evidence: {
      assetId: input.request.assetId,
      pageIds: [...input.request.pageIds],
      inputHash: input.request.inputHash,
      promptDigest: input.request.promptDigest,
      referenceAssetIds: [],
      sentReferenceAssetIds: [],
      transport: "json_generation",
      requestBodyDigest: hashRunInput(body),
    },
  };
}

export function buildPptAssetImageEditRequest(input: {
  request: PptAssetRequest;
  model: string;
  references: Array<{ assetId: string; storageRef: string; sha256: string }>;
}): {
  fields: Record<string, unknown>;
  attachments: Array<{ assetId: string; storageRef: string; sha256: string }>;
  evidence: PptImageProviderRequestEvidence;
} {
  const referenceIds = input.references.map((reference) => reference.assetId);
  if (!sameSet(referenceIds, input.request.referenceAssetIds)) {
    throw new Error(`ppt_asset_reference_set_mismatch:${input.request.assetId}`);
  }
  const fields = {
    model: input.model,
    prompt: [input.request.promptBrief, `构图安全区：${input.request.compositionSafeZone.join("；")}`, `禁止内容：${input.request.negativePrompt}`].join("\n"),
    size: input.request.aspectRatio === "16:9" ? "1536x1024" : "1024x1024",
    quality: "high",
    ...(input.request.transparentBackground ? { background: "transparent" } : {}),
  };
  const attachments = input.references.map((reference) => ({ ...reference }));
  return {
    fields,
    attachments,
    evidence: {
      assetId: input.request.assetId,
      pageIds: [...input.request.pageIds],
      inputHash: input.request.inputHash,
      promptDigest: input.request.promptDigest,
      referenceAssetIds: [...input.request.referenceAssetIds],
      sentReferenceAssetIds: referenceIds,
      transport: "multipart_edit",
      requestBodyDigest: hashRunInput({ fields, attachments }),
    },
  };
}

function sameSet(left: string[], right: string[]): boolean {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.length === sortedRight.length && sortedLeft.every((value, index) => value === sortedRight[index]);
}
