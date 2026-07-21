type ValidationEvidence = { status: "PASSED"; evidenceDigest: string };

export function projectImageSlideBatch(content: Record<string, unknown>, validation: ValidationEvidence): Record<string, unknown> {
  const bundle = object(content.pptImageSlideBundle, "PPT image slide bundle");
  const entries = list(bundle.entries, "PPT image slide entries");
  const sourceArtifactIds = texts(content.sourceArtifactIds, "PPT image sourceArtifactIds");
  if (!entries.length || !sourceArtifactIds.length) throw new Error("PPT image slide output is incomplete.");
  return { schemaVersion: "shanhai-imagegen/v2", mode: "batch", sourceArtifactIds, assets: entries.map((value, index) => {
    const entry = object(value, `PPT image slide entry ${index}`);
    const pageId = text(entry.pageId, `PPT image slide entry ${index} pageId`);
    return { assetId: pageId, targetRefs: [pageId], provider: { name: text(entry.provider, "provider"), model: text(entry.model, "model") }, promptDigest: digest(entry.promptDigest, "promptDigest"), sourceArtifactIds, rawFile: imageFile(entry.rawAsset, "rawAsset"), deliveryFile: imageFile(entry.normalizedAsset, "normalizedAsset"), processingChain: processing(entry.processingChain), validation };
  }).sort((left, right) => left.assetId.localeCompare(right.assetId)) };
}

function imageFile(value: unknown, label: string) { const file = object(value, label); return { fileName: text(file.fileName, `${label}.fileName`), storageRef: text(file.storageRef ?? file.localOutput, `${label}.storageRef`), bytes: positive(file.bytes, `${label}.bytes`), sha256: digest(file.sha256, `${label}.sha256`), mime: text(file.mime, `${label}.mime`), width: positive(file.width, `${label}.width`), height: positive(file.height, `${label}.height`) }; }
function processing(value: unknown) { if (value === undefined) return []; return list(value, "processingChain").map((item, index) => { const step = object(item, `processingChain.${index}`); return { operation: text(step.operation, "operation"), sourceSha256: digest(step.sourceSha256, "sourceSha256"), targetSha256: digest(step.targetSha256, "targetSha256") }; }); }
function object(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`); return value as Record<string, unknown>; }
function list(value: unknown, label: string): unknown[] { if (!Array.isArray(value)) throw new Error(`${label} must be an array.`); return value; }
function text(value: unknown, label: string): string { if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be text.`); return value.trim(); }
function texts(value: unknown, label: string): string[] { return [...new Set(list(value, label).map((item) => text(item, label)))]; }
function positive(value: unknown, label: string): number { if (!Number.isInteger(value) || Number(value) <= 0) throw new Error(`${label} must be positive.`); return Number(value); }
function digest(value: unknown, label: string): string { const result = text(value, label).toLowerCase(); if (!/^[a-f0-9]{64}$/.test(result)) throw new Error(`${label} must be SHA-256.`); return result; }
