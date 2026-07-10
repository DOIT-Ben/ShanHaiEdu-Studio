import type { ToolExecutionResult } from "@/server/tools/tool-types";

export type ToolOutputSerializerMetadata = {
  artifactTitle?: string;
};

type TeacherFacingToolOutput = {
  statusLabel: ToolExecutionResult["status"];
  teacherSafeSummary: string;
  nextActionLabel: "review_artifact" | "ask_teacher_for_input" | "adjust_or_retry" | "retry_later";
  artifactTitle?: string;
  artifactReadyForReview: boolean;
};

export function serializeToolExecutionResultForFunctionCallOutput(
  result: ToolExecutionResult,
  metadata: ToolOutputSerializerMetadata = {},
): string {
  return JSON.stringify(createTeacherFacingToolOutput(result, metadata));
}

const bareUrlAssignmentPattern = /\burl\b\s*[:=]\s*[^\s,;，。)）]+/gi;
const bareUrlLabelPattern = /\burl\b\s*[:=]?/gi;

function createTeacherFacingToolOutput(
  result: ToolExecutionResult,
  metadata: ToolOutputSerializerMetadata,
): TeacherFacingToolOutput {
  if (result.status === "succeeded") {
    return removeUndefinedFields({
      statusLabel: "succeeded",
      teacherSafeSummary: sanitizeTeacherFacingText(result.assistantSummary || "材料已生成，可以检查。"),
      nextActionLabel: "review_artifact",
      artifactTitle: sanitizeOptionalTeacherFacingText(metadata.artifactTitle ?? result.artifactDraft.title),
      artifactReadyForReview: true,
    });
  }

  if (result.status === "needs_input") {
    return {
      statusLabel: "needs_input",
      teacherSafeSummary: sanitizeTeacherFacingText(result.assistantPrompt || "还需要补充信息后才能继续。"),
      nextActionLabel: "ask_teacher_for_input",
      artifactReadyForReview: false,
    };
  }

  if (result.status === "retryable_failed") {
    return {
      statusLabel: "retryable_failed",
      teacherSafeSummary: sanitizeTeacherFacingText(result.observation.teacherSafeSummary || "这一步暂时没有完成，可以稍后再试。"),
      nextActionLabel: "retry_later",
      artifactReadyForReview: false,
    };
  }

  return {
    statusLabel: "failed",
    teacherSafeSummary: sanitizeTeacherFacingText(result.observation.teacherSafeSummary || "这一步暂时没有完成，可以调整要求后重试。"),
    nextActionLabel: "adjust_or_retry",
    artifactReadyForReview: false,
  };
}

function removeUndefinedFields(output: TeacherFacingToolOutput): TeacherFacingToolOutput {
  return Object.fromEntries(Object.entries(output).filter(([, value]) => value !== undefined)) as TeacherFacingToolOutput;
}

function sanitizeOptionalTeacherFacingText(value: string | undefined): string | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  return sanitizeTeacherFacingText(value);
}

function sanitizeTeacherFacingText(value: string): string {
  return value
    .replace(/(["'])(?:file:\/\/\/?)?(?:[A-Za-z]:[\\/]|\/(?:Users|home|tmp|var|private|mnt|Volumes)\/)[^"']+\1/g, "$1[已隐藏]$1")
    .replace(/file:\/\/\/?[^\s,;，。)）]+/gi, "[已隐藏]")
    .replace(/\b[A-Za-z]:[\\/][^\s,;，。)）]+/g, "[已隐藏]")
    .replace(/(?<!:)\/(?:Users|home|tmp|var|private|mnt|Volumes)\/[^\s,;，。)）]+/g, "[已隐藏]")
    .replace(/Bearer\s+[^\s,;，。)）]+/gi, "[已隐藏]")
    .replace(bareUrlAssignmentPattern, "[已隐藏]")
    .replace(/\b(?:api[_-]?key|apikey|credential|token|secret|baseURL|localOutput|sha256)\s*[:=]\s*[^\s,;，。)）]+/gi, "[已隐藏]")
    .replace(/https?:\/\/[^\s,;，。)）]+/gi, "[已隐藏]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[已隐藏]")
    .replace(bareUrlLabelPattern, "[已隐藏]")
    .replace(/\b(?:providerPayload|provider|schema|debug|local\s+path|API|artifactKind|nodeKey|capabilityId|toolId)\b/gi, "[已隐藏]");
}
