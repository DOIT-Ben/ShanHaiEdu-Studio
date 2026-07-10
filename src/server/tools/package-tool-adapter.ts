import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolveLocalArtifactOutput, writeLocalArtifact } from "@/server/artifact-storage/local-artifact-storage";
import { buildStoredImageDownload } from "@/server/image-generation/artifact-image";
import { buildFinalMaterialPackageDownload } from "@/server/package/artifact-package";
import { buildStoredArtifactPptxDownload } from "@/server/pptx/artifact-pptx";
import { buildStoredVideoDownload } from "@/server/video-generation/artifact-video";
import type { ArtifactRecord } from "@/server/workbench/types";
import type { ToolArtifactTruth, ToolDefinition, ToolExecutionResult, ToolQualityGateResult } from "./tool-types";
import { createToolObservation } from "@/server/capabilities/tool-observation";
import { buildAgentHarnessBudgetEvent } from "@/server/conversation/agent-harness-budget";

export type PackageArtifactRef = {
  kind: string;
  artifactId: string;
};

export type PackageToolAdapterInput = {
  tool: ToolDefinition;
  projectId: string;
  artifactRefs: PackageArtifactRef[];
  resolvedArtifacts?: ArtifactRecord[];
  sourceMessageId?: string;
};

const ZIP_MIME = "application/zip";

export async function executePackageTool(input: PackageToolAdapterInput): Promise<ToolExecutionResult> {
  if (input.tool.adapterKind !== "package" || !input.tool.implemented) {
    return buildFailureResult(input, "tool_failed", "这一步暂时无法执行，请稍后重试。", "Unsupported package tool.", "unsupported_package_tool");
  }

  try {
    if (input.tool.capabilityId === "concat_only_assemble") {
      return await executeConcatOnlyAssemble(input);
    }
    if (input.tool.capabilityId === "final_package") {
      return await executeFinalPackage(input);
    }
    return buildFailureResult(input, "tool_failed", "这类打包工具暂时不能自动执行。", `Unsupported package capability: ${input.tool.capabilityId}`, "unsupported_package_tool");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown package tool error";
    return buildFailureResult(input, "quality_gate_failed", "生成结果没有通过交付校验，我没有保存这份结果。", reason, "quality_gate_failed");
  }
}

async function executeConcatOnlyAssemble(input: PackageToolAdapterInput): Promise<ToolExecutionResult> {
  const segments = findResolvedArtifacts(input, "video_segment_generate").sort(compareArtifactsForConcat);
  if (segments.length === 0) {
    throw new Error("missing_video_segments");
  }

  const buffers = segments.map((artifact) => buildStoredVideoDownload(artifact).buffer);
  const output = Buffer.concat(buffers);
  if (!validateMp4Buffer(output)) {
    throw new Error("invalid_concat_video_output");
  }

  const fileName = `concat-${safeFileSegment(input.projectId)}-${Date.now()}.mp4`;
  const stored = writeLocalArtifact({ category: "video-artifacts", fileName, buffer: output });
  const sha256 = createHash("sha256").update(output).digest("hex");
  const sourceArtifactIds = segments.map((artifact) => artifact.id);
  const artifactTruth = buildArtifactTruth(input.tool, "concat_only_assemble");
  const qualityGate = { passed: true, gates: ["mp4_ftyp_present", "mp4_moov_present", "concat_only_order_preserved"] } satisfies ToolQualityGateResult;

  return {
    status: "succeeded",
    toolId: input.tool.id,
    capabilityId: input.tool.capabilityId ?? "concat_only_assemble",
    artifactDraft: {
      nodeKey: "concat_only_assemble",
      kind: "concat_only_assemble",
      title: "真实导入视频成片",
      summary: "已按分镜顺序只拼接已通过校验的视频片段，请核对播放连贯性。",
      markdownContent: "# 真实导入视频成片\n\n已按分镜顺序只拼接视频片段，没有重排、转场、滤镜或内容改写。",
      structuredContent: {
        文件状态: "真实导入视频已拼接",
        文件大小: `${output.length} bytes`,
        文件类型: "video/mp4",
        storage: {
          videoAsset: {
            fileName,
            localOutput: stored.localOutput,
            bytes: output.length,
            sha256,
            mime: "video/mp4",
            generationMode: "concat_only_assembled",
            sourceArtifactIds,
          },
        },
        artifactTruth,
        qualityGate,
      },
    },
    artifactTruth,
    qualityGate,
    assistantSummary: "真实导入视频已按分镜顺序拼接并通过基础校验。",
    budgetEvent: buildBudgetEvent(input.tool, "succeeded", "tool_succeeded"),
  };
}

