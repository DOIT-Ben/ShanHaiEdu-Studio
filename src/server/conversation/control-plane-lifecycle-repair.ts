import type { PrismaClient } from "@/generated/prisma/client";
import { hashRunInput } from "@/server/execution/run-input-snapshot";

import { restoreSemanticContextSnapshot } from "./context-semantic-snapshot";
import { createAgentObservation } from "./react-control";
import type { TaskBrief } from "./task-contract";

const OLD_REASON_CODE = "main_agent_response_invalid";
const REPAIRED_REASON_CODE = "control_plane_lifecycle_conflict";

export async function repairControlPlaneLifecycleConflict(input: {
  client: PrismaClient;
  projectId: string;
  taskId: string;
  intentEpoch: number;
  jobId: string;
  teacherMessageId: string;
}) {
  return input.client.$transaction(async (tx) => {
    const [job, aggregate, teacherMessage, latestSnapshot, failureEvents] = await Promise.all([
      tx.conversationTurnJob.findUnique({ where: { id: input.jobId } }),
      tx.taskAggregate.findUnique({
        where: {
          projectId_intentEpoch: {
            projectId: input.projectId,
            intentEpoch: input.intentEpoch,
          },
        },
      }),
      tx.conversationMessage.findFirst({
        where: { id: input.teacherMessageId, projectId: input.projectId, role: "teacher" },
        select: { metadataJson: true },
      }),
      tx.semanticContextSnapshotRecord.findFirst({
        where: { projectId: input.projectId, taskId: input.taskId, intentEpoch: input.intentEpoch },
        orderBy: { planRevision: "desc" },
      }),
      tx.agentEventRecord.findMany({
        where: {
          projectId: input.projectId,
          taskId: input.taskId,
          intentEpoch: input.intentEpoch,
          kind: "run_failed",
        },
        orderBy: { sequence: "desc" },
        take: 20,
      }),
    ]);
    if (!job || job.projectId !== input.projectId || job.teacherMessageId !== input.teacherMessageId ||
        job.status !== "failed" || job.attempts < job.maxAttempts || job.errorCode !== OLD_REASON_CODE) {
      throw new Error("control_plane_lifecycle_repair_job_invalid");
    }
    if (!aggregate || aggregate.taskId !== input.taskId || !latestSnapshot ||
        latestSnapshot.planRevision <= aggregate.planRevision) {
      throw new Error("control_plane_lifecycle_repair_revision_invalid");
    }
    const taskBrief = parseRecord<TaskBrief>(aggregate.taskBriefJson);
    const snapshot = restoreSemanticContextSnapshot(parseRecord(latestSnapshot.payloadJson));
    if (taskBrief.taskId !== input.taskId || taskBrief.projectId !== input.projectId ||
        taskBrief.intentEpoch !== input.intentEpoch || taskBrief.sourceMessageId !== input.teacherMessageId ||
        snapshot.taskBrief.digest !== taskBrief.digest || snapshot.plan.revision !== latestSnapshot.planRevision) {
      throw new Error("control_plane_lifecycle_repair_snapshot_invalid");
    }
    const messageMetadata = parseRecord(teacherMessage?.metadataJson);
    const mainAgentFailure = isRecord(messageMetadata.mainAgentFailure) ? messageMetadata.mainAgentFailure : {};
    const failureEvent = failureEvents.find((event) => {
      const payload = parseRecord(event.payloadJson);
      return payload.reasonCode === OLD_REASON_CODE && typeof payload.observationId === "string";
    });
    const eventPayload = parseRecord(failureEvent?.payloadJson);
    const failureObservationId = requiredText(eventPayload.observationId);
    if (!failureEvent || mainAgentFailure.reasonCode !== OLD_REASON_CODE || eventPayload.reasonCode !== OLD_REASON_CODE) {
      throw new Error("control_plane_lifecycle_repair_failure_event_invalid");
    }
    const observation = createAgentObservation({
      observationId: failureObservationId,
      createdAt: failureEvent.occurredAt.toISOString(),
      projectId: input.projectId,
      source: "tool",
      status: "failed",
      actionKey: `main_agent_runtime:${input.teacherMessageId}`,
      inputHash: hashRunInput({
        taskId: taskBrief.taskId,
        taskBriefDigest: taskBrief.digest,
        intentEpoch: taskBrief.intentEpoch,
        sourceMessageId: input.teacherMessageId,
      }),
      reasonCodes: [REPAIRED_REASON_CODE],
      reportRefs: [],
      targetLocators: [],
      responsibleStage: "control_plane",
      minimalNextAction: "pause",
      teacherSafeSummary: "任务执行状态发生冲突，当前进度已保存并暂停恢复。",
    });
    const existingObservation = await tx.observationRecord.findUnique({
      where: { observationId: failureObservationId },
    });
    if (existingObservation) {
      const payload = parseRecord(existingObservation.payloadJson);
      if (payload.failureSignature !== observation.failureSignature) {
        throw new Error("control_plane_lifecycle_repair_observation_conflict");
      }
    } else {
      await tx.observationRecord.create({
        data: {
          observationId: observation.observationId,
          projectId: input.projectId,
          taskId: input.taskId,
          intentEpoch: input.intentEpoch,
          status: observation.status,
          reasonCodesJson: JSON.stringify(observation.reasonCodes),
          payloadJson: JSON.stringify(observation),
        },
      });
    }
    await tx.taskAggregate.update({
      where: { taskId: aggregate.taskId },
      data: {
        planId: snapshot.plan.planId,
        planRevision: snapshot.plan.revision,
        status: "paused_recovery",
      },
    });
    await tx.conversationTurnJob.update({
      where: { id: job.id },
      data: {
        errorCode: REPAIRED_REASON_CODE,
        errorMessage: observation.teacherSafeSummary,
        failureCategory: "control_plane",
        failureRetryability: "not_retryable",
      },
    });
    return {
      projectId: input.projectId,
      taskId: input.taskId,
      intentEpoch: input.intentEpoch,
      jobId: job.id,
      teacherMessageId: input.teacherMessageId,
      failureEventId: failureEvent.eventId,
      failureObservationId: observation.observationId,
      failureSignature: observation.failureSignature!,
      previousPlanRevision: aggregate.planRevision,
      restoredPlanRevision: snapshot.plan.revision,
      reasonCode: REPAIRED_REASON_CODE,
    };
  });
}

function parseRecord<T extends Record<string, unknown> = Record<string, unknown>>(value: unknown): T {
  if (isRecord(value)) return value as T;
  if (typeof value !== "string") throw new Error("control_plane_lifecycle_repair_record_invalid");
  const parsed = JSON.parse(value) as unknown;
  if (!isRecord(parsed)) throw new Error("control_plane_lifecycle_repair_record_invalid");
  return parsed as T;
}

function requiredText(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("control_plane_lifecycle_repair_text_invalid");
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
