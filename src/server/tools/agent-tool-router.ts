import { createToolObservation, isToolObservation } from "@/server/capabilities/tool-observation";
import { prisma } from "@/server/db/client";

import { getAgentToolDefinition, getAgentToolDefinitionByTransportName } from "./agent-tool-registry";
import type {
  AgentToolDefinition,
  AgentToolExecutionFailedResult,
  AgentToolExecutionResult,
  AgentToolExecutor,
  AgentToolRoutedExecutionResult,
} from "./agent-tool-types";
import {
  hasValidAgentToolInvocationEnvelope,
  type AgentToolInvocationEnvelope,
} from "./agent-tool-invocation";
import { validateJsonSchemaValue } from "./json-schema-value-validator";
import {
  authorizationCheckUnavailable,
  authorizationDenied,
  defaultAuthorize,
  validateInvocationBindings,
  type AgentToolAuthorizationDatabase,
  type AgentToolAuthorizationDecision,
} from "./agent-tool-authorization";
import { applyAgentToolPolicyOutcome } from "./agent-tool-policy-result";
const SUCCEEDED_EXECUTOR_RESULT_KEYS = new Set([
  "status",
  "toolId",
  "invocationId",
  "structuredOutput",
  "assistantSummary",
  "artifactCreated",
]);
const NON_SUCCEEDED_EXECUTOR_RESULT_KEYS = new Set([
  "status",
  "toolId",
  "invocationId",
  "observation",
  "artifactCreated",
  "errorCategory",
]);

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

export type AgentToolRouterResult = AgentToolRoutedExecutionResult | AgentToolRouterFailedResult;

export type { AgentToolAuthorizationDatabase } from "./agent-tool-authorization";

export type AgentToolRouterDependencies = {
  authorize?: (
    envelope: AgentToolInvocationEnvelope,
    tool: AgentToolDefinition,
  ) => Promise<boolean>;
  authorizationDb?: AgentToolAuthorizationDatabase;
  executor?: AgentToolExecutor<AgentToolInvocationEnvelope>;
};

export type { AgentToolAuthorizationDecision } from "./agent-tool-authorization";

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

  const bindingIssues = validateInvocationBindings(envelope, tool);
  if (bindingIssues.length > 0) {
    return failed(
      envelope,
      "agent_tool_arguments_invalid",
      `Agent Tool invocation binding failed: ${bindingIssues.join(",")}`,
      false,
      { reasonCode: bindingIssues[0], reasonDetails: bindingIssues },
    );
  }

  let authorization: AgentToolAuthorizationDecision;
  if (dependencies.authorize) {
    try {
      authorization = await dependencies.authorize(envelope, tool)
        ? { authorized: true }
        : authorizationDenied("authorization_denied");
    } catch {
      authorization = authorizationCheckUnavailable();
    }
  } else {
    authorization = await defaultAuthorize(dependencies.authorizationDb ?? prisma, envelope);
  }
  if (!authorization.authorized) {
    return failed(
      envelope,
      authorization.errorCategory,
      `Agent Tool preflight rejected the invocation: ${authorization.reasonCode}.`,
      authorization.retryable,
      { reasonCode: authorization.reasonCode },
    );
  }

  if (!dependencies.executor) {
    return failed(envelope, "agent_tool_unavailable", "Agent Tool executor is unavailable.", true);
  }

  try {
    const rawResult = await dependencies.executor(envelope, tool);
    const result = rebuildAgentToolExecutorResult(rawResult, tool.id, envelope.invocationId);
    if (!result) {
      return failed(envelope, "agent_tool_execution_failed", "Agent Tool executor returned an invalid result.", false);
    }
    if (result.status !== "succeeded") return normalizeExecutorFailure(envelope, result);

    const outputValidation = validateJsonSchemaValue(result.structuredOutput, tool.outputSchema);
    if (!outputValidation.valid) {
      return failed(envelope, "agent_tool_output_invalid", `Agent Tool output failed contract validation: ${outputValidation.issues.join(",")}`, false);
    }

    return applyAgentToolPolicyOutcome({
      envelope,
      tool,
      result,
      invalidOutput: (internalReasonSanitized) => failed(
        envelope,
        "agent_tool_output_invalid",
        internalReasonSanitized,
        false,
      ),
    });
  } catch {
    return failed(envelope, "agent_tool_execution_failed", "Agent Tool execution failed.", true);
  }
}

