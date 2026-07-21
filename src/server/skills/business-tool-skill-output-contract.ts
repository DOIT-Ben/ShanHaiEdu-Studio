import { createHash } from "node:crypto";
import type { ToolExecutionResult } from "@/server/tools/tool-types";
import type { LoadedSkillContractSchema } from "./skill-runtime-types";
import { omitObjectKeys } from "@/server/contracts/object-projection";
import { projectImageSlideBatch } from "@/server/ppt-image-slides/ppt-image-slide-skill-output";

type SucceededToolExecutionResult = Extract<ToolExecutionResult, { status: "succeeded" }>;

export const FORMAL_BUSINESS_TOOL_OUTPUT_ADAPTER_IDS = [
  "image-result-single.v2",
  "image-result-batch.v2",
  "video-result-single-shot.v2",
  "delivery-result-package.v2",
] as const;

export type FormalBusinessToolOutputAdapterId = typeof FORMAL_BUSINESS_TOOL_OUTPUT_ADAPTER_IDS[number];

export type FormalBusinessToolOutputContract = {
  skillName: string;
  skillVersion: string;
  artifactType: string;
  contractVersion: string;
};

export type FormalBusinessToolOutputAdapterRegistration = {
  adapterId: FormalBusinessToolOutputAdapterId;
  businessToolNames: string[];
  skillName: string;
  skillVersion: string;
  artifactType: string;
  contractVersion: string;
};

export type FormalBusinessToolOutputProjection = {
  adapterId: FormalBusinessToolOutputAdapterId;
  businessToolName: string;
  contract: FormalBusinessToolOutputContract;
  payload: Record<string, unknown>;
};

export type FormalBusinessToolOutputSchemaValidator = (input: {
  schema: Record<string, unknown>;
  contract: FormalBusinessToolOutputContract;
  payload: Record<string, unknown>;
}) => { valid: boolean; errors?: string[] };

export type ValidatedFormalBusinessToolOutputProjection = FormalBusinessToolOutputProjection & {
  schemaSha256: string;
};

export type FormalBusinessToolOutputContractReasonCode =
  | "formal_skill_output_adapter_unknown"
  | "formal_skill_output_adapter_tool_mismatch"
  | "formal_skill_output_contract_mismatch"
  | "formal_skill_output_source_invalid"
  | "formal_skill_output_schema_invalid";

export class BusinessToolSkillOutputContractError extends Error {
  readonly reasonCode: FormalBusinessToolOutputContractReasonCode;
  readonly validationErrors: string[];

  constructor(
    reasonCode: FormalBusinessToolOutputContractReasonCode,
    message: string,
    validationErrors: string[] = [],
  ) {
    super(message);
    this.name = "BusinessToolSkillOutputContractError";
    this.reasonCode = reasonCode;
    this.validationErrors = [...validationErrors];
  }
}

type AdapterRegistration = FormalBusinessToolOutputAdapterRegistration & {
  expectedArtifactKinds: string[];
  project: (result: SucceededToolExecutionResult) => Record<string, unknown>;
};

const registrations: readonly AdapterRegistration[] = Object.freeze([
  {
    adapterId: "image-result-single.v2",
    businessToolNames: ["generate_classroom_image", "generate_video_assets"],
    skillName: "shanhai-imagegen",
    skillVersion: "1.1",
    artifactType: "image-generation-result",
    contractVersion: "shanhai-imagegen/v2",
    expectedArtifactKinds: ["image_prompts", "asset_image_generate"],
    project: projectSingleImage,
  },
  {
    adapterId: "image-result-batch.v2",
    businessToolNames: ["generate_ppt_sample_assets", "generate_ppt_full_assets", "generate_ppt_page_images"],
    skillName: "shanhai-imagegen",
    skillVersion: "1.1",
    artifactType: "image-generation-result",
    contractVersion: "shanhai-imagegen/v2",
    expectedArtifactKinds: ["image_prompts"],
    project: projectImageBatch,
  },
  {
    adapterId: "video-result-single-shot.v2",
    businessToolNames: ["generate_video_shot"],
    skillName: "shanhai-video-generation",
    skillVersion: "1.1",
    artifactType: "video-generation-result",
    contractVersion: "shanhai-video-generation/v2",
    expectedArtifactKinds: ["video_segment_generate"],
    project: projectVideoShot,
  },
  {
    adapterId: "delivery-result-package.v2",
    businessToolNames: ["create_final_package"],
    skillName: "shanhai-delivery",
    skillVersion: "1.3",
    artifactType: "delivery-package",
    contractVersion: "shanhai-delivery/v2",
    expectedArtifactKinds: ["final_delivery"],
    project: projectFinalPackage,
  },
]);

