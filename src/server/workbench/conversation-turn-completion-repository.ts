import type { ConversationTurnJob, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { assertActiveProjectForWrite } from "./project-lifecycle-service";
import type {
  FailConversationTurnInput,
  FinishConversationTurnInput,
  ProjectExecutionFence,
  ProjectExecutionGuard,
} from "./types";
import {
  assertCurrentTurnFence,
  quarantineTurnJob,
  validateGuardForTurnJob,
  validateTurnJobExecutionIdentity,
} from "./conversation-turn-repository-guards";
import {
  isSha256,
  isSqliteWriteContentionError,
  parseRecord,
  requiredRecoveryText,
  waitForConcurrentCommit,
  type TransactionClient,
} from "./conversation-turn-repository-shared";

type StartConversationTurnInput = {
  lockedBy?: string;
  lockMs?: number;
  fence?: ProjectExecutionFence;
  now?: Date;
  expectedJobId?: string;
};

export function createConversationTurnCompletionRepository(client: PrismaClient = prisma) {
  return {
    startNextConversationTurnJob: startNextConversationTurnJob.bind(null, client),
    finishConversationTurnJob: finishConversationTurnJob.bind(null, client),
    failConversationTurnJob: failConversationTurnJob.bind(null, client),
    getConversationTurnJobs: getConversationTurnJobs.bind(null, client),
  };
}

async function startNextConversationTurnJob(
  client: PrismaClient,
  projectId: string,
  input: StartConversationTurnInput = {},
) {
  let contentionError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await client.$transaction(async (tx) => claimNextConversationTurnJob(tx, projectId, input));
    } catch (error) {
      if (!isSqliteWriteContentionError(error)) throw error;
      contentionError = error;
      await waitForConcurrentCommit(10 * (attempt + 1));
      if (await hasActiveClaim(client, projectId, input).catch(() => false)) return null;
    }
  }
  throw contentionError;
}

async function claimNextConversationTurnJob(
  tx: TransactionClient,
  projectId: string,
  input: StartConversationTurnInput,
) {
  await assertActiveProjectForWrite(tx, projectId);
  const now = input.now ?? new Date();
  if (input.fence) await assertCurrentTurnFence(tx, input.fence, now);
  if (input.expectedJobId) {
    const otherActive = await tx.conversationTurnJob.count({
      where: {
        projectId,
        id: { not: input.expectedJobId },
        status: { in: ["queued", "running"] },
      },
    });
    if (otherActive !== 0) return null;
  }
  const running = await tx.conversationTurnJob.findFirst({
    where: {
      projectId,
      ...(input.expectedJobId ? { id: input.expectedJobId } : {}),
      status: "running",
      OR: [{ lockedUntil: null }, { lockedUntil: { gt: now } }],
    },
    orderBy: { createdAt: "asc" },
  });
  if (running) return null;

  const expiredRunning = await tx.conversationTurnJob.findFirst({
    where: { projectId, status: "running", lockedUntil: { lte: now } },
    orderBy: { createdAt: "asc" },
  });
  if (expiredRunning) return claimExpiredConversationTurnJob(tx, expiredRunning, input, now);

  const next = await tx.conversationTurnJob.findFirst({
    where: { projectId, status: "queued", ...(input.expectedJobId ? { id: input.expectedJobId } : {}) },
    orderBy: { createdAt: "asc" },
  });
  if (!next) return null;
  return claimQueuedConversationTurnJob(tx, next, input, now);
}

async function claimExpiredConversationTurnJob(
  tx: TransactionClient,
  job: ConversationTurnJob,
  input: StartConversationTurnInput,
  now: Date,
) {
  if (job.attempts >= job.maxAttempts && !input.expectedJobId) {
    return updateClaimTarget(tx, job, {
      status: "failed",
      lockedBy: null,
      lockedUntil: null,
      errorCode: "attempts_exhausted",
      errorMessage: "这条排队消息已达到最大重试次数，请重新发送或调整需求。",
      finishedAt: now,
    });
  }
  if (input.fence && !(await validateTurnJobExecutionIdentity(tx, job, now))) {
    return quarantineTurnJob(tx, {
      jobId: job.id,
      expectedStatus: "running",
      expectedAttempts: job.attempts,
      expectedLockedUntil: job.lockedUntil,
      expectedFencingToken: job.fencingToken,
      errorCode: "execution_identity_invalid",
      now,
    });
  }
  const lockMs = input.lockMs ?? 10 * 60 * 1000;
  return updateClaimTarget(tx, job, {
    status: "running",
    attempts: input.expectedJobId ? job.attempts : job.attempts + 1,
    lockedBy: input.lockedBy ?? "local-worker",
    lockedUntil: new Date(now.getTime() + lockMs),
    fencingToken: input.fence?.fencingToken,
    startedAt: now,
    finishedAt: null,
    errorCode: null,
    errorMessage: null,
  });
}

async function claimQueuedConversationTurnJob(
  tx: TransactionClient,
  job: ConversationTurnJob,
  input: StartConversationTurnInput,
  now: Date,
) {
  if (input.fence && !(await validateTurnJobExecutionIdentity(tx, job, now))) {
    return quarantineTurnJob(tx, {
      jobId: job.id,
      expectedStatus: "queued",
      expectedAttempts: job.attempts,
      expectedLockedUntil: job.lockedUntil,
      expectedFencingToken: job.fencingToken,
      errorCode: "execution_identity_invalid",
      now,
    });
  }
  if (job.attempts >= job.maxAttempts) {
    return updateClaimTarget(tx, job, {
      status: "failed",
      errorCode: "attempts_exhausted",
      errorMessage: "这条排队消息已达到最大重试次数，请重新发送或调整需求。",
      finishedAt: new Date(),
    });
  }
  const lockMs = input.lockMs ?? 10 * 60 * 1000;
  return updateClaimTarget(tx, job, {
    status: "running",
    attempts: job.attempts + 1,
    lockedBy: input.lockedBy ?? "local-worker",
    lockedUntil: new Date(now.getTime() + lockMs),
    fencingToken: input.fence?.fencingToken,
    startedAt: now,
    finishedAt: null,
    errorCode: null,
    errorMessage: null,
  });
}

