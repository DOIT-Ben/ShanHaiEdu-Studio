import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { assertActiveProjectForWrite } from "./project-lifecycle-service";
import {
  isSqliteWriteContentionError,
  isUniqueConstraintError,
  prepareGenerationJobInput,
  waitForConcurrentCommit,
} from "./generation-repository-input";
import { assertGenerationCommitGuard } from "./generation-repository-guards";
import { assertPptAssetUnitProviderResult } from "./generation-repository-unit-result";
import type {
  CompleteGenerationUnitInput,
  CreateGenerationJobInput,
  FailGenerationJobInput,
  ProjectExecutionGuard,
  RecordGenerationProviderTaskInput,
} from "./types";

export class GenerationJobIdempotencyConflictError extends Error {
  readonly code = "generation_job_idempotency_conflict";

  constructor() {
    super("Generation job idempotency key already exists with a different input hash.");
    this.name = "GenerationJobIdempotencyConflictError";
  }
}

async function createGenerationJob(
  client: PrismaClient,
  projectId: string,
  input: CreateGenerationJobInput,
  guard?: ProjectExecutionGuard,
) {
  const prepared = await prepareGenerationJobInput(client, projectId, input);
  const findExisting = async () => {
    const existing = await client.generationJob.findUnique({
      where: { projectId_idempotencyKey: { projectId, idempotencyKey: prepared.idempotencyKey } },
    });
    if (!existing) return null;
    if (existing.inputHash !== prepared.inputHash) throw new GenerationJobIdempotencyConflictError();
    return existing;
  };
  const existing = await findExisting();
  if (existing) return existing;

  try {
    return await client.$transaction(async (tx) => {
      await assertActiveProjectForWrite(tx, projectId);
      if (guard) {
        await assertGenerationCommitGuard(tx, projectId, guard);
      }
      const project = await tx.project.findUnique({ where: { id: projectId }, select: { intentEpoch: true } });
      if (!project || project.intentEpoch !== prepared.intentEpoch) {
        throw new Error("Project intent epoch changed before generation job creation.");
      }
      const snapshot = await tx.runInputSnapshot.upsert({
        where: { projectId_inputHash: { projectId, inputHash: prepared.inputHash } },
        update: {},
        create: {
          projectId,
          intentEpoch: prepared.intentEpoch,
          capabilityId: prepared.capabilityId,
          sourceArtifactIdsJson: JSON.stringify(prepared.sourceArtifactIds),
          payloadJson: prepared.payloadJson,
          inputHash: prepared.inputHash,
        },
      });
      const job = await tx.generationJob.create({
        data: {
          projectId,
          kind: input.kind,
          sourceArtifactId: input.sourceArtifactId,
          unitId: input.unitId?.trim() || null,
          runInputSnapshotId: snapshot.id,
          intentEpoch: prepared.intentEpoch,
          idempotencyKey: prepared.idempotencyKey,
          inputHash: prepared.inputHash,
          pollState: "not_started",
          status: "queued",
          attempts: 0,
          maxAttempts: input.maxAttempts ?? 2,
          countsAsProviderSubmission: input.countsAsProviderSubmission ?? true,
        },
      });
      return job;
    });
  } catch (error) {
    if (isUniqueConstraintError(error) || isSqliteWriteContentionError(error)) {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const raced = await findExisting();
        if (raced) return raced;
        await waitForConcurrentCommit(10 * (attempt + 1));
      }
    }
    throw error;
  }
}

async function startGenerationJob(client: PrismaClient, projectId: string, jobId: string) {
  return client.$transaction(async (tx) => {
    await assertActiveProjectForWrite(tx, projectId);
    const existing = await tx.generationJob.findFirst({ where: { id: jobId, projectId } });
    if (!existing) {
      throw new Error(`GenerationJob not found: ${jobId}`);
    }
    if (existing.status === "succeeded") return existing;
    if (existing.status === "submission_unknown") {
      return existing;
    }
    if (existing.status === "running" && existing.pollState === "submitting" && !existing.providerTaskId) {
      return tx.generationJob.update({
        where: { id: jobId },
        data: {
          status: "submission_unknown",
          pollState: "submission_unknown",
          errorMessage: "Provider may have accepted this request, but no recoverable task id was saved.",
          finishedAt: new Date(),
        },
      });
    }
    if (existing.status !== "queued" && existing.status !== "failed" && existing.status !== "running") {
      throw new Error(`GenerationJob cannot start from status: ${existing.status}`);
    }
    if (existing.attempts >= existing.maxAttempts) {
      throw new Error(`GenerationJob attempts exhausted: ${jobId}`);
    }
    return tx.generationJob.update({
      where: { id: jobId },
      data: {
        status: "running",
        attempts: existing.attempts + 1,
        pollState: existing.providerTaskId ? "polling" : "submitting",
        startedAt: new Date(),
        finishedAt: null,
        errorMessage: null,
      },
    });
  });
}