const registrationById = new Map(registrations.map((registration) => [registration.adapterId, registration]));

export function listFormalBusinessToolOutputAdapters(): FormalBusinessToolOutputAdapterRegistration[] {
  return registrations.map((registration) => structuredClone(omitObjectKeys(registration, ["expectedArtifactKinds", "project"])));
}

export function hasFormalBusinessToolOutputAdapter(adapterId: string, businessToolName?: string): boolean {
  const registration = registrationById.get(adapterId as FormalBusinessToolOutputAdapterId);
  return Boolean(registration && (!businessToolName || registration.businessToolNames.includes(businessToolName)));
}

export function projectFormalBusinessToolSkillOutput(input: {
  adapterId: string;
  businessToolName: string;
  contract: FormalBusinessToolOutputContract;
  result: SucceededToolExecutionResult;
}): FormalBusinessToolOutputProjection {
  const registration = requireRegistration(input.adapterId);
  if (!registration.businessToolNames.includes(input.businessToolName)) {
    fail("formal_skill_output_adapter_tool_mismatch", "Formal Skill output Adapter does not own the selected business Tool.");
  }
  assertContractIdentity(input.contract, registration);
  assertVerifiedResult(input.result, registration.expectedArtifactKinds);
  const payload = registration.project(input.result);
  assertNoOrchestrationFields(payload);
  return {
    adapterId: registration.adapterId,
    businessToolName: input.businessToolName,
    contract: structuredClone(input.contract),
    payload: structuredClone(payload),
  };
}

export function validateFormalBusinessToolSkillOutput(input: {
  adapterId: string;
  businessToolName: string;
  contract: FormalBusinessToolOutputContract;
  result: SucceededToolExecutionResult;
  contractSchema: LoadedSkillContractSchema;
  validator: FormalBusinessToolOutputSchemaValidator;
}): ValidatedFormalBusinessToolOutputProjection {
  const projected = projectFormalBusinessToolSkillOutput(input);
  if (
    input.contractSchema.artifactType !== input.contract.artifactType ||
    input.contractSchema.contractVersion !== input.contract.contractVersion ||
    !/^sha256:[a-f0-9]{64}$/i.test(input.contractSchema.schemaSha256)
  ) {
    fail("formal_skill_output_contract_mismatch", "Loaded Skill Schema does not match the selected output contract.");
  }
  const validation = input.validator({
    schema: input.contractSchema.schema,
    contract: structuredClone(input.contract),
    payload: structuredClone(projected.payload),
  });
  if (!validation.valid) {
    throw new BusinessToolSkillOutputContractError(
      "formal_skill_output_schema_invalid",
      "Formal Skill output payload failed its bound Schema.",
      normalizeValidationErrors(validation.errors),
    );
  }
  return { ...projected, schemaSha256: input.contractSchema.schemaSha256.toLowerCase() };
}

