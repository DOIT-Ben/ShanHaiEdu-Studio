import { describe, expect, it, vi } from "vitest";
import { runPptAssetBatch } from "@/server/ppt-quality/ppt-asset-batch-run";
import { validPptDesignPackage } from "./support/ppt-quality-fixture";

describe("V1 Stage 3B PPT asset batch runner", () => {
  it("generates every sample request once and seals a valid manifest", async () => {
    const generateAsset = vi.fn(async (request: { assetId: string; transparentBackground: boolean }, index = 0) => ({
      fileName: `${request.assetId}.png`,
      storageRef: `image-artifacts/${request.assetId}.png`,
      sha256: hashFor(request.assetId),
      bytes: 4096,
      width: request.transparentBackground ? 1024 : 1920,
      height: request.transparentBackground ? 1024 : 1080,
      mime: "image/png" as const,
      transparentBackgroundVerified: request.transparentBackground,
      provider: "test-provider",
      model: "test-model",
      clientRequestId: `client_${request.assetId}_${index}`,
      providerRequestId: null,
      providerTaskId: null,
      sentReferenceAssetIds: [],
    }));

    const result = await runPptAssetBatch({ designPackage: validPptDesignPackage(), generateAsset });

    expect(generateAsset).toHaveBeenCalledTimes(6);
    expect(result.manifest.entries).toHaveLength(6);
    expect(result.manifest.manifestDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fails the batch when delivered transparency contradicts the request", async () => {
    await expect(runPptAssetBatch({
      designPackage: validPptDesignPackage(),
      generateAsset: async (request) => ({
        fileName: `${request.assetId}.png`,
        storageRef: `image-artifacts/${request.assetId}.png`,
        sha256: hashFor(request.assetId),
        bytes: 4096,
        width: 1024,
        height: 1024,
        mime: "image/png",
        transparentBackgroundVerified: false,
        provider: "test-provider",
        model: "test-model",
        clientRequestId: `client_${request.assetId}`,
        providerRequestId: null,
        providerTaskId: null,
        sentReferenceAssetIds: [],
      }),
    })).rejects.toThrow(/asset_transparency_mismatch/);
  });
});

function hashFor(value: string): string {
  return Buffer.from(value).toString("hex").padEnd(64, "0").slice(0, 64);
}
