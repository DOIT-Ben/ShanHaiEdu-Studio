import type { AgentArtifactDraft, AgentRuntimeFailure, AgentRuntimeInput, AgentRuntimeResult } from "./types";
import type { StructuredRuntimeOutput } from "./openai-runtime-output";

export function buildSucceededResult(input: AgentRuntimeInput, parsed: StructuredRuntimeOutput): AgentRuntimeResult {
  const artifactDraft: AgentArtifactDraft = {
    nodeKey: input.task,
    kind: input.task,
    title: sanitizeRuntimeTeacherText(parsed.artifactDraft.title),
    summary: sanitizeRuntimeTeacherText(parsed.artifactDraft.summary),
    markdown: sanitizeRuntimeTeacherText(parsed.artifactDraft.markdown!),
    contentType: "text/markdown",
    generationMode: "model_generated",
    isReadyForTeacherReview: true,
    structuredContent: parsed.artifactDraft.structuredContent,
  };

  return {
    status: "succeeded",
    run: {
      runId: input.runId,
      projectId: input.projectId,
      task: input.task,
      runtimeKind: "openai",
      status: "succeeded",
    },
    assistantMessage: {
      title: sanitizeRuntimeTeacherText(parsed.assistantMessage.title),
      body: sanitizeRuntimeTeacherText(parsed.assistantMessage.body),
    },
    artifactDraft,
    nextSuggestedAction: {
      type: "review_artifact",
      label: sanitizeRuntimeTeacherText(parsed.nextSuggestedAction.label),
    },
  };
}

export function sanitizeRuntimeTeacherText(value: string): string {
  return value
    .replace(/(["'])(?:file:\/\/\/?)?(?:[A-Za-z]:[\\/]|\/(?:Users|home|tmp|var|private|mnt|Volumes)\/)[^"']+\1/g, "$1[已隐藏]$1")
    .replace(/file:\/\/\/?[^^\s,;，。)）]+/gi, "[已隐藏]")
    .replace(/\b[A-Za-z]:[\\/][^\r\n,;，。)）]+?\.(?:json|log|txt|pptx|md|png|jpe?g|mp4|db)\b/gi, "[已隐藏]")
    .replace(/\b[A-Za-z]:[\\/][^\r\n,;，。)）]+/g, "[已隐藏]")
    .replace(/(?<!:)\/(?:Users|home|tmp|var|private|mnt|Volumes)\/[^\s,;，。)）]+/g, "[已隐藏]")
    .replace(/Bearer\s+[^\s,;，。)）]+/gi, "[已隐藏]")
    .replace(/\b(?:projectId|sourceMessageId|artifactRefs|runtimeKind|providerStatus|placeholder|OPENAI_API_KEY|api\s+key|api[_-]?key|apikey|credential|token|secret|baseURL|localOutput|sha256)\s*[:=]\s*[^\s,;，。)）]+/gi, "[已隐藏]")
    .replace(/https?:\/\/[^\s,;，。)）]+/gi, "[已隐藏]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[已隐藏]")
    .replace(/\b(?:providerPayload|provider|schema|debug|local\s+path|API|artifactKind|nodeKey|capabilityId|toolId|projectId|sourceMessageId|artifactRefs|runtimeKind|providerStatus|placeholder|function_call|review_artifact|create_[a-z_]+|generate_[a-z_]+|extract_[a-z_]+|plan_[a-z_]+)\b/gi, "[已隐藏]");
}

export function buildFailedResult(input: AgentRuntimeInput, failure: AgentRuntimeFailure = { category: "unknown", retryable: true }): AgentRuntimeResult {
  return {
    status: "failed",
    run: {
      runId: input.runId,
      projectId: input.projectId,
      task: input.task,
      runtimeKind: "openai",
      status: "failed",
    },
    failure,
    assistantMessage: {
      title: "本次生成没有完成",
      body: "已保留你当前输入和已确认内容。建议稍后重试；如果连续失败，可以先缩短需求描述或补充教材内容后再生成。",
    },
    nextSuggestedAction: {
      type: "retry",
      label: "重试本次生成",
    },
  };
}
