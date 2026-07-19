import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";

import {
  AGENT_EVENT_VERSION,
  replayAgentEvents,
  type AgentEventEnvelope,
} from "./agent-event-envelope";
import {
  restoreSemanticContextSnapshot,
  type SemanticContextSnapshot,
} from "./context-semantic-snapshot";
import type { AgentEventInput } from "./control-plane-tool-result-commit";

export type ControlPlaneTransaction = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export async function appendEventInTransaction(
  tx: ControlPlaneTransaction,
  input: AgentEventInput,
): Promise<AgentEventEnvelope> {
  const latest = await tx.agentEventRecord.findFirst({
    where: { projectId: input.projectId },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });
  const envelope: AgentEventEnvelope = {
    schemaVersion: AGENT_EVENT_VERSION,
    ...structuredClone(input),
    sequence: (latest?.sequence ?? 0) + 1,
  };
  replayAgentEvents([envelope], { projectId: envelope.projectId });
  await tx.agentEventRecord.create({
    data: {
      eventId: envelope.eventId,
      projectId: envelope.projectId,
      taskId: envelope.taskId,
      runId: envelope.runId,
      intentEpoch: envelope.intentEpoch,
      sequence: envelope.sequence,
      kind: envelope.kind,
      visibility: envelope.visibility,
      envelopeJson: JSON.stringify(envelope),
      payloadJson: JSON.stringify(envelope.payload),
      occurredAt: new Date(envelope.occurredAt),
    },
  });
  return envelope;
}

export async function saveSemanticSnapshotInTransaction(
  tx: ControlPlaneTransaction,
  snapshot: SemanticContextSnapshot,
  lastEventSequence: number,
) {
  const state = restoreSemanticContextSnapshot(snapshot);
  if (!Number.isInteger(lastEventSequence) || lastEventSequence < 0) {
    throw new Error("Semantic snapshot lastEventSequence is invalid.");
  }
  return tx.semanticContextSnapshotRecord.upsert({
    where: {
      projectId_taskId_intentEpoch_planRevision: {
        projectId: state.taskBrief.projectId,
        taskId: state.taskBrief.taskId,
        intentEpoch: state.taskBrief.intentEpoch,
        planRevision: state.plan.revision,
      },
    },
    update: {
      snapshotDigest: snapshot.snapshotDigest,
      payloadJson: JSON.stringify(snapshot),
      lastEventSequence,
    },
    create: {
      snapshotId: randomUUID(),
      projectId: state.taskBrief.projectId,
      taskId: state.taskBrief.taskId,
      intentEpoch: state.taskBrief.intentEpoch,
      planRevision: state.plan.revision,
      snapshotDigest: snapshot.snapshotDigest,
      payloadJson: JSON.stringify(snapshot),
      lastEventSequence,
    },
  });
}
