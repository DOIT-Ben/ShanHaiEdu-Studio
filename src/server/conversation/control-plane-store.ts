import type { PrismaClient, ToolInvocationRecord } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import type { SaveArtifactInput } from "@/server/workbench/types";

import {
  replayAgentEvents,
  type AgentEventEnvelope,
  type AgentEventKind,
  type AgentEventVisibility,
} from "./agent-event-envelope";
import { notifyProjectAgentEvent } from "./agent-event-notifier";
import { createControlPlaneMessageCommitOperations } from "./control-plane-message-commit";
import {
  assertPlan,
  assertTaskScope,
  createControlPlaneTaskAggregateOperations,
  mapTaskAggregate,
} from "./control-plane-task-aggregate";
import {
  appendEventInTransaction,
  saveSemanticSnapshotInTransaction,
} from "./control-plane-transaction-operations";
import {
  restoreSemanticContextSnapshot,
  type SemanticContextPlan,
  type SemanticContextSnapshot,
} from "./context-semantic-snapshot";
import { restoreMainAgentReActCheckpoint } from "./main-agent-react-checkpoint";
import { saveValidationReportInTransaction } from "./control-plane-validation-report";
import {
  claimArtifactRouteToolInvocationAuthority,
  claimMainAgentToolInvocationAuthority,
  type RawToolInvocationClaim,
  type StartToolInvocationInput,
} from "./orchestration-tool-authority";
import {
  commitToolArtifactResult,
  commitToolObservationResult,
  type AgentEventInput,
  type CommitToolArtifactInput,
  type CommitToolObservationInput,
  type ToolResultCommitOperations,
  type ToolResultObservationInput,
} from "./control-plane-tool-result-commit";
import {
  hasValidExecutionEnvelope,
  type ExecutionEnvelope,
  type IntentGrant,
  type TaskBrief,
} from "./task-contract";

type TransactionClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export type { AgentEventInput, ToolResultObservationInput } from "./control-plane-tool-result-commit";

export type { PersistedTaskAggregate } from "./control-plane-task-aggregate";

export type SemanticSnapshotScope = {
  projectId: string;
  taskId: string;
  intentEpoch: number;
  maxPlanRevision?: number;
};

export type PersistedToolObservation = {
  observationId: string;
  projectId: string;
  taskId: string;
  invocationId: string | null;
  intentEpoch: number;
  status: string;
  reasonCodes: string[];
  payload: Record<string, unknown>;
  artifactId: string | null;
};

export type ToolInvocationClaim =
  | { kind: "claimed"; invocation: ToolInvocationRecord }
  | { kind: "in_progress"; invocation: ToolInvocationRecord }
  | { kind: "terminal_replay"; invocation: ToolInvocationRecord; observation: PersistedToolObservation };