function projectSingleImage(result: SucceededToolExecutionResult): Record<string, unknown> {
  const content = record(result.artifactDraft.structuredContent, "image output structuredContent");
  const storage = record(content.storage, "image output storage");
  const asset = record(storage.imageAsset, "image output storage.imageAsset");
  const rawFile = projectImageFile(record(asset.rawAsset, "image rawAsset"), "image rawAsset");
  const deliveryFile = projectImageFile(record(asset.normalizedAsset, "image normalizedAsset"), "image normalizedAsset");
  if (text(asset.sha256, "image sha256").toLowerCase() !== deliveryFile.sha256 ||
      resolveStorageRef(asset, "image output") !== deliveryFile.storageRef) {
    fail("formal_skill_output_source_invalid", "Image delivery evidence does not match the normalized file.");
  }
  const sourceArtifactIds = uniqueText([text(asset.sourceArtifactId, "image sourceArtifactId")]);
  const targetRefs = optionalTextArray(asset.targetRefs);
  const validation = projectValidation(result);
  return {
    schemaVersion: "shanhai-imagegen/v2",
    mode: "single",
    sourceArtifactIds,
    assets: [{
      assetId: `image-${deliveryFile.sha256.slice(0, 16)}`,
      targetRefs: targetRefs.length > 0 ? targetRefs : sourceArtifactIds,
      provider: {
        name: text(asset.provider, "image provider"),
        model: text(asset.model, "image model"),
      },
      promptDigest: sha256(asset.promptDigest, "image promptDigest"),
      sourceArtifactIds,
      rawFile,
      deliveryFile,
      processingChain: projectProcessingChain(asset.processingChain),
      validation,
    }],
  };
}

function projectImageBatch(result: SucceededToolExecutionResult): Record<string, unknown> {
  const content = record(result.artifactDraft.structuredContent, "PPT image output structuredContent");
  if (content.pptImageSlideBundle) return projectImageSlideBatch(content, projectValidation(result));
  const manifest = record(content.pptAssetManifest, "PPT image manifest");
  const entries = array(manifest.entries, "PPT image manifest entries");
  if (entries.length === 0) fail("formal_skill_output_source_invalid", "PPT image manifest entries are empty.");
  const storage = record(content.storage, "PPT image output storage");
  const bundle = record(storage.pptAssetBundle, "PPT image output bundle");
  const rootSourceArtifactId = text(bundle.sourceArtifactId, "PPT image sourceArtifactId");
  const validation = projectValidation(result);
  const assets = entries.map((value, index) => {
    const entry = record(value, `PPT image manifest entry ${index}`);
    const referenceArtifactIds = optionalTextArray(entry.referenceAssetIds);
    return {
      assetId: text(entry.assetId, `PPT image entry ${index} assetId`),
      targetRefs: textArray(entry.pageIds, `PPT image entry ${index} pageIds`).sort(),
      provider: {
        name: text(entry.provider, `PPT image entry ${index} provider`),
        model: text(entry.model, `PPT image entry ${index} model`),
      },
      promptDigest: sha256(entry.promptDigest, `PPT image entry ${index} promptDigest`),
      sourceArtifactIds: uniqueText([rootSourceArtifactId, ...referenceArtifactIds]),
      rawFile: projectImageFile(record(entry.rawAsset, `PPT image entry ${index} rawAsset`), `PPT image entry ${index} rawAsset`),
      deliveryFile: projectImageFile(record(entry.normalizedAsset, `PPT image entry ${index} normalizedAsset`), `PPT image entry ${index} normalizedAsset`),
      processingChain: projectProcessingChain(entry.processingChain),
      validation,
    };
  }).sort((left, right) => left.assetId.localeCompare(right.assetId));
  if (new Set(assets.map((asset) => asset.assetId)).size !== assets.length) {
    fail("formal_skill_output_source_invalid", "PPT image manifest contains duplicate asset IDs.");
  }
  return {
    schemaVersion: "shanhai-imagegen/v2",
    mode: "batch",
    sourceArtifactIds: [rootSourceArtifactId],
    assets,
  };
}

function projectVideoShot(result: SucceededToolExecutionResult): Record<string, unknown> {
  const content = record(result.artifactDraft.structuredContent, "video output structuredContent");
  const storage = record(content.storage, "video output storage");
  const asset = record(storage.videoAsset, "video output storage.videoAsset");
  const requestEvidence = record(asset.requestEvidence, "video requestEvidence");
  const providerPayload = record(result.providerPayload, "video providerPayload");
  const references = optionalRecordArray(requestEvidence.references, "video requestEvidence references");
  return {
    schemaVersion: "shanhai-video-generation/v2",
    shots: [{
      shotId: text(requestEvidence.shotId, "video shotId"),
      provider: {
        name: text(providerPayload.provider, "video provider"),
        model: text(providerPayload.model, "video model"),
      },
      requestedDurationSeconds: positiveNumber(requestEvidence.durationSeconds, "video requestedDurationSeconds"),
      sourceArtifactIds: textArray(asset.sourceArtifactIds, "video sourceArtifactIds"),
      referenceArtifactIds: uniqueText(references.map((reference, index) =>
        text(reference.assetId, `video reference ${index} assetId`))),
      file: projectFile(asset, "video file"),
      validation: projectValidation(result),
    }],
  };
}

