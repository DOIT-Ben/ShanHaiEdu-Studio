import type { GptFunctionCall } from "./types";

export type ToolCallIntentStatus = "ready" | "invalid_arguments" | "unsupported";

export type ToolCallTeacherIntent = {
  userInstruction?: string;
  teacherIntent?: string;
  notes?: string;
};

export type ToolCallIntent = {
  toolName: string;
  callId: string;
  status: ToolCallIntentStatus;
  teacherIntent?: ToolCallTeacherIntent;
  diagnostics?: {
    reason?: "tool_not_allowlisted" | "arguments_not_object";
    omittedUnsafeArgumentCount?: number;
  };
};

export type CreateToolCallIntentOptions = {
  allowedToolNames: readonly string[];
};

const teacherSafeArgumentKeys = ["userInstruction", "teacherIntent", "notes"] as const;
const degradedTeacherSemanticText = "已收到补充要求。";
const internalControlFieldAssignmentPattern =
  /\b(?:projectId|artifactRefs|sourceMessageId|provider|capabilityId|toolId|nodeKey|schema|baseURL|api[_-]?key|apikey|token|secret)\b\s*[:=]\s*[^\s,;，。)）]+/gi;
const internalControlFieldNamePattern =
  /\b(?:projectId|artifactRefs|sourceMessageId|provider|capabilityId|toolId|nodeKey|schema|baseURL|api[_-]?key|apikey|token|secret)\b/gi;
const internalControlFieldNameDetectionPattern =
  /\b(?:projectId|artifactRefs|sourceMessageId|provider|capabilityId|toolId|nodeKey|schema|baseURL|api[_-]?key|apikey|token|secret)\b/i;

export function createToolCallIntent(call: GptFunctionCall, options: CreateToolCallIntentOptions): ToolCallIntent {
  const baseIntent = {
    toolName: call.name,
    callId: call.callId,
  };

  if (!options.allowedToolNames.includes(call.name)) {
    return {
      ...baseIntent,
      status: "unsupported",
      diagnostics: { reason: "tool_not_allowlisted" },
    };
  }

  if (call.argumentsJsonParseStatus !== "parsed" || !isPlainRecord(call.argumentsJson)) {
    return {
      ...baseIntent,
      status: "invalid_arguments",
      diagnostics: { reason: "arguments_not_object" },
    };
  }

  const teacherIntent = pickTeacherIntent(call.argumentsJson);
  const omittedUnsafeArgumentCount = Object.keys(call.argumentsJson).filter((key) => !teacherSafeArgumentKeys.includes(key as TeacherSafeArgumentKey)).length;

  return {
    ...baseIntent,
    status: "ready",
    ...(Object.keys(teacherIntent).length > 0 ? { teacherIntent } : {}),
    ...(omittedUnsafeArgumentCount > 0 ? { diagnostics: { omittedUnsafeArgumentCount } } : {}),
  };
}

type TeacherSafeArgumentKey = (typeof teacherSafeArgumentKeys)[number];

function pickTeacherIntent(argumentsJson: Record<string, unknown>): ToolCallTeacherIntent {
  const teacherIntent: ToolCallTeacherIntent = {};

  for (const key of teacherSafeArgumentKeys) {
    const value = argumentsJson[key];
    if (typeof value === "string" && value.trim().length > 0) {
      teacherIntent[key] = sanitizeTeacherSemanticText(value);
    }
  }

  return teacherIntent;
}

function sanitizeTeacherSemanticText(value: string): string {
  if (internalControlFieldNameDetectionPattern.test(value)) {
    return degradedTeacherSemanticText;
  }

  return value
    .replace(/(["'])(?:file:\/\/\/?)?(?:[A-Za-z]:[\\/]|\/(?:Users|home|tmp|var|private|mnt)\/)[^"']+\1/g, "$1[已隐藏]$1")
    .replace(/file:\/\/\/?[^\s,;，。)）]+/gi, "[已隐藏]")
    .replace(/\b[A-Za-z]:[\\/][^\s,;，。)）]+/g, "[已隐藏]")
    .replace(/(?<!:)\/(?:Users|home|tmp|var|private|mnt)\/[^\s,;，。)）]+/g, "[已隐藏]")
    .replace(/Bearer\s+[^\s,;，。)）]+/gi, "[已隐藏]")
    .replace(internalControlFieldAssignmentPattern, "[已隐藏]")
    .replace(/\b(?:api[_-]?key|apikey|credential|token|secret|baseURL)\s*[:=]\s*[^\s,;，。)）]+/gi, "[已隐藏]")
    .replace(/https?:\/\/[^\s,;，。)）]+/gi, "[已隐藏]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[已隐藏]")
    .replace(internalControlFieldNamePattern, "[已隐藏]");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
