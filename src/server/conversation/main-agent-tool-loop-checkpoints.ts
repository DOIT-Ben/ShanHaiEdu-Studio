import { randomUUID } from "node:crypto";

import { hashArtifactDraft } from "@/server/contracts/contract-validator";
import { hashRunInput } from "@/server/execution/run-input-snapshot";
import { isArtifactTrustedForDownstream } from "@/server/quality/artifact-quality-state";
import { isArtifactBoundToTask } from "@/server/quality/artifact-truth-boundary";

import { buildSemanticContextSnapshot } from "./context-semantic-snapshot";
import type {
  MainAgentReActBudgetExhausted,
  MainAgentReActContextTelemetry,
  MainAgentReActRecoveryCheckpoint,
  MainAgentReActRejectedToolCall,
  MainAgentReActSegmentCheckpoint,
} from "./main-agent-controlled-react-loop";
import { createMainAgentRoundBudgetPause } from "./main-agent-run-pause";
import { appendMainAgentReActContextTelemetry, appendMainAgentToolExposureTrace } from "./main-agent-tool-loop-metadata";
import type { MainAgentToolLoopContext } from "./main-agent-tool-loop-types";
import {
  appendAgentObservationMetadata,
  appendRunCheckpointMetadata,
  createAgentObservation,
  createRunCheckpoint,
  readAgentObservationsFromMetadata,
} from "./react-control";

export function createMainAgentToolLoopCheckpointHandlers(context: MainAgentToolLoopContext) {
  return {
    onContextTelemetry: (event: MainAgentReActContextTelemetry) => persistContextTelemetry(context, event),
    onRejectedToolCall: (event: MainAgentReActRejectedToolCall) => persistRejectedToolCall(context, event),
    onBudgetExhausted: (event: MainAgentReActBudgetExhausted) => persistBudgetPause(context, event),
    onSegmentCheckpoint: context.input.taskBrief
      ? (event: MainAgentReActSegmentCheckpoint) => persistRunCheckpoint(context, event, "active")
      : undefined,
    onRecoveryCheckpoint: context.input.taskBrief
      ? (event: MainAgentReActRecoveryCheckpoint) => persistRecoveryCheckpoint(context, event)
      : undefined,
  };
}

async function persistContextTelemetry(context: MainAgentToolLoopContext, event: MainAgentReActContextTelemetry) {
  context.state.currentMetadata = appendMainAgentReActContextTelemetry(context.state.currentMetadata, event);
  await persistMessageMetadata(context);
}

async function persistRejectedToolCall(context: MainAgentToolLoopContext, event: MainAgentReActRejectedToolCall) {
  const { input, state } = context;
  state.currentMetadata = appendMainAgentToolExposureTrace(state.currentMetadata, {
    sequence: ++state.toolExposureSequence,
    event: "tool_rejected",
    intentEpoch: input.project.intentEpoch ?? 0,
    allowedToolNames: state.definitions.map((tool) => tool.transportName),
    selectedToolName: event.toolName,
    rejectionReason: event.reason,
  });
  await persistMessageMetadata(context);
}

async function persistBudgetPause(context: MainAgentToolLoopContext, event: MainAgentReActBudgetExhausted) {
  const { input, state } = context;
  const pause = createMainAgentRoundBudgetPause({
    projectId: input.project.id,
    taskBriefDigest: input.taskBrief?.digest ?? null,
    intentEpoch: input.project.intentEpoch ?? 0,
    planRevision: state.currentPlanRevision,
    event,
  });
  state.currentMetadata = appendMainAgentToolExposureTrace(
    appendRunCheckpointMetadata(
      appendAgentObservationMetadata(state.currentMetadata, pause.observation),
      pause.checkpoint,
    ),
    {
      sequence: ++state.toolExposureSequence,
      event: "run_paused",
      intentEpoch: input.project.intentEpoch ?? 0,
      allowedToolNames: state.definitions.map((tool) => tool.transportName),
      selectedToolName: event.pendingToolName ?? undefined,
      rejectionReason: event.reason,
    },
  );
  await persistMessageMetadata(context);
}

async function persistRecoveryCheckpoint(
  context: MainAgentToolLoopContext,
  event: MainAgentReActRecoveryCheckpoint,
) {
  await persistRecoveryReasonMetadata(context, event);
  await persistRunCheckpoint(context, event, "paused_recovery");
}

