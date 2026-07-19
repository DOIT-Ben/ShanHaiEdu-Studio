import { describe, expect, it } from "vitest";

import type {
  ConversationMessage,
  ConversationTurnJob,
  Project,
} from "@/generated/prisma/client";
import type { WorkbenchActor } from "@/server/auth/actor";
import type { WorkbenchRepository } from "@/server/workbench/repository";
import { createWorkbenchService } from "@/server/workbench/service";
import type {
  EnqueueConversationTurnInput,
  EnqueueMessageAndConversationTurnInput,
  ExecutionIdentitySnapshot,
  FailConversationTurnInput,
  FinishConversationTurnInput,
  ProjectExecutionGuard,
} from "@/server/workbench/types";

const publicMethods = [
  "acquireProjectExecutionLease",
  "addMessage",
  "advanceProjectIntentEpoch",
  "approveArtifact",
  "completeGenerationUnit",
  "createGenerationJob",
  "createProject",
  "enqueueConversationTurn",
  "enqueueMessageAndConversationTurn",
  "failConversationTurnJob",
  "failGenerationJob",
  "finishConversationTurnJob",
  "getApprovedInputs",
  "getArtifact",
  "getArtifacts",
  "getConversationTurnJobs",
  "getExecutionIdentity",
  "getGenerationJobs",
  "getMessages",
  "getProject",
  "getProjectSnapshot",
  "getVideoShots",
  "listProjects",
  "markGenerationSubmissionUnknown",
  "mutateProjectLifecycle",
  "recordGenerationPoll",
  "recordGenerationProviderTask",
  "recordVideoShotProviderTask",
  "releaseProjectExecutionLease",
  "renewProjectExecutionLease",
  "requeueConversationTurnJobAfterContractRepair",
  "requeueConversationTurnJobAfterProviderHealth",
  "requeueConversationTurnJobForRecovery",
  "saveArtifact",
  "saveInteractiveCoursewareSpec",
  "selectVideoShotArtifact",
  "setMessageReaction",
  "startGenerationJob",
  "startGenerationJobForExecution",
  "startNextConversationTurnJob",
  "submitPptFullDeckReview",
  "submitPptSampleReview",
  "updateMessageMetadata",
  "updateProjectGenerationIntensity",
  "updateVideoShotQa",
  "upsertVideoShots",
  "withExecutionGuard",
].sort();

describe("workbench service facade", () => {
  it("keeps the existing public method surface on the single factory", () => {
    expect(Object.keys(createWorkbenchService()).sort()).toEqual(publicMethods);
  });

  it("derives a guarded service with the guard identity and the same method surface", () => {
    const service = createWorkbenchService();
    const guard = {
      projectId: "project-1",
      holderId: "worker-1",
      fencingToken: 3,
      identity: {
        actorUserId: "teacher-1",
        actorAuthMode: "password" as const,
        authSessionId: "session-1",
      },
    };

    const guarded = service.withExecutionGuard(guard);

    expect(guarded.getExecutionIdentity()).toEqual(guard.identity);
    expect(Object.keys(guarded).sort()).toEqual(publicMethods);
  });

  it("overrides caller-supplied execution identities on both enqueue paths", async () => {
    const trustedIdentity: ExecutionIdentitySnapshot = {
      actorUserId: "teacher-1",
      actorAuthMode: "password",
      authSessionId: "session-1",
    };
    const forgedIdentity: ExecutionIdentitySnapshot = {
      actorUserId: "attacker",
      actorAuthMode: "oauth",
      authSessionId: "forged-session",
    };
    let directInput: EnqueueConversationTurnInput | undefined;
    let combinedInput: EnqueueMessageAndConversationTurnInput | undefined;
    const repository = createRepository({
      async enqueueConversationTurn(_projectId, input) {
        directInput = input;
        return makeTurnJob("turn-direct");
      },
      async enqueueMessageAndConversationTurn(_projectId, input) {
        combinedInput = input;
        return {
          message: makeMessage("message-combined"),
          job: makeTurnJob("turn-combined"),
        };
      },
    });
    const service = createWorkbenchService(repository, undefined, trustedIdentity);

    await service.enqueueConversationTurn("project-1", {
      teacherMessageId: "teacher-message-1",
      executionIdentity: forgedIdentity,
    });
    await service.enqueueMessageAndConversationTurn("project-1", {
      role: "teacher",
      content: "只提交需求规格",
      executionIdentity: forgedIdentity,
    });

    expect(directInput?.executionIdentity).toEqual(trustedIdentity);
    expect(combinedInput?.executionIdentity).toEqual(trustedIdentity);
  });

  it("uses the execution guard for writes while preserving actor authorization for reads", async () => {
    const guard = makeGuard();
    let assertedGuard: ProjectExecutionGuard | undefined;
    let guardAssertions = 0;
    const repository = createRepository({
      async assertExecutionGuard(_projectId, candidate) {
        guardAssertions += 1;
        assertedGuard = candidate;
      },
      async addMessage() {
        return makeMessage("guarded-write");
      },
    });
    const service = createWorkbenchService(repository, strangerActor()).withExecutionGuard(guard);

    await expect(service.addMessage("project-1", {
      role: "teacher",
      content: "guarded write",
    })).resolves.toMatchObject({ id: "guarded-write" });
    expect(guardAssertions).toBe(1);
    expect(assertedGuard).toBe(guard);

    await expect(service.getProject("project-1")).rejects.toThrow(/Project not found/i);
    expect(guardAssertions).toBe(1);
  });

  it("passes the same guard to finish and fail without a redundant project lookup", async () => {
    const guard = makeGuard();
    let projectLookups = 0;
    const completionGuards: Array<ProjectExecutionGuard | undefined> = [];
    const repository = createRepository({
      async getProject() {
        projectLookups += 1;
        throw new Error("guarded completion must not query the project");
      },
      async finishConversationTurnJob(
        _projectId: string,
        _jobId: string,
        _input: FinishConversationTurnInput,
        candidate?: ProjectExecutionGuard,
      ) {
        completionGuards.push(candidate);
        return makeTurnJob("turn-finished", "succeeded");
      },
      async failConversationTurnJob(
        _projectId: string,
        _jobId: string,
        _input: FailConversationTurnInput,
        candidate?: ProjectExecutionGuard,
      ) {
        completionGuards.push(candidate);
        return makeTurnJob("turn-failed", "failed");
      },
    });
    const service = createWorkbenchService(repository).withExecutionGuard(guard);

    await expect(service.finishConversationTurnJob("project-1", "turn-1", {}))
      .resolves.toMatchObject({ id: "turn-finished", status: "succeeded" });
    await expect(service.failConversationTurnJob("project-1", "turn-2", { errorMessage: "failed" }))
      .resolves.toMatchObject({ id: "turn-failed", status: "failed" });

    expect(projectLookups).toBe(0);
    expect(completionGuards).toHaveLength(2);
    expect(completionGuards.every((candidate) => candidate === guard)).toBe(true);
  });
});

