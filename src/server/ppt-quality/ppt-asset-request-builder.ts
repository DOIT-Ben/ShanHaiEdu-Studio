import { hashRunInput } from "@/server/execution/run-input-snapshot";
import type { PptDesignPackage, PptPageSpec } from "./ppt-quality-types";
import type { PptAssetRequest, PptAssetRequestBatch } from "./ppt-asset-types";

const FORBIDDEN_EXACT_CONTENT = /\d|[%％=＝+＋×÷]|答案|公式|题干|精确数量/g;
const NEGATIVE_CONSTRAINT = /不得(?:出现|包含)?|禁止(?:出现|包含)?|不要(?:出现|包含)?|不含|无(?:任何)?/;

export class PptAssetContractConflictError extends Error {
  constructor(readonly assetId: string) {
    super(`asset_contract_conflict:${assetId}`);
  }
}

export class PptAssetPromptPolicyError extends Error {
  constructor(readonly assetId: string) {
    super(`asset_prompt_contains_exact_content:${assetId}`);
  }
}

export function buildPptAssetRequestBatch(
  designPackage: PptDesignPackage,
  scope: PptAssetRequestBatch["scope"] = "key_samples",
): PptAssetRequestBatch {
  const designPackageDigest = hashRunInput(designPackage);
  const selectedPageIds = scope === "key_samples"
    ? new Set(designPackage.samplePlan.samplePageIds)
    : new Set(designPackage.pageSpecs.map((page) => page.pageId));
  const byAssetId = new Map<string, PptAssetRequest>();

  for (const page of designPackage.pageSpecs.filter((candidate) => selectedPageIds.has(candidate.pageId))) {
    addRequest(byAssetId, sceneRequest(page));
    for (const asset of page.aiAssets) {
      if (asset.containsEmbeddedText || asset.containsExactMath || containsForbiddenExactContent(asset.promptBrief)) {
        throw new PptAssetPromptPolicyError(asset.assetId);
      }
      addRequest(byAssetId, finalizeRequest({
        assetId: asset.assetId,
        assetKind: "AI_ASSET",
        pageIds: [page.pageId],
        role: asset.role,
        promptBrief: asset.promptBrief,
        negativePrompt: "文字、数字、公式、答案、水印、品牌、二维码、复杂背景",
        aspectRatio: "1:1",
        compositionSafeZone: ["主体完整", "边缘留出透明裁切空间"],
        transparentBackground: true,
        reusePolicy: "reuse_identical",
        referenceAssetIds: [],
      }));
    }
  }

  const requests = [...byAssetId.values()].sort((left, right) => left.assetId.localeCompare(right.assetId));
  const batch = {
    schemaVersion: "ppt-asset-request-batch.v1" as const,
    scope,
    designPackageDigest,
    requests,
  };
  return { ...batch, batchDigest: hashRunInput(batch) };
}

function sceneRequest(page: PptPageSpec): PptAssetRequest {
  if (containsForbiddenExactContent(page.aiScene.brief)) {
    throw new PptAssetPromptPolicyError(page.aiScene.assetId);
  }
  return finalizeRequest({
    assetId: page.aiScene.assetId,
    assetKind: "AI_SCENE",
    pageIds: [page.pageId],
    role: "page_scene",
    promptBrief: page.aiScene.brief,
    negativePrompt: "文字、数字、公式、答案、精确可数对象、水印、品牌、二维码",
    aspectRatio: "16:9",
    compositionSafeZone: [...page.layoutConstraints],
    transparentBackground: false,
    reusePolicy: "page_scoped",
    referenceAssetIds: [],
  });
}

function containsForbiddenExactContent(value: string): boolean {
  for (const match of value.matchAll(FORBIDDEN_EXACT_CONTENT)) {
    const prefix = value.slice(Math.max(0, lastClauseBoundary(value, match.index ?? 0)), match.index);
    if (!NEGATIVE_CONSTRAINT.test(prefix)) return true;
  }
  return false;
}

function lastClauseBoundary(value: string, index: number): number {
  const boundary = Math.max(
    value.lastIndexOf("。", index - 1),
    value.lastIndexOf("；", index - 1),
    value.lastIndexOf(";", index - 1),
    value.lastIndexOf("！", index - 1),
    value.lastIndexOf("？", index - 1),
    value.lastIndexOf("\n", index - 1),
  );
  return boundary + 1;
}

function finalizeRequest(
  input: Omit<PptAssetRequest, "promptDigest" | "inputHash">,
): PptAssetRequest {
  const promptDigest = hashRunInput({
    promptBrief: input.promptBrief,
    negativePrompt: input.negativePrompt,
    aspectRatio: input.aspectRatio,
    compositionSafeZone: input.compositionSafeZone,
  });
  const withPrompt = { ...input, promptDigest };
  return { ...withPrompt, inputHash: hashRunInput(withPrompt) };
}

function addRequest(byAssetId: Map<string, PptAssetRequest>, incoming: PptAssetRequest): void {
  const existing = byAssetId.get(incoming.assetId);
  if (!existing) {
    byAssetId.set(incoming.assetId, incoming);
    return;
  }

  if (existing.reusePolicy === "page_scoped" && !existing.pageIds.every((pageId) => incoming.pageIds.includes(pageId))) {
    throw new PptAssetContractConflictError(incoming.assetId);
  }

  const comparable = (request: PptAssetRequest) => ({
    ...request,
    pageIds: [],
    inputHash: "",
  });
  if (hashRunInput(comparable(existing)) !== hashRunInput(comparable(incoming))) {
    throw new PptAssetContractConflictError(incoming.assetId);
  }

  const pageIds = [...new Set([...existing.pageIds, ...incoming.pageIds])].sort();
  const merged = { ...existing, pageIds };
  const { inputHash: _inputHash, ...semanticRequest } = merged;
  byAssetId.set(incoming.assetId, { ...merged, inputHash: hashRunInput(semanticRequest) });
}