function projectFinalPackage(result: SucceededToolExecutionResult): Record<string, unknown> {
  const content = record(result.artifactDraft.structuredContent, "delivery output structuredContent");
  const storage = record(content.storage, "delivery output storage");
  const packageAsset = record(storage.packageAsset, "delivery packageAsset");
  return {
    schemaVersion: "shanhai-delivery/v2",
    finalPackageManifest: projectFinalPackageManifest(record(content.finalPackageManifest, "finalPackageManifest")),
    classroomRunSpec: projectClassroomRunSpec(record(content.classroomRunSpec, "classroomRunSpec")),
    packageAsset: {
      fileName: text(packageAsset.fileName, "delivery package fileName"),
      localOutput: resolveStorageRef(packageAsset, "delivery package"),
      bytes: positiveInteger(packageAsset.bytes, "delivery package bytes"),
      sha256: sha256(packageAsset.sha256, "delivery package sha256"),
      manifestSha256: sha256(packageAsset.manifestSha256, "delivery manifestSha256"),
      mime: exactText(packageAsset.mime, "application/zip", "delivery package mime"),
      generationMode: exactText(packageAsset.generationMode, "versioned_final_package_generated", "delivery generationMode"),
      sourceArtifactIds: textArray(packageAsset.sourceArtifactIds, "delivery sourceArtifactIds"),
    },
    validation: projectValidation(result),
  };
}

function projectFinalPackageManifest(value: Record<string, unknown>): Record<string, unknown> {
  const fileMap = record(value.files, "final package manifest files");
  const files = Object.fromEntries(Object.entries(fileMap).sort(([left], [right]) => left.localeCompare(right)).map(([role, item]) => {
    const file = record(item, `final package manifest ${role}`);
    return [role, {
      fileName: text(file.fileName, `final package manifest ${role} fileName`),
      bytes: positiveInteger(file.bytes, `final package manifest ${role} bytes`),
      sha256: sha256(file.sha256, `final package manifest ${role} sha256`),
      deliveryStatus: exactText(file.deliveryStatus, "final_eligible", `final package manifest ${role} deliveryStatus`),
      sourceArtifactId: text(file.sourceArtifactId, `final package manifest ${role} sourceArtifactId`),
      sourceArtifactVersion: positiveInteger(file.sourceArtifactVersion, `final package manifest ${role} sourceArtifactVersion`),
      sourceArtifactDigest: sha256(file.sourceArtifactDigest, `final package manifest ${role} sourceArtifactDigest`),
    }];
  }));
  return {
    schemaVersion: exactText(value.schemaVersion, "final-package-manifest.v1", "final package manifest schemaVersion"),
    courseVersionId: text(value.courseVersionId, "final package manifest courseVersionId"),
    courseAnchor: text(value.courseAnchor, "final package manifest courseAnchor"),
    reviewBatchId: text(value.reviewBatchId, "final package manifest reviewBatchId"),
    pptSlideCount: positiveInteger(value.pptSlideCount, "final package manifest pptSlideCount"),
    packageStatus: text(value.packageStatus, "final package manifest packageStatus"),
    teacherSignoff: boolean(value.teacherSignoff, "final package manifest teacherSignoff"),
    requiredRoles: textArray(value.requiredRoles, "final package manifest requiredRoles"),
    ...(value.mediaEvidence === undefined ? {} : { mediaEvidence: projectMediaEvidence(record(value.mediaEvidence, "final package mediaEvidence")) }),
    files,
  };
}

