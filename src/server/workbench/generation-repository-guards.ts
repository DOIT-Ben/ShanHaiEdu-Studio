import type { PrismaClient } from "@/generated/prisma/client";
import {
  ExecutionIdentityRejectedError,
  assertExecutionIdentityCanWriteProject,
} from "@/server/execution/execution-identity";
import { ProjectExecutionLeaseRejectedError } from "@/server/execution/project-execution-lease";
import type { ProjectExecutionFence, ProjectExecutionGuard } from "./types";

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

export async function assertGenerationCommitGuard(
  tx: TransactionClient,
  projectId: string,
  guard: ProjectExecutionGuard,
  now = new Date(),
) {
  if (guard.projectId !== projectId) {
    throw new ProjectExecutionLeaseRejectedError("Execution guard project does not match the generation target.");
  }
  await assertCurrentFence(tx, guard, now);
  await assertExecutionIdentityCanWriteProject(tx, guard.identity, projectId, now);
}

export async function validateGenerationCommitGuard(
  tx: TransactionClient,
  projectId: string,
  guard: ProjectExecutionGuard,
) {
  try {
    await assertGenerationCommitGuard(tx, projectId, guard);
    return true;
  } catch (error) {
    if (error instanceof ProjectExecutionLeaseRejectedError || error instanceof ExecutionIdentityRejectedError) {
      return false;
    }
    throw error;
  }
}

export function executionIdentityMatchesStage(
  stage: { actorUserId: string | null; actorAuthMode: string | null; authSessionId: string | null },
  guard: ProjectExecutionGuard,
) {
  return stage.actorUserId === guard.identity.actorUserId
    && stage.actorAuthMode === guard.identity.actorAuthMode
    && stage.authSessionId === guard.identity.authSessionId;
}
