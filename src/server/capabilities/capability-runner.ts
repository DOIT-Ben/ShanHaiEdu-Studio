import { randomUUID } from "node:crypto";
import { getCapabilityDefinition } from "./capability-registry";
import type { AgentProjectContext, AgentRuntime, AgentRuntimeTask, ApprovedArtifactInput } from "@/server/agent-runtime/types";
import type { CapabilityId, CapabilityRunResult, SaveArtifactDraft } from "./types";

export type AgentRuntimeCapabilityInput = {
  runtime: AgentRuntime;
  projectId: string;
  capabilityId: CapabilityId;
  userMessage: string;
  projectContext: AgentProjectContext;
  approvedArtifacts?: ApprovedArtifactInput[];
};

const capabilityRuntimeTaskMap: Partial<Record<CapabilityId, AgentRuntimeTask>> = {
  requirement_spec: "requirement_spec",
  lesson_plan: "lesson_plan",
  ppt_outline: "ppt_outline",
  intro_video: "intro_video_plan",
  final_package: "final_delivery_checklist",
};

const runtimeArtifactMap: Record<AgentRuntimeTask, Pick<SaveArtifactDraft, "nodeKey" | "kind">> = {
  requirement_spec: { nodeKey: "requirement_spec", kind: "requirement_spec" },
  textbook_evidence: { nodeKey: "textbook_evidence", kind: "textbook_evidence" },
  lesson_plan: { nodeKey: "lesson_plan", kind: "lesson_plan" },
  ppt_outline: { nodeKey: "ppt_draft", kind: "ppt_draft" },
  intro_video_plan: { nodeKey: "intro_video_plan", kind: "intro_video_plan" },
  final_delivery_checklist: { nodeKey: "final_delivery", kind: "final_delivery" },
};

export async function runCapabilityWithAgentRuntime(input: AgentRuntimeCapabilityInput): Promise<CapabilityRunResult> {
  const capability = getCapabilityDefinition(input.capabilityId);
  const placeholder = buildExternalPlaceholderResult(input.capabilityId, input.userMessage);
  if (placeholder) return placeholder;

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

  const artifactTarget = runtimeArtifactMap[result.artifactDraft.nodeKey];
  return {
    status: "succeeded",
    artifactDraft: {
      ...artifactTarget,
      title: result.artifactDraft.title,
      summary: result.artifactDraft.summary,
      markdownContent: result.artifactDraft.markdown,
      structuredContent: {
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

function buildExternalPlaceholderResult(capabilityId: CapabilityId, userMessage: string): CapabilityRunResult | null {
  if (capabilityId !== "coze_ppt" && capabilityId !== "image_asset" && capabilityId !== "intro_video") return null;

  const capability = getCapabilityDefinition(capabilityId);
  const titles: Record<typeof capabilityId, string> = {
    coze_ppt: "PPTX 生成接线占位",
    image_asset: "课堂图片素材提示词",
    intro_video: "导入视频分镜占位",
  };
  const summaries: Record<typeof capabilityId, string> = {
    coze_ppt: "已把 PPTX 生成节点接入交付计划，当前先保存可检查的接线占位。",
    image_asset: "已生成课堂图片素材提示词，后续可接入图片生成服务替换为真实图片。",
    intro_video: "已生成导入视频分镜和生成提示，后续可接入视频生成服务替换为真实视频。",
  };

  const markdownContent = [
    `# ${titles[capabilityId]}`,
    "",
    summaries[capabilityId],
    "",
    "## 当前用途",
    "",
    "- 让完整备课交付链路先能推进到本节点。",
    "- 保存后续真实服务接入所需的草稿输入。",
    "- 该结果是接线占位，不代表外部文件已经生成。",
    "",
    "## 原始需求",
    "",
    userMessage,
  ].join("\n");

  return {
    status: "succeeded",
    artifactDraft: {
      nodeKey: capability.workflowNodeKey,
      kind: capability.artifactKind,
      title: titles[capabilityId],
      summary: summaries[capabilityId],
      markdownContent,
      structuredContent: {
        capabilityId,
        generationMode: "deterministic_draft",
        providerStatus: "deterministic_draft",
        placeholder: true,
      },
    },
    assistantSummary: `已完成「${capability.userLabel}」的接线占位，完整链路可以继续推进。`,
    providerStatus: "deterministic_draft",
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