function projectMediaEvidence(value: Record<string, unknown>): Record<string, unknown> {
  const pptx = record(value.pptx, "final package PPTX evidence");
  const pdf = record(value.pdf, "final package PDF evidence");
  const video = record(value.video, "final package video evidence");
  return {
    pptx: { slideCount: positiveInteger(pptx.slideCount, "final package PPTX slideCount") },
    pdf: { pageCount: positiveInteger(pdf.pageCount, "final package PDF pageCount") },
    video: {
      durationSeconds: positiveNumber(video.durationSeconds, "final package video durationSeconds"),
      width: positiveInteger(video.width, "final package video width"),
      height: positiveInteger(video.height, "final package video height"),
      fps: positiveNumber(video.fps, "final package video fps"),
      videoCodec: text(video.videoCodec, "final package video codec"),
      audioCodec: text(video.audioCodec, "final package audio codec"),
    },
  };
}

function projectClassroomRunSpec(value: Record<string, unknown>): Record<string, unknown> {
  return {
    schemaVersion: exactText(value.schemaVersion, "classroom-run-spec.v1", "ClassroomRunSpec schemaVersion"),
    courseVersionId: text(value.courseVersionId, "ClassroomRunSpec courseVersionId"),
    courseAnchor: text(value.courseAnchor, "ClassroomRunSpec courseAnchor"),
    reviewBatchId: text(value.reviewBatchId, "ClassroomRunSpec reviewBatchId"),
    pptSlideCount: positiveInteger(value.pptSlideCount, "ClassroomRunSpec pptSlideCount"),
    sequence: array(value.sequence, "ClassroomRunSpec sequence").map((item, index) => {
      const step = record(item, `ClassroomRunSpec step ${index}`);
      return {
        ordinal: positiveInteger(step.ordinal, `ClassroomRunSpec step ${index} ordinal`),
        action: text(step.action, `ClassroomRunSpec step ${index} action`),
        ...(step.artifactRole === undefined ? {} : { artifactRole: text(step.artifactRole, `ClassroomRunSpec step ${index} artifactRole`) }),
        ...(step.pptPage === undefined ? {} : { pptPage: positiveInteger(step.pptPage, `ClassroomRunSpec step ${index} pptPage`) }),
        instruction: text(step.instruction, `ClassroomRunSpec step ${index} instruction`),
      };
    }),
  };
}

function projectValidation(result: SucceededToolExecutionResult) {
  const gate = result.qualityGate;
  if (!gate?.passed || !Array.isArray(gate.gates) || gate.gates.length === 0) {
    fail("formal_skill_output_source_invalid", "Formal Tool output has no passing quality evidence.");
  }
  const evidence = { passed: true, gates: uniqueText(gate.gates) };
  return {
    status: "PASSED" as const,
    evidenceDigest: createHash("sha256").update(JSON.stringify(evidence), "utf8").digest("hex"),
  };
}

function projectImageFile(value: Record<string, unknown>, label: string) {
  const projected = projectFile(value, label);
  return {
    ...projected,
    width: positiveInteger(value.width, `${label} width`),
    height: positiveInteger(value.height, `${label} height`),
  };
}

function projectFile(value: Record<string, unknown>, label: string) {
  return {
    fileName: text(value.fileName, `${label} fileName`),
    storageRef: resolveStorageRef(value, label),
    bytes: positiveInteger(value.bytes, `${label} bytes`),
    sha256: sha256(value.sha256, `${label} sha256`),
    mime: text(value.mime, `${label} mime`),
    ...(value.width === undefined ? {} : { width: positiveInteger(value.width, `${label} width`) }),
    ...(value.height === undefined ? {} : { height: positiveInteger(value.height, `${label} height`) }),
  };
}

function projectProcessingChain(value: unknown) {
  if (value === undefined) return [];
  return array(value, "image processingChain").map((item, index) => {
    const step = record(item, `image processingChain ${index}`);
    return {
      operation: text(step.operation, `image processingChain ${index} operation`),
      sourceSha256: sha256(step.sourceSha256, `image processingChain ${index} sourceSha256`),
      targetSha256: sha256(step.targetSha256, `image processingChain ${index} targetSha256`),
    };
  });
}

