import { estimateContextTokens, resolveContextBudgetMode } from "@/server/conversation/context-budget";
import type { CapabilityAvailabilityEntry } from "@/server/capabilities/capability-availability";
import type { AgentWorldState } from "@/server/conversation/agent-world-state";
import type { ContextPackage } from "@/server/conversation/context-package";
import { compactSessionWithValidation } from "@/server/conversation/session-compactor";
import type { ArtifactRecord, ConversationMessageRecord, ProjectRecord, WorkflowNodeRecord } from "@/server/workbench/types";
import type { SemanticContextSnapshot } from "@/server/conversation/context-semantic-snapshot";
import type { TaskBrief } from "@/server/conversation/task-contract";
import { isArtifactBoundToTask } from "@/server/quality/artifact-truth-boundary";

const CONTEXT_GUARDRAILS = [
  "不得把未完成产物描述为已完成或可下载。",
  "只有教师已批准，或已通过内部验证与审查并标记为下游可用的 artifact，才可作为下游可信输入；教师签收保持独立。",
  "不得向教师暴露 provider、schema、storage、local path、debug 等工程细节。",
];

export function buildConversationContextPackage(input: {
  project: ProjectRecord;
  messages: ConversationMessageRecord[];
  workflowNodes: WorkflowNodeRecord[];
  artifacts: ArtifactRecord[];
  taskBrief?: TaskBrief | null;
  maxInputTokens?: number;
}): ContextPackage {
  const scopedArtifacts = input.taskBrief
    ? input.artifacts.filter((artifact) => isArtifactBoundToTask(artifact, input.taskBrief!))
    : input.artifacts;
  const recentMessages = input.messages.slice(-8);
  const compacted = compactSessionWithValidation({
    teacherGoal: input.project.title,
    recentMessages: input.messages.map((message) => ({ role: message.role, content: message.content })),
    artifacts: scopedArtifacts.map((artifact) => ({
      id: artifact.id,
      title: artifact.title,
      kind: artifact.kind,
      status: artifact.status,
      isApproved: artifact.isApproved,
    })),
    guardrails: CONTEXT_GUARDRAILS,
  });
  const tokenEstimate = estimateContextTokens({
    systemRules: CONTEXT_GUARDRAILS.join("\n"),
    snapshot: compacted.summary,
    messages: recentMessages.map((message) => `${message.role}: ${message.content}`),
    artifacts: scopedArtifacts.map((artifact) => `${artifact.nodeKey}:${artifact.status}:${artifact.summary}`),
  });
  const budgetMode = resolveContextBudgetMode({ estimate: tokenEstimate, maxInputTokens: input.maxInputTokens ?? 12_000 });
  const packageMode = compacted.validation.status === "failed" ? "fallback" : budgetMode === "compact_required" ? "snapshot" : "full";

  return {
    mode: packageMode,
    project: {
      id: input.project.id,
      title: input.project.title,
      grade: input.project.grade,
      subject: input.project.subject,
      textbookVersion: input.project.textbookVersion,
      lessonTopic: input.project.lessonTopic,
      currentNodeKey: input.project.currentNodeKey,
    },
    workflowNodes: input.workflowNodes.map((node) => ({
      key: node.key,
      title: node.title,
      status: node.status,
      approvedArtifactId: node.approvedArtifactId,
      staleReason: sanitizeTeacherMessage(node.staleReason) || null,
    })),
    sessionSummary: packageMode === "snapshot" ? compacted.summary : undefined,
    recentMessages: recentMessages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      artifactRefs: message.artifactRefs,
      createdAt: message.createdAt,
    })),
    artifacts: scopedArtifacts.map((artifact) => ({
      id: artifact.id,
      nodeKey: artifact.nodeKey,
      kind: artifact.kind,
      title: artifact.title,
      status: artifact.status,
      summary: artifact.summary,
      isApproved: artifact.isApproved,
      version: artifact.version,
    })),
    guardrails: CONTEXT_GUARDRAILS,
    summaryValidation: compacted.validation,
    tokenEstimate,
  };
}

function sanitizeTeacherMessage(message: string | null): string {
  if (!message) return "";
  const containsSensitiveDetail = /\b(provider|schema|storage|debug|token|manifest|node_id|api|key|secret|credential)\b|[A-Z0-9_]*(?:API_KEY|API_TOKEN|TOKEN|SECRET|KEY|CREDENTIAL)[A-Z0-9_]*|local\s+path|[A-Za-z]:[\\/]|\/(Users|home|tmp|var|private|mnt)\//i.test(message);
  if (containsSensitiveDetail) return "处理过程遇到问题，请稍后重试或调整后再继续。";
  return message.trim();
}

export function contextPackageToMainAgentConversationContext(
  contextPackage: ContextPackage,
  agentWorldState: AgentWorldState | undefined,
  capabilityAvailability: CapabilityAvailabilityEntry[] | undefined,
  pendingPlan: {
    teacherRequest: string;
    toolPlan: import("@/server/capabilities/types").CapabilityToolPlan;
    deliveryPlan?: import("@/server/capabilities/types").DeliveryPlan;
  } | null,
  semanticSnapshot?: SemanticContextSnapshot,
) {
  return {
    contextPackage,
    agentWorldState,
    capabilityAvailability,
    semanticSnapshot,
    recentMessages: contextPackage.recentMessages.map((message) => ({ role: message.role, content: message.content })),
    latestAssistantContent: [...contextPackage.recentMessages].reverse().find((message) => message.role === "assistant")?.content,
    pendingDeliveryPlan: pendingPlan
      ? {
          teacherRequest: pendingPlan.teacherRequest,
          toolPlan: pendingPlan.toolPlan,
          deliveryPlan: pendingPlan.deliveryPlan,
        }
      : undefined,
  };
}
