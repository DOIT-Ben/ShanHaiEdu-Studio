import { hashRunInput } from "@/server/execution/run-input-snapshot";
import type { GptFunctionCall, GptProtocolRequest, GptProtocolResponse } from "@/server/gpt-protocol/types";
import {
  buildMainAgentReActContinuationItems,
  checkpointCharacters,
  createMainAgentReActCheckpoint,
  measureMainAgentReActRequest,
  type MainAgentReActCheckpoint,
  type MainAgentReActRoundRecord,
} from "./main-agent-react-checkpoint";
import type {
  MainAgentReActContextTelemetry,
  MainAgentReActDispatchResult,
  MainAgentReActLoopOptions,
  MainAgentReActLoopResult,
  MainAgentReActToolSet,
  MainAgentReActRecoveryCheckpoint,
} from "./main-agent-react-loop-contract";

export type MainAgentReActLoopState = {
  maxToolRounds: number;
  maxToolRoundsPerSegment: number | null;
  resumeCheckpoint?: MainAgentReActCheckpoint;
  callAttempts: Map<string, { attempts: number; lastStatus: MainAgentReActDispatchResult["status"] }>;
  failureCounts: Map<string, number>;
  observationIds: string[];
  toolRoundsUsed: number;
  lastSegmentCheckpointRound: number;
  currentToolSet: MainAgentReActToolSet;
  roundRecords: MainAgentReActRoundRecord[];
  completionRepairAttempted: boolean;
  currentResponse: GptProtocolResponse;
};

export type MainAgentReActStep =
  | { kind: "return"; result: MainAgentReActLoopResult }
  | { kind: "continue"; response: GptProtocolResponse }
  | { kind: "tool" };

