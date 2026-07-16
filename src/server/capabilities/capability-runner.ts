import { randomUUID } from "node:crypto";
import { getCapabilityDefinition } from "./capability-registry";
import type { AgentProjectContext, AgentRuntime, AgentRuntimeTask, ApprovedArtifactInput, BusinessSkillContext } from "@/server/agent-runtime/types";
import type { CapabilityId, CapabilityRunResult, SaveArtifactDraft } from "./types";
import { validateStoryboardManifest, type StoryboardManifest } from "@/server/video-quality/video-production-contract";
import { validateVideoNarrationScript, type VideoNarrationScript } from "@/server/video-quality/video-narration-contract";
import {
  normalizePptDesignSemanticCandidate,
  projectAuthoritativePptDesignCandidate,
  type PptDesignSemanticCandidate,
} from "@/server/ppt-quality/ppt-design-candidate";
import {
  hasValidExecutionEnvelope,
  hasValidTaskBrief,
  type ExecutionEnvelope,
  type TaskBrief,
} from "@/server/conversation/task-contract";

export type AgentRuntimeCapabilityInput = {
  runtime: AgentRuntime;
  projectId: string;
  capabilityId: CapabilityId;
  userMessage: string;
  taskInput?: Record<string, unknown>;
  projectContext: AgentProjectContext;
  approvedArtifacts?: ApprovedArtifactInput[];
  businessSkillContext?: BusinessSkillContext;
  sourceMessageId?: string;
  executionEnvelope?: ExecutionEnvelope;
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
    taskInput: input.taskInput,
    projectContext: input.projectContext,
    approvedArtifacts: input.approvedArtifacts ?? [],
    businessSkillContext: input.businessSkillContext,
  });

  if (result.status !== "succeeded") {
    return {
      status: "failed",
      userMessage: result.assistantMessage.body || capability.failureRecovery.userMessage,
      retryable: result.failure?.retryable ?? capability.failureRecovery.retryable,
      errorCategory: result.failure?.category ?? "provider",
      ...(result.failure?.reasonCode ? { reasonCode: result.failure.reasonCode } : {}),
      ...(result.failure?.details?.length ? { reasonDetails: [...result.failure.details] } : {}),
      runtimeRun: {
        runId: result.run.runId,
        runtimeKind: result.run.runtimeKind,
        status: "failed",
      },
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
  if (input.capabilityId === "ppt_design") {
    const candidateValue = result.artifactDraft.structuredContent?.pptDesignCandidate;
    if (!candidateValue) return pptCandidateFailure("ppt_design_candidate_missing");
    let semanticCandidate: PptDesignSemanticCandidate;
    try {
      semanticCandidate = normalizePptDesignSemanticCandidate(candidateValue);
    } catch (error) {
      return pptCandidateFailure("ppt_design_candidate_semantics_invalid", extractPptCandidateIssues(error));
    }
    const taskBinding = resolvePptTaskBinding(input);
    if (!taskBinding) return pptCandidateFailure("ppt_design_task_binding_missing");
    const scopeIssues = candidateSemanticScopeIssues(semanticCandidate, input);
    if (scopeIssues.length > 0) {
      return pptCandidateFailure("ppt_design_candidate_semantics_invalid", scopeIssues);
    }
    const trustedPptDraft = resolveTrustedPptDraft(input.approvedArtifacts ?? []);
    if (!trustedPptDraft) return pptCandidateFailure("ppt_design_evidence_binding_missing");
    try {
      result.artifactDraft.structuredContent = {
        ...result.artifactDraft.structuredContent,
        pptDesignCandidate: projectAuthoritativePptDesignCandidate({
          semanticCandidate,
          taskBriefDigest: taskBinding.taskBrief.digest,
          sourceArtifact: {
            artifactId: trustedPptDraft.artifactId,
            version: trustedPptDraft.version,
            digest: trustedPptDraft.digest,
            sourceType: "teacher_material",
          },
        }).candidate,
      };
    } catch (error) {
      return pptCandidateFailure("ppt_design_candidate_semantics_invalid", extractPptCandidateIssues(error));
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

function pptCandidateFailure(reasonCode: string, reasonDetails: string[] = []): Extract<CapabilityRunResult, { status: "failed" }> {
  return {
    status: "failed",
    userMessage: "逐页课件设计候选没有通过当前任务校验，我会根据具体原因重新规划。",
    retryable: true,
    errorCategory: "validation",
    reasonCode,
    ...(reasonDetails.length > 0 ? { reasonDetails: [...new Set(reasonDetails)] } : {}),
  };
}

function resolvePptTaskBinding(input: AgentRuntimeCapabilityInput): { taskBrief: TaskBrief; envelope: ExecutionEnvelope } | undefined {
  const envelope = input.executionEnvelope;
  const taskBriefValue = input.taskInput?.taskBrief;
  if (!envelope || !hasValidExecutionEnvelope(envelope) || !isRecord(taskBriefValue)) return undefined;
  const taskBrief = taskBriefValue as unknown as TaskBrief;
  if (!hasValidTaskBrief(taskBrief)) return undefined;
  if (
    envelope.projectId !== input.projectId ||
    taskBrief.projectId !== input.projectId ||
    envelope.projectId !== taskBrief.projectId ||
    envelope.taskId !== taskBrief.taskId ||
    envelope.intentEpoch !== taskBrief.intentEpoch ||
    envelope.taskBriefDigest !== taskBrief.digest
  ) return undefined;
  return { taskBrief, envelope };
}

function candidateSemanticScopeIssues(
  candidate: PptDesignSemanticCandidate,
  input: AgentRuntimeCapabilityInput,
): string[] {
  const expected = input.projectContext;
  const issues: string[] = [];
  if (!hasMatchingSemanticScope(candidate.brief.grade, expected.grade)) issues.push("grade_mismatch");
  if (!hasMatchingSemanticScope(candidate.brief.subject, expected.subject)) issues.push("subject_mismatch");
  if (!hasMatchingSemanticScope(candidate.brief.topic, expected.topic)) issues.push("topic_mismatch");
  const targetPageCount = input.taskInput?.targetPageCount;
  if (Number.isInteger(targetPageCount) && candidate.brief.targetSlideCount !== targetPageCount) {
    issues.push("target_slide_count_mismatch");
  }
  return issues;
}

function extractPptCandidateIssues(error: unknown) {
  if (!(error instanceof Error)) return [];
  const separator = error.message.indexOf(":");
  if (separator < 0) return [];
  return error.message.slice(separator + 1).split(",")
    .map((issue) => issue.trim())
    .filter((issue) => issue.length > 0 && issue.length <= 160 && /^[A-Za-z0-9_:[\].-]+$/.test(issue));
}

function resolveTrustedPptDraft(artifacts: ApprovedArtifactInput[]): Required<Pick<ApprovedArtifactInput, "artifactId" | "version" | "digest">> | undefined {
  const candidates = artifacts
    .filter((artifact): artifact is ApprovedArtifactInput & Required<Pick<ApprovedArtifactInput, "artifactId" | "version" | "digest">> =>
      (artifact.nodeKey === "ppt_draft" || artifact.kind === "ppt_draft") &&
      typeof artifact.artifactId === "string" && Boolean(artifact.artifactId.trim()) &&
      Number.isInteger(artifact.version) && (artifact.version ?? 0) > 0 &&
      typeof artifact.digest === "string" && /^[a-f0-9]{64}$/.test(artifact.digest))
    .sort((left, right) => right.version - left.version || left.artifactId.localeCompare(right.artifactId));
  if (!candidates.length) return undefined;
  if (candidates.length > 1 && candidates[0].version === candidates[1].version) return undefined;
  return candidates[0];
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, "").toLocaleLowerCase("zh-CN");
}

function hasMatchingSemanticScope(actual: string, expected: string): boolean {
  const normalizedActual = normalizeText(actual);
  const normalizedExpected = normalizeText(expected);
  return Boolean(normalizedActual && normalizedExpected) && (
    normalizedActual === normalizedExpected ||
    normalizedActual.includes(normalizedExpected) ||
    normalizedExpected.includes(normalizedActual)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeCapabilityRunResult(result: CapabilityRunResult): CapabilityRunResult {
  if (result.status === "failed") {
    return {
      status: "failed",
      userMessage: result.userMessage.trim() || "这一步暂时没有完成，可以稍后重试。",
      retryable: result.retryable,
      errorCategory: result.errorCategory,
      ...(result.reasonCode ? { reasonCode: result.reasonCode } : {}),
      ...(result.reasonDetails?.length ? { reasonDetails: [...result.reasonDetails] } : {}),
      ...(result.runtimeRun ? { runtimeRun: result.runtimeRun } : {}),
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
