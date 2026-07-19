import { randomUUID } from "node:crypto";

import type { MainAgentControlToolDefinition } from "@/server/tools/main-agent-tool-registry";

import {
  createDialogueCheckpoint,
  isDialogueCheckpoint,
  type DialogueCheckpoint,
  type DialogueCheckpointOption,
} from "./dialogue-checkpoint";
import type { MainAgentReActDispatchResult } from "./main-agent-controlled-react-loop";
import type { MainAgentToolLoopCall, MainAgentToolLoopContext } from "./main-agent-tool-loop-types";
import {
  compactContinuationObservation,
  observationForContinuation,
  toolInvocationReplayResult,
} from "./main-agent-tool-loop-observations";
import { appendAgentObservationMetadata, createAgentObservation } from "./react-control";
import type { ExecutionEnvelope } from "./task-contract";

export async function dispatchDialogueCheckpoint(input: {
  context: MainAgentToolLoopContext;
  definition: MainAgentControlToolDefinition;
  call: MainAgentToolLoopCall;
  executionEnvelope: ExecutionEnvelope | undefined;
}): Promise<MainAgentReActDispatchResult> {
  const { context, definition, call, executionEnvelope } = input;
  const { input: loopInput, state, controlPlaneStore } = context;
  if (!executionEnvelope || !loopInput.taskBrief) {
    return {
      status: "blocked",
      observation: compactContinuationObservation(
        "blocked",
        ["dialogue_checkpoint_task_required"],
        { nextAction: "replan" },
      ),
    };
  }
  let invocationId: string = randomUUID();
  const claim = await controlPlaneStore.startToolInvocation({
    invocationId,
    envelope: executionEnvelope,
    toolName: definition.id,
    request: structuredClone(call.arguments),
  });
  if (claim.kind === "terminal_replay") {
    const replayCheckpoint = claim.observation.payload.dialogueCheckpoint;
    if (isDialogueCheckpoint(replayCheckpoint)) state.activeDialogueCheckpoint = replayCheckpoint;
    return {
      status: "blocked",
      pauseKind: "dialogue_checkpoint",
      observation: compactContinuationObservation("needs_input", claim.observation.reasonCodes, {
        observationId: claim.observation.observationId,
        nextAction: "ask_teacher",
        summary: state.activeDialogueCheckpoint?.question ?? "需要教师判断当前理解边界。",
      }),
    };
  }
  if (claim.kind === "in_progress") return toolInvocationReplayResult(claim);
  invocationId = claim.invocation.invocationId;
  let dialogueCheckpoint: DialogueCheckpoint;
  try {
    dialogueCheckpoint = dialogueCheckpointFromArguments({
      argumentsValue: call.arguments,
      projectId: loopInput.project.id,
      taskId: loopInput.taskBrief.taskId,
      intentEpoch: loopInput.taskBrief.intentEpoch,
      planRevision: state.currentPlanRevision + 1,
      sourceMessageId: loopInput.triggerMessage.id,
    });
  } catch {
    return commitInvalidDialogueCheckpoint(context, definition, executionEnvelope, invocationId);
  }
  return commitDialogueCheckpoint(context, definition, executionEnvelope, invocationId, dialogueCheckpoint);
}

async function commitInvalidDialogueCheckpoint(
  context: MainAgentToolLoopContext,
  definition: MainAgentControlToolDefinition,
  executionEnvelope: ExecutionEnvelope,
  invocationId: string,
): Promise<MainAgentReActDispatchResult> {
  const { input, state, controlPlaneStore } = context;
  const observation = createAgentObservation({
    projectId: input.project.id,
    source: "validation",
    status: "failed",
    actionKey: definition.id,
    inputHash: executionEnvelope.idempotencyKey,
    reasonCodes: ["dialogue_checkpoint_input_invalid"],
    reportRefs: [],
    targetLocators: [],
    responsibleStage: "main_agent_control_loop",
    minimalNextAction: "repair_upstream",
    teacherSafeSummary: "当前需要确认的问题还不完整，正在重新组织。",
  });
  await controlPlaneStore.commitToolFailure({
    invocationId,
    observation: observationRecord(observation),
    event: {
      eventId: randomUUID(),
      projectId: input.project.id,
      taskId: input.taskBrief!.taskId,
      runId: `turn:${input.triggerMessage.id}`,
      intentEpoch: input.taskBrief!.intentEpoch,
      kind: "tool_observed",
      visibility: "internal",
      occurredAt: new Date().toISOString(),
      payload: { observationId: observation.observationId, status: observation.status },
    },
  });
  state.currentPlanRevision += 1;
  state.currentMetadata = appendAgentObservationMetadata(state.currentMetadata, observation);
  await persistMessageMetadata(context);
  return { status: "failed", observation: observationForContinuation(observation, { nextAction: "replan" }) };
}

