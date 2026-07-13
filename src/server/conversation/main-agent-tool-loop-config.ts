import { randomUUID } from "node:crypto";

import { appendAgentObservationMetadata, createAgentObservation, type AgentObservation } from "@/server/conversation/react-control";
import { hashArtifactDraft } from "@/server/contracts/contract-validator";
import { appendAgentToolReportMetadata, createPersistedAgentToolReport } from "@/server/tools/agent-tool-report";
import type { AgentToolArtifactRef, AgentToolInvocationEnvelope } from "@/server/tools/agent-tool-invocation";
import { listAgentToolDefinitions } from "@/server/tools/agent-tool-registry";
import type { AgentToolRouterResult } from "@/server/tools/agent-tool-router";
import type { AgentToolPolicyOutcome } from "@/server/tools/agent-tool-types";
import type { AgentToolExecutor } from "@/server/tools/agent-tool-types";
import { dispatchMainAgentToolCall } from "@/server/tools/main-agent-tool-dispatcher";
import { toolDefinitionToOpenAiFunctionTool } from "@/server/tools/openai-tool-schema";
import type { createWorkbenchService } from "@/server/workbench/service";
import type { ArtifactRecord, ConversationMessageRecord, ExecutionIdentitySnapshot, ProjectExecutionFence, ProjectRecord } from "@/server/workbench/types";
import type { MainConversationAgentInput } from "./main-conversation-agent";

type WorkbenchService = ReturnType<typeof createWorkbenchService>;

export type CreateMainAgentToolLoopOptionsInput = {
  service: WorkbenchService;
  project: ProjectRecord;
  triggerMessage: ConversationMessageRecord;
  artifacts: ArtifactRecord[];
  identity?: ExecutionIdentitySnapshot;
  fence?: ProjectExecutionFence;
  executor?: AgentToolExecutor<AgentToolInvocationEnvelope>;
};

export function createMainAgentToolLoopOptions(
  input: CreateMainAgentToolLoopOptionsInput,
): MainConversationAgentInput["agentToolLoop"] | undefined {
  if (!input.identity || !input.fence || !input.executor) return undefined;
  const definitions = listAgentToolDefinitions().filter((tool) => tool.mainAgentExecutable && tool.executorReady);
  if (definitions.length === 0) return undefined;
  let currentMetadata = structuredClone(input.triggerMessage.metadata);

  return {
    tools: definitions.map(toolDefinitionToOpenAiFunctionTool),
    allowedToolNames: definitions.map((tool) => tool.transportName),
    maxToolRounds: 3,
    dispatch: async (call) => {
      const currentProject = await input.service.getProject(input.project.id);
      if ((currentProject.intentEpoch ?? 0) !== (input.project.intentEpoch ?? 0)) {
        return {
          status: "inconclusive",
          modelOutput: { reason: "intent_changed", nextAction: "ask_teacher" },
        };
      }
      await input.service.renewProjectExecutionLease({ ...input.fence!, leaseMs: 10 * 60 * 1000 });
      const reviewTargetRef = resolveReviewTarget(call.arguments, input.artifacts);
      const dispatch = await dispatchMainAgentToolCall({
        invocationId: randomUUID(),
        toolName: call.toolName,
        arguments: call.arguments,
        serverContext: {
          identity: input.identity!,
          projectId: input.project.id,
          intentEpoch: input.project.intentEpoch ?? 0,
          sourceMessageId: input.triggerMessage.id,
          approvedArtifactRefs: input.artifacts.filter(isApprovedArtifact).map(toArtifactRef),
          reviewTargetRef,
        },
      }, { agentToolExecutor: input.executor });

      if (dispatch.kind === "blocked") {
        return {
          status: "blocked",
          modelOutput: { reason: dispatch.result.observation.kind, nextAction: "replan" },
          observationId: dispatch.result.observation.observationId,
        };
      }
      if (dispatch.kind === "business_tool") {
        return {
          status: "blocked",
          modelOutput: { reason: "business_tool_requires_outer_guard", nextAction: "ask_teacher" },
        };
      }

      const latestProject = await input.service.getProject(input.project.id);
      if ((latestProject.intentEpoch ?? 0) !== (input.project.intentEpoch ?? 0)) {
        return {
          status: "inconclusive",
          modelOutput: { reason: "stale_result", nextAction: "ask_teacher" },
        };
      }
      await input.service.renewProjectExecutionLease({ ...input.fence!, leaseMs: 10 * 60 * 1000 });

      const report = createPersistedAgentToolReport(dispatch.envelope, dispatch.result);
      const observation = observationFromReport(dispatch.envelope, dispatch.result, report);
      currentMetadata = appendAgentObservationMetadata(
        appendAgentToolReportMetadata(currentMetadata, report),
        observation,
      );
      await input.service.updateMessageMetadata(input.project.id, input.triggerMessage.id, currentMetadata);
      return {
        status: observationStatusForModel(observation),
        modelOutput: modelOutputFromDispatch(dispatch.result),
        observationId: observation.observationId,
      };
    },
  };
}

