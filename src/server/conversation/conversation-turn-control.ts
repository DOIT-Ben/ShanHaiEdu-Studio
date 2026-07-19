import type { MainAgentTurn } from "@/server/capabilities/types";
import { hashRunInput } from "@/server/execution/run-input-snapshot";
import { analyzePptRevisionImpact } from "@/server/ppt-quality/ppt-impact-analysis";
import type { PptDesignPackage } from "@/server/ppt-quality/ppt-quality-types";
import type { ArtifactRecord, ConversationMessageRecord, ProjectRecord } from "@/server/workbench/types";

import {
  appendAgentObservationMetadata,
  appendRunCheckpointMetadata,
  clearRunCheckpointMetadata,
  createAgentObservation,
  createRunCheckpoint,
} from "./react-control";
import type { SemanticContextSnapshot } from "./context-semantic-snapshot";
import { persistPendingDecisionStatus } from "./pending-decision-lifecycle";
import {
  createStandardIntentGrant,
  ensureStandardTaskBudgetDisclosure,
  resolveActiveIntentGrant,
} from "./conversation-turn-task-intake";
import type { ControlPlaneStore, MessageTurnResponse, WorkbenchService } from "./conversation-turn-types";
import type { PendingDecision, TaskBrief } from "./task-contract";
import { createTaskBriefFromProposal } from "./task-intake";
import type { PreAgentControlDecision } from "./turn-intake-control";

export async function commitRejectedPendingDecisionTurn(input: {
  service: WorkbenchService;
  projectId: string;
  triggerMessage: ConversationMessageRecord;
  pendingDecision?: PendingDecision;
}): Promise<MessageTurnResponse> {
  const content = "这个确认已失效或不属于当前任务。我没有执行任何操作；请使用当前确认选项，或直接说明新的要求。";
  const triggerMessage = await input.service.updateMessageMetadata(input.projectId, input.triggerMessage.id, {
    ...input.triggerMessage.metadata,
    pendingDecisionRejection: { reasonCode: "pending_decision_action_mismatch", persistedBeforeAgent: true },
  });
  const assistantMessage = await input.service.addMessage(input.projectId, {
    role: "assistant",
    content,
    metadata: input.pendingDecision ? { pendingDecision: input.pendingDecision } : undefined,
  });
  return {
    message: triggerMessage,
    assistantMessage,
    agentTurn: {
      assistantMessage: { body: content },
      state: input.pendingDecision ? "awaiting_confirmation" : "chatting",
      quickReplies: [],
      recommendedOptions: [],
      runtimeKind: "openai",
    },
  };
}

export type PreAgentControlTurnInput = {
  service: WorkbenchService;
  project: ProjectRecord;
  messages: ConversationMessageRecord[];
  pendingDecision?: PendingDecision;
  previousSnapshot?: SemanticContextSnapshot;
  triggerMessage: ConversationMessageRecord;
  control: PreAgentControlDecision;
  replacementProposal?: Parameters<typeof createTaskBriefFromProposal>[0]["proposal"];
  previousTaskBrief?: TaskBrief;
  controlPlaneStore: ControlPlaneStore;
};

export async function commitPreAgentControlTurn(input: PreAgentControlTurnInput): Promise<MessageTurnResponse> {
  const mutation = await prepareControlMutation(input);
  let triggerMessage = await input.service.updateMessageMetadata(
    input.project.id,
    input.triggerMessage.id,
    mutation.metadata,
  );
  await persistPreviousTaskControl(input, mutation, triggerMessage);
  triggerMessage = await persistReplacementTask(input, mutation, triggerMessage);
  return createControlResponse(input, mutation.controlReasonCode, triggerMessage);
}

