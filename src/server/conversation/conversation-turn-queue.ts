import type { AgentRuntime } from "@/server/agent-runtime/types";
import { createConversationTurnService, type MessageTurnResponse } from "@/server/conversation/conversation-turn-service";
import type { MainConversationAgent } from "@/server/conversation/main-conversation-agent";
import type { createWorkbenchService } from "@/server/workbench/service";
import type { ConversationTurnJobRecord } from "@/server/workbench/types";
import type { ExecutionIdentitySnapshot, ProjectExecutionFence } from "@/server/workbench/types";
import type { AgentToolInvocationEnvelope } from "@/server/tools/agent-tool-invocation";
import type { AgentToolExecutor } from "@/server/tools/agent-tool-types";
import { randomUUID } from "node:crypto";

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
};

export type DrainProjectConversationQueueResult = {
  started: number;
  succeeded: number;
  failed: number;
};

const activeProjectDrains = new Set<string>();

export async function drainProjectConversationQueue(
  projectId: string,
  options: DrainProjectConversationQueueOptions,
): Promise<DrainProjectConversationQueueResult> {
  if (activeProjectDrains.has(projectId)) {
    return { started: 0, succeeded: 0, failed: 0 };
  }

  activeProjectDrains.add(projectId);
  const result: DrainProjectConversationQueueResult = { started: 0, succeeded: 0, failed: 0 };
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
        } else {
          const completed = await executionService.finishConversationTurnJob(projectId, job.id, {
            assistantMessageId: execution.assistantMessageId,
            status: "succeeded",
          });
          if (completed.status === "quarantined") {
            result.failed += 1;
            continue;
          }
        }
        result.succeeded += 1;
      } catch (error) {
        const failure = normalizeExecutionFailure(error);
        await executionService.failConversationTurnJob(projectId, job.id, failure).catch(() => null);
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
    });
    const response = await turnService.executeQueuedTurn(projectId, { teacherMessageId: job.teacherMessageId });
    if (isFailedTurn(response)) {
      throw new ConversationTurnJobFailure({
        assistantMessageId: response.assistantMessage?.id,
        errorCode: "turn_failed",
        errorMessage: response.assistantMessage?.content ?? "这条消息暂时没有生成成功，请稍后重试。",
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

  constructor(input: { assistantMessageId?: string; errorCode?: string; errorMessage: string }) {
    super(input.errorMessage);
    this.name = "ConversationTurnJobFailure";
    this.assistantMessageId = input.assistantMessageId;
    this.errorCode = input.errorCode;
  }
}

function normalizeExecutionFailure(error: unknown) {
  if (error instanceof ConversationTurnJobFailure) {
    return {
      assistantMessageId: error.assistantMessageId,
      errorCode: error.errorCode,
      errorMessage: sanitizeTeacherVisibleError(error.message),
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
  if (/schema|provider|node_id|capabilityId|runtimeKind|storage|local path|debug|token/i.test(trimmed)) return fallback;
  return trimmed;
}
