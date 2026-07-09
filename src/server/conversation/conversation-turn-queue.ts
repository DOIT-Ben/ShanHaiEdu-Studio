import type { AgentRuntime } from "@/server/agent-runtime/types";
import { createConversationTurnService, type MessageTurnResponse } from "@/server/conversation/conversation-turn-service";
import type { MainConversationAgent } from "@/server/conversation/main-conversation-agent";
import type { createWorkbenchService } from "@/server/workbench/service";
import type { ConversationTurnJobRecord } from "@/server/workbench/types";

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
}) => Promise<ConversationTurnJobExecutorResult>;

export type DrainProjectConversationQueueOptions = {
  service: WorkbenchService;
  runtime?: AgentRuntime;
  agent?: MainConversationAgent;
  executor?: ConversationTurnJobExecutor;
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

  try {
    const executor = options.executor ?? createDefaultExecutor(options);
    while (true) {
      const job = await options.service.startNextConversationTurnJob(projectId);
      if (!job) break;
      if (job.status !== "running") {
        if (job.status === "failed") result.failed += 1;
        continue;
      }

      result.started += 1;
      try {
        const execution = await executor({ projectId, job, service: options.service });
        if (execution.status === "blocked") {
          await options.service.finishConversationTurnJob(projectId, job.id, {
            assistantMessageId: execution.assistantMessageId,
            status: "blocked",
            errorCode: execution.errorCode,
            errorMessage: execution.errorMessage,
          });
        } else {
          await options.service.finishConversationTurnJob(projectId, job.id, {
            assistantMessageId: execution.assistantMessageId,
            status: "succeeded",
          });
        }
        result.succeeded += 1;
      } catch (error) {
        const failure = normalizeExecutionFailure(error);
        await options.service.failConversationTurnJob(projectId, job.id, failure);
        result.failed += 1;
      }
    }
  } finally {
    activeProjectDrains.delete(projectId);
  }

  return result;
}

function createDefaultExecutor(options: DrainProjectConversationQueueOptions): ConversationTurnJobExecutor {
  if (!options.runtime) {
    throw new Error("Conversation turn queue drain requires an AgentRuntime when no executor is provided.");
  }
  const turnService = createConversationTurnService({ service: options.service, runtime: options.runtime, agent: options.agent });

  return async ({ projectId, job }) => {
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
