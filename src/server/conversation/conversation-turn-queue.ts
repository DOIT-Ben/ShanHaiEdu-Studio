import type { AgentRuntime } from "@/server/agent-runtime/types";
import { createConversationTurnService, type MessageTurnResponse } from "@/server/conversation/conversation-turn-service";
import type { MainConversationAgent } from "@/server/conversation/main-conversation-agent";
import type { createWorkbenchService } from "@/server/workbench/service";
import type { ConversationTurnJobRecord } from "@/server/workbench/types";
import type { ExecutionIdentitySnapshot, ProjectExecutionFence } from "@/server/workbench/types";
import type { AgentToolInvocationEnvelope } from "@/server/tools/agent-tool-invocation";
import type { AgentToolExecutor } from "@/server/tools/agent-tool-types";
import { collectPersistentTeacherMessageParts } from "@/lib/teacher-agent-events";
import { randomUUID } from "node:crypto";
import type { MainAgentFailure } from "./main-agent-failure";
import { createControlPlaneStore } from "./control-plane-store";
import { evaluateTaskCompletionContract } from "./task-completion-contract";
import { hasValidTaskBrief, type TaskBrief } from "./task-contract";

type WorkbenchService = ReturnType<typeof createWorkbenchService>;

export type ConversationTurnJobExecutorResult = {
  assistantMessageId?: string;
  status?: "succeeded" | "blocked";
  errorCode?: string;
  errorMessage?: string;
};

export type ConversationTurnJobExecutor = (input: {
  projectId: string;
  job: ConversationTurnJobRecord;
  service: WorkbenchService;
  fence: ProjectExecutionFence;
}) => Promise<ConversationTurnJobExecutorResult>;

export type DrainProjectConversationQueueOptions = {
  service: WorkbenchService;
  runtime?: AgentRuntime;
  agent?: MainConversationAgent;
  executor?: ConversationTurnJobExecutor;
  workerId?: string;
  leaseMs?: number;
  agentToolExecutor?: AgentToolExecutor<AgentToolInvocationEnvelope>;
  enableTaskGrantAutonomy?: boolean;
  enableNativeToolControlPlane?: boolean;
};

export type DrainProjectConversationQueueResult = {
  started: number;
  succeeded: number;
  blocked: number;
  failed: number;
};

const activeProjectDrains = new Set<string>();

