import { createToolObservation } from "@/server/capabilities/tool-observation";
import { prisma } from "@/server/db/client";
import { assertExecutionIdentityCanWriteProject } from "@/server/execution/execution-identity";
import { hashArtifactDraft } from "@/server/contracts/contract-validator";

import { getAgentToolDefinition, getAgentToolDefinitionByTransportName } from "./agent-tool-registry";
import type {
  AgentToolDefinition,
  AgentToolExecutionResult,
  AgentToolExecutor,
} from "./agent-tool-types";
import {
  hasValidAgentToolInvocationEnvelope,
  type AgentToolInvocationEnvelope,
} from "./agent-tool-invocation";
import { validateJsonSchemaValue } from "./json-schema-value-validator";
import { enforceVideoCourseAnchorGate, type VideoCourseAnchorCandidate } from "./video-course-anchor-gate";

export type AgentToolRouterFailedResult = {
  status: "failed";
  toolId: string;
  invocationId: string;
  errorCategory:
    | "invocation_integrity_failed"
    | "agent_tool_not_allowed"
    | "agent_tool_unauthorized"
    | "agent_tool_unavailable"
    | "agent_tool_arguments_invalid"
    | "agent_tool_output_invalid"
    | "agent_tool_output_blocked"
    | "agent_tool_execution_failed";
  observation: ReturnType<typeof createToolObservation>;
  artifactCreated: false;
};

export type AgentToolRouterResult = AgentToolExecutionResult | AgentToolRouterFailedResult;

export type AgentToolRouterDependencies = {
  authorize?: (
    envelope: AgentToolInvocationEnvelope,
    tool: AgentToolDefinition,
  ) => Promise<boolean>;
  executor?: AgentToolExecutor<AgentToolInvocationEnvelope>;
};

export async function routeAgentToolCall(
  envelope: AgentToolInvocationEnvelope,
  dependencies: AgentToolRouterDependencies = {},
): Promise<AgentToolRouterResult> {
  let tool: AgentToolDefinition;
  try {
    tool = getAgentToolDefinition(envelope.toolId);
  } catch {
    try {
      tool = getAgentToolDefinitionByTransportName(envelope.toolId);
    } catch {
      return failed(envelope, "agent_tool_not_allowed", "Agent Tool is not registered for model use.", false);
    }
  }

  if (!hasValidAgentToolInvocationEnvelope(envelope)) {
    return failed(envelope, "invocation_integrity_failed", "Agent Tool invocation integrity check failed.", false);
  }

  const inputValidation = validateJsonSchemaValue(envelope.arguments, tool.inputSchema);
  if (!inputValidation.valid) {
    return failed(envelope, "agent_tool_arguments_invalid", `Agent Tool arguments failed contract validation: ${inputValidation.issues.join(",")}`, false);
  }

  const authorize = dependencies.authorize ?? defaultAuthorize;
  let authorized = false;
  try {
    authorized = await authorize(envelope, tool);
  } catch {
    authorized = false;
  }
  if (!authorized) {
    return failed(envelope, "agent_tool_unauthorized", "Agent Tool invocation is not authorized for this project.", false);
  }

  if (!dependencies.executor) {
    return failed(envelope, "agent_tool_unavailable", "Agent Tool executor is unavailable.", true);
  }

  try {
    const result = await dependencies.executor(envelope, tool);
    if (
      result.toolId !== tool.id ||
      result.invocationId !== envelope.invocationId ||
      result.artifactCreated !== false ||
      "artifactDraft" in result ||
      "provider" in result
    ) {
      return failed(envelope, "agent_tool_execution_failed", "Agent Tool executor returned an invalid result.", false);
    }
    if (result.status !== "succeeded") return result;
    const outputValidation = validateJsonSchemaValue(result.structuredOutput, tool.outputSchema);
    if (!outputValidation.valid) {
      return failed(envelope, "agent_tool_output_invalid", `Agent Tool output failed contract validation: ${outputValidation.issues.join(",")}`, false);
    }
    if (tool.id === "video_director.plan_or_repair") {
      const gate = enforceVideoCourseAnchorGate(result.structuredOutput as unknown as VideoCourseAnchorCandidate);
      if (!gate.allowed) {
        return failed(envelope, "agent_tool_output_blocked", `Video course anchor gate blocked output: ${gate.reasonCodes.join(",")}`, false);
      }
      return { ...result, structuredOutput: gate };
    }
    return result;
  } catch {
    return failed(envelope, "agent_tool_execution_failed", "Agent Tool execution failed.", true);
  }
}

async function defaultAuthorize(envelope: AgentToolInvocationEnvelope): Promise<boolean> {
  try {
    await assertExecutionIdentityCanWriteProject(prisma, envelope.identity, envelope.projectId);
    const project = await prisma.project.findUnique({ where: { id: envelope.projectId }, select: { intentEpoch: true } });
    if (project?.intentEpoch !== envelope.intentEpoch) return false;
    if (envelope.approvedArtifactRefs.length === 0) return true;
    const artifacts = await prisma.artifact.findMany({
      where: {
        projectId: envelope.projectId,
        id: { in: envelope.approvedArtifactRefs.map((ref) => ref.artifactId) },
        status: "approved",
        isApproved: true,
      },
    });
    if (artifacts.length !== envelope.approvedArtifactRefs.length) return false;
    return envelope.approvedArtifactRefs.every((ref) => {
      const artifact = artifacts.find((candidate) => candidate.id === ref.artifactId);
      if (!artifact || artifact.kind !== ref.kind || artifact.version !== ref.version) return false;
      return hashArtifactDraft({
        nodeKey: artifact.nodeKey,
        kind: artifact.kind,
        title: artifact.title,
        summary: artifact.summary,
        markdownContent: artifact.markdownContent,
        structuredContent: parseStructuredContent(artifact.structuredContentJson),
      }) === ref.digest;
    });
  } catch {
    return false;
  }
}

function parseStructuredContent(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function failed(
  envelope: Pick<AgentToolInvocationEnvelope, "invocationId" | "projectId" | "sourceMessageId" | "toolId">,
  errorCategory: AgentToolRouterFailedResult["errorCategory"],
  internalReasonSanitized: string,
  retryable: boolean,
): AgentToolRouterFailedResult {
  return {
    status: "failed",
    toolId: envelope.toolId,
    invocationId: envelope.invocationId,
    errorCategory,
    observation: createToolObservation({
      projectId: envelope.projectId,
      sourceMessageId: envelope.sourceMessageId,
      capabilityId: envelope.toolId,
      kind: "blocked_by_policy",
      teacherSafeSummary: retryable
        ? "这项专业审查暂时不可用，请稍后重试。"
        : "这项专业审查当前不能执行，请重新确认任务。",
      internalReasonSanitized,
      retryPolicy: {
        retryable,
        nextAction: retryable ? "retry_later" : "ask_teacher",
      },
    }),
    artifactCreated: false,
  };
}
