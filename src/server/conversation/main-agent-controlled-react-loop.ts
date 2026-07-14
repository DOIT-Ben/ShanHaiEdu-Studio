import { hashRunInput } from "@/server/execution/run-input-snapshot";
import type { GptFunctionCall, GptProtocolRequest, GptProtocolResponse } from "@/server/gpt-protocol/types";
import {
  buildMainAgentReActContinuationItems,
  checkpointCharacters,
  createMainAgentReActCheckpoint,
  measureMainAgentReActRequest,
  type MainAgentReActCheckpoint,
  type MainAgentReActCheckpointSeed,
  type MainAgentReActContinuationObservation,
  type MainAgentReActRoundRecord,
} from "./main-agent-react-checkpoint";

export type MainAgentReActAdapter = {
  createResponse(request: GptProtocolRequest): Promise<GptProtocolResponse>;
};

export type MainAgentReActDispatchResult = {
  status: "succeeded" | "failed" | "blocked" | "inconclusive";
  observation: MainAgentReActContinuationObservation;
};

export type MainAgentReActToolSet = {
  tools: unknown[];
  allowedToolNames: readonly string[];
};

export type MainAgentReActLoopOptions = {
  adapter: MainAgentReActAdapter;
  request: GptProtocolRequest;
  tools: unknown[];
  allowedToolNames: readonly string[];
  refreshTools?: () => MainAgentReActToolSet | Promise<MainAgentReActToolSet>;
  dispatch: (call: { callId: string; toolName: string; arguments: Record<string, unknown> }) => Promise<MainAgentReActDispatchResult>;
  maxToolRounds?: number;
  checkpointSeed?: MainAgentReActCheckpointSeed;
  getCheckpointSeed?: () => MainAgentReActCheckpointSeed;
  maxCheckpointTokens?: number;
  onContextTelemetry?: (event: MainAgentReActContextTelemetry) => void | Promise<void>;
  onRejectedToolCall?: (event: MainAgentReActRejectedToolCall) => void | Promise<void>;
  onBudgetExhausted?: (event: MainAgentReActBudgetExhausted) => void | Promise<void>;
};

export type MainAgentReActRejectedToolCall = {
  toolName: string;
  toolRound: number;
  reason: "repeated_tool_call";
};

export type MainAgentReActBudgetExhausted = {
  reason: "tool_round_limit_reached";
  toolRoundsUsed: number;
  maxToolRounds: number;
  pendingToolName: string | null;
  observationIds: string[];
};

export type MainAgentReActContextTelemetry = {
  phase: "initial" | "continuation";
  toolRound: number;
  requestCharacters: number;
  estimatedInputTokens: number;
  checkpointCharacters: number;
  checkpointObservationCount: number;
  toolCount: number;
  responseDurationMs: number;
};

export type MainAgentReActLoopResult = {
  status: "completed" | "failed" | "blocked";
  assistantText: string;
  toolRoundsUsed: number;
  observationIds: string[];
  reason: "none" | "adapter_failed" | "multiple_tool_calls_blocked" | "tool_call_invalid" | "tool_round_limit_reached" | "repeated_tool_call" | "repeated_tool_failure";
  diagnosticMessage?: string;
};

const safeFailureText = "当前编排已暂停，请调整要求后继续。";

