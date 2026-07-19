import type {
  CreateGenerationJobInput,
  FailGenerationJobInput,
  GenerationJobRecord,
  RecordGenerationProviderTaskInput,
} from "./types";
import type { WorkbenchServiceContext } from "./workbench-service-context";
import { mapGenerationJob } from "./workbench-service-mappers";

export function createWorkbenchGenerationService(context: WorkbenchServiceContext) {
  const { ensureProjectAccess, executionGuard, repository } = context;
  return {
    async createGenerationJob(projectId: string, input: CreateGenerationJobInput): Promise<GenerationJobRecord> {
      await ensureProjectAccess(projectId, "generate");
      const sourceArtifact = await repository.getArtifact(projectId, input.sourceArtifactId);
      if (!sourceArtifact) throw new Error(`Artifact not found: ${input.sourceArtifactId}`);
      return mapGenerationJob(await repository.createGenerationJob(projectId, input, executionGuard));
    },

    async startGenerationJob(projectId: string, jobId: string): Promise<GenerationJobRecord> {
      await ensureProjectAccess(projectId, "generate");
      return mapGenerationJob(await repository.startGenerationJob(projectId, jobId));
    },

    async startGenerationJobForExecution(projectId: string, jobId: string) {
      await ensureProjectAccess(projectId, "generate");
      const job = await repository.startGenerationJob(projectId, jobId);
      return {
        job: mapGenerationJob(job),
        providerTaskId: job.providerTaskId,
        pollState: job.pollState,
      };
    },

    async failGenerationJob(
      projectId: string,
      jobId: string,
      input: FailGenerationJobInput,
    ): Promise<GenerationJobRecord> {
      await ensureProjectAccess(projectId, "generate");
      return mapGenerationJob(await repository.failGenerationJob(projectId, jobId, input));
    },

    async getGenerationJobs(projectId: string): Promise<GenerationJobRecord[]> {
      await ensureProjectAccess(projectId);
      return (await repository.getGenerationJobs(projectId)).map(mapGenerationJob);
    },

    async recordGenerationProviderTask(
      projectId: string,
      jobId: string,
      input: RecordGenerationProviderTaskInput,
    ): Promise<GenerationJobRecord> {
      await ensureProjectAccess(projectId, "generate");
      return mapGenerationJob(await repository.recordGenerationProviderTask(projectId, jobId, input));
    },

    async markGenerationSubmissionUnknown(
      projectId: string,
      jobId: string,
      errorMessage: string,
    ): Promise<GenerationJobRecord> {
      await ensureProjectAccess(projectId, "generate");
      return mapGenerationJob(await repository.markGenerationSubmissionUnknown(projectId, jobId, errorMessage));
    },

    async recordGenerationPoll(projectId: string, jobId: string): Promise<GenerationJobRecord> {
      await ensureProjectAccess(projectId, "generate");
      return mapGenerationJob(await repository.recordGenerationPoll(projectId, jobId));
    },

    async completeGenerationUnit(
      projectId: string,
      jobId: string,
      input: { providerResultJson: string },
    ): Promise<GenerationJobRecord> {
      await ensureProjectAccess(projectId, "generate");
      return mapGenerationJob(await repository.completeGenerationUnit(projectId, jobId, input));
    },
  };
}
