import type { WorkbenchActor } from "@/server/auth/actor";
import { createPrismaWorkbenchRepository, type WorkbenchRepository } from "./repository";
import type {
  ExecutionIdentitySnapshot,
  ProjectExecutionFence,
  ProjectExecutionGuard,
} from "./types";
import { createWorkbenchArtifactService } from "./workbench-artifact-service";
import { createWorkbenchGenerationService } from "./workbench-generation-service";
import { createWorkbenchMessageService } from "./workbench-message-service";
import { createWorkbenchProjectService } from "./workbench-project-service";
import { createWorkbenchServiceContext } from "./workbench-service-context";
import { createWorkbenchSnapshotService } from "./workbench-snapshot-service";
import { createWorkbenchTurnJobService } from "./workbench-turn-job-service";
import { createWorkbenchVideoShotService } from "./workbench-video-shot-service";

export function createWorkbenchService(
  repository: WorkbenchRepository = createPrismaWorkbenchRepository(),
  actor?: WorkbenchActor,
  executionIdentity?: ExecutionIdentitySnapshot,
  executionGuard?: ProjectExecutionGuard,
) {
  const context = createWorkbenchServiceContext({
    repository,
    actor,
    executionIdentity,
    executionGuard,
  });
  return {
    ...createWorkbenchProjectService(context),
    ...createWorkbenchMessageService(context),
    ...createWorkbenchArtifactService(context),
    ...createWorkbenchGenerationService(context),
    ...createWorkbenchVideoShotService(context),
    ...createWorkbenchTurnJobService(context),
    ...createWorkbenchSnapshotService(context),

    getExecutionIdentity() {
      return executionIdentity;
    },

    withExecutionGuard(guard: ProjectExecutionGuard) {
      return createWorkbenchService(repository, actor, guard.identity, guard);
    },

    acquireProjectExecutionLease(input: { projectId: string; holderId: string; leaseMs?: number; now?: Date }) {
      return repository.acquireProjectExecutionLease(input);
    },

    renewProjectExecutionLease(input: ProjectExecutionFence & { leaseMs?: number; now?: Date }) {
      return repository.renewProjectExecutionLease(input);
    },

    releaseProjectExecutionLease(fence: ProjectExecutionFence, now?: Date) {
      return repository.releaseProjectExecutionLease(fence, now);
    },
  };
}
