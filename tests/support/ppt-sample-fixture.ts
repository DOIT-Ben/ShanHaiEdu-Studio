import { buildPptAssetRequestBatch } from "@/server/ppt-quality/ppt-asset-request-builder";
import { createPptAssetManifestDigest } from "@/server/ppt-quality/ppt-asset-validator";
import { createPptKeySampleSetDigest } from "@/server/ppt-quality/ppt-sample-validator";
import type {
  PptAssetFileEvidence,
  PptAssetManifest,
  PptAssetManifestEntry,
  PptAssetProcessingOperation,
  PptAssetRequestBatch,
  PptKeySampleSet,
  PptSampleApproval,
} from "@/server/ppt-quality/ppt-asset-types";
import type { PptDesignPackage } from "@/server/ppt-quality/ppt-quality-types";
import { validPptDesignPackage } from "./ppt-quality-fixture";

export function validPptSampleFixtures(): {
  designPackage: PptDesignPackage;
  requestBatch: PptAssetRequestBatch;
  manifest: PptAssetManifest;
  sampleSet: PptKeySampleSet;
  approval: PptSampleApproval;
} {
  const designPackage = validPptDesignPackage();
  const requestBatch = buildPptAssetRequestBatch(designPackage, "key_samples");
  const manifestWithoutDigest: Omit<PptAssetManifest, "manifestDigest"> = {
    schemaVersion: "ppt-asset-manifest.v1",
    scope: "key_samples",
    designPackageDigest: requestBatch.designPackageDigest,
    requestBatchDigest: requestBatch.batchDigest,
    entries: requestBatch.requests.map((request, index) => ({
      assetId: request.assetId,
      assetKind: request.assetKind,
      pageIds: [...request.pageIds],
      sourceAuthority: "provider_generated",
      provider: "test-image-provider",
      model: "test-image-model",
      clientRequestId: `client_${request.assetId}`,
      providerRequestId: null,
      providerTaskId: null,
      inputHash: request.inputHash,
      promptDigest: request.promptDigest,
      referenceAssetIds: [...request.referenceAssetIds],
      sentReferenceAssetIds: [...request.referenceAssetIds],
      fileName: `${request.assetId}.png`,
      storageRef: `image-artifacts/${request.assetId}.png`,
      sha256: hexadecimalHash(index + 1),
      bytes: 4096 + index,
      width: request.assetKind === "AI_SCENE" ? 1920 : 1024,
      height: request.assetKind === "AI_SCENE" ? 1080 : 1024,
      mime: "image/png",
      rawAsset: {
        fileName: `${request.assetId}-provider-raw.png`,
        storageRef: `image-artifacts/${request.assetId}-provider-raw.png`,
        sha256: hexadecimalHash(index + 1),
        bytes: 4096 + index,
        width: request.assetKind === "AI_SCENE" ? 1920 : 1024,
        height: request.assetKind === "AI_SCENE" ? 1080 : 1024,
        mime: "image/png",
      },
      normalizedAsset: {
        fileName: `${request.assetId}.png`,
        storageRef: `image-artifacts/${request.assetId}.png`,
        sha256: hexadecimalHash(index + 1),
        bytes: 4096 + index,
        width: request.assetKind === "AI_SCENE" ? 1920 : 1024,
        height: request.assetKind === "AI_SCENE" ? 1080 : 1024,
        mime: "image/png",
      },
      transparentBackground: request.transparentBackground,
      placeholder: false,
      localSubjectDrawn: false,
      processingChain: [],
    })),
  };
  const manifest: PptAssetManifest = {
    ...manifestWithoutDigest,
    manifestDigest: createPptAssetManifestDigest(manifestWithoutDigest),
  };

  const sampleSetWithoutDigest: Omit<PptKeySampleSet, "sampleSetDigest"> = {
    schemaVersion: "ppt-key-sample-set.v1",
    designPackageDigest: requestBatch.designPackageDigest,
    requestBatchDigest: requestBatch.batchDigest,
    assetManifestDigest: manifest.manifestDigest,
    samplePageIds: [...designPackage.samplePlan.samplePageIds],
    samplePptx: { storageRef: "ppt-sample-artifacts/key-samples.pptx", sha256: "d".repeat(64) },
    overviews: [
      { kind: "scene_and_primary_props", storageRef: "overviews/scenes.png", sha256: "a".repeat(64), pageIds: [...designPackage.samplePlan.samplePageIds] },
      { kind: "micro_assets", storageRef: "overviews/assets.png", sha256: "b".repeat(64), pageIds: [...designPackage.samplePlan.samplePageIds] },
      { kind: "assembled_samples", storageRef: "overviews/samples.png", sha256: "c".repeat(64), pageIds: [...designPackage.samplePlan.samplePageIds] },
    ],
    assembledPages: designPackage.samplePlan.samplePageIds.map((pageId, index) => {
      const page = designPackage.pageSpecs.find((candidate) => candidate.pageId === pageId)!;
      return {
        pageId,
        renderRef: `sample-renders/${pageId}.png`,
        renderSha256: hexadecimalHash(index + 20),
        assetIds: manifest.entries.filter((entry) => entry.pageIds.includes(pageId)).map((entry) => entry.assetId),
        editableTextLayerIds: page.editableText.map((layer) => layer.layerId),
        editableMathLayerIds: page.editableMath.map((layer) => layer.layerId),
        rasterizedExactContent: false as const,
      };
    }),
    qa: designPackage.samplePlan.samplePageIds.map((pageId) => ({
      pageId,
      design: "passed" as const,
      visual: "passed" as const,
      provenance: "passed" as const,
      findings: [],
    })),
  };
  const sampleSet: PptKeySampleSet = {
    ...sampleSetWithoutDigest,
    sampleSetDigest: createPptKeySampleSetDigest(sampleSetWithoutDigest),
  };
  const approval: PptSampleApproval = {
    schemaVersion: "ppt-sample-approval.v1",
    decision: "approved",
    decisionSource: "explicit_teacher_message",
    decisionText: "我批准这组三页正式样张，可以按此规则生产。",
    teacherMessageId: "message_sample_approval",
    designPackageDigest: sampleSet.designPackageDigest,
    sampleSetDigest: sampleSet.sampleSetDigest,
    approvedAt: "2026-07-12T00:00:00.000Z",
  };
  return { designPackage, requestBatch, manifest, sampleSet, approval };
}

