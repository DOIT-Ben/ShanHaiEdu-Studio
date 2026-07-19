import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { assertExecutionIdentityCanWriteProject } from "@/server/execution/execution-identity";
import {
  createProjectExecutionLeaseRepository,
  ProjectExecutionLeaseRejectedError,
} from "@/server/execution/project-execution-lease";
import type { ProjectExecutionFence, ProjectExecutionGuard } from "./types";

export type ExecutionGuardRepository = ReturnType<typeof createExecutionGuardRepository>;

export function createExecutionGuardRepository(client: PrismaClient = prisma) {
  const executionLeases = createProjectExecutionLeaseRepository(client);

  return {
    acquireProjectExecutionLease: executionLeases.acquire,
    renewProjectExecutionLease: executionLeases.renew,
    releaseProjectExecutionLease: executionLeases.release,

    async assertExecutionGuard(projectId: string, guard: ProjectExecutionGuard, now = new Date()) {
      if (guard.projectId !== projectId) {
        throw new ProjectExecutionLeaseRejectedError("Execution guard project does not match the write target.");
      }
      await client.$transaction(async (tx) => {
        await assertCurrentFence(tx, guard, now);
        await assertExecutionIdentityCanWriteProject(tx, guard.identity, projectId, now);
      });
    },
  };
}

type TransactionClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

async function assertCurrentFence(tx: TransactionClient, fence: ProjectExecutionFence, now: Date) {
  const lease = await tx.projectExecutionLease.findFirst({
    where: {
      projectId: fence.projectId,
      holderId: fence.holderId,
      fencingToken: fence.fencingToken,
      leasedUntil: { gt: now },
    },
    select: { projectId: true },
  });
  if (!lease) {
    throw new ProjectExecutionLeaseRejectedError("Project execution lease is missing, expired, or fenced out.");
  }
}
