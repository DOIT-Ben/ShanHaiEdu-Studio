import { collectPersistentTeacherMessageParts } from "@/lib/teacher-agent-events";
import { hashRunInput } from "@/server/execution/run-input-snapshot";
import { runWithProviderCallTraceBinding } from "@/server/provider-ledger/provider-call-trace";

import type { PreparedConversationAgentTurn } from "./conversation-turn-agent-context";
import type { ConversationTurnExecutionInput, MessageTurnResponse } from "./conversation-turn-types";
import { isDialogueCheckpoint } from "./dialogue-checkpoint";
import { appendPendingDecisionPrompt } from "./pending-decision-lifecycle";
import {
  appendAgentObservationMetadata,
  createAgentObservation,
} from "./react-control";
import { isPendingDecision } from "./task-contract";

export async function runAndPersistConversationAgentTurn(
  input: ConversationTurnExecutionInput,
  prepared: PreparedConversationAgentTurn,
): Promise<MessageTurnResponse> {
  const agentTurn = prepared.precomputedTurn ?? await runWithProviderCallTraceBinding({
    projectId: prepared.project.id,
    taskId: prepared.taskBrief?.taskId,
    teacherMessageId: prepared.triggerMessage.id,
    turnJobId: prepared.turnJobId,
    intentEpoch: prepared.taskBrief?.intentEpoch ?? prepared.project.intentEpoch ?? 0,
    phase: "initial",
  }, async () => await input.agent.respond({
    userMessage: input.teacherContent,
    responseStyle: prepared.triggerMessage.metadata.responseStyle === "concise" ? "concise" : "pragmatic",
    generationIntensity: prepared.project.generationIntensity,
    taskBrief: prepared.taskBrief,
    intentGrant: prepared.intentGrant,
    availableArtifactKinds: prepared.availableArtifactKinds,
    projectContext: prepared.projectContext,
    conversationContext: prepared.conversationContext,
    agentToolLoop: prepared.agentToolLoop,
    onProgress: prepared.onProgress,
  }));

  let triggerMessage = prepared.triggerMessage;
  if (prepared.agentToolLoop) {
    triggerMessage = (await input.service.getMessages(input.projectId))
      .find((message) => message.id === triggerMessage.id) ?? triggerMessage;
    if (prepared.taskBrief) {
      await input.controlPlaneStore.getTaskAggregate(input.projectId, prepared.taskBrief.intentEpoch);
    }
  }
  const failure = await persistRuntimeFailure(input, prepared, triggerMessage, agentTurn);
  triggerMessage = failure.triggerMessage;
  const persistentTimeline = collectPersistentTeacherMessageParts(
    await input.controlPlaneStore.listEvents(input.projectId),
    `turn:${triggerMessage.id}`,
  );
  const persistedPendingDecision = isPendingDecision(triggerMessage.metadata.pendingDecision)
    ? triggerMessage.metadata.pendingDecision
    : undefined;
  const assistantMetadata = mergeMessageMetadata(
    failure.runtimeFailureMetadata,
    persistedPendingDecision ? { pendingDecision: persistedPendingDecision } : undefined,
    persistentTimeline.length ? { agentTimeline: persistentTimeline } : undefined,
    isDialogueCheckpoint(triggerMessage.metadata.dialogueCheckpoint)
      ? { dialogueCheckpoint: triggerMessage.metadata.dialogueCheckpoint }
      : undefined,
  );
  const assistantMessage = await input.service.addMessage(input.projectId, {
    role: "assistant",
    content: appendPendingDecisionPrompt(formatAssistantContent(agentTurn.assistantMessage), persistedPendingDecision),
    metadata: assistantMetadata,
  });
  return { message: triggerMessage, assistantMessage, agentTurn };
}

async function persistRuntimeFailure(
  input: ConversationTurnExecutionInput,
  prepared: PreparedConversationAgentTurn,
  triggerMessage: PreparedConversationAgentTurn["triggerMessage"],
  agentTurn: Awaited<ReturnType<ConversationTurnExecutionInput["agent"]["respond"]>>,
) {
  if (!agentTurn.failure) return { triggerMessage, runtimeFailureMetadata: undefined };
  const failureObservation = createAgentObservation({
    projectId: input.projectId,
    source: "tool",
    status: "failed",
    actionKey: `main_agent_runtime:${triggerMessage.id}`,
    inputHash: hashRunInput({
      taskId: prepared.taskBrief?.taskId ?? null,
      taskBriefDigest: prepared.taskBrief?.digest ?? null,
      intentEpoch: prepared.project.intentEpoch ?? 0,
      sourceMessageId: triggerMessage.id,
    }),
    reasonCodes: [agentTurn.failure.reasonCode],
    reportRefs: [],
    targetLocators: [],
    responsibleStage: "main_agent_runtime",
    minimalNextAction: "pause",
    teacherSafeSummary: agentTurn.failure.summary,
  });
  const runtimeFailureMetadata = appendAgentObservationMetadata({
    ...triggerMessage.metadata,
    mainAgentFailure: agentTurn.failure,
    recovery: {
      errorId: failureObservation.observationId,
      reasonCode: agentTurn.failure.reasonCode,
      summary: agentTurn.failure.summary,
      kind: "retry",
      label: "服务恢复后继续当前任务",
    },
  }, failureObservation);
  const updatedTrigger = await input.service.updateMessageMetadata(input.projectId, triggerMessage.id, {
    ...triggerMessage.metadata,
    ...runtimeFailureMetadata,
  });
  if (prepared.taskBrief && prepared.intentGrant) {
    await input.controlPlaneStore.commitRunFailure({
      taskBrief: prepared.taskBrief,
      intentGrant: prepared.intentGrant,
      observation: {
        observationId: failureObservation.observationId,
        status: failureObservation.status,
        reasonCodes: failureObservation.reasonCodes,
        payload: structuredClone(failureObservation) as unknown as Record<string, unknown>,
      },
      event: {
        eventId: crypto.randomUUID(),
        projectId: input.projectId,
        taskId: prepared.taskBrief.taskId,
        runId: `turn:${updatedTrigger.id}`,
        intentEpoch: prepared.taskBrief.intentEpoch,
        kind: "run_failed",
        visibility: "internal",
        occurredAt: new Date().toISOString(),
        payload: {
          reasonCode: agentTurn.failure.reasonCode,
          retryability: agentTurn.failure.retryability,
          category: agentTurn.failure.category,
          observationId: failureObservation.observationId,
          taskBriefDigest: prepared.taskBrief.digest,
        },
      },
    });
  }
  return { triggerMessage: updatedTrigger, runtimeFailureMetadata };
}

function formatAssistantContent(message: { title?: string; body: string }) {
  return message.title ? `${message.title}\n\n${message.body}` : message.body;
}

function mergeMessageMetadata(
  ...metadataItems: Array<Record<string, unknown> | undefined>
): Record<string, unknown> | undefined {
  const merged = metadataItems.reduce<Record<string, unknown>>((result, metadata) =>
    metadata ? { ...result, ...metadata } : result, {});
  return Object.keys(merged).length > 0 ? merged : undefined;
}