function createRepository(overrides: Partial<WorkbenchRepository> = {}): WorkbenchRepository {
  return {
    async getProject() {
      return makeProject();
    },
    ...overrides,
  } as unknown as WorkbenchRepository;
}

function makeProject(): Project {
  const timestamp = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: "project-1",
    title: "Project",
    status: "active",
    currentNodeKey: "requirement_spec",
    ownerUserId: "owner-1",
    grade: null,
    subject: null,
    textbookVersion: null,
    lessonTopic: null,
    archivedAt: null,
    deletedAt: null,
    lifecycleVersion: 0,
    intentEpoch: 0,
    generationIntensity: "standard",
    intensityVersion: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function makeMessage(id: string): ConversationMessage {
  return {
    id,
    projectId: "project-1",
    role: "teacher",
    content: "message",
    partsJson: "[]",
    artifactRefsJson: "[]",
    metadataJson: "{}",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function makeTurnJob(
  id: string,
  status: "queued" | "succeeded" | "failed" = "queued",
): ConversationTurnJob {
  const timestamp = new Date("2026-01-01T00:00:00.000Z");
  return {
    id,
    projectId: "project-1",
    teacherMessageId: "teacher-message-1",
    assistantMessageId: null,
    status,
    attempts: status === "queued" ? 0 : 1,
    maxAttempts: 2,
    idempotencyKey: null,
    actorUserId: null,
    actorAuthMode: null,
    authSessionId: null,
    fencingToken: null,
    generationIntensity: "standard",
    intensityVersion: 0,
    lockedBy: null,
    lockedUntil: null,
    errorCode: null,
    errorMessage: null,
    failureCategory: null,
    failureRetryability: null,
    failureEvidenceDigest: null,
    recoveryEvidenceDigest: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: status === "queued" ? null : timestamp,
    finishedAt: status === "queued" ? null : timestamp,
  };
}

function makeGuard(): ProjectExecutionGuard {
  return {
    projectId: "project-1",
    holderId: "worker-1",
    fencingToken: 3,
    identity: {
      actorUserId: "teacher-1",
      actorAuthMode: "password",
      authSessionId: "session-1",
    },
  };
}

function strangerActor(): WorkbenchActor {
  return {
    userId: "stranger",
    role: "teacher",
    displayName: "Stranger",
    authMode: "password",
    isAdmin: false,
    projectRoles: {},
  };
}
