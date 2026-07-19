import { answerDialogueCheckpoint, isDialogueCheckpoint, type DialogueCheckpoint } from "./dialogue-checkpoint";
import {
  commitPreAgentControlTurn,
  commitRejectedPendingDecisionTurn,
} from "./conversation-turn-control";
import { prepareConversationAgentTurn } from "./conversation-turn-agent-context";
import { createMainAgentProgressWriter } from "./conversation-turn-progress";
import { runAndPersistConversationAgentTurn } from "./conversation-turn-response";
import {
  findTaskBriefForIntent,
  resolveQueuedTaskBriefBinding,
} from "./conversation-turn-task-intake";
import type {
  ConversationTurnExecutionInput,
  LoadedConversationTurnState,
  MessageTurnResponse,
} from "./conversation-turn-types";
import {
  isPendingDecisionCancellation,
  isPendingDecisionConfirmation,
  resolveCurrentPendingDecision,
} from "./pending-decision-lifecycle";
import type { PendingDecision } from "./task-contract";
import { resolvePreAgentControl } from "./turn-intake-control";

export async function executeTeacherMessageTurn(
  originalInput: ConversationTurnExecutionInput,
): Promise<MessageTurnResponse> {
  let input = originalInput;
  while (true) {
    const state = await loadConversationTurnState(input);
    const early = await handleEarlyTurnControl(input, state);
    if (early.kind === "response") return early.response;
    if (early.kind === "replay") {
      input = { ...input, triggerMessage: early.triggerMessage };
      continue;
    }
    const prepared = await prepareConversationAgentTurn(input, state, early.answeredDialogueCheckpoint);
    if (prepared.kind === "control") return prepared.response;
    return runAndPersistConversationAgentTurn(input, prepared);
  }
}

async function loadConversationTurnState(
  input: ConversationTurnExecutionInput,
): Promise<LoadedConversationTurnState> {
  const submittedActionId = input.confirmedActionId?.trim() || undefined;
  const storedProject = await input.service.getProject(input.projectId);
  const project = input.generationIntensityOverride
    ? { ...storedProject, generationIntensity: input.generationIntensityOverride }
    : storedProject;
  const messages = await input.service.getMessages(input.projectId);
  const queuedTaskBrief = input.executionSource === "queued_message"
    ? await resolveQueuedTaskBriefBinding({
        message: input.triggerMessage,
        project,
        controlPlaneStore: input.controlPlaneStore,
      })
    : undefined;
  const progressTaskRef = { current: queuedTaskBrief };
  const onProgress = createMainAgentProgressWriter({
    projectId: input.projectId,
    teacherMessageId: input.triggerMessage.id,
    projectIntentEpoch: project.intentEpoch ?? 0,
    controlPlaneStore: input.controlPlaneStore,
    getTaskBrief: () => progressTaskRef.current,
  });
  const previousIntentEpoch = project.intentEpoch ?? 0;
  const previousTaskBrief = findTaskBriefForIntent(messages, project.id, previousIntentEpoch);
  const previousAggregate = previousTaskBrief
    ? await input.controlPlaneStore.getTaskAggregate(project.id, previousIntentEpoch)
    : null;
  const previousSnapshot = previousAggregate && previousTaskBrief
    ? await input.controlPlaneStore.getLatestSemanticSnapshot({
        projectId: project.id,
        taskId: previousTaskBrief.taskId,
        intentEpoch: previousIntentEpoch,
        maxPlanRevision: previousAggregate.plan.revision,
      })
    : null;
  const pendingDecision = resolveCurrentPendingDecision({
    value: previousSnapshot?.snapshot.pendingDecision,
    aggregateStatus: previousAggregate?.status,
    planId: previousAggregate?.plan.planId,
    projectId: project.id,
    intentEpoch: previousIntentEpoch,
    taskId: previousTaskBrief?.taskId,
    actorUserId: resolveConversationActorUserId(input),
  });
  return {
    project,
    messages,
    queuedTaskBrief,
    progressTaskRef,
    onProgress,
    previousIntentEpoch,
    previousTaskBrief,
    previousAggregate,
    previousSnapshot,
    pendingDecision,
    confirmedActionId: boundConfirmedActionId(input.teacherContent, submittedActionId, pendingDecision),
    submittedActionId,
  };
}