async function commitDialogueCheckpoint(
  context: MainAgentToolLoopContext,
  definition: MainAgentControlToolDefinition,
  executionEnvelope: ExecutionEnvelope,
  invocationId: string,
  dialogueCheckpoint: DialogueCheckpoint,
): Promise<MainAgentReActDispatchResult> {
  const { input, state, controlPlaneStore } = context;
  const observation = createAgentObservation({
    projectId: input.project.id,
    source: "tool",
    status: "needs_input",
    actionKey: definition.id,
    inputHash: executionEnvelope.idempotencyKey,
    reasonCodes: ["dialogue_checkpoint_requested"],
    reportRefs: [],
    targetLocators: [],
    responsibleStage: "main_agent_control_loop",
    minimalNextAction: "ask_teacher",
    teacherSafeSummary: dialogueCheckpoint.question,
  });
  await controlPlaneStore.commitToolObservation({
    invocationId,
    observation: {
      ...observationRecord(observation),
      payload: { ...structuredClone(observation), dialogueCheckpoint: structuredClone(dialogueCheckpoint) },
    },
    event: {
      eventId: randomUUID(),
      projectId: input.project.id,
      taskId: input.taskBrief!.taskId,
      runId: `turn:${input.triggerMessage.id}`,
      intentEpoch: input.taskBrief!.intentEpoch,
      kind: "decision_pending",
      visibility: "teacher",
      occurredAt: new Date().toISOString(),
      payload: {
        activityId: dialogueCheckpoint.checkpointId,
        label: "需要你判断一个会影响结果的方向",
        status: "needs_input",
        observationId: observation.observationId,
        dialogueCheckpoint: structuredClone(dialogueCheckpoint),
      },
    },
  });
  state.currentPlanRevision += 1;
  state.activeDialogueCheckpoint = dialogueCheckpoint;
  state.currentMetadata = appendAgentObservationMetadata(
    { ...state.currentMetadata, dialogueCheckpoint: structuredClone(dialogueCheckpoint) },
    observation,
  );
  await persistMessageMetadata(context);
  return {
    status: "blocked",
    pauseKind: "dialogue_checkpoint",
    observation: observationForContinuation(observation, {
      nextAction: "ask_teacher",
      summary: dialogueCheckpoint.question,
    }),
  };
}

function dialogueCheckpointFromArguments(input: {
  argumentsValue: Record<string, unknown>;
  projectId: string;
  taskId: string;
  intentEpoch: number;
  planRevision: number;
  sourceMessageId: string;
}) {
  const options = Array.isArray(input.argumentsValue.options)
    ? input.argumentsValue.options.flatMap((value): DialogueCheckpointOption[] => {
        if (!isRecord(value) || typeof value.id !== "string" || typeof value.label !== "string" ||
            typeof value.description !== "string" || typeof value.recommended !== "boolean") return [];
        return [{ id: value.id, label: value.label, description: value.description, recommended: value.recommended }];
      })
    : [];
  return createDialogueCheckpoint({
    projectId: input.projectId,
    taskId: input.taskId,
    intentEpoch: input.intentEpoch,
    planRevision: input.planRevision,
    sourceMessageId: input.sourceMessageId,
    question: typeof input.argumentsValue.question === "string" ? input.argumentsValue.question : "",
    understandingSummary: typeof input.argumentsValue.understandingSummary === "string"
      ? input.argumentsValue.understandingSummary
      : "",
    impactSummary: typeof input.argumentsValue.impactSummary === "string" ? input.argumentsValue.impactSummary : "",
    options,
    allowFreeText: input.argumentsValue.allowFreeText === true,
  });
}

function observationRecord(observation: ReturnType<typeof createAgentObservation>) {
  return {
    observationId: observation.observationId,
    status: observation.status,
    reasonCodes: observation.reasonCodes,
    payload: structuredClone(observation) as unknown as Record<string, unknown>,
  };
}

async function persistMessageMetadata(context: MainAgentToolLoopContext) {
  await context.input.service.updateMessageMetadata(
    context.input.project.id,
    context.input.triggerMessage.id,
    context.state.currentMetadata,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
