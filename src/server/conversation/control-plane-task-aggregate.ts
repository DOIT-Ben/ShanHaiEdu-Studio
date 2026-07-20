import type { PrismaClient } from "@/generated/prisma/client";

import {
  hasValidTaskBrief,
  type IntentGrant,
  type TaskBrief,
} from "./task-contract";
import type { SemanticContextPlan } from "./context-semantic-snapshot";

type TransactionClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export type PersistedTaskAggregate = {
  taskBrief: TaskBrief;
  intentGrant: IntentGrant;
  plan: SemanticContextPlan;
  status: string;
  checkpoint: Record<string, unknown> | null;
};

export function createControlPlaneTaskAggregateOperations(client: PrismaClient) {
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
          data: { status: "paused_recovery" },
        });
      });
      return mapTaskAggregate(row);
    },

    async resumeTaskAggregate(input: {
      taskBrief: TaskBrief;
      intentGrant: IntentGrant;
      plan: SemanticContextPlan;
    }): Promise<PersistedTaskAggregate> {
      assertTaskScope(input.taskBrief, input.intentGrant);
      assertPlan(input.plan);
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
            parseJson<TaskBrief>(existing.taskBriefJson).digest !== input.taskBrief.digest ||
            existing.status !== "paused_recovery" || input.plan.revision < existing.planRevision) {
          throw new Error("Task aggregate is not a resumable task checkpoint.");
        }
        return tx.taskAggregate.update({
          where: { taskId: existing.taskId },
          data: {
            taskBriefJson: JSON.stringify(input.taskBrief),
            intentGrantJson: JSON.stringify(input.intentGrant),
            planId: input.plan.planId,
            planRevision: input.plan.revision,
            status: "active",
            checkpointJson: "null",
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
  };
}

export function assertTaskScope(taskBrief: TaskBrief, intentGrant: IntentGrant) {
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

export function assertPlan(plan: SemanticContextPlan) {
  if (!plan.planId.trim() || !Number.isInteger(plan.revision) || plan.revision < 0 || !plan.status.trim()) {
    throw new Error("Task aggregate plan is invalid.");
  }
}

export function mapTaskAggregate(row: {
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

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

export type { TransactionClient };
