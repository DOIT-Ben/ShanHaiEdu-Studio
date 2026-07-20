import { hashRunInput } from "@/server/execution/run-input-snapshot";
import {
  buildMainAgentReActResumeItems,
  isMainAgentReActResumeContextCompatible,
  restoreMainAgentReActCheckpoint,
  type MainAgentReActCheckpoint,
} from "./main-agent-react-checkpoint";
import {
  createResponseWithTelemetry,
  dispatchStatusFromObservation,
  failed,
  modelRequest,
  processCompletionResponse,
  processToolRound,
  uniqueObservationIds,
  type MainAgentReActLoopState,
} from "./main-agent-react-loop-helpers";
import type {
  MainAgentReActDispatchResult,
  MainAgentReActLoopOptions,
  MainAgentReActLoopResult,
  MainAgentReActToolSet,
} from "./main-agent-react-loop-contract";

export type {
  MainAgentReActAdapter,
  MainAgentReActBudgetExhausted,
  MainAgentReActCompletionContract,
  MainAgentReActContextTelemetry,
  MainAgentReActDispatchResult,
  MainAgentReActLoopOptions,
  MainAgentReActLoopResult,
  MainAgentReActRecoveryCheckpoint,
  MainAgentReActRejectedToolCall,
  MainAgentReActSegmentCheckpoint,
  MainAgentReActToolSet,
} from "./main-agent-react-loop-contract";

export async function runMainAgentControlledReActLoop(
  options: MainAgentReActLoopOptions,
): Promise<MainAgentReActLoopResult> {
  const maxToolRounds = Math.max(0, options.maxToolRounds ?? 3);
  const maxToolRoundsPerSegment = options.maxToolRoundsPerSegment === undefined ? null : Math.max(1, Math.trunc(options.maxToolRoundsPerSegment));
  let resumeCheckpoint: MainAgentReActCheckpoint | undefined;
  try {
    resumeCheckpoint = options.resumeCheckpoint ? restoreMainAgentReActCheckpoint(options.resumeCheckpoint) : undefined;
    if (resumeCheckpoint && !isMainAgentReActResumeContextCompatible({ checkpoint: resumeCheckpoint, request: options.request, seed: options.getCheckpointSeed?.() ?? options.checkpointSeed })) {
      return failed("checkpoint_restore_failed", 0, [], "checkpoint_context_mismatch");
    }
  } catch (error) {
    return failed("checkpoint_restore_failed", 0, [], error instanceof Error ? error.message : "checkpoint_restore_failed");
  }
  const restoredRecords = resumeCheckpoint?.completedRounds ?? [];
  const callAttempts = new Map<string, { attempts: number; lastStatus: MainAgentReActDispatchResult["status"] }>();
  const failureCounts = new Map<string, number>();
  for (const record of restoredRecords) {
    const status = dispatchStatusFromObservation(record.observation.status);
    callAttempts.set(record.callDigest, { attempts: 1, lastStatus: status });
    if (status !== "succeeded") {
      const signature = hashRunInput({ toolName: record.toolName, callDigest: record.callDigest, status, reasonCodes: record.observation.reasonCodes });
      failureCounts.set(signature, (failureCounts.get(signature) ?? 0) + 1);
    }
  }
  const observationIds = uniqueObservationIds([
    ...(resumeCheckpoint?.compactedHistory.observationIds ?? []),
    ...restoredRecords.flatMap((record) => record.observation.observationId ? [record.observation.observationId] : []),
    ...(resumeCheckpoint?.externalObservations ?? []).flatMap((observation) => observation.observationId ? [observation.observationId] : []),
  ]);
  const toolRoundsUsed = resumeCheckpoint ? Math.max(resumeCheckpoint.compactedHistory.omittedRounds + restoredRecords.length, ...restoredRecords.map((record) => record.round)) : 0;
  let currentToolSet: MainAgentReActToolSet = { tools: options.tools, allowedToolNames: options.allowedToolNames };
  if (options.prepareTools) currentToolSet = await options.prepareTools();
  const currentResponse = await createResponseWithTelemetry({
    options,
    request: modelRequest(options.request, currentToolSet.tools, resumeCheckpoint ? buildMainAgentReActResumeItems({ request: options.request, checkpoint: resumeCheckpoint }) : undefined),
    phase: "initial",
    toolRound: 0,
    toolCount: currentToolSet.allowedToolNames.length,
  });
  const state: MainAgentReActLoopState = {
    maxToolRounds,
    maxToolRoundsPerSegment,
    resumeCheckpoint,
    callAttempts,
    failureCounts,
    observationIds,
    toolRoundsUsed,
    lastSegmentCheckpointRound: toolRoundsUsed,
    currentToolSet,
    roundRecords: structuredClone(restoredRecords),
    completionRepairAttempted: false,
    currentResponse,
  };

  while (true) {
    const completionStep = await processCompletionResponse({ options, state });
    if (completionStep.kind === "return") return completionStep.result;
    if (completionStep.kind === "continue") {
      state.currentResponse = completionStep.response;
      continue;
    }
    const toolStep = await processToolRound({ options, state });
    if (toolStep.kind === "return") return toolStep.result;
    state.currentResponse = toolStep.response;
  }
}
