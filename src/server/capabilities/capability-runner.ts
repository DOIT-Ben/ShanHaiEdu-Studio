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