async function updateClaimTarget(
  tx: TransactionClient,
  job: ConversationTurnJob,
  data: Parameters<TransactionClient["conversationTurnJob"]["updateMany"]>[0]["data"],
) {
  const result = await tx.conversationTurnJob.updateMany({
    where: {
      id: job.id,
      projectId: job.projectId,
      status: job.status,
      attempts: job.attempts,
      lockedUntil: job.lockedUntil,
      fencingToken: job.fencingToken,
    },
    data,
  });
  if (result.count !== 1) return null;
  return tx.conversationTurnJob.findUniqueOrThrow({ where: { id: job.id } });
}

async function hasActiveClaim(client: PrismaClient, projectId: string, input: StartConversationTurnInput) {
  const now = input.now ?? new Date();
  return Boolean(await client.conversationTurnJob.findFirst({
    where: {
      projectId,
      ...(input.expectedJobId ? { id: input.expectedJobId } : {}),
      status: "running",
      OR: [{ lockedUntil: null }, { lockedUntil: { gt: now } }],
    },
    select: { id: true },
  }));
}

async function finishConversationTurnJob(
  client: PrismaClient,
  projectId: string,
  jobId: string,
  input: FinishConversationTurnInput,
  guard?: ProjectExecutionGuard,
) {
  return client.$transaction(async (tx) => {
    await assertActiveProjectForWrite(tx, projectId);
    const existing = await tx.conversationTurnJob.findFirst({ where: { id: jobId, projectId } });
    if (!existing) throw new Error(`ConversationTurnJob not found: ${jobId}`);
    if (existing.status !== "running") throw new Error(`ConversationTurnJob is not running: ${jobId}`);
    if (guard && !(await validateGuardForTurnJob(tx, existing, guard))) {
      return quarantineTurnJob(tx, {
        jobId: existing.id,
        expectedStatus: "running",
        expectedAttempts: existing.attempts,
        expectedLockedUntil: existing.lockedUntil,
        expectedFencingToken: guard.fencingToken,
        errorCode: "execution_fence_rejected",
        now: new Date(),
      });
    }
    const finalStatus = input.status ?? "succeeded";
    if (input.taskTerminal) await finishTaskAggregate(tx, projectId, input, finalStatus);
    return tx.conversationTurnJob.update({
      where: { id: jobId },
      data: {
        status: finalStatus,
        assistantMessageId: input.assistantMessageId,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
        lockedBy: null,
        lockedUntil: null,
        finishedAt: new Date(),
      },
    });
  });
}

async function finishTaskAggregate(
  tx: TransactionClient,
  projectId: string,
  input: FinishConversationTurnInput,
  finalStatus: "succeeded" | "blocked",
) {
  const terminal = input.taskTerminal!;
  const expectedTaskStatus = finalStatus === "succeeded" ? "completed" : "paused_recovery";
  if (terminal.status !== expectedTaskStatus || !requiredRecoveryText(terminal.taskId) ||
      !Number.isInteger(terminal.intentEpoch) || terminal.intentEpoch < 0 || !isSha256(terminal.taskBriefDigest)) {
    throw new Error("ConversationTurnJob task terminal state is invalid.");
  }
  const aggregate = await tx.taskAggregate.findUnique({
    where: { projectId_intentEpoch: { projectId, intentEpoch: terminal.intentEpoch } },
  });
  const aggregateTaskBrief = parseRecord(aggregate?.taskBriefJson);
  if (!aggregate || aggregate.taskId !== terminal.taskId || aggregateTaskBrief.digest !== terminal.taskBriefDigest) {
    throw new Error("ConversationTurnJob task terminal state does not match TaskAggregate.");
  }
  await tx.taskAggregate.update({
    where: { taskId: aggregate.taskId },
    data: { status: terminal.status, checkpointJson: JSON.stringify(terminal.checkpoint) },
  });
}

async function failConversationTurnJob(
  client: PrismaClient,
  projectId: string,
  jobId: string,
  input: FailConversationTurnInput,
  guard?: ProjectExecutionGuard,
) {
  return client.$transaction(async (tx) => {
    await assertActiveProjectForWrite(tx, projectId);
    const existing = await tx.conversationTurnJob.findFirst({ where: { id: jobId, projectId } });
    if (!existing) throw new Error(`ConversationTurnJob not found: ${jobId}`);
    if (existing.status !== "running") throw new Error(`ConversationTurnJob is not running: ${jobId}`);
    if (guard && !(await validateGuardForTurnJob(tx, existing, guard))) {
      return quarantineTurnJob(tx, {
        jobId: existing.id,
        expectedStatus: "running",
        expectedAttempts: existing.attempts,
        expectedLockedUntil: existing.lockedUntil,
        expectedFencingToken: guard.fencingToken,
        errorCode: "execution_fence_rejected",
        now: new Date(),
      });
    }
    return tx.conversationTurnJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        assistantMessageId: input.assistantMessageId,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage,
        failureCategory: input.failureCategory ?? null,
        failureRetryability: input.retryability ?? null,
        failureEvidenceDigest: input.failureEvidenceDigest ?? null,
        lockedBy: null,
        lockedUntil: null,
        finishedAt: new Date(),
      },
    });
  });
}

async function getConversationTurnJobs(client: PrismaClient, projectId: string) {
  return client.conversationTurnJob.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
  });
}