async function recordGenerationProviderTask(
  client: PrismaClient,
  projectId: string,
  jobId: string,
  input: RecordGenerationProviderTaskInput,
) {
  const providerTaskId = input.providerTaskId.trim();
  if (!providerTaskId) throw new Error("GenerationJob providerTaskId is required.");
  return client.$transaction(async (tx) => {
    await assertActiveProjectForWrite(tx, projectId);
    const existing = await tx.generationJob.findFirst({ where: { id: jobId, projectId } });
    if (!existing) throw new Error(`GenerationJob not found: ${jobId}`);
    if (existing.providerTaskId && existing.providerTaskId !== providerTaskId) {
      throw new Error(`GenerationJob providerTaskId conflict: ${jobId}`);
    }
    if (existing.status !== "running" || !["submitting", "polling"].includes(existing.pollState)) {
      throw new Error(`GenerationJob cannot record provider task from state: ${existing.status}/${existing.pollState}`);
    }
    return tx.generationJob.update({
      where: { id: jobId },
      data: {
        providerTaskId,
        pollState: "polling",
        providerAcceptedAt: existing.providerAcceptedAt ?? new Date(),
        errorMessage: null,
      },
    });
  });
}

async function markGenerationSubmissionUnknown(
  client: PrismaClient,
  projectId: string,
  jobId: string,
  errorMessage: string,
) {
  return client.$transaction(async (tx) => {
    await assertActiveProjectForWrite(tx, projectId);
    const existing = await tx.generationJob.findFirst({ where: { id: jobId, projectId } });
    if (!existing) throw new Error(`GenerationJob not found: ${jobId}`);
    if (existing.status === "submission_unknown") return existing;
    if (existing.status === "running" && existing.pollState === "polling" && existing.providerTaskId) {
      return existing;
    }
    if (existing.status !== "running" || existing.pollState !== "submitting" || existing.providerTaskId) {
      throw new Error(
        `GenerationJob cannot mark submission unknown from state: ${existing.status}/${existing.pollState}`,
      );
    }
    return tx.generationJob.update({
      where: { id: jobId },
      data: {
        status: "submission_unknown",
        pollState: "submission_unknown",
        errorMessage,
        finishedAt: new Date(),
      },
    });
  });
}

async function completeGenerationUnit(
  client: PrismaClient,
  projectId: string,
  jobId: string,
  input: CompleteGenerationUnitInput,
) {
  const providerResultJson = input.providerResultJson.trim();
  if (!providerResultJson) throw new Error("GenerationJob providerResultJson is required.");
  return client.$transaction(async (tx) => {
    await assertActiveProjectForWrite(tx, projectId);
    const existing = await tx.generationJob.findFirst({
      where: { id: jobId, projectId },
      include: { runInputSnapshot: true },
    });
    if (!existing) throw new Error(`GenerationJob not found: ${jobId}`);
    assertPptAssetUnitProviderResult(providerResultJson, existing.runInputSnapshot?.payloadJson);
    if (existing.status === "succeeded") {
      if (existing.providerResultJson !== providerResultJson) {
        throw new Error(`GenerationJob provider result conflict: ${jobId}`);
      }
      return existing;
    }
    if (existing.status !== "running") {
      throw new Error(`GenerationJob cannot complete from status: ${existing.status}`);
    }
    return tx.generationJob.update({
      where: { id: jobId },
      data: {
        status: "succeeded",
        pollState: "completed",
        providerAcceptedAt: existing.providerAcceptedAt ?? new Date(),
        providerResultJson,
        errorMessage: null,
        finishedAt: new Date(),
      },
    });
  });
}

async function recordGenerationPoll(client: PrismaClient, projectId: string, jobId: string) {
  const updated = await client.generationJob.updateMany({
    where: { id: jobId, projectId, status: "running", providerTaskId: { not: null } },
    data: { pollState: "polling", lastPolledAt: new Date() },
  });
  if (updated.count !== 1) throw new Error(`GenerationJob cannot record poll: ${jobId}`);
  return client.generationJob.findUniqueOrThrow({ where: { id: jobId } });
}

async function failGenerationJob(
  client: PrismaClient,
  projectId: string,
  jobId: string,
  input: FailGenerationJobInput,
) {
  return client.$transaction(async (tx) => {
    await assertActiveProjectForWrite(tx, projectId);
    const existing = await tx.generationJob.findFirst({ where: { id: jobId, projectId } });
    if (!existing) {
      throw new Error(`GenerationJob not found: ${jobId}`);
    }
    if (existing.status !== "running") {
      throw new Error(`GenerationJob is not running: ${jobId}`);
    }
    return tx.generationJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        errorMessage: input.errorMessage,
        finishedAt: new Date(),
      },
    });
  });
}

async function getGenerationJobs(client: PrismaClient, projectId: string) {
  return client.generationJob.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
  });
}

export function createGenerationJobRepository(client: PrismaClient = prisma) {
  return {
    createGenerationJob: createGenerationJob.bind(null, client),
    startGenerationJob: startGenerationJob.bind(null, client),
    recordGenerationProviderTask: recordGenerationProviderTask.bind(null, client),
    markGenerationSubmissionUnknown: markGenerationSubmissionUnknown.bind(null, client),
    completeGenerationUnit: completeGenerationUnit.bind(null, client),
    recordGenerationPoll: recordGenerationPoll.bind(null, client),
    failGenerationJob: failGenerationJob.bind(null, client),
    getGenerationJobs: getGenerationJobs.bind(null, client),
  };
}