export async function drainProjectConversationQueue(
  projectId: string,
  options: DrainProjectConversationQueueOptions,
): Promise<DrainProjectConversationQueueResult> {
  if (activeProjectDrains.has(projectId)) {
    return { started: 0, succeeded: 0, blocked: 0, failed: 0 };
  }

  activeProjectDrains.add(projectId);
  const result: DrainProjectConversationQueueResult = { started: 0, succeeded: 0, blocked: 0, failed: 0 };
  const holderId = options.workerId?.trim() || `conversation-worker-${randomUUID()}`;
  const leaseMs = options.leaseMs ?? 10 * 60 * 1000;
  const lease = await options.service.acquireProjectExecutionLease({ projectId, holderId, leaseMs }).catch((error) => {
    activeProjectDrains.delete(projectId);
    throw error;
  });
  if (!lease) {
    activeProjectDrains.delete(projectId);
    return result;
  }
  const fence: ProjectExecutionFence = { projectId, holderId, fencingToken: lease.fencingToken };
  const stopHeartbeat = startLeaseHeartbeat(options.service, fence, leaseMs);

  try {
    const executor = options.executor ?? createDefaultExecutor(options);
    while (true) {
      const job = await options.service.startNextConversationTurnJob(projectId, {
        lockedBy: holderId,
        lockMs: leaseMs,
        fence,
      });
      if (!job) break;
      if (job.status !== "running") {
        if (job.status === "failed" || job.status === "quarantined") result.failed += 1;
        continue;
      }

      result.started += 1;
      const executionService = options.service.withExecutionGuard({
        ...fence,
        identity: readJobExecutionIdentity(job),
      });
      try {
        await appendConversationRunStartedEvent({ projectId, job, service: options.service });
        const execution = await executor({ projectId, job, service: executionService, fence });
        await options.service.renewProjectExecutionLease({ ...fence, leaseMs });
        if (execution.status === "blocked") {
          const completed = await executionService.finishConversationTurnJob(projectId, job.id, {
            assistantMessageId: execution.assistantMessageId,
            status: "blocked",
            errorCode: execution.errorCode,
            errorMessage: execution.errorMessage,
          });
          if (completed.status === "quarantined") {
            result.failed += 1;
            continue;
          }
          await appendTerminalConversationEvents({ projectId, job: completed, service: options.service, assistantMessageId: completed.assistantMessageId, status: "blocked" });
          result.blocked += 1;
        } else {
          const taskTerminal = await resolveTaskTerminalState({
            projectId,
            job,
            service: options.service,
          });
          const completionBlocked = taskTerminal?.status === "paused_recovery";
          const completed = await executionService.finishConversationTurnJob(projectId, job.id, {
            assistantMessageId: execution.assistantMessageId,
            status: completionBlocked ? "blocked" : "succeeded",
            ...(completionBlocked ? {
              errorCode: "completion_contract_unsatisfied",
              errorMessage: "当前任务仍有未完成的交付，进度已保存。",
            } : {}),
            ...(taskTerminal ? { taskTerminal } : {}),
          });
          if (completed.status === "quarantined") {
            result.failed += 1;
            continue;
          }
          await appendTerminalConversationEvents({
            projectId,
            job: completed,
            service: options.service,
            assistantMessageId: completed.assistantMessageId,
            status: completionBlocked ? "blocked" : "succeeded",
          });
          if (completionBlocked) result.blocked += 1;
          else result.succeeded += 1;
        }
      } catch (error) {
        const failure = normalizeExecutionFailure(error);
        const failed = await executionService.failConversationTurnJob(projectId, job.id, failure);
        await appendTerminalConversationEvents({ projectId, job: failed, service: options.service, assistantMessageId: failed.assistantMessageId, status: "failed" });
        result.failed += 1;
      }
    }
  } finally {
    stopHeartbeat();
    await options.service.releaseProjectExecutionLease(fence).catch(() => false);
    activeProjectDrains.delete(projectId);
  }

  return result;
}

async function resolveTaskTerminalState(input: {
  projectId: string;
  job: ConversationTurnJobRecord;
  service: WorkbenchService;
}) {
  const messages = await input.service.getMessages(input.projectId);
  const teacherMessage = messages.find((message) => message.id === input.job.teacherMessageId);
  const candidate = teacherMessage?.metadata.taskBrief;
  if (!candidate || typeof candidate !== "object" || !hasValidTaskBrief(candidate as TaskBrief)) return null;
  const taskBrief = candidate as TaskBrief;
  const store = createControlPlaneStore();
  const aggregate = await store.getTaskAggregate(input.projectId, taskBrief.intentEpoch);
  if (!aggregate || aggregate.taskBrief.taskId !== taskBrief.taskId || aggregate.taskBrief.digest !== taskBrief.digest) {
    throw new Error("TaskAggregate is missing for the queued task terminal transition.");
  }
  const artifacts = await input.service.getArtifacts(input.projectId);
  const completion = evaluateTaskCompletionContract(taskBrief, artifacts);
  if (completion.status === "satisfied") {
    return {
      taskId: taskBrief.taskId,
      intentEpoch: taskBrief.intentEpoch,
      taskBriefDigest: taskBrief.digest,
      status: "completed" as const,
      checkpoint: null,
    };
  }
  return {
    taskId: taskBrief.taskId,
    intentEpoch: taskBrief.intentEpoch,
    taskBriefDigest: taskBrief.digest,
    status: "paused_recovery" as const,
    checkpoint: aggregate.checkpoint ?? {
      schemaVersion: "task-completion-checkpoint.v1",
      checkpointId: `completion:${input.job.id}:${taskBrief.digest.slice(0, 12)}`,
      projectId: input.projectId,
      taskId: taskBrief.taskId,
      intentEpoch: taskBrief.intentEpoch,
      reasonCode: "completion_contract_unsatisfied",
      remainingRequestedOutputs: completion.remainingRequestedOutputs,
    },
  };
}

