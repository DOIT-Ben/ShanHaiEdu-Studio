import { randomUUID } from "node:crypto";

import type { PrismaClient, ToolInvocationRecord } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { hasValidValidationReportDigest, hashArtifactDraft } from "@/server/contracts/contract-validator";
import { resolveRuntimeContract } from "@/server/contracts/runtime-contract";
import { commitToolResultAtomically } from "@/server/execution/tool-result-commit";
import type { ValidationReport } from "@/server/quality/quality-types";
import { getToolDefinition } from "@/server/tools/tool-registry";
import type { SaveArtifactInput } from "@/server/workbench/types";

import {
  AGENT_EVENT_VERSION,
  replayAgentEvents,
  type AgentEventEnvelope,
  type AgentEventKind,
  type AgentEventVisibility,
} from "./agent-event-envelope";
import { notifyProjectAgentEvent } from "./agent-event-notifier";
import {
  restoreSemanticContextSnapshot,
  type SemanticContextPlan,
  type SemanticContextSnapshot,
} from "./context-semantic-snapshot";
import { restoreMainAgentReActCheckpoint } from "./main-agent-react-checkpoint";
import {
  hasValidExecutionEnvelope,
  hasValidTaskBrief,
  type ExecutionEnvelope,
  type IntentGrant,
  type TaskBrief,
} from "./task-contract";

type TransactionClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export type AgentEventInput = Omit<AgentEventEnvelope, "schemaVersion" | "sequence">;

export type PersistedTaskAggregate = {
  taskBrief: TaskBrief;
  intentGrant: IntentGrant;
  plan: SemanticContextPlan;
  status: string;
  checkpoint: Record<string, unknown> | null;
};

export type SemanticSnapshotScope = {
  projectId: string;
  taskId: string;
  intentEpoch: number;
  maxPlanRevision?: number;
};

