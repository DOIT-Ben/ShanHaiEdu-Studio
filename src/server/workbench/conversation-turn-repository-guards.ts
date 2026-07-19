import { ExecutionIdentityRejectedError, assertExecutionIdentityCanWriteProject } from "@/server/execution/execution-identity";
import { ProjectExecutionLeaseRejectedError } from "@/server/execution/project-execution-lease";
import type { ProjectExecutionFence, ProjectExecutionGuard } from "./types";
import type { TransactionClient } from "./conversation-turn-repository-shared";

export async function assertCurrentTurnFence(
  tx: TransactionClient,
  fence: ProjectExecutionFence,
  now: Date,
) {
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

export async function validateTurnJobExecutionIdentity(
  tx: TransactionClient,
  job: { projectId: string; actorUserId: string | null; actorAuthMode: string | null; authSessionId: string | null },
  now: Date,
) {
  if (!job.actorUserId || !isExecutionAuthMode(job.actorAuthMode)) return false;
  try {
    await assertExecutionIdentityCanWriteProject(tx, {
      actorUserId: job.actorUserId,
      actorAuthMode: job.actorAuthMode,
      authSessionId: job.authSessionId,
    }, job.projectId, now);
    return true;
  } catch (error) {
    if (error instanceof ExecutionIdentityRejectedError) return false;
    throw error;
  }
}

export async function validateGuardForTurnJob(
  tx: TransactionClient,
  job: { projectId: string; fencingToken: number | null },
  guard: ProjectExecutionGuard,
) {
  if (job.projectId !== guard.projectId || job.fencingToken !== guard.fencingToken) return false;
  try {
    await assertCurrentTurnFence(tx, guard, new Date());
    await assertExecutionIdentityCanWriteProject(tx, guard.identity, guard.projectId);
    return true;
  } catch (error) {
    if (error instanceof ProjectExecutionLeaseRejectedError || error instanceof ExecutionIdentityRejectedError) return false;
    throw error;
  }
}

export async function quarantineTurnJob(
  tx: TransactionClient,
  input: {
    jobId: string;
    expectedStatus: string;
    expectedAttempts: number;
    expectedLockedUntil: Date | null;
    expectedFencingToken: number | null;
    errorCode: string;
    now: Date;
  },
) {
  const updated = await tx.conversationTurnJob.updateMany({
    where: {
      id: input.jobId,
      status: input.expectedStatus,
      attempts: input.expectedAttempts,
      lockedUntil: input.expectedLockedUntil,
      fencingToken: input.expectedFencingToken,
    },
    data: {
      status: "quarantined",
      errorCode: input.errorCode,
      errorMessage: "后台执行身份或写租约已经失效，本次结果未提交。",
      lockedBy: null,
      lockedUntil: null,
      finishedAt: input.now,
      fencingToken: input.expectedFencingToken,
    },
  });
  if (updated.count !== 1) {
    throw new ProjectExecutionLeaseRejectedError("Conversation turn job was already claimed by a newer fence.");
  }
  const job = await tx.conversationTurnJob.findUnique({ where: { id: input.jobId } });
  if (!job) throw new Error(`ConversationTurnJob not found after quarantine: ${input.jobId}`);
  return job;
}

function isExecutionAuthMode(value: string | null): value is "local" | "password" | "oauth" | "sso" {
  return value === "local" || value === "password" || value === "oauth" || value === "sso";
}