function observationFromReport(
  envelope: AgentToolInvocationEnvelope,
  result: AgentToolRouterResult,
  report: ReturnType<typeof createPersistedAgentToolReport>,
): AgentObservation {
  const successful = result.status === "succeeded";
  const policy = successful && "policyOutcome" in result ? result.policyOutcome : undefined;
  const structured = successful ? result.structuredOutput : null;
  const status = resolveObservationStatus(result, policy, structured);
  const targetLocators = successful && Array.isArray(structured?.targetLocators)
    ? structured.targetLocators.filter(isTargetLocator)
    : [];
  const responsibleStage = successful && typeof structured?.responsibleStage === "string"
    ? structured.responsibleStage
    : envelope.arguments.stage as string | undefined;
  return createAgentObservation({
    projectId: envelope.projectId,
    source: envelope.toolId === "delivery_critic.review" ? "quality" : "tool",
    status,
    actionKey: envelope.toolId,
    inputHash: envelope.inputHash,
    reasonCodes: policy?.reasonCodes?.length
      ? policy.reasonCodes
      : successful ? [`agent_tool_${status}`] : [result.errorCategory ?? result.observation.kind],
    reportRefs: envelope.toolId === "delivery_critic.review"
      ? [{ kind: "critic", id: report.reportId, digest: report.reportDigest }]
      : [],
    targetLocators,
    responsibleStage,
    minimalNextAction: status === "succeeded"
      ? "continue"
      : status === "repair" ? (targetLocators.length ? "repair_unit" : "repair_upstream")
        : status === "needs_input" || status === "blocked" ? "ask_teacher" : "repair_upstream",
    teacherSafeSummary: report.assistantSummary,
  });
}

function resolveObservationStatus(
  result: AgentToolRouterResult,
  policy: AgentToolPolicyOutcome | undefined,
  structured: Record<string, unknown> | null,
): AgentObservation["status"] {
  if (result.status !== "succeeded") {
    if (result.status === "needs_input") return "needs_input";
    if (result.status === "inconclusive") return "inconclusive";
    return "failed";
  }
  if (policy) {
    if (policy.passed) return "succeeded";
    if (policy.reviewOutcome === "blocked") return "blocked";
    if (policy.reviewOutcome === "inconclusive") return "inconclusive";
    return "repair";
  }
  if (structured?.decision === "repair") return "repair";
  if (structured?.decision === "blocked") return "blocked";
  if (structured?.decision === "needs_input") return "needs_input";
  return "succeeded";
}

function modelOutputFromDispatch(result: AgentToolRouterResult): Record<string, unknown> {
  if (result.status !== "succeeded") {
    return {
      summary: result.observation.teacherSafeSummary,
      reason: result.errorCategory ?? result.observation.kind,
      retryPolicy: result.observation.retryPolicy,
    };
  }
  const policy = "policyOutcome" in result && result.policyOutcome
    ? {
        passed: result.policyOutcome.passed,
        eligibleForDownstreamGuard: result.policyOutcome.eligibleForDownstreamGuard,
        reviewOutcome: result.policyOutcome.reviewOutcome,
        reasonCodes: result.policyOutcome.reasonCodes,
        forbiddenNextToolIntents: result.policyOutcome.forbiddenNextToolIntents,
      }
    : null;
  return {
    assistantSummary: result.assistantSummary,
    structuredOutput: result.structuredOutput,
    policyOutcome: policy,
  };
}

function resolveReviewTarget(argumentsValue: Record<string, unknown>, artifacts: ArtifactRecord[]): AgentToolArtifactRef | null {
  const direct = isRecord(argumentsValue.courseAnchorRef) && typeof argumentsValue.courseAnchorRef.artifactId === "string"
    ? argumentsValue.courseAnchorRef.artifactId
    : null;
  const locator = Array.isArray(argumentsValue.targetLocators)
    ? argumentsValue.targetLocators.find((item) => isRecord(item) && item.kind === "artifact" && typeof item.artifactId === "string")
    : null;
  const artifactId = direct ?? (isRecord(locator) ? locator.artifactId as string : null);
  const artifact = artifactId ? artifacts.find((item) => item.id === artifactId) : undefined;
  return artifact ? toArtifactRef(artifact) : null;
}

function toArtifactRef(artifact: ArtifactRecord): AgentToolArtifactRef {
  return {
    artifactId: artifact.id,
    kind: artifact.kind,
    version: artifact.version,
    digest: hashArtifactDraft({
      nodeKey: artifact.nodeKey,
      kind: artifact.kind,
      title: artifact.title,
      summary: artifact.summary,
      markdownContent: artifact.markdownContent,
      structuredContent: artifact.structuredContent,
    }),
  };
}

function isApprovedArtifact(artifact: ArtifactRecord) {
  return artifact.status === "approved" && artifact.isApproved;
}

function observationStatusForModel(observation: AgentObservation): "succeeded" | "failed" | "blocked" | "inconclusive" {
  if (observation.status === "succeeded") return "succeeded";
  if (observation.status === "blocked" || observation.status === "needs_input") return "blocked";
  if (observation.status === "inconclusive") return "inconclusive";
  return "failed";
}

function isTargetLocator(value: unknown): value is AgentObservation["targetLocators"][number] {
  return isRecord(value) && typeof value.kind === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
