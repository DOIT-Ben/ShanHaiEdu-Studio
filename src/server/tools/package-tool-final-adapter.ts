import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolveLocalArtifactOutput, writeLocalArtifact } from "@/server/artifact-storage/local-artifact-storage";
import { hasValidExecutionEnvelope, type ExecutionEnvelope } from "@/server/conversation/task-contract";
import { prepareVersionedFinalPackageInput } from "@/server/package/final-package-input-contract";
import {
  buildVersionedFinalPackage,
  createFinalPackageManifestDigest,
  verifyFinalPackageBuffer,
  type ClassroomRunSpec,
} from "@/server/package/versioned-final-package";
import type { ArtifactRecord } from "@/server/workbench/types";

import {
  buildArtifactTruth,
  buildBudgetEvent,
  findResolvedArtifacts,
  isRecord,
  requireArtifact,
  type PackageToolAdapterInput,
} from "./package-tool-adapter-shared";
import type { ToolExecutionResult, ToolQualityGateResult } from "./tool-types";

const ZIP_MIME = "application/zip";

export async function executeFinalPackage(input: PackageToolAdapterInput): Promise<ToolExecutionResult> {
  const prepared = prepareVersionedFinalPackageInput({
    projectId: input.projectId,
    classroomRunSpecDraft: input.toolInput?.classroomRunSpecDraft,
    artifacts: {
      requirement: requireArtifact(input, "requirement_spec"),
      lessonPlan: requireArtifact(input, "lesson_plan"),
      pptDesign: requireArtifact(input, "ppt_design_draft"),
      pptx: requireArtifact(input, "pptx_artifact"),
      image: requireFinalImageArtifact(input),
      narrationScript: requireArtifact(input, "video_script_generate"),
      video: requireArtifact(input, "concat_only_assemble"),
    },
  });
  let download: Awaited<ReturnType<typeof buildVersionedFinalPackage>>;
  try {
    download = await buildVersionedFinalPackage({
      files: prepared.files,
      classroomRunSpec: prepared.classroomRunSpec,
      teacherSignoff: false,
      inspectors: input.finalPackageInspectors,
    });
  } finally {
    prepared.cleanup();
  }

  const fileName = `shanhai-final-${safeFileSegment(input.projectId)}.zip`;
  const stored = writeLocalArtifact({ category: "package-artifacts", fileName, buffer: download.buffer });
  const artifactTruth = buildArtifactTruth(input.tool, "final_delivery");
  const qualityGate = { passed: true, gates: ["version_binding_verified", "review_batch_verified", "classroom_run_spec_verified", "all_files_final_eligible", "manifest_reverse_verified"] } satisfies ToolQualityGateResult;

  return {
    status: "succeeded",
    toolId: input.tool.id,
    capabilityId: input.tool.capabilityId ?? "final_package",
    artifactDraft: {
      nodeKey: "final_delivery",
      kind: "final_delivery",
      title: "最终材料包",
      summary: "已打包真实 PPTX、课堂图片和导入视频，可下载后授课前核对。",
      markdownContent: buildFinalDeliveryMarkdown(input),
      structuredContent: {
        文件状态: "真实最终材料包已生成",
        文件大小: `${download.buffer.length} bytes`,
        文件类型: ZIP_MIME,
        finalPackageManifest: download.manifest,
        classroomRunSpec: prepared.classroomRunSpec,
        courseVersionId: prepared.courseVersionId,
        reviewBatchId: prepared.reviewBatchId,
        storage: {
          packageAsset: {
            fileName,
            localOutput: stored.localOutput,
            bytes: download.buffer.length,
            sha256: download.sha256,
            manifestSha256: createFinalPackageManifestDigest(download.manifest),
            mime: ZIP_MIME,
            generationMode: "versioned_final_package_generated",
            sourceArtifactIds: prepared.sourceArtifactIds,
          },
        },
        artifactTruth,
        qualityGate,
      },
    },
    artifactTruth,
    qualityGate,
    assistantSummary: "最终材料包已完成版本、审查批次、课堂顺序和文件完整性校验。",
    budgetEvent: buildBudgetEvent(input.tool, "succeeded", "tool_succeeded"),
  };
}