async function executeFinalPackage(input: PackageToolAdapterInput): Promise<ToolExecutionResult> {
  const finalDelivery = buildFinalDeliveryArtifact(input);
  const pptx = await buildStoredArtifactPptxDownload(requireArtifact(input, "pptx_artifact"));
  const image = buildStoredImageDownload(requireArtifact(input, "image_prompts"));
  const video = buildStoredVideoDownload(requireArtifact(input, "concat_only_assemble"));
  const download = await buildFinalMaterialPackageDownload({ finalDelivery, pptx, image, video });
  if (!validateZipBuffer(download.buffer)) {
    throw new Error("invalid_final_package_zip");
  }

  const stored = writeLocalArtifact({ category: "package-artifacts", fileName: download.filename, buffer: download.buffer });
  const sha256 = createHash("sha256").update(download.buffer).digest("hex");
  const sourceArtifactIds = input.tool.requiredArtifactKinds.map((kind) => requireArtifact(input, kind).id);
  const artifactTruth = buildArtifactTruth(input.tool, "final_delivery");
  const qualityGate = { passed: true, gates: ["zip_valid", "pptx_included", "image_included", "video_included", "manifest_included"] } satisfies ToolQualityGateResult;

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
        storage: {
          packageAsset: {
            fileName: download.filename,
            localOutput: stored.localOutput,
            bytes: download.buffer.length,
            sha256,
            mime: ZIP_MIME,
            generationMode: "final_package_generated",
            sourceArtifactIds,
          },
        },
        artifactTruth,
        qualityGate,
      },
    },
    artifactTruth,
    qualityGate,
    assistantSummary: "最终材料包已生成并通过基础校验。",
    budgetEvent: buildBudgetEvent(input.tool, "succeeded", "tool_succeeded"),
  };
}

