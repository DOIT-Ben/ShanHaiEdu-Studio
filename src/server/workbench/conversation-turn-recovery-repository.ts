import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { assertActiveProjectForWrite } from "./project-lifecycle-service";
import type {
  RecoverConversationTurnAfterContractRepairInput,
  RecoverConversationTurnAfterProviderHealthInput,
  RecoverConversationTurnInput,
} from "./types";
import { isSha256, parseRecord, requiredRecoveryText } from "./conversation-turn-repository-shared";

export function createConversationTurnRecoveryRepository(client: PrismaClient = prisma) {
  return {
    requeueConversationTurnJobForRecovery: requeueConversationTurnJobForRecovery.bind(null, client),
    requeueConversationTurnJobAfterProviderHealth: requeueConversationTurnJobAfterProviderHealth.bind(null, client),
    requeueConversationTurnJobAfterContractRepair: requeueConversationTurnJobAfterContractRepair.bind(null, client),
  };
}

async function requeueConversationTurnJobForRecovery(
  client: PrismaClient,
  projectId: string,
  jobId: string,
  input: RecoverConversationTurnInput,
) {
  return client.$transaction(async (tx) => {
    await assertActiveProjectForWrite(tx, projectId);
    const existing = await tx.conversationTurnJob.findFirst({ where: { id: jobId, projectId } });
    if (!existing || existing.status !== "failed") return null;
    const retryable = existing.failureRetryability === "retryable";
    const legacyRetryable = input.allowLegacyTurnFailed === true &&
      existing.failureRetryability === null && existing.errorCode === "turn_failed";
    if (!retryable && !legacyRetryable) return null;
    if (existing.attempts >= existing.maxAttempts || !isSha256(input.recoveryEvidenceDigest)) return null;
    if (existing.recoveryEvidenceDigest === input.recoveryEvidenceDigest ||
        existing.failureEvidenceDigest === input.recoveryEvidenceDigest) return null;
    return tx.conversationTurnJob.update({
      where: { id: existing.id },
      data: {
        status: "queued",
        recoveryEvidenceDigest: input.recoveryEvidenceDigest.toLowerCase(),
        lockedBy: null,
        lockedUntil: null,
        finishedAt: null,
      },
    });
  });
}

async function requeueConversationTurnJobAfterProviderHealth(
  client: PrismaClient,
  projectId: string,
  jobId: string,
  input: RecoverConversationTurnAfterProviderHealthInput,
) {
  return client.$transaction(async (tx) => {
    await assertActiveProjectForWrite(tx, projectId);
    if (input.projectId !== projectId || input.jobId !== jobId ||
        !requiredRecoveryText(input.teacherMessageId) || !requiredRecoveryText(input.taskId) ||
        !requiredRecoveryText(input.expectedErrorCode) || !Number.isInteger(input.intentEpoch) || input.intentEpoch < 0 ||
        !isSha256(input.recoveryEvidenceDigest)) return null;
    const existing = await tx.conversationTurnJob.findFirst({ where: { id: jobId, projectId } });
    if (!existing || existing.status !== "failed" ||
        existing.failureRetryability !== "after_provider_health_change" ||
        existing.teacherMessageId !== input.teacherMessageId || existing.errorCode !== input.expectedErrorCode ||
        existing.attempts > existing.maxAttempts) return null;
    const evidenceDigest = input.recoveryEvidenceDigest.toLowerCase();
    if (existing.recoveryEvidenceDigest === evidenceDigest || existing.failureEvidenceDigest === evidenceDigest) return null;

    const aggregate = await tx.taskAggregate.findFirst({
      where: { taskId: input.taskId, projectId, intentEpoch: input.intentEpoch, status: "paused_recovery" },
    });
    if (!aggregate) return null;
    const aggregateTaskBrief = parseRecord(aggregate.taskBriefJson);
    if (aggregateTaskBrief.taskId !== input.taskId || aggregateTaskBrief.projectId !== projectId ||
        aggregateTaskBrief.intentEpoch !== input.intentEpoch ||
        aggregateTaskBrief.sourceMessageId !== input.teacherMessageId) return null;
    const teacherMessage = await tx.conversationMessage.findFirst({
      where: { id: input.teacherMessageId, projectId, role: "teacher" },
      select: { metadataJson: true },
    });
    if (!teacherMessage) return null;
    const messageTaskBrief = parseRecord(parseRecord(teacherMessage.metadataJson).taskBrief);
    if (messageTaskBrief.taskId !== input.taskId || messageTaskBrief.projectId !== projectId ||
        messageTaskBrief.intentEpoch !== input.intentEpoch) return null;
    const activeJobCount = await tx.conversationTurnJob.count({
      where: { projectId, status: { in: ["queued", "running"] }, id: { not: existing.id } },
    });
    if (activeJobCount !== 0) return null;

    return tx.conversationTurnJob.update({
      where: { id: existing.id },
      data: {
        status: "queued",
        ...(existing.attempts === existing.maxAttempts ? { maxAttempts: existing.maxAttempts + 1 } : {}),
        recoveryEvidenceDigest: evidenceDigest,
        lockedBy: null,
        lockedUntil: null,
        finishedAt: null,
      },
    });
  });
}