export function setMaterializedPptAssetFixtureEvidence(input: {
  entry: PptAssetManifestEntry;
  rawAsset: PptAssetFileEvidence;
  normalizedAsset: PptAssetFileEvidence;
  processingOperation?: PptAssetProcessingOperation;
}) {
  if (
    input.rawAsset.fileName === input.normalizedAsset.fileName ||
    input.rawAsset.storageRef === input.normalizedAsset.storageRef
  ) {
    throw new Error("PPT asset fixture raw and normalized locators must be distinct.");
  }
  if (input.rawAsset.sha256 !== input.normalizedAsset.sha256 && !input.processingOperation) {
    throw new Error("PPT asset fixture changed bytes require a processing operation.");
  }
  const normalizedAsset = structuredClone(input.normalizedAsset);
  input.entry.fileName = normalizedAsset.fileName;
  input.entry.storageRef = normalizedAsset.storageRef;
  input.entry.sha256 = normalizedAsset.sha256;
  input.entry.bytes = normalizedAsset.bytes;
  input.entry.width = normalizedAsset.width;
  input.entry.height = normalizedAsset.height;
  input.entry.mime = normalizedAsset.mime;
  input.entry.rawAsset = structuredClone(input.rawAsset);
  input.entry.normalizedAsset = normalizedAsset;
  input.entry.processingChain = input.rawAsset.sha256 === normalizedAsset.sha256
    ? []
    : [{
        operation: input.processingOperation!,
        sourceSha256: input.rawAsset.sha256,
        targetSha256: normalizedAsset.sha256,
      }];
}

function hexadecimalHash(value: number): string {
  return value.toString(16).padStart(2, "0").repeat(32).slice(0, 64);
}