function buildFinalDeliveryMarkdown(input: PackageToolAdapterInput) {
  const lessonPlan = findResolvedArtifacts(input, "lesson_plan")[0];
  const design = findResolvedArtifacts(input, "ppt_design_draft")[0];
  return [
    "# 最终交付清单",
    "",
    "## 已包含材料",
    "- 真实 PPTX 文件",
    "- 课堂视觉图",
    "- 导入视频成片",
    "- 本清单与校验信息",
    "",
    "## 教师核对重点",
    `- 教案：${lessonPlan?.title ?? "已确认教案"}`,
    `- PPT 设计：${design?.title ?? "已确认 PPT 设计稿"}`,
    "- 正式授课前请核对教材页码、例题、页面顺序、视频节奏和课堂锚点。",
    "",
  ].join("\n");
}

function requireFinalImageArtifact(input: PackageToolAdapterInput): ArtifactRecord {
  const artifact = findResolvedArtifacts(input, "image_prompts").find((candidate) => {
    const storage = candidate.structuredContent.storage;
    if (!isRecord(storage) || !isRecord(storage.imageAsset)) return false;
    return typeof storage.imageAsset.localOutput === "string" && typeof storage.imageAsset.sha256 === "string";
  });
  if (!artifact) throw new Error("missing_final_classroom_image");
  return artifact;
}

export type PersistedFinalPackageToolInvocation = {
  invocationId: string;
  projectId: string;
  taskId: string;
  intentEpoch: number;
  planRevision: number;
  toolName: string;
  executionEnvelopeJson: string;
  idempotencyKey: string;
  status: string;
  artifactId: string | null;
  observationId: string | null;
  finishedAt: Date | null;
};

export type PersistedFinalPackageObservation = {
  observationId: string;
  projectId: string;
  taskId: string;
  invocationId: string | null;
  intentEpoch: number;
  status: string;
  artifactId: string | null;
};

export async function readPackageAssetBuffer(
  artifact: ArtifactRecord,
  invocation: PersistedFinalPackageToolInvocation | null,
  observation: PersistedFinalPackageObservation | null,
) {
  assertFinalPackageToolLineage(artifact, invocation, observation);
  const storage = artifact.structuredContent.storage;
  const packageAsset = storage && typeof storage === "object" ? (storage as Record<string, unknown>).packageAsset : null;
  if (!packageAsset || typeof packageAsset !== "object") throw new Error("stored_package_asset_not_found");
  const asset = packageAsset as Record<string, unknown>;
  if (asset.generationMode !== "versioned_final_package_generated" || asset.mime !== ZIP_MIME || typeof asset.fileName !== "string" || !asset.fileName.trim().toLowerCase().endsWith(".zip") || !Number.isInteger(asset.bytes) || (asset.bytes as number) < 1 || !isSha256(asset.sha256) || !isSha256(asset.manifestSha256)) {
    throw new Error("stored_package_asset_contract_invalid");
  }
  const manifest = requireRecord(artifact.structuredContent.finalPackageManifest, "stored_package_manifest_missing");
  const classroomRunSpec = requireRecord(artifact.structuredContent.classroomRunSpec, "stored_package_run_spec_missing") as ClassroomRunSpec;
  if (asset.manifestSha256 !== createFinalPackageManifestDigest(manifest) || artifact.structuredContent.courseVersionId !== manifest.courseVersionId || artifact.structuredContent.reviewBatchId !== manifest.reviewBatchId || classroomRunSpec.courseVersionId !== manifest.courseVersionId || classroomRunSpec.reviewBatchId !== manifest.reviewBatchId || classroomRunSpec.courseAnchor !== manifest.courseAnchor || classroomRunSpec.pptSlideCount !== manifest.pptSlideCount) {
    throw new Error("stored_package_version_binding_invalid");
  }
  assertStoredSourceLineage(asset.sourceArtifactIds, manifest.files);
  const localOutput = typeof asset.localOutput === "string" ? asset.localOutput : "";
  const absolutePath = resolveLocalArtifactOutput(localOutput);
  if (!absolutePath) throw new Error("stored_package_path_outside_storage");
  const buffer = readFileSync(absolutePath);
  if (buffer.length !== asset.bytes || createHash("sha256").update(buffer).digest("hex") !== asset.sha256) throw new Error("stored_package_digest_mismatch");
  await verifyFinalPackageBuffer(buffer, manifest, classroomRunSpec);
  return { filename: typeof asset.fileName === "string" && asset.fileName.trim() ? asset.fileName : `${safeFileSegment(artifact.id)}.zip`, buffer };
}