async function requeueConversationTurnJobAfterContractRepair(
  client: PrismaClient,
  projectId: string,
  jobId: string,
  input: RecoverConversationTurnAfterContractRepairInput,
) {
  return client.$transaction(async (tx) => {
    await assertActiveProjectForWrite(tx, projectId);
    if (input.projectId !== projectId || input.jobId !== jobId) return null;
    if (!requiredRecoveryText(input.teacherMessageId) || !requiredRecoveryText(input.taskId) ||
        !requiredRecoveryText(input.idempotencyKey) || !requiredRecoveryText(input.failureObservationId) ||
        !Number.isInteger(input.intentEpoch) || input.intentEpoch < 0 || !isSha256(input.taskBriefDigest) ||
        !isSha256(input.expectedFailureSignature) || !isSha256(input.repairEvidenceDigest)) return null;
    const existing = await tx.conversationTurnJob.findFirst({ where: { id: jobId, projectId } });
    if (!existing || existing.attempts < existing.maxAttempts ||
        existing.teacherMessageId !== input.teacherMessageId || existing.idempotencyKey !== input.idempotencyKey) return null;
    const failedAfterContractDefect = existing.status === "failed" &&
      ["main_agent_execution_failed", "control_plane_lifecycle_conflict", "main_agent_retry_budget_exhausted"]
        .includes(existing.errorCode ?? "") && existing.failureRetryability === "not_retryable";
    const legacyControlledPause = existing.status === "failed" && existing.errorCode === "turn_failed" &&
      existing.failureRetryability === null;
    const wronglySucceededIncompleteTask = existing.status === "succeeded";
    if (!failedAfterContractDefect && !legacyControlledPause && !wronglySucceededIncompleteTask) return null;
    const repairDigest = input.repairEvidenceDigest.toLowerCase();
    if (repairDigest === input.expectedFailureSignature.toLowerCase() || existing.recoveryEvidenceDigest === repairDigest) return null;

    const aggregate = await tx.taskAggregate.findFirst({
      where: {
        taskId: input.taskId,
        projectId,
        intentEpoch: input.intentEpoch,
        status: { in: ["active", "paused_recovery"] },
      },
    });
    if (!aggregate) return null;
    const aggregateTaskBrief = parseRecord(aggregate.taskBriefJson);
    if (aggregateTaskBrief.digest !== input.taskBriefDigest || aggregateTaskBrief.taskId !== input.taskId ||
        aggregateTaskBrief.projectId !== projectId || aggregateTaskBrief.intentEpoch !== input.intentEpoch ||
        aggregateTaskBrief.sourceMessageId !== input.teacherMessageId) return null;
    const teacherMessage = await tx.conversationMessage.findFirst({
      where: { id: input.teacherMessageId, projectId, role: "teacher" },
      select: { metadataJson: true },
    });
    if (!teacherMessage) return null;
    const messageTaskBrief = parseRecord(parseRecord(teacherMessage.metadataJson).taskBrief);
    if (messageTaskBrief.digest !== input.taskBriefDigest || messageTaskBrief.taskId !== input.taskId ||
        messageTaskBrief.projectId !== projectId || messageTaskBrief.intentEpoch !== input.intentEpoch) return null;
    const failureObservation = await tx.observationRecord.findFirst({
      where: {
        observationId: input.failureObservationId,
        projectId,
        taskId: input.taskId,
        intentEpoch: input.intentEpoch,
        status: { in: ["failed", "blocked", "inconclusive"] },
      },
      select: { payloadJson: true },
    });
    if (!failureObservation ||
        parseRecord(failureObservation.payloadJson).failureSignature !== input.expectedFailureSignature.toLowerCase()) return null;
    if (legacyControlledPause && aggregate.status !== "paused_recovery") return null;
    const activeJobCount = await tx.conversationTurnJob.count({
      where: { projectId, status: { in: ["queued", "running"] }, id: { not: existing.id } },
    });
    if (activeJobCount !== 0) return null;
    return tx.conversationTurnJob.update({
      where: { id: existing.id },
      data: {
        status: "queued",
        maxAttempts: existing.maxAttempts + 1,
        recoveryEvidenceDigest: repairDigest,
        lockedBy: null,
        lockedUntil: null,
        finishedAt: null,
      },
    });
  });
}