function assertVerifiedResult(result: SucceededToolExecutionResult, expectedArtifactKinds: string[]): void {
  if (result.status !== "succeeded") fail("formal_skill_output_source_invalid", "Formal output Adapter requires a successful Tool result.");
  const truth = result.artifactTruth;
  if (!truth?.created || !truth.persisted || truth.placeholder || !expectedArtifactKinds.includes(truth.producedArtifactKind) ||
      result.artifactDraft.kind !== truth.producedArtifactKind) {
    fail("formal_skill_output_source_invalid", "Formal Tool output artifact truth is incomplete or mismatched.");
  }
  projectValidation(result);
}

function assertContractIdentity(
  contract: FormalBusinessToolOutputContract,
  registration: AdapterRegistration,
): void {
  if (
    contract.skillName !== registration.skillName ||
    contract.skillVersion !== registration.skillVersion ||
    contract.artifactType !== registration.artifactType ||
    contract.contractVersion !== registration.contractVersion
  ) {
    fail("formal_skill_output_contract_mismatch", "Formal Skill output contract identity does not match the Adapter registration.");
  }
}

function requireRegistration(adapterId: string): AdapterRegistration {
  const registration = registrationById.get(adapterId as FormalBusinessToolOutputAdapterId);
  if (!registration) fail("formal_skill_output_adapter_unknown", "Formal Skill output Adapter is not registered.");
  return registration;
}

const forbiddenControlKeys = new Set([
  "clientrequestid",
  "fallback",
  "fallbackpolicy",
  "nextaction",
  "nexttool",
  "providerorder",
  "providerrequestid",
  "providerselection",
  "providertaskid",
  "retry",
  "retrypolicy",
  "stop",
  "stopreason",
]);

function assertNoOrchestrationFields(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNoOrchestrationFields);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (forbiddenControlKeys.has(key.replace(/[_-]/g, "").toLowerCase())) {
      fail("formal_skill_output_source_invalid", "Formal Skill payload contains an orchestration control field.");
    }
    assertNoOrchestrationFields(child);
  }
}

function normalizeValidationErrors(errors: string[] | undefined): string[] {
  return [...new Set((errors ?? ["schema_validation_failed"]).map((error) => error.trim()).filter(Boolean))].slice(0, 50);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("formal_skill_output_source_invalid", `${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) fail("formal_skill_output_source_invalid", `${label} must be an array.`);
  return value;
}

function optionalRecordArray(value: unknown, label: string): Record<string, unknown>[] {
  if (value === undefined) return [];
  return array(value, label).map((item, index) => record(item, `${label} ${index}`));
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) fail("formal_skill_output_source_invalid", `${label} must be non-empty text.`);
  return value.trim();
}

function exactText(value: unknown, expected: string, label: string): string {
  const actual = text(value, label);
  if (actual !== expected) fail("formal_skill_output_source_invalid", `${label} is not supported.`);
  return actual;
}

function textArray(value: unknown, label: string): string[] {
  const values = array(value, label).map((item, index) => text(item, `${label} ${index}`));
  if (values.length === 0 || new Set(values).size !== values.length) {
    fail("formal_skill_output_source_invalid", `${label} must contain unique text values.`);
  }
  return values;
}

function optionalTextArray(value: unknown): string[] {
  if (value === undefined) return [];
  return uniqueText(array(value, "optional text list").map((item, index) => text(item, `optional text list ${index}`)));
}

function uniqueText(values: string[]): string[] {
  return [...new Set(values)];
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) fail("formal_skill_output_source_invalid", `${label} must be a positive integer.`);
  return value as number;
}

function positiveNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) fail("formal_skill_output_source_invalid", `${label} must be positive.`);
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") fail("formal_skill_output_source_invalid", `${label} must be boolean.`);
  return value;
}

function sha256(value: unknown, label: string): string {
  const digest = text(value, label).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) fail("formal_skill_output_source_invalid", `${label} must be a SHA-256 digest.`);
  return digest;
}

function resolveStorageRef(value: Record<string, unknown>, label: string): string {
  return text(value.storageRef ?? value.localOutput, `${label} storageRef`);
}

function fail(reasonCode: FormalBusinessToolOutputContractReasonCode, message: string): never {
  throw new BusinessToolSkillOutputContractError(reasonCode, message);
}