async function prepareControlMutation(input: PreAgentControlTurnInput) {
  const previousIntentEpoch = input.project.intentEpoch ?? 0;
  const pendingStatus = input.control.kind === "pause"
    ? "paused"
    : input.control.kind === "cancel" ? "canceled" : "superseded";
  const aggregateStatus = input.control.kind === "pause" ? "paused_recovery" : pendingStatus;
  const nextIntentEpoch = input.control.advanceIntentEpoch
    ? await input.service.advanceProjectIntentEpoch(input.project.id, previousIntentEpoch)
    : previousIntentEpoch;
  const controlArtifacts = input.control.kind === "redirect"
    ? await input.service.getArtifacts(input.project.id)
    : [];
  const domainImpact = input.control.kind === "redirect"
    ? resolveDomainRevisionImpact(input.control.userMessage, controlArtifacts)
    : null;
  const impactScope = input.control.kind === "redirect"
    ? domainImpact?.nextAction === "repair_unit" ? "unit" : "upstream"
    : "task";
  const controlReasonCode = input.control.kind === "redirect" && !input.pendingDecision
    ? "teacher_redirected_without_pending_decision"
    : input.control.reasonCode;
  const observation = createAgentObservation({
    projectId: input.project.id,
    source: "teacher_revision",
    status: input.control.kind === "redirect" ? "repair" : "needs_input",
    actionKey: `${input.control.kind}:${input.previousTaskBrief?.taskId ?? "active-task"}`,
    inputHash: hashRunInput({
      control: input.control.kind,
      previousIntentEpoch,
      nextIntentEpoch,
      userMessage: input.control.userMessage,
    }),
    reasonCodes: [controlReasonCode],
    reportRefs: [],
    targetLocators: [],
    responsibleStage: "turn_intake_control",
    minimalNextAction: input.control.kind === "redirect" ? "repair_upstream" : "pause",
    teacherSafeSummary: controlAcknowledgement(input.control.kind),
  });
  const retainedTaskBrief = input.control.kind === "redirect" ? undefined : input.previousTaskBrief;
  const retainedIntentGrant = retainedTaskBrief
    ? ensureStandardTaskBudgetDisclosure(
        resolveActiveIntentGrant(input.messages, retainedTaskBrief) ?? createStandardIntentGrant(retainedTaskBrief),
        retainedTaskBrief,
      )
    : undefined;
  let metadata: Record<string, unknown> = appendAgentObservationMetadata({
    ...input.triggerMessage.metadata,
    ...(retainedTaskBrief ? { taskBrief: retainedTaskBrief } : {}),
    ...(retainedIntentGrant ? { intentGrant: retainedIntentGrant } : {}),
    conversationControlImpact: {
      decisionKind: input.control.kind,
      reasonCode: controlReasonCode,
      previousIntentEpoch,
      nextIntentEpoch,
      persistedBeforeAgent: true,
      impactScope,
      preservedArtifacts: true,
      supersededDecisionIds: input.pendingDecision ? [input.pendingDecision.decisionId] : [],
      domainImpact,
    },
  }, observation);
  metadata = input.control.kind === "pause"
    ? appendRunCheckpointMetadata(metadata, createRunCheckpoint({
        projectId: input.project.id,
        planVersion: nextIntentEpoch,
        reason: "teacher_requested_pause",
        actionKey: observation.actionKey,
        inputHash: observation.inputHash,
        observationRefs: [observation.observationId],
      }))
    : clearRunCheckpointMetadata(metadata);
  return {
    previousIntentEpoch,
    nextIntentEpoch,
    aggregateStatus,
    controlReasonCode,
    observation,
    metadata,
  };
}

async function persistPreviousTaskControl(
  input: PreAgentControlTurnInput,
  mutation: Awaited<ReturnType<typeof prepareControlMutation>>,
  triggerMessage: ConversationMessageRecord,
) {
  if (!input.previousTaskBrief) return;
  const previousIntentGrant = ensureStandardTaskBudgetDisclosure(
    resolveActiveIntentGrant(input.messages, input.previousTaskBrief) ??
      createStandardIntentGrant(input.previousTaskBrief),
    input.previousTaskBrief,
  );
  const previousAggregate = await input.controlPlaneStore.getTaskAggregate(
    input.project.id,
    mutation.previousIntentEpoch,
  );
  const checkpoint = input.control.kind === "pause" && mutation.metadata.agentRunCheckpoint &&
    typeof mutation.metadata.agentRunCheckpoint === "object"
    ? mutation.metadata.agentRunCheckpoint as Record<string, unknown>
    : previousAggregate?.checkpoint ?? null;
  const updatedAggregate = await input.controlPlaneStore.upsertTaskAggregate({
    taskBrief: input.previousTaskBrief,
    intentGrant: previousIntentGrant,
    plan: previousAggregate ? { ...previousAggregate.plan, status: mutation.aggregateStatus } : {
      planId: input.pendingDecision?.planId ?? `plan:${input.previousTaskBrief.taskId}`,
      revision: 0,
      status: mutation.aggregateStatus,
    },
    status: mutation.aggregateStatus,
    checkpoint,
  });
  await input.controlPlaneStore.appendEvent({
    eventId: crypto.randomUUID(),
    projectId: input.project.id,
    taskId: input.previousTaskBrief.taskId,
    runId: `turn:${input.triggerMessage.id}`,
    intentEpoch: mutation.previousIntentEpoch,
    kind: "task_updated",
    visibility: "internal",
    occurredAt: new Date().toISOString(),
    payload: { control: input.control.kind, observationId: mutation.observation.observationId },
  });
  if (input.pendingDecision && input.control.kind !== "pause") {
    await persistPendingDecisionStatus({
      service: input.service,
      controlPlaneStore: input.controlPlaneStore,
      projectId: input.project.id,
      triggerMessage,
      taskBrief: input.previousTaskBrief,
      aggregate: updatedAggregate,
      previousSnapshot: input.previousSnapshot,
      decision: input.pendingDecision,
      status: input.control.kind === "cancel" ? "canceled" : "superseded",
    });
  }
}