function assertFinalPackageToolLineage(
  artifact: ArtifactRecord,
  invocation: PersistedFinalPackageToolInvocation | null,
  observation: PersistedFinalPackageObservation | null,
): asserts invocation is PersistedFinalPackageToolInvocation {
  const envelope = invocation ? parsePersistedFinalPackageEnvelope(invocation.executionEnvelopeJson) : null;
  if (!invocation || !envelope || artifact.origin !== "tool_result" || typeof artifact.taskId !== "string" || !artifact.taskId.trim() || !isSha256(artifact.taskBriefDigest) || !Number.isInteger(artifact.intentEpoch) || (artifact.intentEpoch ?? -1) < 0 || !Number.isInteger(artifact.planRevision) || (artifact.planRevision ?? -1) < 0 || invocation.projectId !== artifact.projectId || invocation.taskId !== artifact.taskId || invocation.intentEpoch !== artifact.intentEpoch || invocation.planRevision !== artifact.planRevision || invocation.artifactId !== artifact.id || invocation.status !== "succeeded" || invocation.toolName !== "create_final_package" || !invocation.observationId || !invocation.finishedAt || invocation.idempotencyKey !== envelope.idempotencyKey || envelope.projectId !== artifact.projectId || envelope.taskId !== artifact.taskId || envelope.intentEpoch !== artifact.intentEpoch || envelope.planRevision !== artifact.planRevision || envelope.taskBriefDigest !== artifact.taskBriefDigest || !observation || observation.observationId !== invocation.observationId || observation.projectId !== artifact.projectId || observation.taskId !== artifact.taskId || observation.invocationId !== invocation.invocationId || observation.intentEpoch !== artifact.intentEpoch || observation.artifactId !== artifact.id || observation.status !== "succeeded") {
    throw new Error("stored_package_tool_lineage_invalid");
  }
}

function parsePersistedFinalPackageEnvelope(value: string): ExecutionEnvelope | null {
  try {
    const parsed = JSON.parse(value) as ExecutionEnvelope;
    return hasValidExecutionEnvelope(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function assertStoredSourceLineage(sourceArtifactIds: unknown, files: unknown): void {
  if (!Array.isArray(sourceArtifactIds) || sourceArtifactIds.length === 0 || sourceArtifactIds.some((id) => typeof id !== "string" || !id.trim()) || new Set(sourceArtifactIds).size !== sourceArtifactIds.length || !isRecord(files)) throw new Error("stored_package_source_lineage_invalid");
  const sourceIds = new Set(sourceArtifactIds);
  if (Object.values(files).some((value) => !isRecord(value) || typeof value.sourceArtifactId !== "string" || !sourceIds.has(value.sourceArtifactId))) throw new Error("stored_package_source_lineage_invalid");
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function requireRecord(value: unknown, errorCode: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(errorCode);
  return value;
}

function safeFileSegment(value: string) {
  return value.trim().toLowerCase().replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-").replace(/[^a-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "project";
}