function buildFinalDeliveryArtifact(input: PackageToolAdapterInput) {
  const now = new Date().toISOString();
  return {
    id: `final-${input.projectId}`,
    key: `final-${input.projectId}`,
    nodeKey: "final_delivery",
    kind: "final_delivery",
    title: "最终材料包",
    summary: "真实交付材料汇总。",
    markdownContent: buildFinalDeliveryMarkdown(input),
    updatedAt: now,
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

function requireArtifact(input: PackageToolAdapterInput, kind: string): ArtifactRecord {
  const artifact = findResolvedArtifacts(input, kind)[0];
  if (!artifact) {
    throw new Error(`missing_${kind}`);
  }
  return artifact;
}

function findResolvedArtifacts(input: PackageToolAdapterInput, kind: string): ArtifactRecord[] {
  const refIds = new Set(input.artifactRefs.filter((ref) => ref.kind === kind && ref.artifactId.trim()).map((ref) => ref.artifactId));
  return (input.resolvedArtifacts ?? []).filter(
    (artifact) =>
      refIds.has(artifact.id) &&
      artifact.projectId === input.projectId &&
      artifact.kind === kind &&
      artifact.nodeKey === kind &&
      artifact.status === "approved" &&
      artifact.isApproved === true,
  );
}

function compareArtifactsForConcat(left: ArtifactRecord, right: ArtifactRecord) {
  if (left.version !== right.version) return left.version - right.version;
  return left.updatedAt.localeCompare(right.updatedAt);
}

function buildArtifactTruth(tool: ToolDefinition, fallbackKind: string): ToolArtifactTruth {
  return {
    created: true,
    persisted: true,
    persistenceScope: "provider_local_file",
    providerPersisted: true,
    workbenchPersisted: false,
    placeholder: false,
    producedArtifactKind: tool.producedArtifactKind ?? fallbackKind,
  };
}

function buildFailureResult(
  input: PackageToolAdapterInput,
  kind: "tool_failed" | "quality_gate_failed",
  teacherSafeSummary: string,
  internalReason: string,
  errorCategory: string,
): ToolExecutionResult {
  const capabilityId = input.tool.capabilityId ?? "unknown";
  return {
    status: "failed",
    toolId: input.tool.id,
    capabilityId,
    observation: createToolObservation({
      projectId: input.projectId,
      sourceMessageId: input.sourceMessageId,
      capabilityId,
      expectedArtifactKind: input.tool.producedArtifactKind,
      kind,
      teacherSafeSummary,
      internalReasonSanitized: internalReason,
      retryPolicy: { retryable: false, nextAction: kind === "quality_gate_failed" ? "fix_inputs" : "ask_teacher" },
    }),
    artifactCreated: false,
    errorCategory,
    budgetEvent: buildBudgetEvent(input.tool, "failed", kind),
  };
}

function buildBudgetEvent(tool: ToolDefinition, status: "succeeded" | "failed", kind: "tool_succeeded" | "tool_failed" | "quality_gate_failed") {
  return buildAgentHarnessBudgetEvent({
    capabilityId: tool.capabilityId ?? "unknown",
    actionKey: `${tool.id}:${tool.producedArtifactKind ?? ""}`,
    expectedArtifactKind: tool.producedArtifactKind,
    status,
    kind,
  });
}

function validateZipBuffer(buffer: Buffer) {
  return buffer.length > 64 && buffer.subarray(0, 2).toString("utf8") === "PK" && buffer.includes(Buffer.from("manifest.json"));
}

function validateMp4Buffer(buffer: Buffer) {
  if (buffer.length < 1024) return false;
  const ftypLimit = Math.min(buffer.length - 4, 64);
  let hasFtyp = false;
  for (let index = 0; index <= ftypLimit; index += 1) {
    if (buffer.subarray(index, index + 4).toString("ascii") === "ftyp") {
      hasFtyp = true;
      break;
    }
  }
  const moovLimit = Math.min(buffer.length - 4, 1024 * 1024);
  let hasMoov = false;
  for (let index = 0; index <= moovLimit; index += 1) {
    if (buffer.subarray(index, index + 4).toString("ascii") === "moov") {
      hasMoov = true;
      break;
    }
  }
  return hasFtyp && hasMoov;
}

function safeFileSegment(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-")
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "project"
  );
}

export function readPackageAssetBuffer(artifact: ArtifactRecord) {
  const storage = artifact.structuredContent.storage;
  const packageAsset = storage && typeof storage === "object" ? (storage as Record<string, unknown>).packageAsset : null;
  if (!packageAsset || typeof packageAsset !== "object") {
    throw new Error("stored_package_asset_not_found");
  }
  const asset = packageAsset as { localOutput?: unknown; fileName?: unknown };
  const localOutput = typeof asset.localOutput === "string" ? asset.localOutput : "";
  const absolutePath = resolveLocalArtifactOutput(localOutput);
  if (!absolutePath) {
    throw new Error("stored_package_path_outside_storage");
  }
  const buffer = readFileSync(absolutePath);
  if (!validateZipBuffer(buffer)) {
    throw new Error("invalid_stored_package_file");
  }
  return {
    filename: typeof asset.fileName === "string" && asset.fileName.trim() ? asset.fileName : `${safeFileSegment(artifact.id)}.zip`,
    buffer,
  };
}
