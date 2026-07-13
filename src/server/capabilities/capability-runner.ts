import { randomUUID } from "node:crypto";
import { getCapabilityDefinition } from "./capability-registry";
import { validatePptDesignDraftForCoze } from "@/server/ppt-design/ppt-design-validation";
import type { AgentProjectContext, AgentRuntime, AgentRuntimeTask, ApprovedArtifactInput } from "@/server/agent-runtime/types";
import type { CapabilityId, CapabilityRunResult, SaveArtifactDraft } from "./types";
import { validateStoryboardManifest, type StoryboardManifest } from "@/server/video-quality/video-production-contract";
import { validateVideoNarrationScript, type VideoNarrationScript } from "@/server/video-quality/video-narration-contract";

export type AgentRuntimeCapabilityInput = {
  runtime: AgentRuntime;
  projectId: string;
  capabilityId: CapabilityId;
  userMessage: string;
  projectContext: AgentProjectContext;
  approvedArtifacts?: ApprovedArtifactInput[];
  sourceMessageId?: string;
};

const capabilityRuntimeTaskMap: Partial<Record<CapabilityId, AgentRuntimeTask>> = {
  requirement_spec: "requirement_spec",
  lesson_plan: "lesson_plan",
  ppt_outline: "ppt_outline",
  ppt_design: "ppt_design",
  knowledge_anchor_extract: "knowledge_anchor_extract",
  creative_theme_generate: "creative_theme_generate",
  video_script_generate: "video_script_generate",
  storyboard_generate: "storyboard_generate",
  asset_brief_generate: "asset_brief_generate",
  video_segment_plan: "video_segment_plan",
  concat_only_assemble: "concat_only_assemble",
  final_package: "final_delivery_checklist",
};

const runtimeArtifactMap: Record<AgentRuntimeTask, Pick<SaveArtifactDraft, "nodeKey" | "kind">> = {
  requirement_spec: { nodeKey: "requirement_spec", kind: "requirement_spec" },
  textbook_evidence: { nodeKey: "textbook_evidence", kind: "textbook_evidence" },
  lesson_plan: { nodeKey: "lesson_plan", kind: "lesson_plan" },
  ppt_outline: { nodeKey: "ppt_draft", kind: "ppt_draft" },
  ppt_design: { nodeKey: "ppt_design_draft", kind: "ppt_design_draft" },
  intro_video_plan: { nodeKey: "intro_video_plan", kind: "intro_video_plan" },
  knowledge_anchor_extract: { nodeKey: "knowledge_anchor_extract", kind: "knowledge_anchor_extract" },
  creative_theme_generate: { nodeKey: "creative_theme_generate", kind: "creative_theme_generate" },
  video_script_generate: { nodeKey: "video_script_generate", kind: "video_script_generate" },
  storyboard_generate: { nodeKey: "storyboard_generate", kind: "storyboard_generate" },
  asset_brief_generate: { nodeKey: "asset_brief_generate", kind: "asset_brief_generate" },
  video_segment_plan: { nodeKey: "video_segment_plan", kind: "video_segment_plan" },
  concat_only_assemble: { nodeKey: "concat_only_assemble", kind: "concat_only_assemble" },
  final_delivery_checklist: { nodeKey: "final_delivery", kind: "final_delivery" },
};

export async function runCapabilityWithAgentRuntime(input: AgentRuntimeCapabilityInput): Promise<CapabilityRunResult> {
  const capability = getCapabilityDefinition(input.capabilityId);
  const task = capabilityRuntimeTaskMap[input.capabilityId];

  if (!task) {
    return {
      status: "failed",
      userMessage: capability.failureRecovery.userMessage,
      retryable: capability.failureRecovery.retryable,
      errorCategory: capability.providerMode === "external" ? "provider" : "validation",
    };
  }

  const result = await input.runtime.run({
    projectId: input.projectId,
    runId: randomUUID(),
    sourceMessageId: input.sourceMessageId,
    task,
    userMessage: input.userMessage,
    projectContext: input.projectContext,
    approvedArtifacts: input.approvedArtifacts ?? [],
  });

  if (result.status !== "succeeded") {
    return {
      status: "failed",
      userMessage: result.assistantMessage.body || capability.failureRecovery.userMessage,
      retryable: capability.failureRecovery.retryable,
      errorCategory: "provider",
    };
  }

  const deterministic_runtime_blocked_real_asset =
    result.artifactDraft.generationMode === "deterministic_draft" && capability.deterministicFallback === "blocked";

  if (deterministic_runtime_blocked_real_asset) {
    return {
      status: "failed",
      userMessage: capability.failureRecovery.userMessage,
      retryable: capability.failureRecovery.retryable,
      errorCategory: "validation",
    } satisfies CapabilityRunResult & { status: "failed" };
  }

  if (input.capabilityId === "ppt_design") {
    const designValidation = validatePptDesignDraftForCoze(result.artifactDraft.markdown);
    if (!designValidation.valid) {
      return {
        status: "failed",
        userMessage: designValidation.message,
        retryable: true,
        errorCategory: "validation",
      };
    }
  }
  if (input.capabilityId === "storyboard_generate") {
    const manifest = result.artifactDraft.structuredContent?.videoStoryboardManifest;
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) || !validateStoryboardManifest(manifest as StoryboardManifest).valid) {
      return {
        status: "failed",
        userMessage: "视频分镜缺少可执行的镜头与连续性信息，请重新生成分镜。",
        retryable: true,
        errorCategory: "validation",
      };
    }
  }
  if (input.capabilityId === "video_script_generate") {
    const script = result.artifactDraft.structuredContent?.videoNarrationScript;
    if (!script || typeof script !== "object" || Array.isArray(script) || !validateVideoNarrationScript(script as VideoNarrationScript).valid) {
      return { status: "failed", userMessage: "视频脚本缺少可执行的受控旁白内容，请重新生成脚本。", retryable: true, errorCategory: "validation" };
    }
  }

  const artifactTarget = runtimeArtifactMap[result.artifactDraft.nodeKey];
  return {
    status: "succeeded",
    artifactDraft: {
      ...artifactTarget,
      title: result.artifactDraft.title,
      summary: result.artifactDraft.summary,
      markdownContent: result.artifactDraft.markdown,
      structuredContent: {
        ...result.artifactDraft.structuredContent,
        capabilityId: input.capabilityId,
        generationMode: result.artifactDraft.generationMode,
        providerStatus: result.artifactDraft.generationMode === "model_generated" ? "real" : "deterministic_draft",
        runtimeKind: result.run.runtimeKind,
        nextSuggestedAction: result.nextSuggestedAction.label,
      },
    },
    assistantSummary: result.assistantMessage.title
      ? `${result.assistantMessage.title}\n\n${result.assistantMessage.body}`
      : result.assistantMessage.body,
    providerStatus: result.artifactDraft.generationMode === "model_generated" ? "real" : "deterministic_draft",
  };
}

export function normalizeCapabilityRunResult(result: CapabilityRunResult): CapabilityRunResult {
  if (result.status === "failed") {
    return {
      status: "failed",
      userMessage: result.userMessage.trim() || "这一步暂时没有完成，可以稍后重试。",
      retryable: result.retryable,
      errorCategory: result.errorCategory,
    };
  }

  if (result.status === "needs_input") {
    return {
      status: "needs_input",
      missingInputs: [...result.missingInputs],
      assistantPrompt: result.assistantPrompt.trim(),
    };
  }

  return {
    status: "succeeded",
    artifactDraft: { ...result.artifactDraft },
    assistantSummary: result.assistantSummary.trim(),
    providerStatus: result.providerStatus,
  };
}
