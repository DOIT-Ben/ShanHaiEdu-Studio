import { randomUUID } from "node:crypto";

import type { createWorkbenchService } from "@/server/workbench/service";
import type { ConversationMessageRecord } from "@/server/workbench/types";

import type { PersistedTaskAggregate, createControlPlaneStore } from "./control-plane-store";
import { buildSemanticContextSnapshot, type SemanticContextSnapshot } from "./context-semantic-snapshot";
import {
  isPendingDecision,
  withPendingDecisionStatus,
  type PendingDecision,
  type PendingDecisionStatus,
  type TaskBrief,
} from "./task-contract";

type WorkbenchService = ReturnType<typeof createWorkbenchService>;
type ControlPlaneStore = ReturnType<typeof createControlPlaneStore>;

export function resolveCurrentPendingDecision(input: {
  value: unknown;
  aggregateStatus?: string;
  planId?: string;
  projectId: string;
  intentEpoch: number;
  taskId?: string;
  actorUserId: string;
  now?: string;
}): PendingDecision | undefined {
  if (!isPendingDecision(input.value) || input.value.status !== "pending") return undefined;
  if (input.aggregateStatus !== "paused_recovery") return undefined;
  if (!input.taskId || input.value.taskId !== input.taskId) return undefined;
  if (input.value.projectId !== input.projectId || input.value.intentEpoch !== input.intentEpoch) return undefined;
  if (input.value.actorUserId !== input.actorUserId || input.value.planId !== input.planId) return undefined;
  if (input.value.expiresAt) {
    const expiresAt = Date.parse(input.value.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.parse(input.now ?? new Date().toISOString())) return undefined;
  }
  return structuredClone(input.value);
}

export function isPendingDecisionConfirmation(text: string): boolean {
  const normalized = normalizeDecisionReply(text);
  return /^(?:确认继续|确认开始|确认执行|确认生成|确认并开始|同意继续|同意执行|确定|开始|继续)$/.test(normalized)
    || /^(?:确认|同意).*(?:授权|预算|升级|生成|执行|继续)$/.test(normalized);
}

export function isPendingDecisionCancellation(text: string): boolean {
  const normalized = normalizeDecisionReply(text);
  return /^(?:暂不继续|先不继续|取消|拒绝|算了|不做了|停止|终止)$/.test(normalized);
}

export function appendPendingDecisionPrompt(content: string, decision?: PendingDecision): string {
  if (!decision || decision.status !== "pending") return content;
  const prompt = [decision.question, decision.impactSummary].filter(Boolean).join("\n");
  if (!prompt || content.includes(decision.question)) return content;
  return `${content.trim()}\n\n${prompt}`.trim();
}

export async function persistPendingDecisionStatus(input: {
  service: WorkbenchService;
  controlPlaneStore: ControlPlaneStore;
  projectId: string;
  triggerMessage: ConversationMessageRecord;
  taskBrief: TaskBrief;
  aggregate: PersistedTaskAggregate;
  previousSnapshot?: SemanticContextSnapshot;
  decision: PendingDecision;
  status: Exclude<PendingDecisionStatus, "pending">;
}): Promise<number> {
  assertDecisionScope(input);
  const updatedDecision = withPendingDecisionStatus(input.decision, input.status);
  const messages = await input.service.getMessages(input.projectId);
  let triggerUpdated = false;

  for (const message of messages) {
    const existing = message.metadata.pendingDecision;
    if (!isPendingDecision(existing) || existing.decisionId !== input.decision.decisionId ||
        existing.actionId !== input.decision.actionId) continue;
    await input.service.updateMessageMetadata(input.projectId, message.id, {
      ...message.metadata,
      pendingDecision: updatedDecision,
    });
    triggerUpdated ||= message.id === input.triggerMessage.id;
  }

  if (!triggerUpdated) {
    await input.service.updateMessageMetadata(input.projectId, input.triggerMessage.id, {
      ...input.triggerMessage.metadata,
      pendingDecision: updatedDecision,
    });
  }

  const event = await input.controlPlaneStore.appendEvent({
    eventId: randomUUID(),
    projectId: input.projectId,
    taskId: input.taskBrief.taskId,
    runId: `turn:${input.triggerMessage.id}`,
    intentEpoch: input.taskBrief.intentEpoch,
    kind: "task_updated",
    visibility: "internal",
    occurredAt: new Date().toISOString(),
    payload: {
      decisionId: input.decision.decisionId,
      actionId: input.decision.actionId,
      decisionStatus: input.status,
    },
  });
  const previous = input.previousSnapshot;
  await input.controlPlaneStore.saveSemanticSnapshot(buildSemanticContextSnapshot({
    taskBrief: input.taskBrief,
    plan: input.aggregate.plan,
    pendingDecision: updatedDecision,
    trustedArtifactRefs: previous?.trustedArtifactRefs ?? [],
    observationRefs: previous?.observationRefs ?? [],
    recentMessages: previous?.recentMessages ?? [],
  }), event.sequence);
  return event.sequence;
}

function assertDecisionScope(input: {
  projectId: string;
  taskBrief: TaskBrief;
  aggregate: PersistedTaskAggregate;
  decision: PendingDecision;
}) {
  if (input.taskBrief.projectId !== input.projectId || input.decision.projectId !== input.projectId ||
      input.aggregate.taskBrief.projectId !== input.projectId ||
      input.decision.taskId !== input.taskBrief.taskId || input.aggregate.taskBrief.taskId !== input.taskBrief.taskId ||
      input.decision.intentEpoch !== input.taskBrief.intentEpoch ||
      input.aggregate.taskBrief.intentEpoch !== input.taskBrief.intentEpoch ||
      input.decision.planId !== input.aggregate.plan.planId) {
    throw new Error("PendingDecision scope does not match the active task.");
  }
}

function normalizeDecisionReply(text: string) {
  return text.trim().replace(/\s+/g, "").replace(/[。.!！]+$/g, "");
}