async function appendConversationRunStartedEvent(input: {
  projectId: string;
  job: ConversationTurnJobRecord;
  service: WorkbenchService;
}) {
  try {
    const [project, messages] = await Promise.all([
      input.service.getProject(input.projectId),
      input.service.getMessages(input.projectId),
    ]);
    const teacherMessage = messages.find((message) => message.id === input.job.teacherMessageId);
    const taskBrief = recordValue(teacherMessage?.metadata.taskBrief);
    const taskId = optionalText(taskBrief?.taskId) ?? `conversation-turn:${input.job.id}`;
    const intentEpoch = nonNegativeInteger(taskBrief?.intentEpoch) ?? project.intentEpoch ?? 0;
    await createControlPlaneStore().appendEvent({
      eventId: randomUUID(),
      projectId: input.projectId,
      taskId,
      runId: `turn:${input.job.teacherMessageId}`,
      intentEpoch,
      kind: "run_started",
      visibility: "teacher",
      occurredAt: new Date().toISOString(),
      payload: {
        status: "running",
        teacherMessageId: input.job.teacherMessageId,
      },
    });
  } catch {
    // Event projection must not become a second execution path.
  }
}

async function appendTerminalConversationEvents(input: {
  projectId: string;
  job: ConversationTurnJobRecord;
  service: WorkbenchService;
  assistantMessageId: string | null | undefined;
  status: "succeeded" | "blocked" | "failed";
}) {
  try {
    const [project, messages] = await Promise.all([
      input.service.getProject(input.projectId),
      input.service.getMessages(input.projectId),
    ]);
    const teacherMessage = messages.find((message) => message.id === input.job.teacherMessageId);
    const assistantMessage = input.assistantMessageId
      ? messages.find((message) => message.id === input.assistantMessageId)
      : undefined;
    const taskBrief = recordValue(teacherMessage?.metadata.taskBrief);
    const taskId = optionalText(taskBrief?.taskId) ?? `conversation-turn:${input.job.id}`;
    const intentEpoch = nonNegativeInteger(taskBrief?.intentEpoch) ?? project.intentEpoch ?? 0;
    const runId = `turn:${input.job.teacherMessageId}`;
    const store = createControlPlaneStore();
    if (assistantMessage?.content.trim()) {
      await store.appendEvent({
        eventId: randomUUID(),
        projectId: input.projectId,
        taskId,
        runId,
        intentEpoch,
        kind: "text_completed",
        visibility: "teacher",
        occurredAt: new Date().toISOString(),
        payload: { messageId: assistantMessage.id, text: assistantMessage.content },
      });
    }
    await store.appendEvent({
      eventId: randomUUID(),
      projectId: input.projectId,
      taskId,
      runId,
      intentEpoch,
      kind: input.status === "succeeded" ? "run_completed" : "run_failed",
      visibility: "teacher",
      occurredAt: new Date().toISOString(),
      payload: {
        status: input.status,
        ...(assistantMessage ? { messageId: assistantMessage.id } : {}),
        ...(input.job.errorCode ? {
          reasonCode: input.job.errorCode,
          label: terminalFailureLabel(input.status, input.job.errorCode),
        } : {}),
      },
    });
    if (assistantMessage) {
      const agentTimeline = collectPersistentTeacherMessageParts(
        await store.listEvents(input.projectId),
        runId,
      );
      await input.service.updateMessageMetadata(input.projectId, assistantMessage.id, {
        ...assistantMessage.metadata,
        ...(agentTimeline.length ? { agentTimeline } : {}),
      });
    }
  } catch {
    // The durable message and TurnJob are already committed; a later snapshot remains a safe recovery path.
  }
}