async function persistReplacementTask(
  input: PreAgentControlTurnInput,
  mutation: Awaited<ReturnType<typeof prepareControlMutation>>,
  triggerMessage: ConversationMessageRecord,
) {
  if (input.control.kind !== "redirect" || !input.replacementProposal) return triggerMessage;
  const projectConstraints = [input.project.grade, input.project.subject, input.project.lessonTopic]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim());
  const nextTaskBrief = createTaskBriefFromProposal({
    proposal: {
      ...input.replacementProposal,
      goal: input.control.userMessage.trim(),
      constraints: [...new Set([...input.replacementProposal.constraints, ...projectConstraints])],
    },
    taskId: `task:${input.triggerMessage.id}`,
    projectId: input.project.id,
    intentEpoch: mutation.nextIntentEpoch,
    generationIntensity: input.project.generationIntensity ?? "standard",
    sourceMessageId: input.triggerMessage.id,
    context: {
      grade: input.project.grade,
      subject: input.project.subject,
      textbookVersion: input.project.textbookVersion,
      lessonTopic: input.project.lessonTopic,
    },
  });
  const nextIntentGrant = createStandardIntentGrant(nextTaskBrief);
  const updatedMessage = await input.service.updateMessageMetadata(input.project.id, input.triggerMessage.id, {
    ...triggerMessage.metadata,
    taskBrief: nextTaskBrief,
    intentGrant: nextIntentGrant,
  });
  await input.controlPlaneStore.upsertTaskAggregate({
    taskBrief: nextTaskBrief,
    intentGrant: nextIntentGrant,
    plan: { planId: `plan:${nextTaskBrief.taskId}`, revision: 0, status: "active" },
    status: "active",
    checkpoint: null,
  });
  await input.controlPlaneStore.appendEvent({
    eventId: crypto.randomUUID(),
    projectId: input.project.id,
    taskId: nextTaskBrief.taskId,
    runId: `turn:${input.triggerMessage.id}`,
    intentEpoch: mutation.nextIntentEpoch,
    kind: "task_created",
    visibility: "internal",
    occurredAt: new Date().toISOString(),
    payload: {
      control: input.control.kind,
      controlObservationId: mutation.observation.observationId,
      taskBriefDigest: nextTaskBrief.digest,
    },
  });
  return updatedMessage;
}

async function createControlResponse(
  input: PreAgentControlTurnInput,
  controlReasonCode: string,
  triggerMessage: ConversationMessageRecord,
): Promise<MessageTurnResponse> {
  const content = controlAcknowledgement(input.control.kind);
  const assistantMessage = await input.service.addMessage(input.project.id, {
    role: "assistant",
    content,
    metadata: {
      conversationControlDecision: {
        kind: input.control.kind,
        reasonCode: controlReasonCode,
        persistedBeforeAgent: true,
      },
    },
  });
  const agentTurn: MainAgentTurn = {
    assistantMessage: { body: content },
    state: input.control.kind === "redirect" ? "collecting_inputs" : "chatting",
    quickReplies: [],
    recommendedOptions: [],
    runtimeKind: "openai",
  };
  return { message: triggerMessage, assistantMessage, agentTurn };
}

function controlAcknowledgement(kind: PreAgentControlDecision["kind"]) {
  if (kind === "pause") return "已暂停当前任务，并保存了恢复位置。";
  if (kind === "cancel") return "已取消当前任务，旧结果不会继续提升。";
  return "已保存新的任务方向，旧计划不会继续执行。";
}

function resolveDomainRevisionImpact(teacherMessage: string, artifacts: ArtifactRecord[]) {
  const pageMatch = teacherMessage.match(/第\s*(\d{1,3})\s*页/);
  if (!pageMatch) return null;
  const pageId = `page_${pageMatch[1].padStart(2, "0")}`;
  const designArtifact = [...artifacts].reverse().find((artifact) => artifact.kind === "ppt_design_draft");
  const packageValue = designArtifact?.structuredContent.pptDesignPackage;
  if (!isPptDesignPackageShape(packageValue)) {
    return {
      nextAction: "pause" as const,
      requestedPageIds: [pageId],
      reasonCodes: ["ppt_design_package_missing_for_exact_impact"],
    };
  }
  try {
    return analyzePptRevisionImpact(packageValue, { kind: "page_text_layout", pageId });
  } catch {
    return {
      nextAction: "pause" as const,
      requestedPageIds: [pageId],
      reasonCodes: ["ppt_page_locator_not_found"],
    };
  }
}

function isPptDesignPackageShape(value: unknown): value is PptDesignPackage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.pageSpecs) && Array.isArray(record.objectives) &&
    Array.isArray(record.evidenceBindings) && Boolean(record.samplePlan) &&
    typeof record.samplePlan === "object";
}