export async function runMainAgentControlledReActLoop(
  options: MainAgentReActLoopOptions,
): Promise<MainAgentReActLoopResult> {
  const maxToolRounds = Math.max(0, options.maxToolRounds ?? 3);
  const callAttempts = new Map<string, { attempts: number; lastStatus: MainAgentReActDispatchResult["status"] }>();
  const failureCounts = new Map<string, number>();
  const observationIds: string[] = [];
  let toolRoundsUsed = 0;
  let currentToolSet: MainAgentReActToolSet = {
    tools: options.tools,
    allowedToolNames: options.allowedToolNames,
  };
  const roundRecords: MainAgentReActRoundRecord[] = [];
  let currentResponse = await createResponseWithTelemetry({
    options,
    request: modelRequest(options.request, currentToolSet.tools),
    phase: "initial",
    toolRound: 0,
    toolCount: currentToolSet.allowedToolNames.length,
  });

  while (true) {
    if (currentResponse.diagnostics.status === "failed") {
      return failed("adapter_failed", toolRoundsUsed, observationIds, currentResponse.diagnostics.errorMessage);
    }
    if (currentResponse.functionCalls.length === 0) {
      return {
        status: "completed",
        assistantText: currentResponse.assistantText,
        toolRoundsUsed,
        observationIds,
        reason: "none",
      };
    }
    if (toolRoundsUsed >= maxToolRounds) {
      await options.onBudgetExhausted?.({
        reason: "tool_round_limit_reached",
        toolRoundsUsed,
        maxToolRounds,
        pendingToolName: currentResponse.functionCalls.length === 1 ? currentResponse.functionCalls[0].name : null,
        observationIds: [...observationIds],
      });
      return failed("tool_round_limit_reached", toolRoundsUsed, observationIds);
    }
    if (currentResponse.functionCalls.length !== 1) return blocked("multiple_tool_calls_blocked", toolRoundsUsed, observationIds);

    const call = currentResponse.functionCalls[0];
    const parsed = parseAllowedCall(call, currentToolSet.allowedToolNames);
    if (!parsed) return blocked("tool_call_invalid", toolRoundsUsed, observationIds);
    const signature = hashRunInput({ toolName: parsed.toolName, arguments: parsed.arguments });
    const previousAttempt = callAttempts.get(signature);
    if (previousAttempt && (previousAttempt.lastStatus === "succeeded" || previousAttempt.attempts >= 2)) {
      await notifyRejectedToolCall(options, parsed.toolName, toolRoundsUsed + 1);
      return blocked("repeated_tool_call", toolRoundsUsed, observationIds);
    }

    const dispatchResult = await options.dispatch(parsed);
    callAttempts.set(signature, {
      attempts: (previousAttempt?.attempts ?? 0) + 1,
      lastStatus: dispatchResult.status,
    });
    if (dispatchResult.observation.observationId) observationIds.push(dispatchResult.observation.observationId);
    toolRoundsUsed += 1;
    if (dispatchResult.status !== "succeeded") {
      const failureSignature = hashRunInput({
        toolName: parsed.toolName,
        status: dispatchResult.status,
        reasonCodes: dispatchResult.observation.reasonCodes,
      });
      const failureCount = (failureCounts.get(failureSignature) ?? 0) + 1;
      failureCounts.set(failureSignature, failureCount);
      if (failureCount >= 2) return blocked("repeated_tool_failure", toolRoundsUsed, observationIds);
    }
    roundRecords.push({
      round: toolRoundsUsed,
      toolName: parsed.toolName,
      callDigest: signature,
      observation: dispatchResult.observation,
    });
    if (options.refreshTools) currentToolSet = await options.refreshTools();
    const checkpoint = createMainAgentReActCheckpoint({
      request: options.request,
      seed: options.getCheckpointSeed?.() ?? options.checkpointSeed,
      records: roundRecords,
      currentToolNames: currentToolSet.allowedToolNames,
      maxEstimatedTokens: options.maxCheckpointTokens,
    });
    const continuationRequest = modelRequest(
      options.request,
      currentToolSet.tools,
      buildMainAgentReActContinuationItems({ request: options.request, checkpoint, latestCall: call }),
    );
    currentResponse = await createResponseWithTelemetry({
      options,
      request: continuationRequest,
      phase: "continuation",
      toolRound: toolRoundsUsed,
      toolCount: currentToolSet.allowedToolNames.length,
      checkpoint,
    });
  }
}

async function notifyRejectedToolCall(
  options: MainAgentReActLoopOptions,
  toolName: string,
  toolRound: number,
) {
  try {
    await options.onRejectedToolCall?.({ toolName, toolRound, reason: "repeated_tool_call" });
  } catch {
    // Audit telemetry must never change Main Agent control flow.
  }
}

function parseAllowedCall(call: GptFunctionCall, allowed: readonly string[]) {
  if (!allowed.includes(call.name) || call.argumentsJsonParseStatus !== "parsed" || !isRecord(call.argumentsJson)) return null;
  return { callId: call.callId, toolName: call.name, arguments: structuredClone(call.argumentsJson) };
}

function modelRequest(request: GptProtocolRequest, tools: unknown[], inputItems?: unknown[]): GptProtocolRequest {
  return {
    ...request,
    ...(inputItems ? { inputItems } : {}),
    tools,
    toolChoice: "auto",
    parallelToolCalls: false,
  };
}

async function createResponseWithTelemetry(input: {
  options: MainAgentReActLoopOptions;
  request: GptProtocolRequest;
  phase: MainAgentReActContextTelemetry["phase"];
  toolRound: number;
  toolCount: number;
  checkpoint?: MainAgentReActCheckpoint;
}) {
  const startedAt = performance.now();
  const response = await input.options.adapter.createResponse(input.request);
  const measurement = measureMainAgentReActRequest(input.request);
  const event: MainAgentReActContextTelemetry = {
    phase: input.phase,
    toolRound: input.toolRound,
    ...measurement,
    checkpointCharacters: checkpointCharacters(input.checkpoint),
    checkpointObservationCount: input.checkpoint?.completedRounds.length ?? 0,
    toolCount: input.toolCount,
    responseDurationMs: Math.max(0, Math.round(performance.now() - startedAt)),
  };
  try {
    await input.options.onContextTelemetry?.(event);
  } catch {
    // Telemetry must never change Main Agent control flow.
  }
  return response;
}

function failed(reason: MainAgentReActLoopResult["reason"], rounds: number, observationIds: string[], diagnosticMessage?: string): MainAgentReActLoopResult {
  return { status: "failed", assistantText: safeFailureText, toolRoundsUsed: rounds, observationIds, reason, ...(diagnosticMessage ? { diagnosticMessage } : {}) };
}

function blocked(reason: MainAgentReActLoopResult["reason"], rounds: number, observationIds: string[]): MainAgentReActLoopResult {
  return { status: "blocked", assistantText: safeFailureText, toolRoundsUsed: rounds, observationIds, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