function rebuildAgentToolExecutorResult(
  value: unknown,
  expectedToolId: AgentToolDefinition["id"],
  expectedInvocationId: string,
): AgentToolExecutionResult | null {
  if (!isRecord(value) ||
      value.toolId !== expectedToolId ||
      value.invocationId !== expectedInvocationId ||
      value.artifactCreated !== false) {
    return null;
  }

  if (value.status === "succeeded") {
    if (!hasOnlyAllowedOwnKeys(value, SUCCEEDED_EXECUTOR_RESULT_KEYS) ||
        !isRecord(value.structuredOutput) ||
        typeof value.assistantSummary !== "string") {
      return null;
    }
    return {
      status: "succeeded",
      toolId: expectedToolId,
      invocationId: expectedInvocationId,
      structuredOutput: structuredClone(value.structuredOutput),
      assistantSummary: value.assistantSummary,
      artifactCreated: false,
    };
  }

  if (!isNonSucceededExecutorStatus(value.status) ||
      !hasOnlyAllowedOwnKeys(value, NON_SUCCEEDED_EXECUTOR_RESULT_KEYS) ||
      !isToolObservation(value.observation) ||
      (value.errorCategory !== undefined && typeof value.errorCategory !== "string")) {
    return null;
  }

  const result: AgentToolExecutionFailedResult = {
    status: value.status,
    toolId: expectedToolId,
    invocationId: expectedInvocationId,
    observation: structuredClone(value.observation),
    artifactCreated: false,
  };
  if (typeof value.errorCategory === "string") result.errorCategory = value.errorCategory;
  return result;
}

function normalizeExecutorFailure(
  envelope: AgentToolInvocationEnvelope,
  result: AgentToolExecutionFailedResult,
): AgentToolExecutionFailedResult {
  const retryable = result.observation.retryPolicy.retryable === true;
  const errorCategory = retryable ? "agent_tool_unavailable" : "agent_tool_execution_failed";
  const policy = failedObservationPolicy(errorCategory, retryable);

  return {
    status: result.status,
    toolId: result.toolId,
    invocationId: result.invocationId,
    errorCategory,
    observation: createToolObservation({
      projectId: envelope.projectId,
      sourceMessageId: envelope.sourceMessageId,
      capabilityId: envelope.toolId,
      errorCategory,
      reasonCode: result.observation.reasonCode ?? (retryable
        ? "agent_tool_executor_temporarily_unavailable"
        : "agent_tool_executor_result_inconclusive"),
      reasonDetails: result.observation.reasonDetails,
      kind: policy.kind,
      teacherSafeSummary: policy.teacherSafeSummary,
      internalReasonSanitized: result.observation.internalReasonSanitized,
      retryPolicy: { retryable, nextAction: policy.nextAction },
    }),
    artifactCreated: false,
  };
}

function hasOnlyAllowedOwnKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Reflect.ownKeys(value).every((key) => typeof key === "string" && allowed.has(key));
}

function isNonSucceededExecutorStatus(
  value: unknown,
): value is AgentToolExecutionFailedResult["status"] {
  return value === "needs_input" || value === "failed" || value === "inconclusive";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failed(
  envelope: Pick<AgentToolInvocationEnvelope, "invocationId" | "projectId" | "sourceMessageId" | "toolId">,
  errorCategory: AgentToolRouterFailedResult["errorCategory"],
  internalReasonSanitized: string,
  retryable: boolean,
  details: { reasonCode?: string; reasonDetails?: string[] } = {},
): AgentToolRouterFailedResult {
  const policy = failedObservationPolicy(errorCategory, retryable);
  return {
    status: "failed",
    toolId: envelope.toolId,
    invocationId: envelope.invocationId,
    errorCategory,
    observation: createToolObservation({
      projectId: envelope.projectId,
      sourceMessageId: envelope.sourceMessageId,
      capabilityId: envelope.toolId,
      errorCategory,
      reasonCode: details.reasonCode,
      reasonDetails: details.reasonDetails,
      kind: policy.kind,
      teacherSafeSummary: policy.teacherSafeSummary,
      internalReasonSanitized,
      retryPolicy: {
        retryable,
        nextAction: policy.nextAction,
      },
    }),
    artifactCreated: false,
  };
}

function failedObservationPolicy(
  errorCategory: AgentToolRouterFailedResult["errorCategory"],
  retryable: boolean,
) {
  if (retryable) {
    return {
      kind: "tool_failed" as const,
      nextAction: "retry_later" as const,
      teacherSafeSummary: "这项专业审查暂时不可用，当前进度已经保存。",
    };
  }
  if (errorCategory === "agent_tool_unauthorized") {
    return {
      kind: "blocked_by_policy" as const,
      nextAction: "ask_teacher" as const,
      teacherSafeSummary: "这项操作缺少当前任务所需的授权，尚未执行。",
    };
  }
  if (errorCategory === "agent_tool_arguments_invalid" || errorCategory === "agent_tool_output_invalid" ||
      errorCategory === "agent_tool_output_blocked" || errorCategory === "agent_tool_execution_failed") {
    return {
      kind: "quality_gate_failed" as const,
      nextAction: "fix_inputs" as const,
      teacherSafeSummary: "当前输入或审查结果没有通过校验，已返回重新调整。",
    };
  }
  return {
    kind: "tool_failed" as const,
    nextAction: "skip_or_replan" as const,
    teacherSafeSummary: "当前调用没有通过完整性校验，已返回重新规划。",
  };
}
