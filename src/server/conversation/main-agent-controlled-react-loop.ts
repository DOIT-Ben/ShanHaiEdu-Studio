import { hashRunInput } from "@/server/execution/run-input-snapshot";
import type { GptFunctionCall, GptProtocolRequest, GptProtocolResponse } from "@/server/gpt-protocol/types";
import type { MainAgentProgressSink } from "./main-agent-stream-projection";
import {
  buildMainAgentReActContinuationItems,
  buildMainAgentReActResumeItems,
  checkpointCharacters,
  createMainAgentReActCheckpoint,
  isMainAgentReActResumeContextCompatible,
  restoreMainAgentReActCheckpoint,
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
  pauseKind?: "human_gate" | "dialogue_checkpoint";
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
  prepareTools?: () => MainAgentReActToolSet | Promise<MainAgentReActToolSet>;
  refreshTools?: () => MainAgentReActToolSet | Promise<MainAgentReActToolSet>;
  describeToolCall?: (call: { toolName: string; arguments: Record<string, unknown> }) => {
    purpose?: string;
    inputSummary?: string[];
    expectedOutput?: string;
  } | Promise<{
    purpose?: string;
    inputSummary?: string[];
    expectedOutput?: string;
  }>;
  dispatch: (call: { callId: string; toolName: string; arguments: Record<string, unknown> }) => Promise<MainAgentReActDispatchResult>;
  validateCompletion?: () => MainAgentReActCompletionContract | Promise<MainAgentReActCompletionContract>;
  maxToolRounds?: number;
  maxToolRoundsPerSegment?: number;
  checkpointSeed?: MainAgentReActCheckpointSeed;
  getCheckpointSeed?: () => MainAgentReActCheckpointSeed;
  maxCheckpointTokens?: number;
  usePreviousResponseId?: boolean;
  resumeCheckpoint?: MainAgentReActCheckpoint;
  onContextTelemetry?: (event: MainAgentReActContextTelemetry) => void | Promise<void>;
  onRejectedToolCall?: (event: MainAgentReActRejectedToolCall) => void | Promise<void>;
  onBudgetExhausted?: (event: MainAgentReActBudgetExhausted) => void | Promise<void>;
  onSegmentCheckpoint?: (event: MainAgentReActSegmentCheckpoint) => void | Promise<void>;
  onRecoveryCheckpoint?: (event: MainAgentReActRecoveryCheckpoint) => void | Promise<void>;
  onProgress?: MainAgentProgressSink;
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

export type MainAgentReActSegmentCheckpoint = {
  segmentIndex: number;
  toolRoundsUsed: number;
  pendingToolName: string;
  observationIds: string[];
  checkpoint: MainAgentReActCheckpoint;
};

export type MainAgentReActRecoveryCheckpoint = {
  reason: "adapter_failed" | "completion_contract_unsatisfied" | "dialogue_checkpoint_required" | "human_gate_required" | "repeated_tool_call" | "repeated_tool_failure";
  toolRoundsUsed: number;
  observationIds: string[];
  checkpoint: MainAgentReActCheckpoint;
  remainingRequestedOutputs?: string[];
};

export type MainAgentReActCompletionContract = {
  status: "satisfied" | "unsatisfied";
  remainingRequestedOutputs: string[];
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
  reason: "none" | "adapter_failed" | "checkpoint_persistence_failed" | "checkpoint_restore_failed" | "completion_contract_unsatisfied" | "control_plane_dispatch_failed" | "dialogue_checkpoint_required" | "human_gate_required" | "multiple_tool_calls_blocked" | "tool_call_invalid" | "tool_round_limit_reached" | "repeated_tool_call" | "repeated_tool_failure";
  diagnosticMessage?: string;
};

const safeFailureText = "当前编排已暂停，请调整要求后继续。";

export async function runMainAgentControlledReActLoop(
  options: MainAgentReActLoopOptions,
): Promise<MainAgentReActLoopResult> {
  const maxToolRounds = Math.max(0, options.maxToolRounds ?? 3);
  const maxToolRoundsPerSegment = options.maxToolRoundsPerSegment === undefined
    ? null
    : Math.max(1, Math.trunc(options.maxToolRoundsPerSegment));
  let resumeCheckpoint: MainAgentReActCheckpoint | undefined;
  try {
    resumeCheckpoint = options.resumeCheckpoint
      ? restoreMainAgentReActCheckpoint(options.resumeCheckpoint)
      : undefined;
    if (resumeCheckpoint && !isMainAgentReActResumeContextCompatible({
      checkpoint: resumeCheckpoint,
      request: options.request,
      seed: options.getCheckpointSeed?.() ?? options.checkpointSeed,
    })) {
      return failed("checkpoint_restore_failed", 0, [], "checkpoint_context_mismatch");
    }
  } catch (error) {
    return failed(
      "checkpoint_restore_failed",
      0,
      [],
      error instanceof Error ? error.message : "checkpoint_restore_failed",
    );
  }
  const restoredRecords = resumeCheckpoint?.completedRounds ?? [];
  const callAttempts = new Map<string, { attempts: number; lastStatus: MainAgentReActDispatchResult["status"] }>();
  const failureCounts = new Map<string, number>();
  for (const record of restoredRecords) {
    const status = dispatchStatusFromObservation(record.observation.status);
    callAttempts.set(record.callDigest, { attempts: 1, lastStatus: status });
    if (status !== "succeeded") {
      const failureSignature = hashRunInput({
        toolName: record.toolName,
        callDigest: record.callDigest,
        status,
        reasonCodes: record.observation.reasonCodes,
      });
      failureCounts.set(failureSignature, (failureCounts.get(failureSignature) ?? 0) + 1);
    }
  }
  const observationIds: string[] = uniqueObservationIds([
    ...(resumeCheckpoint?.compactedHistory.observationIds ?? []),
    ...restoredRecords.flatMap((record) => record.observation.observationId ? [record.observation.observationId] : []),
    ...(resumeCheckpoint?.externalObservations ?? []).flatMap((observation) =>
      observation.observationId ? [observation.observationId] : []),
  ]);
  let toolRoundsUsed = resumeCheckpoint
    ? Math.max(
        resumeCheckpoint.compactedHistory.omittedRounds + restoredRecords.length,
        ...restoredRecords.map((record) => record.round),
      )
    : 0;
  let lastSegmentCheckpointRound = toolRoundsUsed;
  let currentToolSet: MainAgentReActToolSet = {
    tools: options.tools,
    allowedToolNames: options.allowedToolNames,
  };
  if (options.prepareTools) currentToolSet = await options.prepareTools();
  const roundRecords: MainAgentReActRoundRecord[] = structuredClone(restoredRecords);
  let completionRepairAttempted = false;
  let currentResponse = await createResponseWithTelemetry({
    options,
    request: modelRequest(
      options.request,
      currentToolSet.tools,
      resumeCheckpoint ? buildMainAgentReActResumeItems({ request: options.request, checkpoint: resumeCheckpoint }) : undefined,
    ),
    phase: "initial",
    toolRound: 0,
    toolCount: currentToolSet.allowedToolNames.length,
  });

  while (true) {
    if (currentResponse.diagnostics.status === "failed") {
      if (roundRecords.length > 0 && options.onRecoveryCheckpoint) {
        const checkpoint = createMainAgentReActCheckpoint({
          request: options.request,
          seed: options.getCheckpointSeed?.() ?? options.checkpointSeed,
          records: roundRecords,
          currentToolNames: currentToolSet.allowedToolNames,
          maxEstimatedTokens: options.maxCheckpointTokens,
          compactedHistory: resumeCheckpoint?.compactedHistory,
          externalObservations: resumeCheckpoint?.externalObservations,
        });
        try {
          await options.onRecoveryCheckpoint({
            reason: "adapter_failed",
            toolRoundsUsed,
            observationIds: [...observationIds],
            checkpoint,
          });
        } catch (error) {
          return failed(
            "checkpoint_persistence_failed",
            toolRoundsUsed,
            observationIds,
            error instanceof Error ? error.message : "checkpoint_persistence_failed",
          );
        }
      }
      return failed("adapter_failed", toolRoundsUsed, observationIds, currentResponse.diagnostics.errorMessage);
    }
    if (currentResponse.functionCalls.length === 0) {
      const completion = options.validateCompletion
        ? await options.validateCompletion()
        : { status: "satisfied" as const, remainingRequestedOutputs: [] };
      if (completion.status === "unsatisfied") {
        const checkpoint = createMainAgentReActCheckpoint({
          request: options.request,
          seed: options.getCheckpointSeed?.() ?? options.checkpointSeed,
          records: roundRecords,
          currentToolNames: currentToolSet.allowedToolNames,
          maxEstimatedTokens: options.maxCheckpointTokens,
          compactedHistory: resumeCheckpoint?.compactedHistory,
          externalObservations: resumeCheckpoint?.externalObservations,
        });
        if (completionRepairAttempted) {
          try {
            await options.onRecoveryCheckpoint?.({
              reason: "completion_contract_unsatisfied",
              toolRoundsUsed,
              observationIds: [...observationIds],
              checkpoint,
              remainingRequestedOutputs: [...completion.remainingRequestedOutputs],
            });
          } catch (error) {
            return failed(
              "checkpoint_persistence_failed",
              toolRoundsUsed,
              observationIds,
              error instanceof Error ? error.message : "checkpoint_persistence_failed",
            );
          }
          return blocked("completion_contract_unsatisfied", toolRoundsUsed, observationIds);
        }
        completionRepairAttempted = true;
        currentResponse = await createResponseWithTelemetry({
          options,
          request: modelRequest(
            options.request,
            currentToolSet.tools,
            buildCompletionContractRepairItems({
              request: options.request,
              checkpoint,
              remainingRequestedOutputs: completion.remainingRequestedOutputs,
            }),
          ),
          phase: "continuation",
          toolRound: toolRoundsUsed,
          toolCount: currentToolSet.allowedToolNames.length,
          checkpoint,
        });
        continue;
      }
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

    if (maxToolRoundsPerSegment !== null && toolRoundsUsed - lastSegmentCheckpointRound >= maxToolRoundsPerSegment) {
      const pendingToolName = currentResponse.functionCalls[0].name;
      const checkpoint = createMainAgentReActCheckpoint({
        request: options.request,
        seed: options.getCheckpointSeed?.() ?? options.checkpointSeed,
        records: roundRecords,
        currentToolNames: currentToolSet.allowedToolNames,
        maxEstimatedTokens: options.maxCheckpointTokens,
        compactedHistory: resumeCheckpoint?.compactedHistory,
        externalObservations: resumeCheckpoint?.externalObservations,
      });
      if (!options.onSegmentCheckpoint) {
        return failed("checkpoint_persistence_failed", toolRoundsUsed, observationIds);
      }
      try {
        await options.onSegmentCheckpoint({
          segmentIndex: Math.floor(toolRoundsUsed / maxToolRoundsPerSegment),
          toolRoundsUsed,
          pendingToolName,
          observationIds: [...observationIds],
          checkpoint,
        });
      } catch (error) {
        return failed(
          "checkpoint_persistence_failed",
          toolRoundsUsed,
          observationIds,
          error instanceof Error ? error.message : "checkpoint_persistence_failed",
        );
      }
      lastSegmentCheckpointRound = toolRoundsUsed;
    }

    const call = currentResponse.functionCalls[0];
    const parsed = parseAllowedCall(call, currentToolSet.allowedToolNames);
    if (!parsed) return blocked("tool_call_invalid", toolRoundsUsed, observationIds);
    const signature = hashRunInput({ toolName: parsed.toolName, arguments: parsed.arguments });
    const previousAttempt = callAttempts.get(signature);
    if (previousAttempt && (previousAttempt.lastStatus === "succeeded" || previousAttempt.attempts >= 2)) {
      await notifyRejectedToolCall(options, parsed.toolName, toolRoundsUsed + 1);
      const persisted = await persistRecoveryCheckpoint({
        options,
        reason: "repeated_tool_call",
        toolRoundsUsed,
        observationIds,
        roundRecords,
        currentToolSet,
        resumeCheckpoint,
      });
      if (!persisted.ok) return failed("checkpoint_persistence_failed", toolRoundsUsed, observationIds, persisted.diagnosticMessage);
      return blocked("repeated_tool_call", toolRoundsUsed, observationIds);
    }

    let dispatchResult: MainAgentReActDispatchResult;
    try {
      const visibleDetails = await describeToolCallSafely(options, parsed);
      await notifyProgress(options, { type: "step_started", toolName: parsed.toolName, ...visibleDetails });
      dispatchResult = await options.dispatch(parsed);
    } catch (error) {
      return failed(
        "control_plane_dispatch_failed",
        toolRoundsUsed,
        observationIds,
        error instanceof Error ? error.message : "control_plane_dispatch_failed",
      );
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
    callAttempts.set(signature, {
      attempts: (previousAttempt?.attempts ?? 0) + 1,
      lastStatus: dispatchResult.status,
    });
    if (dispatchResult.observation.observationId) observationIds.push(dispatchResult.observation.observationId);
    toolRoundsUsed += 1;
    roundRecords.push({
      round: toolRoundsUsed,
      toolName: parsed.toolName,
      callDigest: signature,
      observation: dispatchResult.observation,
    });
    if (dispatchResult.status === "blocked" && dispatchResult.observation.nextAction === "ask_teacher") {
      const pauseReason = dispatchResult.pauseKind === "dialogue_checkpoint"
        ? "dialogue_checkpoint_required" as const
        : "human_gate_required" as const;
      const persisted = await persistRecoveryCheckpoint({
        options,
        reason: pauseReason,
        toolRoundsUsed,
        observationIds,
        roundRecords,
        currentToolSet,
        resumeCheckpoint,
      });
      if (!persisted.ok) {
        return failed("checkpoint_persistence_failed", toolRoundsUsed, observationIds, persisted.diagnosticMessage);
      }
      return blocked(pauseReason, toolRoundsUsed, observationIds);
    }
    if (dispatchResult.status !== "succeeded") {
      const failureSignature = hashRunInput({
        toolName: parsed.toolName,
        callDigest: signature,
        status: dispatchResult.status,
        reasonCodes: dispatchResult.observation.reasonCodes,
      });
      const failureCount = (failureCounts.get(failureSignature) ?? 0) + 1;
      failureCounts.set(failureSignature, failureCount);
      if (failureCount >= 2) {
        const persisted = await persistRecoveryCheckpoint({
          options,
          reason: "repeated_tool_failure",
          toolRoundsUsed,
          observationIds,
          roundRecords,
          currentToolSet,
          resumeCheckpoint,
        });
        if (!persisted.ok) return failed("checkpoint_persistence_failed", toolRoundsUsed, observationIds, persisted.diagnosticMessage);
        return blocked("repeated_tool_failure", toolRoundsUsed, observationIds);
      }
    }
    if (options.refreshTools) currentToolSet = await options.refreshTools();
    const checkpoint = createMainAgentReActCheckpoint({
      request: options.request,
      seed: options.getCheckpointSeed?.() ?? options.checkpointSeed,
      records: roundRecords,
      currentToolNames: currentToolSet.allowedToolNames,
      maxEstimatedTokens: options.maxCheckpointTokens,
      compactedHistory: resumeCheckpoint?.compactedHistory,
      externalObservations: resumeCheckpoint?.externalObservations,
    });
    const continuationItems = buildMainAgentReActContinuationItems({ request: options.request, checkpoint, latestCall: call });
    const continuationRequest = options.usePreviousResponseId === true && currentResponse.responseId
      ? modelRequest(options.request, currentToolSet.tools, continuationItems.slice(-1), currentResponse.responseId)
      : modelRequest(options.request, currentToolSet.tools, continuationItems);
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

async function persistRecoveryCheckpoint(input: {
  options: MainAgentReActLoopOptions;
  reason: MainAgentReActRecoveryCheckpoint["reason"];
  toolRoundsUsed: number;
  observationIds: string[];
  roundRecords: MainAgentReActRoundRecord[];
  currentToolSet: MainAgentReActToolSet;
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

function buildCompletionContractRepairItems(input: {
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

function dispatchStatusFromObservation(
  status: MainAgentReActContinuationObservation["status"],
): MainAgentReActDispatchResult["status"] {
  if (status === "succeeded") return "succeeded";
  if (status === "blocked" || status === "needs_input") return "blocked";
  if (status === "inconclusive" || status === "repair") return "inconclusive";
  return "failed";
}

function uniqueObservationIds(values: string[]) {
  return [...new Set(values.filter(Boolean))];
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

async function notifyProgress(
  options: MainAgentReActLoopOptions,
  event: Parameters<NonNullable<MainAgentReActLoopOptions["onProgress"]>>[0],
) {
  try {
    await options.onProgress?.(event);
  } catch {
    // Progress projection must never change Main Agent control flow.
  }
}

async function describeToolCallSafely(
  options: MainAgentReActLoopOptions,
  call: { toolName: string; arguments: Record<string, unknown> },
) {
  try {
    return await options.describeToolCall?.(call) ?? {};
  } catch {
    return {};
  }
}

function parseAllowedCall(call: GptFunctionCall, allowed: readonly string[]) {
  if (!allowed.includes(call.name) || call.argumentsJsonParseStatus !== "parsed" || !isRecord(call.argumentsJson)) return null;
  return { callId: call.callId, toolName: call.name, arguments: structuredClone(call.argumentsJson) };
}

function modelRequest(request: GptProtocolRequest, tools: unknown[], inputItems?: unknown[], previousResponseId?: string): GptProtocolRequest {
  return {
    ...request,
    ...(inputItems ? { inputItems } : {}),
    ...(previousResponseId ? { previousResponseId } : {}),
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