type EarlyTurnResult =
  | { kind: "response"; response: MessageTurnResponse }
  | { kind: "replay"; triggerMessage: ConversationTurnExecutionInput["triggerMessage"] }
  | { kind: "continue"; answeredDialogueCheckpoint?: DialogueCheckpoint };

async function handleEarlyTurnControl(
  input: ConversationTurnExecutionInput,
  state: LoadedConversationTurnState,
): Promise<EarlyTurnResult> {
  if (state.submittedActionId && state.pendingDecision?.actionId !== state.submittedActionId) {
    return {
      kind: "response",
      response: await commitRejectedPendingDecisionTurn({
        service: input.service,
        projectId: input.projectId,
        triggerMessage: input.triggerMessage,
        pendingDecision: state.pendingDecision,
      }),
    };
  }
  const matchesSubmittedDecision = state.submittedActionId &&
    state.pendingDecision?.actionId === state.submittedActionId;
  if (matchesSubmittedDecision && isPendingDecisionCancellation(input.teacherContent)) {
    return {
      kind: "response",
      response: await commitPreAgentControlTurn(controlInput(input, state, {
        kind: "cancel",
        reasonCode: "teacher_requested_cancel",
        advanceIntentEpoch: true,
        userMessage: input.teacherContent,
      })),
    };
  }
  if (matchesSubmittedDecision && !state.confirmedActionId) {
    return {
      kind: "response",
      response: await commitPreAgentControlTurn(controlInput(input, state, {
        kind: "redirect",
        reasonCode: "teacher_requested_redirect",
        advanceIntentEpoch: true,
        userMessage: input.teacherContent,
      })),
    };
  }
  const preAgentControl = state.queuedTaskBrief ? undefined : resolvePreAgentControl(input.teacherContent, {
    hasActiveTask: Boolean(state.previousTaskBrief),
    hasPendingPlan: Boolean(state.pendingDecision),
    allowRedirect: "imperative",
  });
  if (preAgentControl) {
    const response = await commitPreAgentControlTurn(controlInput(input, state, preAgentControl));
    return preAgentControl.kind === "redirect"
      ? { kind: "replay", triggerMessage: response.message }
      : { kind: "response", response };
  }
  const pendingDialogue = state.previousSnapshot?.snapshot.pendingDecision;
  const answeredDialogueCheckpoint = state.previousTaskBrief && state.previousAggregate?.status === "paused_recovery" &&
    isDialogueCheckpoint(pendingDialogue) && pendingDialogue.status === "pending"
    ? answerDialogueCheckpoint(pendingDialogue, {
        responseMessageId: input.triggerMessage.id,
        responseText: input.teacherContent,
      })
    : undefined;
  return { kind: "continue", answeredDialogueCheckpoint };
}

function controlInput(
  input: ConversationTurnExecutionInput,
  state: LoadedConversationTurnState,
  control: Parameters<typeof commitPreAgentControlTurn>[0]["control"],
): Parameters<typeof commitPreAgentControlTurn>[0] {
  return {
    service: input.service,
    project: state.project,
    messages: state.messages,
    pendingDecision: state.pendingDecision,
    previousSnapshot: state.previousSnapshot?.snapshot,
    triggerMessage: input.triggerMessage,
    control,
    previousTaskBrief: state.previousTaskBrief,
    controlPlaneStore: input.controlPlaneStore,
  };
}

function resolveConversationActorUserId(input: ConversationTurnExecutionInput) {
  return input.executionIdentity?.actorUserId ?? input.service.getExecutionIdentity()?.actorUserId ??
    `local-project:${input.projectId}`;
}

function boundConfirmedActionId(
  teacherContent: string,
  confirmedActionId: string | undefined,
  decision: PendingDecision | undefined,
) {
  const actionId = confirmedActionId?.trim();
  if (!actionId) return undefined;
  return decision?.actionId === actionId && isPendingDecisionConfirmation(teacherContent) ? actionId : undefined;
}