export function createControlPlaneStore(client: PrismaClient = prisma) {
  return {
    ...createControlPlaneTaskAggregateOperations(client),

    ...createControlPlaneMessageCommitOperations(client),

    async appendEvent(input: AgentEventInput): Promise<AgentEventEnvelope> {
      const event = await client.$transaction((tx) => appendEventInTransaction(tx, input));
      notifyProjectAgentEvent(event.projectId, event.sequence);
      return event;
    },

    async listEvents(projectId: string, afterSequence = 0): Promise<AgentEventEnvelope[]> {
      const rows = await client.agentEventRecord.findMany({
        where: { projectId, sequence: { gt: afterSequence } },
        orderBy: { sequence: "asc" },
      });
      return replayAgentEvents(rows.map((row) => parseJson<AgentEventEnvelope>(row.envelopeJson)), {
        projectId,
        afterSequence,
      });
    },

    async getLatestEventSequence(projectId: string): Promise<number> {
      const latest = await client.agentEventRecord.findFirst({
        where: { projectId },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      });
      return latest?.sequence ?? 0;
    },

    async saveSemanticSnapshot(snapshot: SemanticContextSnapshot, lastEventSequence: number) {
      const row = await client.$transaction((tx) =>
        saveSemanticSnapshotInTransaction(tx, snapshot, lastEventSequence));
      return mapSemanticSnapshot(row);
    },

    async commitRunCheckpoint(input: {
      taskBrief: TaskBrief;
      intentGrant: IntentGrant;
      plan: SemanticContextPlan;
      checkpoint: Record<string, unknown>;
      semanticSnapshot: SemanticContextSnapshot;
      event: AgentEventInput;
    }) {
      assertTaskScope(input.taskBrief, input.intentGrant);
      assertPlan(input.plan);
      assertRunCheckpoint(input.checkpoint);
      assertCheckpointSnapshot(input.taskBrief, input.plan, input.semanticSnapshot);
      if (
        input.event.projectId !== input.taskBrief.projectId ||
        input.event.taskId !== input.taskBrief.taskId ||
        input.event.intentEpoch !== input.taskBrief.intentEpoch ||
        input.event.kind !== "task_updated"
      ) {
        throw new Error("Run checkpoint event does not match the task scope.");
      }

      return client.$transaction(async (tx) => {
        const aggregateRow = await tx.taskAggregate.upsert({
          where: {
            projectId_intentEpoch: {
              projectId: input.taskBrief.projectId,
              intentEpoch: input.taskBrief.intentEpoch,
            },
          },
          update: {
            taskId: input.taskBrief.taskId,
            taskBriefJson: JSON.stringify(input.taskBrief),
            intentGrantJson: JSON.stringify(input.intentGrant),
            planId: input.plan.planId,
            planRevision: input.plan.revision,
            status: input.plan.status,
            checkpointJson: JSON.stringify(input.checkpoint),
          },
          create: {
            taskId: input.taskBrief.taskId,
            projectId: input.taskBrief.projectId,
            intentEpoch: input.taskBrief.intentEpoch,
            taskBriefJson: JSON.stringify(input.taskBrief),
            intentGrantJson: JSON.stringify(input.intentGrant),
            planId: input.plan.planId,
            planRevision: input.plan.revision,
            status: input.plan.status,
            checkpointJson: JSON.stringify(input.checkpoint),
          },
        });
        const event = await appendEventInTransaction(tx, input.event);
        const snapshotRow = await saveSemanticSnapshotInTransaction(
          tx,
          input.semanticSnapshot,
          event.sequence,
        );
        return {
          aggregate: mapTaskAggregate(aggregateRow),
          event,
          snapshot: mapSemanticSnapshot(snapshotRow),
        };
      });
    },

    async getLatestSemanticSnapshot(scope: SemanticSnapshotScope) {
      assertSemanticSnapshotScope(scope);
      return client.$transaction(async (tx) => {
        const project = await tx.project.findUnique({
          where: { id: scope.projectId },
          select: { intentEpoch: true },
        });
        if (!project || project.intentEpoch !== scope.intentEpoch) return null;
        const aggregate = await tx.taskAggregate.findUnique({
          where: {
            projectId_intentEpoch: {
              projectId: scope.projectId,
              intentEpoch: scope.intentEpoch,
            },
          },
          select: { taskId: true, planRevision: true },
        });
        if (!aggregate || aggregate.taskId !== scope.taskId) return null;
        const maxPlanRevision = Math.min(
          scope.maxPlanRevision ?? aggregate.planRevision,
          aggregate.planRevision,
        );
        const row = await tx.semanticContextSnapshotRecord.findFirst({
          where: {
            projectId: scope.projectId,
            taskId: scope.taskId,
            intentEpoch: scope.intentEpoch,
            planRevision: { lte: maxPlanRevision },
          },
          orderBy: { planRevision: "desc" },
        });
        return row ? mapSemanticSnapshot(row) : null;
      });
    },

    async startToolInvocation(input: StartToolInvocationInput) {
      return mapRawToolInvocationClaim(await claimMainAgentToolInvocationAuthority(client, input));
    },

    async startArtifactRouteToolInvocation(input: StartToolInvocationInput) {
      return mapRawToolInvocationClaim(await claimArtifactRouteToolInvocationAuthority(client, input));
    },

    async getToolInvocation(invocationId: string) {
      return client.toolInvocationRecord.findUnique({ where: { invocationId } });
    },

    async getObservation(observationId: string) {
      const row = await client.observationRecord.findUnique({ where: { observationId } });
      return row ? mapObservation(row) : null;
    },

    async commitToolResult(input: CommitToolArtifactInput) {
      return commitToolArtifactResult(client, input, toolResultCommitOperations);
    },

    async commitToolFailure(input: CommitToolObservationInput) {
      return commitToolObservationResult(client, input, false, toolResultCommitOperations);
    },

    async commitToolObservation(input: CommitToolObservationInput) {
      return commitToolObservationResult(client, input, true, toolResultCommitOperations);
    },

    async commitRunFailure(input: {
      taskBrief: TaskBrief;
      intentGrant: IntentGrant;
      observation: ToolResultObservationInput;
      event: AgentEventInput;
    }) {
      assertTaskScope(input.taskBrief, input.intentGrant);
      if (
        input.event.projectId !== input.taskBrief.projectId ||
        input.event.taskId !== input.taskBrief.taskId ||
        input.event.intentEpoch !== input.taskBrief.intentEpoch ||
        input.event.kind !== "run_failed"
      ) {
        throw new Error("Run failure event does not match the task scope.");
      }
      return client.$transaction(async (tx) => {
        const aggregate = await tx.taskAggregate.findUnique({
          where: {
            projectId_intentEpoch: {
              projectId: input.taskBrief.projectId,
              intentEpoch: input.taskBrief.intentEpoch,
            },
          },
        });
        if (!aggregate || aggregate.taskId !== input.taskBrief.taskId ||
            parseJson<TaskBrief>(aggregate.taskBriefJson).digest !== input.taskBrief.digest) {
          throw new Error("Task aggregate not found for run failure.");
        }
        const observation = await tx.observationRecord.create({
          data: {
            observationId: input.observation.observationId,
            projectId: input.taskBrief.projectId,
            taskId: input.taskBrief.taskId,
            intentEpoch: input.taskBrief.intentEpoch,
            status: input.observation.status,
            reasonCodesJson: JSON.stringify(uniqueText(input.observation.reasonCodes)),
            payloadJson: JSON.stringify(input.observation.payload),
          },
        });
        const event = await appendEventInTransaction(tx, input.event);
        const paused = await tx.taskAggregate.update({
          where: { taskId: aggregate.taskId },
          data: {
            status: "paused_recovery",
          },
        });
        return { aggregate: mapTaskAggregate(paused), observation: mapObservation(observation), event };
      });
    },
  };
}

