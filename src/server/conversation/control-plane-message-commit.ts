import type { PrismaClient } from "@/generated/prisma/client";

import { notifyProjectAgentEvent } from "./agent-event-notifier";
import { replayAgentEvents, type AgentEventEnvelope } from "./agent-event-envelope";
import {
  restoreSemanticContextSnapshot,
  type SemanticContextPlan,
  type SemanticContextSnapshot,
} from "./context-semantic-snapshot";
import {
  appendEventInTransaction,
  saveSemanticSnapshotInTransaction,
  type ControlPlaneTransaction,
} from "./control-plane-transaction-operations";
import type { AgentEventInput } from "./control-plane-tool-result-commit";
import { removeResolvedDecisionParts } from "./pending-decision-message-parts";
import {
  hasValidTaskBrief,
  isPendingDecision,
  withPendingDecisionStatus,
  type IntentGrant,
  type PendingDecision,
  type PendingDecisionStatus,
  type TaskBrief,
} from "./task-contract";

export type PendingDecisionCommitAggregate = {
  taskBrief: TaskBrief;
  intentGrant: IntentGrant;
  plan: SemanticContextPlan;
  status: string;
  checkpoint: Record<string, unknown> | null;
};

export type PendingDecisionStatusCommitInput = {
  taskBrief: TaskBrief;
  intentGrant: IntentGrant;
  plan: SemanticContextPlan;
  triggerMessageId: string;
  triggerMessageMetadata: Record<string, unknown>;
  decision: PendingDecision;
  status: Exclude<PendingDecisionStatus, "pending">;
  event: AgentEventInput;
  semanticSnapshot: SemanticContextSnapshot;
};

export function createControlPlaneMessageCommitOperations(client: PrismaClient) {
  return {
    async commitIntentGrantWithMessage(input: {
      taskBrief: TaskBrief;
      intentGrant: IntentGrant;
      messageId: string;
      messageMetadata: Record<string, unknown>;
    }): Promise<void> {
      assertTaskGrant(input.taskBrief, input.intentGrant);
      await client.$transaction(async (tx) => {
        const aggregate = await tx.taskAggregate.updateMany({
          where: {
            projectId: input.taskBrief.projectId,
            taskId: input.taskBrief.taskId,
            intentEpoch: input.taskBrief.intentEpoch,
          },
          data: { intentGrantJson: JSON.stringify(input.intentGrant) },
        });
        if (aggregate.count !== 1) throw new Error("Task aggregate not found for IntentGrant commit.");
        const message = await tx.conversationMessage.updateMany({
          where: { id: input.messageId, projectId: input.taskBrief.projectId },
          data: { metadataJson: JSON.stringify(input.messageMetadata) },
        });
        if (message.count !== 1) throw new Error("Conversation message not found for IntentGrant commit.");
      });
    },

    async commitPendingDecisionStatus(input: PendingDecisionStatusCommitInput) {
      const updatedDecision = assertPendingDecisionCommit(input);
      const committed = await client.$transaction(async (tx) => {
        const aggregate = await requireCurrentAggregate(tx, input);
        const existingEvent = await resolveExistingDecisionEvent(tx, input);
        if (existingEvent && await hasCommittedSnapshot(tx, input, updatedDecision, existingEvent.sequence)) {
          return { aggregate: mapAggregate(aggregate), event: existingEvent };
        }

        const updatedAggregate = await tx.taskAggregate.update({
          where: { taskId: aggregate.taskId },
          data: {
            taskBriefJson: JSON.stringify(input.taskBrief),
            intentGrantJson: JSON.stringify(input.intentGrant),
            planId: input.plan.planId,
            planRevision: input.plan.revision,
            status: input.plan.status,
          },
        });
        await updateDecisionMessages(tx, input, updatedDecision);
        const event = existingEvent ?? await appendEventInTransaction(tx, input.event);
        await saveSemanticSnapshotInTransaction(tx, input.semanticSnapshot, event.sequence);
        return { aggregate: mapAggregate(updatedAggregate), event };
      });
      notifyProjectAgentEvent(committed.event.projectId, committed.event.sequence);
      return committed;
    },
  };
}