async function persistRecoveryReasonMetadata(
  context: MainAgentToolLoopContext,
  event: MainAgentReActRecoveryCheckpoint,
) {
  if (event.reason === "human_gate_required" || event.reason === "dialogue_checkpoint_required") {
    await persistDecisionRecoveryMetadata(context, event);
    return;
  }
  if (event.reason === "completion_contract_unsatisfied") {
    await persistCompletionRecoveryMetadata(context, event);
    return;
  }
  if (event.reason === "adapter_failed" || event.reason === "repeated_tool_call" ||
      event.reason === "repeated_tool_failure") {
    await persistToolFailureRecoveryMetadata(context, event);
  }
}

async function persistDecisionRecoveryMetadata(
  context: MainAgentToolLoopContext,
  event: MainAgentReActRecoveryCheckpoint,
) {
  const { input, state } = context;
  if (event.reason === "dialogue_checkpoint_required" && !state.activeDialogueCheckpoint) {
    throw new Error("DialogueCheckpoint recovery requires a pending checkpoint.");
  }
  const observations = readAgentObservationsFromMetadata(state.currentMetadata);
  const latestObservation = [...observations].reverse().find((observation) =>
    event.observationIds.includes(observation.observationId));
  const dialogueRecovery = event.reason === "dialogue_checkpoint_required";
  const latestToolName = dialogueRecovery
    ? "request_teacher_decision"
    : event.checkpoint.completedRounds.at(-1)?.toolName ?? "main_agent_tool_loop";
  const metadata = dialogueRecovery
    ? { ...state.currentMetadata, dialogueCheckpoint: structuredClone(state.activeDialogueCheckpoint) }
    : state.currentMetadata;
  state.currentMetadata = appendRunCheckpointMetadata(
    metadata,
    createRunCheckpoint({
      checkpointId: event.checkpoint.checkpointDigest,
      projectId: input.project.id,
      planVersion: state.currentPlanRevision,
      reason: dialogueRecovery ? "dialogue_checkpoint_required" : "human_gate_required",
      actionKey: latestObservation?.actionKey ?? latestToolName,
      inputHash: latestObservation?.inputHash,
      observationRefs: event.observationIds,
    }),
  );
  await persistMessageMetadata(context);
}

async function persistCompletionRecoveryMetadata(
  context: MainAgentToolLoopContext,
  event: MainAgentReActRecoveryCheckpoint,
) {
  const { input, state } = context;
  const observation = createAgentObservation({
    projectId: input.project.id,
    source: "validation",
    status: "blocked",
    actionKey: "main_agent_completion_contract",
    inputHash: hashRunInput({
      taskBriefDigest: input.taskBrief?.digest ?? null,
      intentEpoch: input.project.intentEpoch ?? 0,
      planRevision: state.currentPlanRevision,
      remainingRequestedOutputs: event.remainingRequestedOutputs ?? [],
    }),
    reasonCodes: ["completion_contract_unsatisfied", "remaining_requested_outputs"],
    reportRefs: [],
    targetLocators: [],
    responsibleStage: "main_agent_control_loop",
    minimalNextAction: "pause",
    teacherSafeSummary: "当前任务还没有完整完成，进度已保存，可以从现有成果继续。",
  });
  state.currentMetadata = appendRunCheckpointMetadata(
    appendAgentObservationMetadata(state.currentMetadata, observation),
    createRunCheckpoint({
      checkpointId: event.checkpoint.checkpointDigest,
      projectId: input.project.id,
      planVersion: state.currentPlanRevision,
      reason: "completion_contract_unsatisfied",
      actionKey: "main_agent_completion_contract",
      inputHash: observation.inputHash,
      observationRefs: [...event.observationIds, observation.observationId],
    }),
  );
  await persistMessageMetadata(context);
}

async function persistToolFailureRecoveryMetadata(
  context: MainAgentToolLoopContext,
  event: MainAgentReActRecoveryCheckpoint,
) {
  const { input, state } = context;
  const observations = readAgentObservationsFromMetadata(state.currentMetadata);
  const latestObservation = [...observations].reverse().find((observation) =>
    event.observationIds.includes(observation.observationId));
  const latestToolName = event.checkpoint.completedRounds.at(-1)?.toolName ?? "main_agent_tool_loop";
  const repeated = event.reason === "repeated_tool_call" || event.reason === "repeated_tool_failure";
  state.currentMetadata = appendMainAgentToolExposureTrace(
    appendRunCheckpointMetadata(
      state.currentMetadata,
      createRunCheckpoint({
        checkpointId: event.checkpoint.checkpointDigest,
        projectId: input.project.id,
        planVersion: state.currentPlanRevision,
        reason: repeated ? "repeated_failure" : "adapter_failed",
        actionKey: latestObservation?.actionKey ?? latestToolName,
        inputHash: latestObservation?.inputHash,
        observationRefs: event.observationIds,
      }),
    ),
    {
      sequence: ++state.toolExposureSequence,
      event: "run_paused",
      intentEpoch: input.project.intentEpoch ?? 0,
      allowedToolNames: state.definitions.map((tool) => tool.transportName),
      selectedToolName: latestToolName,
      rejectionReason: event.reason === "repeated_tool_call" || event.reason === "repeated_tool_failure"
        ? event.reason
        : "adapter_failed",
    },
  );
  await persistMessageMetadata(context);
}

