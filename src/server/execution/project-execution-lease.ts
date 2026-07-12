import type { PrismaClient, ProjectExecutionLease } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import type { ProjectExecutionFence } from "@/server/workbench/types";

export type AcquireProjectExecutionLeaseInput = {
  projectId: string;
  holderId: string;
  leaseMs?: number;
  now?: Date;
};

export type RenewProjectExecutionLeaseInput = ProjectExecutionFence & {
  leaseMs?: number;
  now?: Date;
};

export class ProjectExecutionLeaseRejectedError extends Error {
  readonly code = "execution_lease_rejected";

  constructor(message: string) {
    super(message);
    this.name = "ProjectExecutionLeaseRejectedError";
  }
}

export function createProjectExecutionLeaseRepository(client: PrismaClient = prisma) {
  return {
    async acquire(input: AcquireProjectExecutionLeaseInput): Promise<ProjectExecutionLease | null> {
      const holderId = input.holderId.trim();
      if (!holderId) throw new Error("Project execution lease holderId is required.");
      const now = input.now ?? new Date();
      const leasedUntil = new Date(now.getTime() + normalizeLeaseMs(input.leaseMs));

      await client.$executeRaw`
        INSERT INTO "ProjectExecutionLease" (
          "projectId", "holderId", "fencingToken", "leasedUntil", "createdAt", "updatedAt"
        ) VALUES (
          ${input.projectId}, ${holderId}, 1, ${leasedUntil}, ${now}, ${now}
        )
        ON CONFLICT("projectId") DO UPDATE SET
          "holderId" = excluded."holderId",
          "fencingToken" = CASE
            WHEN "ProjectExecutionLease"."holderId" = excluded."holderId"
             AND "ProjectExecutionLease"."leasedUntil" > ${now}
              THEN "ProjectExecutionLease"."fencingToken"
            ELSE "ProjectExecutionLease"."fencingToken" + 1
          END,
          "leasedUntil" = excluded."leasedUntil",
          "updatedAt" = excluded."updatedAt"
        WHERE "ProjectExecutionLease"."holderId" = excluded."holderId"
           OR "ProjectExecutionLease"."leasedUntil" <= ${now}
      `;

      const lease = await client.projectExecutionLease.findUnique({ where: { projectId: input.projectId } });
      return lease?.holderId === holderId && lease.leasedUntil.getTime() === leasedUntil.getTime() ? lease : null;
    },

    async renew(input: RenewProjectExecutionLeaseInput): Promise<ProjectExecutionLease | null> {
      const now = input.now ?? new Date();
      const leasedUntil = new Date(now.getTime() + normalizeLeaseMs(input.leaseMs));
      const updated = await client.projectExecutionLease.updateMany({
        where: {
          projectId: input.projectId,
          holderId: input.holderId,
          fencingToken: input.fencingToken,
          leasedUntil: { gt: now },
        },
        data: { leasedUntil },
      });
      if (updated.count !== 1) return null;
      return client.projectExecutionLease.findUnique({ where: { projectId: input.projectId } });
    },

    async release(fence: ProjectExecutionFence, now = new Date()): Promise<boolean> {
      const updated = await client.projectExecutionLease.updateMany({
        where: {
          projectId: fence.projectId,
          holderId: fence.holderId,
          fencingToken: fence.fencingToken,
        },
        data: { leasedUntil: now },
      });
      return updated.count === 1;
    },

    async assertCurrent(fence: ProjectExecutionFence, now = new Date()): Promise<ProjectExecutionLease> {
      const lease = await client.projectExecutionLease.findFirst({
        where: {
          projectId: fence.projectId,
          holderId: fence.holderId,
          fencingToken: fence.fencingToken,
          leasedUntil: { gt: now },
        },
      });
      if (!lease) {
        throw new ProjectExecutionLeaseRejectedError("Project execution lease is missing, expired, or fenced out.");
      }
      return lease;
    },

    async get(projectId: string) {
      return client.projectExecutionLease.findUnique({ where: { projectId } });
    },
  };
}

function normalizeLeaseMs(value?: number) {
  const leaseMs = value ?? 10 * 60 * 1000;
  if (!Number.isFinite(leaseMs) || leaseMs <= 0) {
    throw new Error("Project execution leaseMs must be a positive finite number.");
  }
  return Math.floor(leaseMs);
}