function assertPendingDecisionCommit(input: PendingDecisionStatusCommitInput): PendingDecision {
  assertTaskGrant(input.taskBrief, input.intentGrant);
  if (!isPendingDecision(input.decision) || input.decision.status !== "pending") {
    throw new Error("PendingDecision commit requires an unresolved decision.");
  }
  if (!input.triggerMessageId.trim() || !input.plan.planId.trim() || !Number.isInteger(input.plan.revision) ||
      input.plan.revision < 0 || !input.plan.status.trim()) {
    throw new Error("PendingDecision commit plan is invalid.");
  }
  if (input.decision.projectId !== input.taskBrief.projectId || input.decision.taskId !== input.taskBrief.taskId ||
      input.decision.intentEpoch !== input.taskBrief.intentEpoch || input.decision.planId !== input.plan.planId) {
    throw new Error("PendingDecision commit scope does not match the task plan.");
  }
  const updatedDecision = withPendingDecisionStatus(input.decision, input.status);
  const snapshot = restoreSemanticContextSnapshot(input.semanticSnapshot);
  const snapshotDecision = snapshot.pendingDecision;
  if (snapshot.taskBrief.digest !== input.taskBrief.digest || snapshot.plan.planId !== input.plan.planId ||
      snapshot.plan.revision !== input.plan.revision || snapshot.plan.status !== input.plan.status ||
      !isPendingDecision(snapshotDecision) || snapshotDecision.decisionId !== updatedDecision.decisionId ||
      snapshotDecision.actionId !== updatedDecision.actionId || snapshotDecision.status !== updatedDecision.status) {
    throw new Error("PendingDecision semantic snapshot does not match the commit.");
  }
  const payload = input.event.payload;
  if (input.event.projectId !== input.taskBrief.projectId || input.event.taskId !== input.taskBrief.taskId ||
      input.event.intentEpoch !== input.taskBrief.intentEpoch || input.event.kind !== "task_updated" ||
      payload.decisionId !== updatedDecision.decisionId || payload.actionId !== updatedDecision.actionId ||
      payload.decisionStatus !== updatedDecision.status) {
    throw new Error("PendingDecision event does not match the commit.");
  }
  return updatedDecision;
}

async function requireCurrentAggregate(tx: ControlPlaneTransaction, input: PendingDecisionStatusCommitInput) {
  const aggregate = await tx.taskAggregate.findUnique({
    where: { projectId_intentEpoch: { projectId: input.taskBrief.projectId, intentEpoch: input.taskBrief.intentEpoch } },
  });
  const persistedBrief = aggregate ? parseJson<TaskBrief>(aggregate.taskBriefJson) : null;
  if (!aggregate || aggregate.taskId !== input.taskBrief.taskId || persistedBrief?.digest !== input.taskBrief.digest ||
      aggregate.planId !== input.plan.planId || aggregate.planRevision !== input.plan.revision) {
    throw new Error("PendingDecision commit cannot update a stale task aggregate.");
  }
  return aggregate;
}

async function resolveExistingDecisionEvent(
  tx: ControlPlaneTransaction,
  input: PendingDecisionStatusCommitInput,
): Promise<AgentEventEnvelope | null> {
  const rows = await tx.agentEventRecord.findMany({
    where: {
      projectId: input.taskBrief.projectId,
      taskId: input.taskBrief.taskId,
      intentEpoch: input.taskBrief.intentEpoch,
      kind: "task_updated",
    },
    orderBy: { sequence: "asc" },
  });
  const matches = rows.filter((row) => parseRecord(row.payloadJson).actionId === input.decision.actionId);
  if (matches.length > 1) throw new Error("PendingDecision action has duplicate persisted events.");
  const row = matches[0];
  if (!row) return null;
  const payload = parseRecord(row.payloadJson);
  if (payload.decisionId !== input.decision.decisionId || payload.decisionStatus !== input.status) {
    throw new Error("PendingDecision action was already committed with a conflicting payload.");
  }
  const envelope = parseJson<AgentEventEnvelope>(row.envelopeJson);
  replayAgentEvents([envelope], { projectId: input.taskBrief.projectId, afterSequence: row.sequence - 1 });
  return envelope;
}

