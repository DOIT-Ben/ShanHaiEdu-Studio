import type {
  ConversationMessageRecord,
  ConversationTurnJobRecord,
  EnqueueMessageAndConversationTurnInput,
  EnqueueConversationTurnInput,
  FailConversationTurnInput,
  FinishConversationTurnInput,
  ProjectExecutionFence,
  RecoverConversationTurnAfterContractRepairInput,
  RecoverConversationTurnAfterProviderHealthInput,
  RecoverConversationTurnInput,
} from "./types";
import { projectMessageParts } from "./workbench-message-service";
import type { WorkbenchServiceContext } from "./workbench-service-context";
import { mapConversationTurnJob, mapMessage } from "./workbench-service-mappers";

export function createWorkbenchTurnJobService(context: WorkbenchServiceContext) {
  const { ensureProjectAccess, executionGuard, executionIdentity, repository } = context;
  return {
    async enqueueConversationTurn(
      projectId: string,
      input: EnqueueConversationTurnInput,
    ): Promise<ConversationTurnJobRecord> {
      await ensureProjectAccess(projectId, "write");
      const job = await repository.enqueueConversationTurn(projectId, { ...input, executionIdentity });
      return mapConversationTurnJob(job);
    },

    async enqueueMessageAndConversationTurn(
      projectId: string,
      input: EnqueueMessageAndConversationTurnInput,
    ): Promise<{ message: ConversationMessageRecord; job: ConversationTurnJobRecord }> {
      await ensureProjectAccess(projectId, "write");
      const result = await repository.enqueueMessageAndConversationTurn(projectId, {
        ...await projectMessageParts(context, projectId, input),
        executionIdentity,
      });
      return { message: mapMessage(result.message), job: mapConversationTurnJob(result.job) };
    },

    async startNextConversationTurnJob(
      projectId: string,
      input: {
        lockedBy?: string;
        lockMs?: number;
        fence?: ProjectExecutionFence;
        now?: Date;
        expectedJobId?: string;
      } = {},
    ): Promise<ConversationTurnJobRecord | null> {
      await ensureProjectAccess(projectId, "generate");
      const job = await repository.startNextConversationTurnJob(projectId, input);
      return job ? mapConversationTurnJob(job) : null;
    },

    async finishConversationTurnJob(
      projectId: string,
      jobId: string,
      input: FinishConversationTurnInput,
    ): Promise<ConversationTurnJobRecord> {
      if (!executionGuard) await ensureProjectAccess(projectId, "generate");
      const job = await repository.finishConversationTurnJob(projectId, jobId, input, executionGuard);
      return mapConversationTurnJob(job);
    },

    async failConversationTurnJob(
      projectId: string,
      jobId: string,
      input: FailConversationTurnInput,
    ): Promise<ConversationTurnJobRecord> {
      if (!executionGuard) await ensureProjectAccess(projectId, "generate");
      const job = await repository.failConversationTurnJob(projectId, jobId, input, executionGuard);
      return mapConversationTurnJob(job);
    },

    async requeueConversationTurnJobForRecovery(
      projectId: string,
      jobId: string,
      input: RecoverConversationTurnInput,
    ): Promise<ConversationTurnJobRecord | null> {
      await ensureProjectAccess(projectId, "generate");
      const job = await repository.requeueConversationTurnJobForRecovery(projectId, jobId, input);
      return job ? mapConversationTurnJob(job) : null;
    },

    async requeueConversationTurnJobAfterProviderHealth(
      projectId: string,
      jobId: string,
      input: RecoverConversationTurnAfterProviderHealthInput,
    ): Promise<ConversationTurnJobRecord | null> {
      await ensureProjectAccess(projectId, "generate");
      const job = await repository.requeueConversationTurnJobAfterProviderHealth(projectId, jobId, input);
      return job ? mapConversationTurnJob(job) : null;
    },

    async requeueConversationTurnJobAfterContractRepair(
      projectId: string,
      jobId: string,
      input: RecoverConversationTurnAfterContractRepairInput,
    ): Promise<ConversationTurnJobRecord | null> {
      await ensureProjectAccess(projectId, "generate");
      const job = await repository.requeueConversationTurnJobAfterContractRepair(projectId, jobId, input);
      return job ? mapConversationTurnJob(job) : null;
    },

    async getConversationTurnJobs(projectId: string): Promise<ConversationTurnJobRecord[]> {
      await ensureProjectAccess(projectId);
      return (await repository.getConversationTurnJobs(projectId)).map(mapConversationTurnJob);
    },
  };
}