export async function persistRecoveryCheckpoint(input: {
  options: MainAgentReActLoopOptions;
  reason: MainAgentReActRecoveryCheckpoint["reason"];
  toolRoundsUsed: number;
  observationIds: string[];
  roundRecords: MainAgentReActRoundRecord[];
  currentToolSet: { tools: unknown[]; allowedToolNames: readonly string[] };
  resumeCheckpoint?: MainAgentReActCheckpoint;
}): Promise<{ ok: true } | { ok: false; diagnosticMessage: string }> {
  if (!input.options.onRecoveryCheckpoint) return { ok: true };
  const checkpoint = createMainAgentReActCheckpoint({
    request: input.options.request,
    seed: input.options.getCheckpointSeed?.() ?? input.options.checkpointSeed,
    records: input.roundRecords,
    currentToolNames: input.currentToolSet.allowedToolNames,
    maxEstimatedTokens: input.options.maxCheckpointTokens,
    compactedHistory: input.resumeCheckpoint?.compactedHistory,
    externalObservations: input.resumeCheckpoint?.externalObservations,
  });
  try {
    await input.options.onRecoveryCheckpoint({
      reason: input.reason,
      toolRoundsUsed: input.toolRoundsUsed,
      observationIds: [...input.observationIds],
      checkpoint,
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      diagnosticMessage: error instanceof Error ? error.message : "checkpoint_persistence_failed",
    };
  }
}

export function buildCompletionContractRepairItems(input: {
  request: GptProtocolRequest;
  checkpoint: MainAgentReActCheckpoint;
  remainingRequestedOutputs: string[];
}) {
  return [
    { role: "user", content: input.request.input },
    {
      role: "user",
      content: JSON.stringify({
        type: "main_agent_completion_contract_unsatisfied",
        remainingRequestedOutputs: [...new Set(input.remainingRequestedOutputs)],
        checkpoint: input.checkpoint,
        instruction: "Read the current tools and observations, then choose one valid next Tool or return a real gate/pause reason.",
      }),
    },
  ];
}

export function dispatchStatusFromObservation(
  status: MainAgentReActDispatchResult["observation"]["status"],
): MainAgentReActDispatchResult["status"] {
  if (status === "succeeded") return "succeeded";
  if (status === "blocked" || status === "needs_input") return "blocked";
  if (status === "inconclusive" || status === "repair") return "inconclusive";
  return "failed";
}

export function uniqueObservationIds(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export async function notifyRejectedToolCall(
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

export async function notifyProgress(
  options: MainAgentReActLoopOptions,
  event: Parameters<NonNullable<MainAgentReActLoopOptions["onProgress"]>>[0],
) {
  try {
    await options.onProgress?.(event);
  } catch {
    // Progress projection must never change Main Agent control flow.
  }
}

export async function describeToolCallSafely(
  options: MainAgentReActLoopOptions,
  call: { toolName: string; arguments: Record<string, unknown> },
) {
  try {
    return await options.describeToolCall?.(call) ?? {};
  } catch {
    return {};
  }
}

export function parseAllowedCall(call: GptFunctionCall, allowed: readonly string[]) {
  if (!allowed.includes(call.name) || call.argumentsJsonParseStatus !== "parsed" || !isRecord(call.argumentsJson)) return null;
  return { callId: call.callId, toolName: call.name, arguments: structuredClone(call.argumentsJson) };
}

export function modelRequest(request: GptProtocolRequest, tools: unknown[], inputItems?: unknown[], previousResponseId?: string): GptProtocolRequest {
  return {
    ...request,
    ...(inputItems ? { inputItems } : {}),
    ...(previousResponseId ? { previousResponseId } : {}),
    tools,
    toolChoice: "auto",
    parallelToolCalls: false,
  };
}

export async function createResponseWithTelemetry(input: {
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

export async function processCompletionResponse(input: {
  options: MainAgentReActLoopOptions;
  state: MainAgentReActLoopState;
}): Promise<MainAgentReActStep> {
  const { options, state } = input;
  const response = state.currentResponse;
  if (response.diagnostics.status === "failed") {
    if (state.roundRecords.length > 0 && options.onRecoveryCheckpoint) {
      const persisted = await persistRecoveryCheckpoint({
        options,
        reason: "adapter_failed",
        toolRoundsUsed: state.toolRoundsUsed,
        observationIds: state.observationIds,
        roundRecords: state.roundRecords,
        currentToolSet: state.currentToolSet,
        resumeCheckpoint: state.resumeCheckpoint,
      });
      if (!persisted.ok) return { kind: "return", result: failed("checkpoint_persistence_failed", state.toolRoundsUsed, state.observationIds, persisted.diagnosticMessage) };
    }
    return { kind: "return", result: failed("adapter_failed", state.toolRoundsUsed, state.observationIds, response.diagnostics.errorMessage) };
  }
  if (response.functionCalls.length > 0) return { kind: "tool" };
  const completion = options.validateCompletion
    ? await options.validateCompletion()
    : { status: "satisfied" as const, remainingRequestedOutputs: [] };
  if (completion.status === "satisfied") {
    return {
      kind: "return",
      result: { status: "completed", assistantText: response.assistantText, toolRoundsUsed: state.toolRoundsUsed, observationIds: state.observationIds, reason: "none" },
    };
  }
  const checkpoint = createMainAgentReActCheckpoint({
    request: options.request,
    seed: options.getCheckpointSeed?.() ?? options.checkpointSeed,
    records: state.roundRecords,
    currentToolNames: state.currentToolSet.allowedToolNames,
    maxEstimatedTokens: options.maxCheckpointTokens,
    compactedHistory: state.resumeCheckpoint?.compactedHistory,
    externalObservations: state.resumeCheckpoint?.externalObservations,
  });
  if (state.completionRepairAttempted) {
    try {
      await options.onRecoveryCheckpoint?.({
        reason: "completion_contract_unsatisfied",
        toolRoundsUsed: state.toolRoundsUsed,
        observationIds: [...state.observationIds],
        checkpoint,
        remainingRequestedOutputs: [...completion.remainingRequestedOutputs],
      });
    } catch (error) {
      return { kind: "return", result: failed("checkpoint_persistence_failed", state.toolRoundsUsed, state.observationIds, error instanceof Error ? error.message : "checkpoint_persistence_failed") };
    }
    return { kind: "return", result: blocked("completion_contract_unsatisfied", state.toolRoundsUsed, state.observationIds) };
  }
  state.completionRepairAttempted = true;
  return {
    kind: "continue",
    response: await createResponseWithTelemetry({
      options,
      request: modelRequest(options.request, state.currentToolSet.tools, buildCompletionContractRepairItems({
        request: options.request,
        checkpoint,
        remainingRequestedOutputs: completion.remainingRequestedOutputs,
      })),
      phase: "continuation",
      toolRound: state.toolRoundsUsed,
      toolCount: state.currentToolSet.allowedToolNames.length,
      checkpoint,
    }),
  };
}

export async function processToolRound(input: {
  options: MainAgentReActLoopOptions;
  state: MainAgentReActLoopState;
}): Promise<Exclude<MainAgentReActStep, { kind: "tool" }>> {
  const { options, state } = input;
  const response = state.currentResponse;
  if (state.toolRoundsUsed >= state.maxToolRounds) {
    await options.onBudgetExhausted?.({
      reason: "tool_round_limit_reached",
      toolRoundsUsed: state.toolRoundsUsed,
      maxToolRounds: state.maxToolRounds,
      pendingToolName: response.functionCalls.length === 1 ? response.functionCalls[0].name : null,
      observationIds: [...state.observationIds],
    });
    return { kind: "return", result: failed("tool_round_limit_reached", state.toolRoundsUsed, state.observationIds) };
  }
  if (response.functionCalls.length !== 1) return { kind: "return", result: blocked("multiple_tool_calls_blocked", state.toolRoundsUsed, state.observationIds) };
  if (state.maxToolRoundsPerSegment !== null && state.toolRoundsUsed - state.lastSegmentCheckpointRound >= state.maxToolRoundsPerSegment) {
    const checkpoint = createMainAgentReActCheckpoint({
      request: options.request,
      seed: options.getCheckpointSeed?.() ?? options.checkpointSeed,
      records: state.roundRecords,
      currentToolNames: state.currentToolSet.allowedToolNames,
      maxEstimatedTokens: options.maxCheckpointTokens,
      compactedHistory: state.resumeCheckpoint?.compactedHistory,
      externalObservations: state.resumeCheckpoint?.externalObservations,
    });
    if (!options.onSegmentCheckpoint) return { kind: "return", result: failed("checkpoint_persistence_failed", state.toolRoundsUsed, state.observationIds) };
    try {
      await options.onSegmentCheckpoint({
        segmentIndex: Math.floor(state.toolRoundsUsed / state.maxToolRoundsPerSegment),
        toolRoundsUsed: state.toolRoundsUsed,
        pendingToolName: response.functionCalls[0].name,
        observationIds: [...state.observationIds],
        checkpoint,
      });
    } catch (error) {
      return { kind: "return", result: failed("checkpoint_persistence_failed", state.toolRoundsUsed, state.observationIds, error instanceof Error ? error.message : "checkpoint_persistence_failed") };
    }
    state.lastSegmentCheckpointRound = state.toolRoundsUsed;
  }
  const call = response.functionCalls[0];
  const parsed = parseAllowedCall(call, state.currentToolSet.allowedToolNames);
  if (!parsed) return { kind: "return", result: blocked("tool_call_invalid", state.toolRoundsUsed, state.observationIds) };
  const signature = hashRunInput({ toolName: parsed.toolName, arguments: parsed.arguments });
  const previousAttempt = state.callAttempts.get(signature);
  if (previousAttempt && (previousAttempt.lastStatus === "succeeded" || previousAttempt.attempts >= 2)) {
    await notifyRejectedToolCall(options, parsed.toolName, state.toolRoundsUsed + 1);
    const persisted = await persistRecoveryCheckpoint({ options, reason: "repeated_tool_call", toolRoundsUsed: state.toolRoundsUsed, observationIds: state.observationIds, roundRecords: state.roundRecords, currentToolSet: state.currentToolSet, resumeCheckpoint: state.resumeCheckpoint });
    if (!persisted.ok) return { kind: "return", result: failed("checkpoint_persistence_failed", state.toolRoundsUsed, state.observationIds, persisted.diagnosticMessage) };
    return { kind: "return", result: blocked("repeated_tool_call", state.toolRoundsUsed, state.observationIds) };
  }
  const dispatchResult = await dispatchAndRecord({ options, state, parsed, signature, previousAttempt });
  if ("result" in dispatchResult) return dispatchResult.result;
  if (dispatchResult.status === "blocked" && dispatchResult.observation.nextAction === "ask_teacher") {
    const pauseReason = dispatchResult.pauseKind === "dialogue_checkpoint" ? "dialogue_checkpoint_required" as const : "human_gate_required" as const;
    const persisted = await persistRecoveryCheckpoint({ options, reason: pauseReason, toolRoundsUsed: state.toolRoundsUsed, observationIds: state.observationIds, roundRecords: state.roundRecords, currentToolSet: state.currentToolSet, resumeCheckpoint: state.resumeCheckpoint });
    if (!persisted.ok) return { kind: "return", result: failed("checkpoint_persistence_failed", state.toolRoundsUsed, state.observationIds, persisted.diagnosticMessage) };
    return { kind: "return", result: blocked(pauseReason, state.toolRoundsUsed, state.observationIds) };
  }
  if (dispatchResult.status !== "succeeded") {
    const failureSignature = hashRunInput({ toolName: parsed.toolName, callDigest: signature, status: dispatchResult.status, reasonCodes: dispatchResult.observation.reasonCodes });
    const failureCount = (state.failureCounts.get(failureSignature) ?? 0) + 1;
    state.failureCounts.set(failureSignature, failureCount);
    if (failureCount >= 2) {
      const persisted = await persistRecoveryCheckpoint({ options, reason: "repeated_tool_failure", toolRoundsUsed: state.toolRoundsUsed, observationIds: state.observationIds, roundRecords: state.roundRecords, currentToolSet: state.currentToolSet, resumeCheckpoint: state.resumeCheckpoint });
      if (!persisted.ok) return { kind: "return", result: failed("checkpoint_persistence_failed", state.toolRoundsUsed, state.observationIds, persisted.diagnosticMessage) };
      return { kind: "return", result: blocked("repeated_tool_failure", state.toolRoundsUsed, state.observationIds) };
    }
  }
  if (options.refreshTools) state.currentToolSet = await options.refreshTools();
  const checkpoint = createMainAgentReActCheckpoint({ request: options.request, seed: options.getCheckpointSeed?.() ?? options.checkpointSeed, records: state.roundRecords, currentToolNames: state.currentToolSet.allowedToolNames, maxEstimatedTokens: options.maxCheckpointTokens, compactedHistory: state.resumeCheckpoint?.compactedHistory, externalObservations: state.resumeCheckpoint?.externalObservations });
  const continuationItems = buildMainAgentReActContinuationItems({ request: options.request, checkpoint, latestCall: call });
  return { kind: "continue", response: await createResponseWithTelemetry({ options, request: options.usePreviousResponseId === true && response.responseId ? modelRequest(options.request, state.currentToolSet.tools, continuationItems.slice(-1), response.responseId) : modelRequest(options.request, state.currentToolSet.tools, continuationItems), phase: "continuation", toolRound: state.toolRoundsUsed, toolCount: state.currentToolSet.allowedToolNames.length, checkpoint }) };
}

async function dispatchAndRecord(input: {
  options: MainAgentReActLoopOptions;
  state: MainAgentReActLoopState;
  parsed: { callId: string; toolName: string; arguments: Record<string, unknown> };
  signature: string;
  previousAttempt?: { attempts: number; lastStatus: MainAgentReActDispatchResult["status"] };
}): Promise<MainAgentReActDispatchResult | { result: Exclude<MainAgentReActStep, { kind: "tool" }> }> {
  const { options, state, parsed } = input;
  let dispatchResult: MainAgentReActDispatchResult;
  try {
    const visibleDetails = await describeToolCallSafely(options, parsed);
    await notifyProgress(options, { type: "step_started", toolName: parsed.toolName, ...visibleDetails });
    dispatchResult = await options.dispatch(parsed);
  } catch (error) {
    return { result: { kind: "return", result: failed("control_plane_dispatch_failed", state.toolRoundsUsed, state.observationIds, error instanceof Error ? error.message : "control_plane_dispatch_failed") } };
  }
  await notifyProgress(options, {
    type: "step_observed",
    toolName: parsed.toolName,
    status: dispatchResult.observation.status,
    ...(dispatchResult.observation.observationId ? { observationId: dispatchResult.observation.observationId } : {}),
    reasonCodes: [...dispatchResult.observation.reasonCodes],
    ...(dispatchResult.observation.summary ? { summary: dispatchResult.observation.summary } : {}),
    ...(dispatchResult.observation.nextAction ? { nextAction: dispatchResult.observation.nextAction } : {}),
    ...(dispatchResult.observation.artifactRefs?.length ? { artifactRefs: structuredClone(dispatchResult.observation.artifactRefs) } : {}),
  });
  state.callAttempts.set(input.signature, { attempts: (input.previousAttempt?.attempts ?? 0) + 1, lastStatus: dispatchResult.status });
  if (dispatchResult.observation.observationId) state.observationIds.push(dispatchResult.observation.observationId);
  state.toolRoundsUsed += 1;
  state.roundRecords.push({ round: state.toolRoundsUsed, toolName: parsed.toolName, callDigest: input.signature, observation: dispatchResult.observation });
  return dispatchResult;
}

export function failed(reason: MainAgentReActLoopResult["reason"], rounds: number, observationIds: string[], diagnosticMessage?: string): MainAgentReActLoopResult {
  return { status: "failed", assistantText: safeFailureText, toolRoundsUsed: rounds, observationIds, reason, ...(diagnosticMessage ? { diagnosticMessage } : {}) };
}

export function blocked(reason: MainAgentReActLoopResult["reason"], rounds: number, observationIds: string[]): MainAgentReActLoopResult {
  return { status: "blocked", assistantText: safeFailureText, toolRoundsUsed: rounds, observationIds, reason };
}

const safeFailureText = "当前编排已暂停，请调整要求后继续。";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
