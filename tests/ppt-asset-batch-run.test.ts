import { describe, expect, it, vi } from "vitest";
import { PptAssetBatchExecutionError, runPptAssetBatch } from "@/server/ppt-quality/ppt-asset-batch-run";
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

  it("stops after the first failed Provider unit and preserves the submitted count", async () => {
    const succeeded: string[] = [];
    const failed: string[] = [];
    let callIndex = 0;
    const generateAsset = vi.fn(async (request: { assetId: string; transparentBackground: boolean }) => {
      const index = callIndex++;
      if (index === 2) throw new Error("provider rejected unit 3");
      return generatedAsset(request, index);
    });

    const error = await runPptAssetBatch({
      designPackage: validPptDesignPackage(),
      generateAsset,
      lifecycle: {
        loadSucceededUnit: async () => null,
        onSubmissionStarted: async () => undefined,
        onSubmissionSucceeded: async (request) => { succeeded.push(request.assetId); },
        onSubmissionFailed: async (request) => { failed.push(request.assetId); },
      },
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(PptAssetBatchExecutionError);
    expect(error).toMatchObject({ providerSubmissionCount: 3 });
    expect(generateAsset).toHaveBeenCalledTimes(3);
    expect(succeeded).toHaveLength(2);
    expect(failed).toHaveLength(1);
  });

  it("recovers verified terminal units without submitting or charging them again", async () => {
    const packageValue = validPptDesignPackage();
    const firstRunRequests = (await runPptAssetBatch({
      designPackage: packageValue,
      generateAsset: async (request) => generatedAsset(request),
    })).requestBatch.requests;
    const recovered = new Map(firstRunRequests.slice(0, 2).map((request) => [request.assetId, generatedAsset(request)]));
    const generateAsset = vi.fn(async (request: { assetId: string; transparentBackground: boolean }, index = 0) => generatedAsset(request, index));

    const result = await runPptAssetBatch({
      designPackage: packageValue,
      generateAsset,
      lifecycle: {
        loadSucceededUnit: async (request) => recovered.get(request.assetId) ?? null,
        onSubmissionStarted: async () => undefined,
        onSubmissionSucceeded: async () => undefined,
        onSubmissionFailed: async () => undefined,
      },
    });

    expect(result.providerSubmissionCount).toBe(4);
    expect(generateAsset).toHaveBeenCalledTimes(4);
    expect(result.manifest.entries).toHaveLength(6);
  });

  it("does not submit a unit when its persisted submission state is unknown", async () => {
    const generateAsset = vi.fn(async (request: { assetId: string; transparentBackground: boolean }) => generatedAsset(request));

    await expect(runPptAssetBatch({
      designPackage: validPptDesignPackage(),
      generateAsset,
      lifecycle: {
        loadSucceededUnit: async () => null,
        onSubmissionStarted: async () => { throw new Error("submission_unknown"); },
        onSubmissionSucceeded: async () => undefined,
        onSubmissionFailed: async () => undefined,
      },
    })).rejects.toMatchObject({ providerSubmissionCount: 0 });
    expect(generateAsset).not.toHaveBeenCalled();
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
