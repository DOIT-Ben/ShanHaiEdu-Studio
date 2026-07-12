import { buildPptAssetRequestBatch } from "@/server/ppt-quality/ppt-asset-request-builder";
import { createPptAssetManifestDigest } from "@/server/ppt-quality/ppt-asset-validator";
import type { PptAssetManifest } from "@/server/ppt-quality/ppt-asset-types";
import { validPptSampleFixtures } from "./ppt-sample-fixture";

export function validPptFullProductionFixtures() {
  const samples = validPptSampleFixtures();
  const requestBatch = buildPptAssetRequestBatch(samples.designPackage, "full_production");
  const semantic: Omit<PptAssetManifest, "manifestDigest"> = {
    schemaVersion: "ppt-asset-manifest.v1",
    scope: "full_production",
    designPackageDigest: requestBatch.designPackageDigest,
    requestBatchDigest: requestBatch.batchDigest,
    entries: requestBatch.requests.map((request, index) => ({
      assetId: request.assetId,
      assetKind: request.assetKind,
      pageIds: [...request.pageIds],
      sourceAuthority: "provider_generated" as const,
      provider: "test-image-provider",
      model: "test-image-model",
      clientRequestId: `client_${request.assetId}`,
      providerRequestId: null,
      providerTaskId: null,
      inputHash: request.inputHash,
      promptDigest: request.promptDigest,
      referenceAssetIds: [...request.referenceAssetIds],
      sentReferenceAssetIds: [...request.referenceAssetIds],
      fileName: `full-${request.assetId}.png`,
      storageRef: `image-artifacts/full-${request.assetId}.png`,
      sha256: (index + 1).toString(16).padStart(2, "0").repeat(32).slice(0, 64),
      bytes: 4096 + index,
      width: request.assetKind === "AI_SCENE" ? 1920 : 1024,
      height: request.assetKind === "AI_SCENE" ? 1080 : 1024,
      mime: "image/png" as const,
      transparentBackground: request.transparentBackground,
      placeholder: false as const,
      localSubjectDrawn: false as const,
      processingChain: [],
    })),
  };
  const manifest: PptAssetManifest = { ...semantic, manifestDigest: createPptAssetManifestDigest(semantic) };
  return { ...samples, requestBatch, manifest };
}
