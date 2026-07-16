import { projectRuntimeAbToolDefinitions } from "./tool-projection";
import {
  RUNTIME_AB_ISOLATION,
  assertRuntimeAbEvaluationProfile,
  assertRuntimeAbRunInput,
  createRuntimeAbCallBinding,
  createRuntimeAbCheckpoint,
  restoreRuntimeAbCheckpoint,
  runtimeAbCheckpointScope,
  type RuntimeAbAdapter,
  type RuntimeAbCheckpoint,
  type RuntimeAbCheckpointStore,
  type RuntimeAbObservation,
  type RuntimeAbRunInput,
  type RuntimeAbRunResult,
  type RuntimeAbTraceEntry,
} from "./types";

export async function runRuntimeAbEvaluation(
  adapter: RuntimeAbAdapter,
  input: RuntimeAbRunInput,
): Promise<RuntimeAbRunResult> {
  assertRuntimeAbRunInput(input);
  assertRuntimeAbEvaluationProfile(adapter.profile);
  const toolDefinitions = projectRuntimeAbToolDefinitions();
  const trace: RuntimeAbTraceEntry[] = [];
  let requestCount = 0;
  let observations: RuntimeAbObservation[] = [];

  try {
    const stored = await input.checkpointStore.load(runtimeAbCheckpointScope(input));
    observations = restoreRuntimeAbCheckpoint({
      checkpoint: stored,
      taskBrief: input.taskBrief,
      intentGrant: input.intentGrant,
      planRevision: input.planRevision,
      toolDefinitions,
    });
  } catch (error) {
    return result(
      "failed",
      "The isolated Runtime A/B checkpoint could not be restored.",
      "checkpoint_restore_failed",
      error,
    );
  }

  const committedCalls = new Set(observations.map((observation) => observation.callDigest));
  while (requestCount < RUNTIME_AB_ISOLATION.maxTurns) {
    requestCount += 1;
    let decision;
    try {
      decision = await adapter.decide({
        taskBrief: structuredClone(input.taskBrief),
        intentGrant: structuredClone(input.intentGrant),
        observations: structuredClone(observations),
        tools: structuredClone(toolDefinitions),
      });
    } catch (error) {
      return result(
        "paused",
        "The isolated Runtime A/B model transport failed without promoting business state.",
        "model_transport_failed",
        error,
      );
    }

    if (decision.kind === "complete") return result("completed", decision.summary);
    if (decision.kind === "paused") return result("paused", decision.summary, decision.reasonCode);

    const binding = createRuntimeAbCallBinding(decision.call);
    if (committedCalls.has(binding.callDigest)) {
      return result(
        "paused",
        "The isolated Runtime A/B run rejected a committed identical call.",
        "duplicate_tool_call",
      );
    }

    const observation = await input.gateway.execute(decision.call);
    if (
      observation.callDigest !== binding.callDigest
      || observation.argumentsDigest !== binding.argumentsDigest
    ) {
      return result(
        "failed",
        "The isolated Runtime A/B Tool Observation did not match its selected call.",
        "observation_call_binding_mismatch",
      );
    }
    const pendingObservations = [...observations, observation];
    const checkpoint = checkpointFor(pendingObservations);
    try {
      await persistAndConfirmCheckpoint({
        store: input.checkpointStore,
        checkpoint,
        taskBrief: input.taskBrief,
        intentGrant: input.intentGrant,
        planRevision: input.planRevision,
        toolDefinitions,
      });
    } catch (error) {
      return result(
        "failed",
        "The isolated Runtime A/B run could not durably persist its Observation.",
        "checkpoint_persistence_failed",
        error,
      );
    }

    observations = pendingObservations;
    committedCalls.add(observation.callDigest);
    trace.push({
      turn: requestCount,
      callId: observation.callId,
      toolName: observation.toolName,
      arguments: structuredClone(decision.call.arguments),
      callDigest: observation.callDigest,
      argumentsDigest: observation.argumentsDigest,
      idempotencyKey: observation.idempotencyKey,
      observationId: observation.observationId,
      observationStatus: observation.status,
    });
    if (observation.status === "failed" && isTerminalGate(observation.reasonCode)) {
      return result("paused", observation.summary, observation.reasonCode ?? "tool_execution_failed");
    }
  }

  return result(
    "paused",
    "The isolated Runtime A/B run exhausted its six-turn budget.",
    "max_turns_exhausted",
  );

  function checkpointFor(currentObservations: readonly RuntimeAbObservation[]) {
    return createRuntimeAbCheckpoint({
      taskBrief: input.taskBrief,
      intentGrant: input.intentGrant,
      planRevision: input.planRevision,
      toolDefinitions,
      observations: currentObservations,
    });
  }

  function result(
    status: RuntimeAbRunResult["status"],
    finalSummary: string,
    reasonCode?: string,
    error?: unknown,
  ): RuntimeAbRunResult {
    const diagnostic = error instanceof Error ? error.message : undefined;
    return {
      runtimeKind: adapter.runtimeKind,
      adoptionStatus: "evaluation_only",
      productionEligible: false,
      status,
      ...(reasonCode ? { reasonCode } : {}),
      finalSummary: diagnostic ? `${finalSummary} ${diagnostic}` : finalSummary,
      trace: structuredClone(trace),
      checkpoint: checkpointFor(observations),
      requestCount,
      isolation: RUNTIME_AB_ISOLATION,
    };
  }
}

async function persistAndConfirmCheckpoint(input: {
  store: RuntimeAbCheckpointStore;
  checkpoint: RuntimeAbCheckpoint;
  taskBrief: RuntimeAbRunInput["taskBrief"];
  intentGrant: RuntimeAbRunInput["intentGrant"];
  planRevision: number;
  toolDefinitions: ReturnType<typeof projectRuntimeAbToolDefinitions>;
}) {
  await input.store.save(input.checkpoint);
  const persisted = await input.store.load({
    projectId: input.checkpoint.projectId,
    taskId: input.checkpoint.taskId,
    intentEpoch: input.checkpoint.intentEpoch,
    planRevision: input.checkpoint.planRevision,
  });
  if (!persisted || persisted.checkpointDigest !== input.checkpoint.checkpointDigest) {
    throw new Error("Runtime A/B durable checkpoint read-after-write confirmation failed.");
  }
  restoreRuntimeAbCheckpoint({
    checkpoint: persisted,
    taskBrief: input.taskBrief,
    intentGrant: input.intentGrant,
    planRevision: input.planRevision,
    toolDefinitions: input.toolDefinitions,
  });
}

function isTerminalGate(reasonCode: string | undefined) {
  if (!reasonCode) return false;
  return reasonCode.startsWith("execution_")
    || reasonCode === "authorization_required"
    || reasonCode === "budget_upgrade_required"
    || reasonCode === "permission_change_required"
    || reasonCode === "destructive_action_required"
    || reasonCode === "human_gate_required";
}
