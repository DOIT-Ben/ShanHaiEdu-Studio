function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProviderAssetEvidence(value: unknown) {
  if (!isRecordValue(value)) return false;
  return typeof value.fileName === "string" && value.fileName.length > 0
    && typeof value.storageRef === "string" && value.storageRef.length > 0
    && typeof value.sha256 === "string" && /^[a-f0-9]{64}$/i.test(value.sha256)
    && typeof value.bytes === "number" && value.bytes > 0
    && typeof value.width === "number" && value.width > 0
    && typeof value.height === "number" && value.height > 0
    && typeof value.mime === "string" && value.mime.startsWith("image/");
}

export function assertPptAssetUnitProviderResult(
  providerResultJson: string,
  snapshotPayloadJson: string | undefined,
) {
  const value = JSON.parse(providerResultJson) as unknown;
  const snapshot = snapshotPayloadJson ? JSON.parse(snapshotPayloadJson) as unknown : null;
  if (!isRecordValue(value) || value.schemaVersion !== "ppt-asset-unit-result.v1" || !isRecordValue(value.result)) {
    throw new Error("GenerationJob providerResultJson is not a PPT asset unit result.");
  }
  if (!isRecordValue(snapshot) || !isRecordValue(snapshot.input) || !isRecordValue(snapshot.input.request)) {
    throw new Error("GenerationJob input snapshot cannot verify the PPT asset unit result.");
  }
  const request = snapshot.input.request;
  if (
    value.batchDigest !== snapshot.input.batchDigest
    || value.assetId !== request.assetId
    || value.requestInputHash !== request.inputHash
  ) {
    throw new Error("GenerationJob provider result does not match its input snapshot.");
  }
  const result = value.result;
  if (
    typeof result.provider !== "string" || !result.provider
    || typeof result.model !== "string" || !result.model
    || typeof result.clientRequestId !== "string" || !result.clientRequestId
    || typeof result.fileName !== "string" || !result.fileName
    || typeof result.storageRef !== "string" || !result.storageRef
    || typeof result.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(result.sha256)
    || typeof result.bytes !== "number" || result.bytes <= 0
    || typeof result.width !== "number" || result.width <= 0
    || typeof result.height !== "number" || result.height <= 0
    || typeof result.mime !== "string" || !result.mime.startsWith("image/")
    || result.transparentBackgroundVerified !== request.transparentBackground
    || !Array.isArray(result.sentReferenceAssetIds)
    || !isProviderAssetEvidence(result.rawAsset)
    || !isProviderAssetEvidence(result.normalizedAsset)
  ) {
    throw new Error("GenerationJob providerResultJson does not contain verifiable PPT asset evidence.");
  }
}