async function persistRunCheckpoint(
  context: MainAgentToolLoopContext,
  event: MainAgentReActSegmentCheckpoint | MainAgentReActRecoveryCheckpoint,
  status: "active" | "paused_recovery",
) {
  const { input, state, controlPlaneStore } = context;
  const taskBrief = input.taskBrief;
  if (!taskBrief) throw new Error("ReAct checkpoint requires a TaskBrief.");
  const aggregate = await controlPlaneStore.getTaskAggregate(taskBrief.projectId, taskBrief.intentEpoch);
  if (!aggregate || aggregate.taskBrief.digest !== taskBrief.digest) {
    throw new Error("ReAct checkpoint requires the current TaskAggregate.");
  }
  if (aggregate.plan.revision !== state.currentPlanRevision || aggregate.status !== "active") {
    throw new Error("ReAct checkpoint cannot commit a stale task plan.");
  }
  const persistedPlan = { ...aggregate.plan, status };
  const previousSnapshot = await controlPlaneStore.getLatestSemanticSnapshot({
    projectId: taskBrief.projectId,
    taskId: taskBrief.taskId,
    intentEpoch: taskBrief.intentEpoch,
    maxPlanRevision: aggregate.plan.revision,
  });
  const observations = readAgentObservationsFromMetadata(state.currentMetadata);
  const semanticSnapshot = buildSemanticContextSnapshot({
    taskBrief,
    plan: persistedPlan,
    pendingDecision: state.activeDialogueCheckpoint ?? state.activeHumanGateDecision ??
      previousSnapshot?.snapshot.pendingDecision ?? null,
    trustedArtifactRefs: input.artifacts
      .filter((artifact) => isArtifactTrustedForDownstream(artifact) && isArtifactBoundToTask(artifact, taskBrief))
      .map((artifact) => ({
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
        taskId: taskBrief.taskId,
        taskBriefDigest: taskBrief.digest,
        intentEpoch: taskBrief.intentEpoch,
        bindingSource: artifact.taskBriefDigest
          ? "tool_execution" as const
          : artifact.origin === "teacher_input"
            ? "current_intent_teacher_input" as const
            : "current_intent_compatibility" as const,
      })),
    observationRefs: observations.map((observation) => ({
      observationId: observation.observationId,
      reasonCodes: observation.reasonCodes,
      intentEpoch: taskBrief.intentEpoch,
    })),
    recentMessages: [
      ...(previousSnapshot?.snapshot.recentMessages ?? []),
      { role: input.triggerMessage.role, content: input.triggerMessage.content },
    ],
  });
  await controlPlaneStore.commitRunCheckpoint({
    taskBrief,
    intentGrant: aggregate.intentGrant,
    plan: persistedPlan,
    checkpoint: structuredClone(event.checkpoint) as unknown as Record<string, unknown>,
    semanticSnapshot,
    event: {
      eventId: randomUUID(),
      projectId: taskBrief.projectId,
      taskId: taskBrief.taskId,
      runId: `turn:${input.triggerMessage.id}`,
      intentEpoch: taskBrief.intentEpoch,
      kind: "task_updated",
      visibility: "internal",
      occurredAt: new Date().toISOString(),
      payload: {
        checkpointDigest: event.checkpoint.checkpointDigest,
        toolRoundsUsed: event.toolRoundsUsed,
        observationIds: [...event.observationIds],
        status,
        ...("reason" in event ? { reasonCode: event.reason } : {}),
        ...("segmentIndex" in event ? { segmentIndex: event.segmentIndex } : {}),
        ...("pendingToolName" in event ? { pendingToolName: event.pendingToolName } : {}),
      },
    },
  });
}

async function persistMessageMetadata(context: MainAgentToolLoopContext) {
  await context.input.service.updateMessageMetadata(
    context.input.project.id,
    context.input.triggerMessage.id,
    context.state.currentMetadata,
  );
}
