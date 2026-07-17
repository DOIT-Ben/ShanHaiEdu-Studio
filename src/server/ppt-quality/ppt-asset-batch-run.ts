import { buildPptAssetRequestBatch } from "./ppt-asset-request-builder";
import type { PptDesignPackage } from "./ppt-quality-types";
import type { PptAssetManifest, PptAssetManifestEntry, PptAssetRequest, PptGeneratedAsset } from "./ppt-asset-types";
import { createPptAssetManifestDigest, validatePptAssetManifest } from "./ppt-asset-validator";

export type PptAssetBatchRunResult = {
  requestBatch: ReturnType<typeof buildPptAssetRequestBatch>;
  manifest: PptAssetManifest;
  providerSubmissionCount?: number;
};

export type PptAssetBatchLifecycle = {
  loadSucceededUnit: (request: PptAssetRequest) => Promise<PptGeneratedAsset | null>;
  onSubmissionStarted: (request: PptAssetRequest) => Promise<void>;
  onSubmissionSucceeded: (request: PptAssetRequest, result: PptGeneratedAsset) => Promise<void>;
  onSubmissionFailed: (request: PptAssetRequest, error: unknown) => Promise<void>;
};

export class PptAssetBatchExecutionError extends Error {
  readonly providerSubmissionCount: number;
  readonly originalError: unknown;

  constructor(error: unknown, providerSubmissionCount: number) {
    super(error instanceof Error ? error.message : String(error));
    this.name = "PptAssetBatchExecutionError";
    this.providerSubmissionCount = providerSubmissionCount;
    this.originalError = error;
  }
}

export async function runPptAssetBatch(input: {
  designPackage: PptDesignPackage;
  generateAsset: (request: PptAssetRequest) => Promise<PptGeneratedAsset>;
  scope?: PptAssetManifest["scope"];
  lifecycle?: PptAssetBatchLifecycle;
}): Promise<PptAssetBatchRunResult> {
  const scope = input.scope ?? "key_samples";
  const requestBatch = buildPptAssetRequestBatch(input.designPackage, scope);
  const entries: PptAssetManifestEntry[] = [];
  let providerSubmissionCount = 0;

  for (const request of requestBatch.requests) {
    let generated = await input.lifecycle?.loadSucceededUnit(request) ?? null;
    if (!generated) {
      try {
        await input.lifecycle?.onSubmissionStarted(request);
      } catch (error) {
        throw new PptAssetBatchExecutionError(error, providerSubmissionCount);
      }
      providerSubmissionCount += 1;
      try {
        generated = await input.generateAsset(request);
      } catch (error) {
        try {
          await input.lifecycle?.onSubmissionFailed(request, error);
        } catch {
          // The original Provider failure remains the batch failure authority.
        }
        throw new PptAssetBatchExecutionError(error, providerSubmissionCount);
      }
      try {
        await input.lifecycle?.onSubmissionSucceeded(request, generated);
      } catch (error) {
        throw new PptAssetBatchExecutionError(error, providerSubmissionCount);
      }
    }
    entries.push({
      assetId: request.assetId,
      assetKind: request.assetKind,
      pageIds: [...request.pageIds],
      sourceAuthority: "provider_generated",
      provider: generated.provider,
      model: generated.model,
      clientRequestId: generated.clientRequestId,
      providerRequestId: generated.providerRequestId,
      providerTaskId: generated.providerTaskId,
      inputHash: request.inputHash,
      promptDigest: request.promptDigest,
      referenceAssetIds: [...request.referenceAssetIds],
      sentReferenceAssetIds: [...generated.sentReferenceAssetIds],
      fileName: generated.fileName,
      storageRef: generated.storageRef,
      sha256: generated.sha256,
      bytes: generated.bytes,
      width: generated.width,
      height: generated.height,
      mime: generated.mime,
      rawAsset: generated.rawAsset ? { ...generated.rawAsset } : generated.rawAsset,
      normalizedAsset: generated.normalizedAsset ? { ...generated.normalizedAsset } : generated.normalizedAsset,
      transparentBackground: generated.transparentBackgroundVerified,
      placeholder: false,
      localSubjectDrawn: false,
      processingChain: generated.processingChain ?? [],
    });
  }

  const manifestWithoutDigest: Omit<PptAssetManifest, "manifestDigest"> = {
    schemaVersion: "ppt-asset-manifest.v1",
    scope,
    designPackageDigest: requestBatch.designPackageDigest,
    requestBatchDigest: requestBatch.batchDigest,
    entries,
  };
  const manifest: PptAssetManifest = {
    ...manifestWithoutDigest,
    manifestDigest: createPptAssetManifestDigest(manifestWithoutDigest),
  };
  const validation = validatePptAssetManifest(manifest, requestBatch);
  if (!validation.valid) {
    throw new Error(`ppt_asset_manifest_invalid:${validation.issues.map((item) => item.code).join(",")}`);
  }
  return { requestBatch, manifest, providerSubmissionCount };
}