function mapRawToolInvocationClaim(claim: RawToolInvocationClaim): ToolInvocationClaim {
  return claim.kind === "terminal_replay"
    ? { ...claim, observation: mapObservation(claim.observation) }
    : claim;
}

const toolResultCommitOperations: ToolResultCommitOperations = {
  async saveArtifact(tx, invocation, artifact, generationJobId) {
    const envelope = parsePersistedExecutionEnvelope(invocation.executionEnvelopeJson);
    const created = await saveArtifactInTransaction(tx, invocation.projectId, artifact, {
      taskId: invocation.taskId,
      taskBriefDigest: envelope.taskBriefDigest,
      intentEpoch: invocation.intentEpoch,
      planRevision: invocation.planRevision,
    });
    if (artifact.validationReport) {
      await saveValidationReportInTransaction(tx, invocation, created.id, artifact, generationJobId);
    }
    return created;
  },
  appendEvent: appendEventInTransaction,
  advancePlanRevision: advanceTaskPlanRevision,
};

async function saveArtifactInTransaction(
  tx: TransactionClient,
  projectId: string,
  input: SaveArtifactInput,
  binding: Pick<ExecutionEnvelope, "taskId" | "taskBriefDigest" | "intentEpoch" | "planRevision">,
) {
  const latest = await tx.artifact.findFirst({
    where: { projectId, nodeKey: input.nodeKey },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const artifact = await tx.artifact.create({
    data: {
      projectId,
      taskId: binding.taskId,
      taskBriefDigest: binding.taskBriefDigest,
      intentEpoch: binding.intentEpoch,
      planRevision: binding.planRevision,
      origin: "tool_result",
      nodeKey: input.nodeKey,
      kind: input.kind,
      title: input.title,
      status: input.status,
      summary: input.summary,
      markdownContent: input.markdownContent,
      structuredContentJson: JSON.stringify(input.structuredContent),
      version: (latest?.version ?? 0) + 1,
      isApproved: input.status === "approved",
    },
  });
  return artifact;
}

function parsePersistedExecutionEnvelope(value: string): ExecutionEnvelope {
  let parsed: ExecutionEnvelope;
  try {
    parsed = JSON.parse(value) as ExecutionEnvelope;
  } catch {
    throw new Error("Tool invocation ExecutionEnvelope is invalid.");
  }
  if (!hasValidExecutionEnvelope(parsed)) throw new Error("Tool invocation ExecutionEnvelope is invalid.");
  return parsed;
}

async function advanceTaskPlanRevision(
  tx: TransactionClient,
  invocation: { projectId: string; taskId: string; intentEpoch: number; planRevision: number },
) {
  const result = await tx.taskAggregate.updateMany({
    where: {
      projectId: invocation.projectId,
      taskId: invocation.taskId,
      intentEpoch: invocation.intentEpoch,
      planRevision: invocation.planRevision,
      status: "active",
    },
    data: { planRevision: { increment: 1 } },
  });
  if (result.count !== 1) {
    throw new Error("Tool result cannot advance a stale task plan revision.");
  }
}

function assertRunCheckpoint(checkpoint: Record<string, unknown>) {
  if (
    !checkpoint ||
    checkpoint.schemaVersion !== "react-checkpoint.v1" ||
    typeof checkpoint.checkpointDigest !== "string" ||
    !/^[a-f0-9]{64}$/i.test(checkpoint.checkpointDigest)
  ) {
    throw new Error("Run checkpoint is invalid.");
  }
  restoreMainAgentReActCheckpoint(checkpoint as unknown as Parameters<typeof restoreMainAgentReActCheckpoint>[0]);
}

function assertCheckpointSnapshot(
  taskBrief: TaskBrief,
  plan: SemanticContextPlan,
  snapshot: SemanticContextSnapshot,
) {
  const state = restoreSemanticContextSnapshot(snapshot);
  if (
    state.taskBrief.projectId !== taskBrief.projectId ||
    state.taskBrief.taskId !== taskBrief.taskId ||
    state.taskBrief.intentEpoch !== taskBrief.intentEpoch ||
    state.taskBrief.digest !== taskBrief.digest ||
    state.plan.planId !== plan.planId ||
    state.plan.revision !== plan.revision ||
    state.plan.status !== plan.status
  ) {
    throw new Error("Run checkpoint semantic snapshot does not match the task plan.");
  }
}

function mapSemanticSnapshot(row: {
  payloadJson: string;
  snapshotDigest: string;
  lastEventSequence: number;
}) {
  const snapshot = parseJson<SemanticContextSnapshot>(row.payloadJson);
  restoreSemanticContextSnapshot(snapshot);
  return { snapshot, snapshotDigest: row.snapshotDigest, lastEventSequence: row.lastEventSequence };
}

function assertSemanticSnapshotScope(scope: SemanticSnapshotScope) {
  if (!scope.projectId?.trim() || !scope.taskId?.trim() ||
      !Number.isInteger(scope.intentEpoch) || scope.intentEpoch < 0 ||
      (scope.maxPlanRevision !== undefined &&
        (!Number.isInteger(scope.maxPlanRevision) || scope.maxPlanRevision < 0))) {
    throw new Error("Semantic snapshot scope is invalid.");
  }
}

function mapObservation(row: {
  observationId: string;
  projectId: string;
  taskId: string;
  invocationId: string | null;
  intentEpoch: number;
  status: string;
  reasonCodesJson: string;
  payloadJson: string;
  artifactId: string | null;
}) {
  return {
    observationId: row.observationId,
    projectId: row.projectId,
    taskId: row.taskId,
    invocationId: row.invocationId,
    intentEpoch: row.intentEpoch,
    status: row.status,
    reasonCodes: parseJson<string[]>(row.reasonCodesJson),
    payload: parseJson<Record<string, unknown>>(row.payloadJson),
    artifactId: row.artifactId,
  };
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function uniqueText(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export type { AgentEventKind, AgentEventVisibility };