function terminalFailureLabel(status: "succeeded" | "blocked" | "failed", reasonCode: string) {
  if (status === "succeeded") return "本轮任务已经完成";
  if (reasonCode === "completion_contract_unsatisfied") return "当前交付仍未完成，进度和恢复入口已保存";
  if (reasonCode === "turn_execution_failed") return "恢复当前任务时未完成，失败位置已保存";
  if (reasonCode.startsWith("main_agent_provider_")) return "智能服务请求未完成，失败位置已保存";
  return "当前步骤未完成，失败位置已保存";
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function nonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function readJobExecutionIdentity(job: ConversationTurnJobRecord): ExecutionIdentitySnapshot {
  if (!job.actorUserId || !isExecutionAuthMode(job.actorAuthMode)) {
    throw new Error("Conversation turn job execution identity is missing.");
  }
  return {
    actorUserId: job.actorUserId,
    actorAuthMode: job.actorAuthMode,
    authSessionId: job.authSessionId,
  };
}

function isExecutionAuthMode(value: string | null): value is ExecutionIdentitySnapshot["actorAuthMode"] {
  return value === "local" || value === "password" || value === "oauth" || value === "sso";
}

function startLeaseHeartbeat(service: WorkbenchService, fence: ProjectExecutionFence, leaseMs: number) {
  const intervalMs = Math.max(25, Math.floor(leaseMs / 3));
  const timer = setInterval(() => {
    void service.renewProjectExecutionLease({ ...fence, leaseMs }).catch(() => null);
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

function createDefaultExecutor(options: DrainProjectConversationQueueOptions): ConversationTurnJobExecutor {
  if (!options.runtime) {
    throw new Error("Conversation turn queue drain requires an AgentRuntime when no executor is provided.");
  }
  return async ({ projectId, job, service, fence }) => {
    const turnService = createConversationTurnService({
      service,
      runtime: options.runtime!,
      agent: options.agent,
      agentToolExecutor: options.agentToolExecutor,
      executionIdentity: readJobExecutionIdentity(job),
      executionFence: fence,
      generationIntensityOverride: job.generationIntensity,
      enableTaskGrantAutonomy: options.enableTaskGrantAutonomy,
      enableNativeToolControlPlane: options.enableNativeToolControlPlane,
    });
    const response = await turnService.executeQueuedTurn(projectId, { teacherMessageId: job.teacherMessageId });
    if (isFailedTurn(response)) {
      const failure = response.agentTurn?.failure;
      throw new ConversationTurnJobFailure({
        assistantMessageId: response.assistantMessage?.id,
        errorCode: failure?.reasonCode ?? "turn_failed",
        errorMessage: failure?.summary ?? response.assistantMessage?.content ?? "这条消息暂时没有生成成功，请稍后重试。",
        failure,
      });
    }

    return { assistantMessageId: response.assistantMessage?.id };
  };
}

function isFailedTurn(response: MessageTurnResponse) {
  return typeof response.agentTurn?.state === "string" && response.agentTurn.state.startsWith("failed");
}

class ConversationTurnJobFailure extends Error {
  readonly assistantMessageId?: string;
  readonly errorCode?: string;
  readonly failure?: MainAgentFailure;

  constructor(input: { assistantMessageId?: string; errorCode?: string; errorMessage: string; failure?: MainAgentFailure }) {
    super(input.errorMessage);
    this.name = "ConversationTurnJobFailure";
    this.assistantMessageId = input.assistantMessageId;
    this.errorCode = input.errorCode;
    this.failure = input.failure;
  }
}

function normalizeExecutionFailure(error: unknown) {
  if (error instanceof ConversationTurnJobFailure) {
    return {
      assistantMessageId: error.assistantMessageId,
      errorCode: error.errorCode,
      errorMessage: sanitizeTeacherVisibleError(error.message),
      failureCategory: error.failure?.category,
      retryability: error.failure?.retryability,
      failureEvidenceDigest: error.failure?.evidenceDigest,
    };
  }

  return {
    errorCode: "turn_execution_failed",
    errorMessage: sanitizeTeacherVisibleError(error instanceof Error ? error.message : "这条消息暂时没有生成成功，请稍后重试。"),
  };
}

function sanitizeTeacherVisibleError(message: string) {
  const fallback = "这条消息暂时没有生成成功，请稍后重试。";
  const trimmed = message.trim();
  if (!trimmed) return fallback;
  if (/schema|provider|node_id|capabilityId|runtimeKind|storage|local path|debug|token|task aggregate|intentepoch|identity cannot change/i.test(trimmed)) return fallback;
  return trimmed;
}
