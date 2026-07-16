import { createHash } from "node:crypto";

import type { createControlPlaneStore } from "@/server/conversation/control-plane-store";
import type { createWorkbenchService } from "@/server/workbench/service";

type WorkbenchService = ReturnType<typeof createWorkbenchService>;
type ControlPlaneStore = ReturnType<typeof createControlPlaneStore>;

export async function recoverConversationTurnFromCheckpoint(input: {
  projectId: string;
  checkpointId: string;
  service: WorkbenchService;
  controlPlaneStore: ControlPlaneStore;
}) {
  const checkpointId = requiredText(input.checkpointId, "checkpointId");
  const [jobs, messages] = await Promise.all([
    input.service.getConversationTurnJobs(input.projectId),
    input.service.getMessages(input.projectId),
  ]);
  const messagesById = new Map(messages.map((message) => [message.id, message]));
  const candidates = jobs.filter((job) => {
    if (job.status !== "failed" || job.attempts >= job.maxAttempts || job.failureRetryability !== "retryable") return false;
    const relatedMessages = [messagesById.get(job.teacherMessageId), job.assistantMessageId ? messagesById.get(job.assistantMessageId) : undefined];
    return relatedMessages.some((message) => checkpointIdFromMetadata(message?.metadata) === checkpointId);
  });
  if (candidates.length !== 1) throw new Error("Conversation recovery checkpoint does not identify one retryable failed turn.");

  const failedJob = candidates[0];
  const teacherMessage = messagesById.get(failedJob.teacherMessageId);
  if (!teacherMessage) throw new Error("Conversation recovery teacher message was not found.");
  const taskBrief = recordValue(teacherMessage.metadata.taskBrief);
  const taskId = requiredText(taskBrief?.taskId, "taskBrief.taskId");
  const intentEpoch = nonNegativeInteger(taskBrief?.intentEpoch, "taskBrief.intentEpoch");
  const aggregate = await input.controlPlaneStore.getTaskAggregate(input.projectId, intentEpoch);
  if (
    !aggregate ||
    aggregate.taskBrief.taskId !== taskId ||
    aggregate.taskBrief.projectId !== input.projectId ||
    currentCheckpointId(aggregate.checkpoint) !== checkpointId
  ) {
    throw new Error("Conversation recovery checkpoint is not bound to the active task aggregate.");
  }

  const recoveryEvidenceDigest = createHash("sha256").update(JSON.stringify({
    projectId: input.projectId,
    taskId,
    intentEpoch,
    turnJobId: failedJob.id,
    checkpointId,
    failureEvidenceDigest: failedJob.failureEvidenceDigest,
  })).digest("hex");
  const recovered = await input.service.requeueConversationTurnJobForRecovery(input.projectId, failedJob.id, {
    recoveryEvidenceDigest,
  });
  if (!recovered) throw new Error("Conversation recovery checkpoint has already been used or is no longer retryable.");
  return { message: teacherMessage, job: recovered };
}

function currentCheckpointId(checkpoint: Record<string, unknown> | null) {
  if (!checkpoint) return undefined;
  const value = typeof checkpoint.checkpointId === "string"
    ? checkpoint.checkpointId
    : checkpoint.checkpointDigest;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function checkpointIdFromMetadata(metadata: Record<string, unknown> | undefined) {
  const checkpoint = recordValue(metadata?.agentRunCheckpoint);
  return typeof checkpoint?.checkpointId === "string" && checkpoint.checkpointId.trim()
    ? checkpoint.checkpointId.trim()
    : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function requiredText(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Conversation recovery ${field} is required.`);
  return value.trim();
}

function nonNegativeInteger(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Conversation recovery ${field} is invalid.`);
  }
  return value;
}
