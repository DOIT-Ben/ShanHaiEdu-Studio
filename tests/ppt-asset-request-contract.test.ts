import { describe, expect, it } from "vitest";
import {
  buildPptAssetRequestBatch,
  PptAssetContractConflictError,
  PptAssetPromptPolicyError,
} from "@/server/ppt-quality/ppt-asset-request-builder";
import { validPptDesignPackage } from "./support/ppt-quality-fixture";

describe("V1 Stage 3B PPT asset request contract", () => {
  it("extracts stable scene and micro-asset requests for approved sample pages", () => {
    const input = validPptDesignPackage();
    const first = buildPptAssetRequestBatch(input, "key_samples");
    const second = buildPptAssetRequestBatch(input, "key_samples");

    expect(first.requests).toHaveLength(6);
    expect(first.requests.map((request) => request.assetKind)).toEqual(expect.arrayContaining(["AI_SCENE", "AI_ASSET"]));
    expect(first.requests.every((request) => request.pageIds.length > 0 && request.promptDigest && request.inputHash)).toBe(true);
    expect(second.batchDigest).toBe(first.batchDigest);
  });

  it("deduplicates an identical reusable asset across sample pages", () => {
    const input = validPptDesignPackage();
    const page02 = input.pageSpecs[1];
    const page05 = input.pageSpecs[4];
    page05.aiAssets = [{ ...page02.aiAssets[0] }];

    const batch = buildPptAssetRequestBatch(input, "key_samples");
    const reused = batch.requests.find((request) => request.assetId === page02.aiAssets[0].assetId)!;

    expect(reused.pageIds).toEqual(["page_02", "page_05"]);
    expect(batch.requests).toHaveLength(5);
  });

  it("rejects conflicting contracts for the same asset id", () => {
    const input = validPptDesignPackage();
    input.pageSpecs[4].aiAssets = [{
      ...input.pageSpecs[1].aiAssets[0],
      promptBrief: "另一个完全不同的透明课堂教具",
    }];

    expect(() => buildPptAssetRequestBatch(input, "key_samples")).toThrow(PptAssetContractConflictError);
  });

  it("does not merge a page-scoped scene across different pages", () => {
    const input = validPptDesignPackage();
    input.pageSpecs[4].aiScene = { ...input.pageSpecs[4].aiScene, assetId: input.pageSpecs[1].aiScene.assetId, brief: input.pageSpecs[1].aiScene.brief };

    expect(() => buildPptAssetRequestBatch(input, "key_samples")).toThrow(PptAssetContractConflictError);
  });

  it("rejects image prompts that bake in exact math or answers", () => {
    const input = validPptDesignPackage();
    input.pageSpecs[4].aiAssets[0] = {
      ...input.pageSpecs[4].aiAssets[0],
      promptBrief: "画出 25%=1/4 的答案卡",
    };

    expect(() => buildPptAssetRequestBatch(input, "key_samples")).toThrow(PptAssetPromptPolicyError);
  });

  it("allows exact-content words when they only appear in negative constraints", () => {
    const input = validPptDesignPackage();
    input.pageSpecs[1].aiScene.brief = "明亮课堂场景。不得出现文字、数字、公式、答案或精确数量。";
    input.pageSpecs[4].aiAssets[0].promptBrief = "一个青绿色观察框。禁止包含题干、公式和答案。";

    expect(() => buildPptAssetRequestBatch(input, "key_samples")).not.toThrow();
  });

  it("still rejects exact content after an unrelated negative clause", () => {
    const input = validPptDesignPackage();
    input.pageSpecs[4].aiAssets[0].promptBrief = "不得出现品牌。画出答案卡。";

    expect(() => buildPptAssetRequestBatch(input, "key_samples")).toThrow(PptAssetPromptPolicyError);
  });
});
