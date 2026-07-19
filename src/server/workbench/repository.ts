import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { createArtifactRepository } from "./artifact-repository";
import { createConversationTurnCompletionRepository } from "./conversation-turn-completion-repository";
import { createConversationTurnEnqueueRepository } from "./conversation-turn-enqueue-repository";
import { createConversationTurnRecoveryRepository } from "./conversation-turn-recovery-repository";
import { createExecutionGuardRepository } from "./execution-guard-repository";
import { createGenerationJobRepository } from "./generation-job-repository";
import { createMessageRepository } from "./message-repository";
import { createProjectRepository } from "./project-repository";
import { createVideoShotRepository } from "./video-shot-repository";

export { GenerationJobIdempotencyConflictError } from "./generation-job-repository";

export type WorkbenchRepository = ReturnType<typeof createPrismaWorkbenchRepository>;

export function createPrismaWorkbenchRepository(client: PrismaClient = prisma) {
  return {
    ...createProjectRepository(client),
    ...createMessageRepository(client),
    ...createArtifactRepository(client),
    ...createGenerationJobRepository(client),
    ...createConversationTurnEnqueueRepository(client),
    ...createConversationTurnCompletionRepository(client),
    ...createConversationTurnRecoveryRepository(client),
    ...createVideoShotRepository(client),
    ...createExecutionGuardRepository(client),
  };
}