export type ToolResultObservationInput = {
  observationId: string;
  status: string;
  reasonCodes: string[];
  payload: Record<string, unknown>;
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
    async upsertTaskAggregate(input: {
      taskBrief: TaskBrief;
      intentGrant: IntentGrant;
      plan: SemanticContextPlan;
      status?: string;
      checkpoint: Record<string, unknown> | null;
    }): Promise<PersistedTaskAggregate> {
      assertTaskScope(input.taskBrief, input.intentGrant);
      assertPlan(input.plan);
      const row = await client.$transaction(async (tx) => {
        const where = {
          projectId_intentEpoch: {
            projectId: input.taskBrief.projectId,
            intentEpoch: input.taskBrief.intentEpoch,
          },
        };
        const existing = await tx.taskAggregate.findUnique({ where });
        if (existing && existing.taskId !== input.taskBrief.taskId) {
          const existingBrief = parseJson<TaskBrief>(existing.taskBriefJson);
          const invocationCount = await tx.toolInvocationRecord.count({
            where: { projectId: existing.projectId, taskId: existing.taskId },
          });
          const canReplaceUnstartedLegacyIdentity = existing.planRevision === 0 && input.plan.revision === 0 &&
            existing.status === "active" && parseJson<Record<string, unknown> | null>(existing.checkpointJson) === null &&
            existingBrief.sourceMessageId === input.taskBrief.sourceMessageId && invocationCount === 0;
          if (!canReplaceUnstartedLegacyIdentity) {
            throw new Error("Task aggregate identity cannot change within an IntentEpoch.");
          }
        }
        if (existing && input.plan.revision < existing.planRevision) {
          throw new Error("Task aggregate plan revision cannot regress.");
        }
        const checkpointJson = existing && input.plan.revision === existing.planRevision &&
          input.checkpoint === null && parseJson<Record<string, unknown> | null>(existing.checkpointJson) !== null
          ? existing.checkpointJson
          : JSON.stringify(input.checkpoint);
        return existing
          ? tx.taskAggregate.update({
              where: { taskId: existing.taskId },
              data: {
                taskId: input.taskBrief.taskId,
                taskBriefJson: JSON.stringify(input.taskBrief),
                intentGrantJson: JSON.stringify(input.intentGrant),
                planId: input.plan.planId,
                planRevision: input.plan.revision,
                status: input.status ?? input.plan.status,
                checkpointJson,
              },
            })
          : tx.taskAggregate.create({
              data: {
                taskId: input.taskBrief.taskId,
                projectId: input.taskBrief.projectId,
                intentEpoch: input.taskBrief.intentEpoch,
                taskBriefJson: JSON.stringify(input.taskBrief),
                intentGrantJson: JSON.stringify(input.intentGrant),
                planId: input.plan.planId,
                planRevision: input.plan.revision,
                status: input.status ?? input.plan.status,
                checkpointJson,
              },
            });
      });
      return mapTaskAggregate(row);
    },

    async pauseTaskAggregate(input: {
      taskBrief: TaskBrief;
      intentGrant: IntentGrant;
    }): Promise<PersistedTaskAggregate> {
      assertTaskScope(input.taskBrief, input.intentGrant);
      const row = await client.$transaction(async (tx) => {
        const existing = await tx.taskAggregate.findUnique({
          where: {
            projectId_intentEpoch: {
              projectId: input.taskBrief.projectId,
              intentEpoch: input.taskBrief.intentEpoch,
            },
          },
        });
        if (!existing || existing.taskId !== input.taskBrief.taskId ||
            parseJson<TaskBrief>(existing.taskBriefJson).digest !== input.taskBrief.digest) {
          throw new Error("Task aggregate not found for run pause.");
        }
        return tx.taskAggregate.update({
          where: { taskId: existing.taskId },
          data: {
            status: "paused_recovery",
          },
        });
      });
      return mapTaskAggregate(row);
    },

    async getTaskAggregate(projectId: string, intentEpoch: number): Promise<PersistedTaskAggregate | null> {
      const row = await client.taskAggregate.findUnique({
        where: { projectId_intentEpoch: { projectId, intentEpoch } },
      });
      return row ? mapTaskAggregate(row) : null;
    },

    async commitIntentGrantWithMessage(input: {
      taskBrief: TaskBrief;
      intentGrant: IntentGrant;
      messageId: string;
      messageMetadata: Record<string, unknown>;
    }): Promise<void> {
      assertTaskScope(input.taskBrief, input.intentGrant);
      await client.$transaction(async (tx) => {
        const aggregate = await tx.taskAggregate.updateMany({
          where: {
            projectId: input.taskBrief.projectId,
            taskId: input.taskBrief.taskId,
            intentEpoch: input.taskBrief.intentEpoch,
          },
          data: { intentGrantJson: JSON.stringify(input.intentGrant) },
        });
        if (aggregate.count !== 1) {
          throw new Error("Task aggregate not found for IntentGrant commit.");
        }
        const message = await tx.conversationMessage.updateMany({
          where: { id: input.messageId, projectId: input.taskBrief.projectId },
          data: { metadataJson: JSON.stringify(input.messageMetadata) },
        });
        if (message.count !== 1) {
          throw new Error("Conversation message not found for IntentGrant commit.");
        }
      });
    },

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
      const state = restoreSemanticContextSnapshot(snapshot);
      if (!Number.isInteger(lastEventSequence) || lastEventSequence < 0) {
        throw new Error("Semantic snapshot lastEventSequence is invalid.");
      }
      const row = await client.semanticContextSnapshotRecord.upsert({
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

    async startToolInvocation(input: {
      invocationId: string;
      envelope: ExecutionEnvelope;
      toolName: string;
      request: Record<string, unknown>;
    }) {
      if (!hasValidExecutionEnvelope(input.envelope)) {
        throw new Error("Tool invocation requires a valid ExecutionEnvelope.");
      }
      if (!input.toolName.trim()) throw new Error("Tool invocation toolName is required.");
      const requestJson = JSON.stringify(input.request);
      const executionEnvelopeJson = JSON.stringify(input.envelope);
      return client.$transaction(async (tx) => {
        const idempotencyWhere = {
          projectId_idempotencyKey: {
            projectId: input.envelope.projectId,
            idempotencyKey: input.envelope.idempotencyKey,
          },
        };
        const existing = await tx.toolInvocationRecord.findUnique({ where: idempotencyWhere });
        if (existing) return classifyExistingInvocation(tx, existing, input.toolName, executionEnvelopeJson, requestJson);

        const aggregate = await tx.taskAggregate.findUnique({
          where: {
            projectId_intentEpoch: {
              projectId: input.envelope.projectId,
              intentEpoch: input.envelope.intentEpoch,
            },
          },
          select: { taskId: true, planRevision: true, taskBriefJson: true },
        });
        if (
          !aggregate ||
          aggregate.taskId !== input.envelope.taskId ||
          aggregate.planRevision !== input.envelope.planRevision ||
          parseJson<TaskBrief>(aggregate.taskBriefJson).digest !== input.envelope.taskBriefDigest
        ) {
          throw new Error("Tool invocation ExecutionEnvelope is stale.");
        }
        const invocation = await tx.toolInvocationRecord.create({
          data: {
            invocationId: input.invocationId,
            projectId: input.envelope.projectId,
            taskId: input.envelope.taskId,
            intentEpoch: input.envelope.intentEpoch,
            planRevision: input.envelope.planRevision,
            toolName: input.toolName,
            executionEnvelopeJson,
            requestJson,
            idempotencyKey: input.envelope.idempotencyKey,
          },
        });
        return { kind: "claimed" as const, invocation };
      });
    },

    async getToolInvocation(invocationId: string) {
      return client.toolInvocationRecord.findUnique({ where: { invocationId } });
    },

    async getObservation(observationId: string) {
      const row = await client.observationRecord.findUnique({ where: { observationId } });
      return row ? mapObservation(row) : null;
    },

    async commitToolResult(input: {
      invocationId: string;
      generationJobId?: string;
      artifact: SaveArtifactInput;
      observation: ToolResultObservationInput;
      event: AgentEventInput;
    }) {
      const invocation = await client.toolInvocationRecord.findUnique({ where: { invocationId: input.invocationId } });
      if (!invocation || invocation.status !== "running") {
        throw new Error("Tool invocation is not active.");
      }
      assertEventMatchesInvocation(input.event, invocation);

      return commitToolResultAtomically({
        transaction: (commit) => client.$transaction(async (tx) => {
          let committedArtifactId: string | undefined;
          let committedObservationId: string | undefined;
          return commit({
            saveArtifact: async (artifact) => {
              const envelope = parsePersistedExecutionEnvelope(invocation.executionEnvelopeJson);
              const created = await saveArtifactInTransaction(tx, invocation.projectId, artifact, {
                taskId: invocation.taskId,
                taskBriefDigest: envelope.taskBriefDigest,
                intentEpoch: invocation.intentEpoch,
                planRevision: invocation.planRevision,
              });
              if (artifact.validationReport) {
                await saveValidationReportInTransaction(tx, invocation, created.id, artifact, input.generationJobId);
              }
              committedArtifactId = created.id;
              return created;
            },
            saveObservation: async (observation) => {
              if (!committedArtifactId) throw new Error("Atomic result is missing its Artifact.");
              const created = await tx.observationRecord.create({
                data: {
                  observationId: observation.observationId,
                  projectId: invocation.projectId,
                  taskId: invocation.taskId,
                  invocationId: invocation.invocationId,
                  intentEpoch: invocation.intentEpoch,
                  status: observation.status,
                  reasonCodesJson: JSON.stringify(uniqueText(observation.reasonCodes)),
                  payloadJson: JSON.stringify(observation.payload),
                  artifactId: committedArtifactId,
                },
              });
              committedObservationId = created.observationId;
              return created;
            },
            saveEvent: async (event) => {
              if (!committedArtifactId || !committedObservationId) {
                throw new Error("Atomic result is missing its Observation.");
              }
              const created = await appendEventInTransaction(tx, event);
              await tx.toolInvocationRecord.update({
                where: { invocationId: invocation.invocationId },
                data: {
                  status: "succeeded",
                  artifactId: committedArtifactId,
                  observationId: committedObservationId,
                  finishedAt: new Date(),
                },
              });
              if (input.generationJobId) {
                const generationJob = await tx.generationJob.updateMany({
                  where: {
                    id: input.generationJobId,
                    projectId: invocation.projectId,
                    intentEpoch: invocation.intentEpoch,
                    status: { in: ["queued", "running"] },
                  },
                  data: {
                    status: "succeeded",
                    pollState: "completed",
                    resultArtifactId: committedArtifactId,
                    errorMessage: null,
                    finishedAt: new Date(),
                  },
                });
                if (generationJob.count !== 1) {
                  throw new Error("GenerationJob cannot be completed from the current Tool invocation.");
                }
              }
              await advanceTaskPlanRevision(tx, invocation);
              return created;
            },
          });
        }),
        artifact: input.artifact,
        observation: input.observation,
        event: input.event,
      });
    },

    async commitToolFailure(input: {
      invocationId: string;
      generationJob?: {
        jobId: string;
        status: "failed" | "submission_unknown";
        errorMessage: string;
      };
      observation: ToolResultObservationInput;
      event: AgentEventInput;
      validationReport?: ValidationReport;
      advancePlanRevision?: boolean;
    }) {
      return commitObservationOnly(client, input, "failed");
    },

    async commitToolObservation(input: {
      invocationId: string;
      observation: ToolResultObservationInput;
      event: AgentEventInput;
      invocationStatus: "succeeded" | "failed";
    }) {
      return commitObservationOnly(client, input, input.invocationStatus);
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

async function classifyExistingInvocation(
  tx: TransactionClient,
  invocation: ToolInvocationRecord,
  toolName: string,
  executionEnvelopeJson: string,
  requestJson: string,
): Promise<ToolInvocationClaim> {
  if (
    invocation.toolName !== toolName ||
    invocation.executionEnvelopeJson !== executionEnvelopeJson ||
    invocation.requestJson !== requestJson
  ) {
    throw new Error("Tool invocation idempotency key conflicts with a different request.");
  }
  if (invocation.status === "running") {
    return { kind: "in_progress" as const, invocation };
  }
  if (!invocation.observationId) {
    throw new Error("Terminal Tool invocation is missing its Observation.");
  }
  const observation = await tx.observationRecord.findUnique({
    where: { observationId: invocation.observationId },
  });
  if (!observation) throw new Error("Terminal Tool invocation Observation is missing.");
  return { kind: "terminal_replay" as const, invocation, observation: mapObservation(observation) };
}

async function commitObservationOnly(
  client: PrismaClient,
  input: {
    invocationId: string;
    generationJob?: {
      jobId: string;
      status: "failed" | "submission_unknown";
      errorMessage: string;
    };
    observation: ToolResultObservationInput;
    event: AgentEventInput;
    validationReport?: ValidationReport;
    advancePlanRevision?: boolean;
  },
  invocationStatus: "succeeded" | "failed",
) {
  const invocation = await client.toolInvocationRecord.findUnique({ where: { invocationId: input.invocationId } });
  if (!invocation || invocation.status !== "running") {
    throw new Error("Tool invocation is not active.");
  }
  assertEventMatchesInvocation(input.event, invocation);
  return client.$transaction(async (tx) => {
    if (input.validationReport) {
      await saveToolInvocationValidationReportInTransaction(tx, invocation, input.validationReport);
    }
    const observation = await tx.observationRecord.create({
      data: {
        observationId: input.observation.observationId,
        projectId: invocation.projectId,
        taskId: invocation.taskId,
        invocationId: invocation.invocationId,
        intentEpoch: invocation.intentEpoch,
        status: input.observation.status,
        reasonCodesJson: JSON.stringify(uniqueText(input.observation.reasonCodes)),
        payloadJson: JSON.stringify(input.observation.payload),
      },
    });
    const event = await appendEventInTransaction(tx, input.event);
    await tx.toolInvocationRecord.update({
      where: { invocationId: invocation.invocationId },
      data: {
        status: invocationStatus,
        observationId: observation.observationId,
        finishedAt: new Date(),
      },
    });
    if (input.generationJob) {
      const generationJob = await tx.generationJob.updateMany({
        where: {
          id: input.generationJob.jobId,
          projectId: invocation.projectId,
          intentEpoch: invocation.intentEpoch,
          status: { in: ["queued", "running"] },
        },
        data: {
          status: input.generationJob.status,
          pollState: input.generationJob.status === "submission_unknown" ? "submission_unknown" : "failed",
          errorMessage: input.generationJob.errorMessage,
          finishedAt: new Date(),
        },
      });
      if (generationJob.count !== 1) {
        throw new Error("GenerationJob cannot be failed from the current Tool invocation.");
      }
    }
    if (input.advancePlanRevision !== false) await advanceTaskPlanRevision(tx, invocation);
    return { observation, event };
  });
}

async function saveToolInvocationValidationReportInTransaction(
  tx: TransactionClient,
  invocation: ToolInvocationRecord,
  report: ValidationReport,
) {
  if (
    !hasValidValidationReportDigest(report) ||
    report.overallStatus !== "failed" ||
    report.target.kind !== "tool_invocation" ||
    report.target.targetId !== invocation.invocationId ||
    (report.intentEpoch !== undefined && report.intentEpoch !== invocation.intentEpoch)
  ) {
    throw new Error("Tool invocation ValidationReport is invalid.");
  }
  const createdAt = new Date(report.createdAt);
  if (!Number.isFinite(createdAt.getTime())) throw new Error("Validation report createdAt is invalid.");
  await tx.validationReportRecord.create({
    data: {
      id: report.reportId,
      projectId: invocation.projectId,
      capabilityId: invocation.toolName,
      stage: report.stage,
      authority: report.authority,
      domain: report.domain,
      targetKind: report.target.kind,
      targetId: report.target.targetId,
      targetVersion: report.target.targetVersion,
      targetDigest: report.target.targetDigest,
      inputHash: report.inputHash,
      intentEpoch: report.intentEpoch,
      contractId: report.contract.id,
      contractVersion: report.contract.version,
      overallStatus: report.overallStatus,
      reportDigest: report.reportDigest,
      payloadJson: JSON.stringify(report),
      createdAt,
    },
  });
}

async function appendEventInTransaction(tx: TransactionClient, input: AgentEventInput): Promise<AgentEventEnvelope> {
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

async function saveSemanticSnapshotInTransaction(
  tx: TransactionClient,
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
  await tx.workflowNode.update({
    where: { projectId_key: { projectId, key: input.nodeKey } },
    data: { status: input.status },
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

async function saveValidationReportInTransaction(
  tx: TransactionClient,
  invocation: ToolInvocationRecord,
  artifactId: string,
  input: SaveArtifactInput,
  generationJobId?: string,
) {
  const report = input.validationReport!;
  const envelope = parsePersistedExecutionEnvelope(invocation.executionEnvelopeJson);
  const tool = getToolDefinition(invocation.toolName);
  const contract = resolveRuntimeContract(tool);
  const targetDigest = hashArtifactDraft({
    nodeKey: input.nodeKey,
    kind: input.kind,
    title: input.title,
    summary: input.summary,
    markdownContent: input.markdownContent,
    structuredContent: input.structuredContent,
  });
  if (
    !hasValidValidationReportDigest(report) ||
    report.overallStatus !== "passed" ||
    report.target.kind !== "artifact_draft" ||
    report.target.targetId !== invocation.toolName ||
    report.target.targetDigest !== targetDigest ||
    report.intentEpoch !== invocation.intentEpoch ||
    report.stage !== contract.capabilityId ||
    report.contract.id !== contract.id ||
    report.contract.version !== contract.version ||
    contract.outputArtifactKind !== input.kind
  ) {
    throw new Error("Validation report rejected during atomic Tool result commit.");
  }
  const expectedInputHash = generationJobId
    ? await validationInputHashForGenerationJob(tx, invocation, generationJobId, contract.capabilityId)
    : envelope.idempotencyKey;
  if (report.inputHash !== expectedInputHash) {
    throw new Error("Validation report rejected during atomic Tool result commit.");
  }
  const createdAt = new Date(report.createdAt);
  if (!Number.isFinite(createdAt.getTime())) throw new Error("Validation report createdAt is invalid.");
  await tx.validationReportRecord.create({
    data: {
      id: report.reportId,
      projectId: invocation.projectId,
      capabilityId: report.stage,
      stage: report.stage,
      authority: report.authority,
      domain: report.domain,
      targetKind: report.target.kind,
      targetId: report.target.targetId,
      targetVersion: report.target.targetVersion,
      targetDigest: report.target.targetDigest,
      inputHash: report.inputHash,
      intentEpoch: report.intentEpoch,
      contractId: report.contract.id,
      contractVersion: report.contract.version,
      overallStatus: report.overallStatus,
      reportDigest: report.reportDigest,
      payloadJson: JSON.stringify(report),
      artifactId,
      ...(generationJobId ? { generationJobId } : {}),
      createdAt,
    },
  });
}

async function validationInputHashForGenerationJob(
  tx: TransactionClient,
  invocation: ToolInvocationRecord,
  generationJobId: string,
  capabilityId: string,
): Promise<string> {
  const job = await tx.generationJob.findFirst({
    where: {
      id: generationJobId,
      projectId: invocation.projectId,
      intentEpoch: invocation.intentEpoch,
    },
    select: {
      status: true,
      inputHash: true,
      runInputSnapshot: {
        select: {
          projectId: true,
          intentEpoch: true,
          capabilityId: true,
          inputHash: true,
        },
      },
    },
  });
  if (
    job?.status !== "running" ||
    !job.inputHash ||
    !job.runInputSnapshot ||
    job.runInputSnapshot.projectId !== invocation.projectId ||
    job.runInputSnapshot.intentEpoch !== invocation.intentEpoch ||
    job.runInputSnapshot.capabilityId !== capabilityId ||
    job.runInputSnapshot.inputHash !== job.inputHash
  ) {
    throw new Error("Validation report rejected during atomic Tool result commit.");
  }
  return job.inputHash;
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

function assertTaskScope(taskBrief: TaskBrief, intentGrant: IntentGrant) {
  if (!hasValidTaskBrief(taskBrief)) throw new Error("Task aggregate requires a valid TaskBrief.");
  if (
    intentGrant.taskId !== taskBrief.taskId ||
    intentGrant.projectId !== taskBrief.projectId ||
    intentGrant.intentEpoch !== taskBrief.intentEpoch ||
    intentGrant.intensity !== taskBrief.generationIntensity
  ) {
    throw new Error("Task aggregate IntentGrant does not match TaskBrief.");
  }
}

function assertPlan(plan: SemanticContextPlan) {
  if (!plan.planId.trim() || !Number.isInteger(plan.revision) || plan.revision < 0 || !plan.status.trim()) {
    throw new Error("Task aggregate plan is invalid.");
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

function assertEventMatchesInvocation(
  event: AgentEventInput,
  invocation: { projectId: string; taskId: string; intentEpoch: number },
) {
  if (
    event.projectId !== invocation.projectId ||
    event.taskId !== invocation.taskId ||
    event.intentEpoch !== invocation.intentEpoch
  ) {
    throw new Error("Tool result event does not match invocation scope.");
  }
}

function mapTaskAggregate(row: {
  taskBriefJson: string;
  intentGrantJson: string;
  planId: string;
  planRevision: number;
  status: string;
  checkpointJson: string;
}): PersistedTaskAggregate {
  return {
    taskBrief: parseJson<TaskBrief>(row.taskBriefJson),
    intentGrant: parseJson<IntentGrant>(row.intentGrantJson),
    plan: { planId: row.planId, revision: row.planRevision, status: row.status },
    status: row.status,
    checkpoint: parseJson<Record<string, unknown> | null>(row.checkpointJson),
  };
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
