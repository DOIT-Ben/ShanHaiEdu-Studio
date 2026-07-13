import { createToolObservation } from "@/server/capabilities/tool-observation";
import type { ExecutionIdentitySnapshot } from "@/server/workbench/types";

import { createAgentToolInvocationEnvelope, type AgentToolArtifactRef, type AgentToolInvocationEnvelope } from "./agent-tool-invocation";
import { routeAgentToolCall, type AgentToolAuthorizationDatabase, type AgentToolRouterResult } from "./agent-tool-router";
import type { AgentToolDefinition, AgentToolExecutor } from "./agent-tool-types";
import { resolveMainAgentToolDefinition } from "./main-agent-tool-registry";
import { routeToolCall, type ToolRouterInput } from "./tool-router";
import type { ToolExecutionResult } from "./tool-types";

export type MainAgentToolServerContext = {
  identity: ExecutionIdentitySnapshot;
  projectId: string;
  intentEpoch: number;
  sourceMessageId: string;
  approvedArtifactRefs: AgentToolArtifactRef[];
  reviewTargetRef?: AgentToolArtifactRef | null;
};

export type MainAgentToolDispatchRequest = {
  invocationId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  serverContext: MainAgentToolServerContext;
};

export type MainAgentToolDispatchResult =
  | {
      kind: "agent_tool";
      envelope: AgentToolInvocationEnvelope;
      result: AgentToolRouterResult;
    }
  | {
      kind: "business_tool";
      result: ToolExecutionResult;
    }
  | {
      kind: "blocked";
      result: {
        status: "failed";
        observation: ReturnType<typeof createToolObservation>;
      };
    };

export type MainAgentToolDispatcherDependencies = {
  agentToolExecutor?: AgentToolExecutor<AgentToolInvocationEnvelope>;
  agentToolAuthorizationDb?: AgentToolAuthorizationDatabase;
  authorizeAgentTool?: (envelope: AgentToolInvocationEnvelope, tool: AgentToolDefinition) => Promise<boolean>;
  businessToolRouter?: typeof routeToolCall;
  buildBusinessToolInput?: (request: MainAgentToolDispatchRequest, internalToolId: string) => ToolRouterInput;
  allowBusinessExecution?: boolean;
};

export async function dispatchMainAgentToolCall(
  request: MainAgentToolDispatchRequest,
  dependencies: MainAgentToolDispatcherDependencies,
): Promise<MainAgentToolDispatchResult> {
  let definition;
  try {
    definition = resolveMainAgentToolDefinition(request.toolName);
  } catch {
    return blocked(request, "unknown_or_hidden_tool");
  }

  if (!definition.modelVisible || !definition.mainAgentExecutable) {
    return blocked(request, "tool_not_executable");
  }

  if (definition.adapterKind === "agent") {
    if (!dependencies.agentToolExecutor) return blocked(request, "agent_tool_executor_unavailable");
    const envelope = createAgentToolInvocationEnvelope({
      invocationId: request.invocationId,
      toolId: definition.id,
      identity: request.serverContext.identity,
      projectId: request.serverContext.projectId,
      intentEpoch: request.serverContext.intentEpoch,
      sourceMessageId: request.serverContext.sourceMessageId,
      reviewTargetRef: request.serverContext.reviewTargetRef ?? null,
      approvedArtifactRefs: request.serverContext.approvedArtifactRefs,
      arguments: structuredClone(request.arguments),
    });
    const result = await routeAgentToolCall(envelope, {
      executor: dependencies.agentToolExecutor,
      authorizationDb: dependencies.agentToolAuthorizationDb,
      authorize: dependencies.authorizeAgentTool,
    });
    return { kind: "agent_tool", envelope, result };
  }

  if (!dependencies.allowBusinessExecution || !dependencies.buildBusinessToolInput) {
    return blocked(request, "business_tool_requires_outer_guard");
  }
  const result = await (dependencies.businessToolRouter ?? routeToolCall)(
    dependencies.buildBusinessToolInput(request, definition.internalToolId),
  );
  return { kind: "business_tool", result };
}

function blocked(request: MainAgentToolDispatchRequest, reason: string): MainAgentToolDispatchResult {
  return {
    kind: "blocked",
    result: {
      status: "failed",
      observation: createToolObservation({
        projectId: request.serverContext.projectId,
        sourceMessageId: request.serverContext.sourceMessageId,
        capabilityId: request.toolName,
        kind: "blocked_by_policy",
        teacherSafeSummary: "这一步当前不能直接执行，我会重新判断下一步。",
        internalReasonSanitized: reason,
        retryPolicy: { retryable: false, nextAction: "skip_or_replan" },
      }),
    },
  };
}