async function hasCommittedSnapshot(
  tx: ControlPlaneTransaction,
  input: PendingDecisionStatusCommitInput,
  decision: PendingDecision,
  eventSequence: number,
) {
  const row = await tx.semanticContextSnapshotRecord.findUnique({
    where: {
      projectId_taskId_intentEpoch_planRevision: {
        projectId: input.taskBrief.projectId,
        taskId: input.taskBrief.taskId,
        intentEpoch: input.taskBrief.intentEpoch,
        planRevision: input.plan.revision,
      },
    },
  });
  if (!row || row.lastEventSequence < eventSequence) return false;
  const state = restoreSemanticContextSnapshot(parseJson<SemanticContextSnapshot>(row.payloadJson));
  return state.plan.planId === input.plan.planId && state.plan.status === input.plan.status &&
    isPendingDecision(state.pendingDecision) && state.pendingDecision.decisionId === decision.decisionId &&
    state.pendingDecision.actionId === decision.actionId && state.pendingDecision.status === decision.status;
}

async function updateDecisionMessages(
  tx: ControlPlaneTransaction,
  input: PendingDecisionStatusCommitInput,
  updatedDecision: PendingDecision,
) {
  const messages = await tx.conversationMessage.findMany({
    where: { projectId: input.taskBrief.projectId },
    select: { id: true, metadataJson: true, partsJson: true },
  });
  if (!messages.some((message) => message.id === input.triggerMessageId)) {
    throw new Error("PendingDecision trigger message was not found.");
  }
  for (const message of messages) {
    const metadata = parseRecord(message.metadataJson);
    const existing = metadata.pendingDecision;
    const matchesDecision = isPendingDecision(existing) &&
      existing.decisionId === input.decision.decisionId && existing.actionId === input.decision.actionId;
    if (isPendingDecision(existing) && (existing.actionId === input.decision.actionId ||
        existing.decisionId === input.decision.decisionId) && !matchesDecision) {
      throw new Error("PendingDecision message contains a conflicting action binding.");
    }
    if (matchesDecision && existing.status !== "pending" && existing.status !== input.status) {
      throw new Error("PendingDecision message was already committed with a conflicting status.");
    }
    if (!matchesDecision && message.id !== input.triggerMessageId) continue;
    if (message.id === input.triggerMessageId && isPendingDecision(existing) && !matchesDecision) {
      throw new Error("PendingDecision trigger message belongs to another decision.");
    }
    await tx.conversationMessage.update({
      where: { id: message.id },
      data: {
        metadataJson: JSON.stringify({
          ...metadata,
          ...(message.id === input.triggerMessageId ? input.triggerMessageMetadata : {}),
          pendingDecision: updatedDecision,
        }),
        partsJson: JSON.stringify(removeResolvedDecisionParts(message.partsJson, updatedDecision)),
      },
    });
  }
}

function assertTaskGrant(taskBrief: TaskBrief, intentGrant: IntentGrant) {
  if (!hasValidTaskBrief(taskBrief) || intentGrant.taskId !== taskBrief.taskId ||
      intentGrant.projectId !== taskBrief.projectId || intentGrant.intentEpoch !== taskBrief.intentEpoch ||
      intentGrant.intensity !== taskBrief.generationIntensity) {
    throw new Error("PendingDecision IntentGrant does not match TaskBrief.");
  }
}

function mapAggregate(row: {
  taskBriefJson: string;
  intentGrantJson: string;
  planId: string;
  planRevision: number;
  status: string;
  checkpointJson: string;
}): PendingDecisionCommitAggregate {
  return {
    taskBrief: parseJson<TaskBrief>(row.taskBriefJson),
    intentGrant: parseJson<IntentGrant>(row.intentGrantJson),
    plan: { planId: row.planId, revision: row.planRevision, status: row.status },
    status: row.status,
    checkpoint: parseJson<Record<string, unknown> | null>(row.checkpointJson),
  };
}

function parseRecord(value: string): Record<string, unknown> {
  const parsed = parseJson<unknown>(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("PendingDecision persisted payload is invalid.");
  }
  return parsed as Record<string, unknown>;
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}
