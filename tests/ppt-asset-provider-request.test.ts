import { describe, expect, it } from "vitest";
import {
  buildPptAssetImageEditRequest,
  buildPptAssetImageGenerationRequest,
  PptAssetReferenceTransportRequiredError,
} from "@/server/ppt-quality/ppt-image-provider-request";
import { validPptSampleFixtures } from "./support/ppt-sample-fixture";

describe("V1 Stage 3B PPT asset provider request evidence", () => {
  it("builds a stable disclosed request for one asset", () => {
    const { requestBatch } = validPptSampleFixtures();
    const request = requestBatch.requests.find((candidate) => candidate.assetKind === "AI_SCENE")!;
    const first = buildPptAssetImageGenerationRequest({ request, model: "image-model" });
    const second = buildPptAssetImageGenerationRequest({ request, model: "image-model" });

    expect(first.body).toMatchObject({ model: "image-model", size: "1536x1024", quality: "high" });
    expect(first.evidence).toMatchObject({
      assetId: request.assetId,
      pageIds: request.pageIds,
      inputHash: request.inputHash,
      sentReferenceAssetIds: [],
      transport: "json_generation",
    });
    expect(second.evidence.requestBodyDigest).toBe(first.evidence.requestBodyDigest);
  });

  it("blocks the generation transport when reference assets are required", () => {
    const { requestBatch } = validPptSampleFixtures();
    const request = { ...requestBatch.requests[0], referenceAssetIds: ["approved_style_reference"] };

    expect(() => buildPptAssetImageGenerationRequest({ request, model: "image-model" })).toThrow(PptAssetReferenceTransportRequiredError);
  });

  it("proves the exact references attached to a multipart edit request", () => {
    const { requestBatch } = validPptSampleFixtures();
    const request = { ...requestBatch.requests[0], referenceAssetIds: ["reference_a"] };
    const result = buildPptAssetImageEditRequest({
      request,
      model: "image-model",
      references: [{ assetId: "reference_a", storageRef: "image-artifacts/reference-a.png", sha256: "a".repeat(64) }],
    });

    expect(result.attachments).toHaveLength(1);
    expect(result.evidence).toMatchObject({
      referenceAssetIds: ["reference_a"],
      sentReferenceAssetIds: ["reference_a"],
      transport: "multipart_edit",
    });
  });

  it("rejects a claimed reference set that differs from actual attachments", () => {
    const { requestBatch } = validPptSampleFixtures();
    const request = { ...requestBatch.requests[0], referenceAssetIds: ["reference_a"] };

    expect(() => buildPptAssetImageEditRequest({
      request,
      model: "image-model",
      references: [{ assetId: "reference_b", storageRef: "image-artifacts/reference-b.png", sha256: "b".repeat(64) }],
    })).toThrow(/reference_set_mismatch/);
  });
});
