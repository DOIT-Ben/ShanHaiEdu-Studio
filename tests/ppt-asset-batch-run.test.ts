import { describe, expect, it, vi } from "vitest";
import { runPptAssetBatch } from "@/server/ppt-quality/ppt-asset-batch-run";
import { validPptDesignPackage } from "./support/ppt-quality-fixture";

describe("V1 Stage 3B PPT asset batch runner", () => {
  it("generates every sample request once and seals a valid manifest", async () => {
    const generateAsset = vi.fn(async (request: { assetId: string; transparentBackground: boolean }, index = 0) => generatedAsset(request, index));

    const result = await runPptAssetBatch({ designPackage: validPptDesignPackage(), generateAsset });

    expect(generateAsset).toHaveBeenCalledTimes(6);
    expect(result.manifest.entries).toHaveLength(6);
    expect(result.manifest.entries[0]).toMatchObject({
      provider: "minimax",
      model: "test-model",
      rawAsset: {
        fileName: expect.stringMatching(/provider-raw\.png$/),
        storageRef: expect.stringContaining("provider-raw"),
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        bytes: 4096,
        mime: "image/png",
        width: expect.any(Number),
        height: expect.any(Number),
      },
      normalizedAsset: {
        fileName: expect.stringMatching(/normalized\.png$/),
        storageRef: expect.stringContaining("normalized"),
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        bytes: 4096,
        mime: "image/png",
        width: expect.any(Number),
        height: expect.any(Number),
      },
    });
    expect(result.manifest.manifestDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fails closed when a generated PPT image omits either raw or normalized file evidence", async () => {
    await expect(runPptAssetBatch({
      designPackage: validPptDesignPackage(),
      generateAsset: async (request) => {
        const missingRaw = generatedAsset(request);
        Reflect.deleteProperty(missingRaw, "rawAsset");
        return missingRaw;
      },
    })).rejects.toThrow(/asset_raw_evidence_missing/);

    await expect(runPptAssetBatch({
      designPackage: validPptDesignPackage(),
      generateAsset: async (request) => {
        const missingNormalized = generatedAsset(request);
        Reflect.deleteProperty(missingNormalized, "normalizedAsset");
        return missingNormalized;
      },
    })).rejects.toThrow(/asset_normalized_evidence_missing/);
  });

  it("fails the batch when delivered transparency contradicts the request", async () => {
    await expect(runPptAssetBatch({
      designPackage: validPptDesignPackage(),
      generateAsset: async (request) => ({
        ...generatedAsset(request),
        transparentBackgroundVerified: false,
      }),
    })).rejects.toThrow(/asset_transparency_mismatch/);
  });
});

function hashFor(value: string): string {
  return Buffer.from(value).toString("hex").padEnd(64, "0").slice(0, 64);
}

function generatedAsset(request: { assetId: string; transparentBackground: boolean }, index = 0) {
  const width = request.transparentBackground ? 1024 : 1920;
  const height = request.transparentBackground ? 1024 : 1080;
  const normalizedSha256 = hashFor(`${request.assetId}-normalized`);
  return {
    fileName: `${request.assetId}-normalized.png`,
    storageRef: `image-artifacts/${request.assetId}-normalized.png`,
    sha256: normalizedSha256,
    bytes: 4096,
    width,
    height,
    mime: "image/png" as const,
    transparentBackgroundVerified: request.transparentBackground,
    provider: "minimax",
    model: "test-model",
    clientRequestId: `client_${request.assetId}_${index}`,
    providerRequestId: null,
    providerTaskId: null,
    sentReferenceAssetIds: [],
    rawAsset: {
      fileName: `${request.assetId}-provider-raw.png`,
      storageRef: `image-artifacts/${request.assetId}-provider-raw.png`,
      sha256: normalizedSha256,
      bytes: 4096,
      width,
      height,
      mime: "image/png" as const,
    },
    normalizedAsset: {
      fileName: `${request.assetId}-normalized.png`,
      storageRef: `image-artifacts/${request.assetId}-normalized.png`,
      sha256: normalizedSha256,
      bytes: 4096,
      width,
      height,
      mime: "image/png" as const,
    },
  };
}
