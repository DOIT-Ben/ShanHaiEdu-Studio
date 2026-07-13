import { prisma } from "@/server/db/client";
import type { PrismaClient } from "@/generated/prisma/client";
import type { WorkbenchActor } from "@/server/auth/actor";
import { ExecutionIdentityRejectedError, assertExecutionIdentityCanWriteProject } from "@/server/execution/execution-identity";
import { createProjectExecutionLeaseRepository, ProjectExecutionLeaseRejectedError } from "@/server/execution/project-execution-lease";
import { canonicalizeRunInput, hashRunInput } from "@/server/execution/run-input-snapshot";
import { hasValidValidationReportDigest, hashArtifactDraft } from "@/server/contracts/contract-validator";
import { guardFinish } from "@/server/conversation/react-control";
import type { QualityDecision, ValidationReport } from "@/server/quality/quality-types";
import { createHumanGateActionId } from "@/server/guards/human-gate";
import { validatePptKeySampleSet, validatePptSampleApproval } from "@/server/ppt-quality/ppt-sample-validator";
import type { PptAssetManifest, PptAssetRequestBatch, PptKeySampleSet, PptSampleApproval } from "@/server/ppt-quality/ppt-asset-types";
import type { PptDesignPackage } from "@/server/ppt-quality/ppt-quality-types";
import { validatePptFullDeckPackage } from "@/server/ppt-quality/ppt-full-deck-candidate";
import type { PptFullDeckPackage } from "@/server/ppt-quality/ppt-production-types";
import { DEFAULT_WORKFLOW_NODES, FIRST_WORKFLOW_NODE_KEY } from "./workflow-defaults";
import { assertActiveProjectForWrite, ProjectLifecycleError } from "./project-lifecycle-service";
import type {
  AddMessageInput,
  CreateProjectInput,
  EnqueueMessageAndConversationTurnInput,
  EnqueueConversationTurnInput,
  FailConversationTurnInput,
  CreateGenerationJobInput,
  FailGenerationJobInput,
  FinishConversationTurnInput,
  FinishAgentRunInput,
  RegenerateArtifactInput,
  SaveArtifactInput,
  StartAgentRunInput,
  ProjectLifecycleState,
  ProjectExecutionFence,
  ProjectExecutionGuard,
  RecordGenerationProviderTaskInput,
  StageGenerationResultInput,
  UpsertVideoShotsInput,
} from "./types";

export type WorkbenchRepository = ReturnType<typeof createPrismaWorkbenchRepository>;

export class GenerationJobIdempotencyConflictError extends Error {
  readonly code = "generation_job_idempotency_conflict";

  constructor() {
    super("Generation job idempotency key already exists with a different input hash.");
    this.name = "GenerationJobIdempotencyConflictError";
  }
}

export class GenerationResultQuarantinedError extends Error {
  readonly code = "generation_result_quarantined";

  constructor(readonly reason: string) {
    super(`Generation result was quarantined: ${reason}`);
    this.name = "GenerationResultQuarantinedError";
  }
}

export function createPrismaWorkbenchRepository(client: PrismaClient = prisma) {
  const executionLeases = createProjectExecutionLeaseRepository(client);
  return {
    async listProjects(input: { actor?: WorkbenchActor; view?: ProjectLifecycleState } = {}) {
      const lifecycleWhere = input.view === "archived"
        ? { archivedAt: { not: null }, deletedAt: null }
        : input.view === "trash"
          ? { deletedAt: { not: null } }
          : { archivedAt: null, deletedAt: null };
      return client.project.findMany({
        where: input.actor
          ? {
              ...lifecycleWhere,
              OR: [
                { ownerUserId: input.actor.userId },
                ...((input.actor.authMode ?? "local") === "local" ? [{ ownerUserId: null }] : []),
                { memberships: { some: { userId: input.actor.userId } } },
              ],
            }
          : lifecycleWhere,
        orderBy: { updatedAt: "desc" },
      });
    },

    async createProject(input: CreateProjectInput) {
      return client.$transaction(async (tx) => {
        if (input.ownerUserId) {
          const existingOwner = await tx.localUser.findUnique({
            where: { id: input.ownerUserId },
          });
          if (!existingOwner) {
            await tx.localUser.create({
              data: { id: input.ownerUserId, displayName: "本地教师", role: "teacher", authMode: "local" },
            });
          }
        }

        const project = await tx.project.create({
          data: {
            title: input.title,
            currentNodeKey: FIRST_WORKFLOW_NODE_KEY,
            ownerUserId: input.ownerUserId,
            grade: input.grade,
            subject: input.subject,
            textbookVersion: input.textbookVersion,
            lessonTopic: input.lessonTopic,
          },
        });

        await tx.workflowNode.createMany({
          data: DEFAULT_WORKFLOW_NODES.map((node) => ({
            projectId: project.id,
            key: node.key,
            title: node.title,
            status: node.status,
            order: node.order,
            upstreamNodeKeysJson: JSON.stringify(node.upstreamNodeKeys),
          })),
        });

        if (input.ownerUserId) {
          await tx.projectMembership.upsert({
            where: { projectId_userId: { projectId: project.id, userId: input.ownerUserId } },
            update: { role: "owner" },
            create: { projectId: project.id, userId: input.ownerUserId, role: "owner" },
          });
        }

        return project;
      });
    },

    async getProject(projectId: string) {
      return client.project.findUnique({ where: { id: projectId } });
    },

    async addMessage(projectId: string, input: AddMessageInput) {
      return client.$transaction(async (tx) => {
        await assertActiveProjectForWrite(tx, projectId);
        return tx.conversationMessage.create({
          data: {
            projectId,
            role: input.role,
            content: input.content,
            artifactRefsJson: JSON.stringify(input.artifactRefs ?? []),
            metadataJson: JSON.stringify(input.metadata ?? {}),
          },
        });
      });
    },

    async updateMessageMetadata(projectId: string, messageId: string, metadata: Record<string, unknown>) {
      return client.$transaction(async (tx) => {
        await assertActiveProjectForWrite(tx, projectId);
        const result = await tx.conversationMessage.updateMany({
          where: { id: messageId, projectId },
          data: { metadataJson: JSON.stringify(metadata) },
        });

        if (result.count === 0) {
          throw new Error(`ConversationMessage not found: ${messageId}`);
        }

        const message = await tx.conversationMessage.findFirst({
          where: { id: messageId, projectId },
        });
        if (!message) {
          throw new Error(`ConversationMessage not found: ${messageId}`);
        }

        return message;
      });
    },

    async saveArtifact(projectId: string, input: SaveArtifactInput) {
      return client.$transaction(async (tx) => {
        await assertActiveProjectForWrite(tx, projectId);
        if (input.validationReport) {
          assertPassedValidationReportForDraft(input.validationReport, input);
        }
        const latest = await tx.artifact.findFirst({
          where: { projectId, nodeKey: input.nodeKey },
          orderBy: { version: "desc" },
        });
        const artifact = await tx.artifact.create({
          data: {
            projectId,
            nodeKey: input.nodeKey,
            kind: input.kind,
            title: input.title,
            status: input.status,
            summary: input.summary,
            markdownContent: input.markdownContent,
            structuredContentJson: JSON.stringify(input.structuredContent ?? {}),
            version: latest ? latest.version + 1 : 1,
          },
        });

        await tx.workflowNode.update({
          where: { projectId_key: { projectId, key: input.nodeKey } },
          data: { status: input.status },
        });

        if (input.validationReport) {
          await tx.validationReportRecord.create({
            data: validationReportRecordData({
              projectId,
              report: input.validationReport,
              artifactId: artifact.id,
            }),
          });
        }

        return artifact;
      });
    },

    async approveArtifact(projectId: string, artifactId: string) {
      return client.$transaction(async (tx) => {
        await assertActiveProjectForWrite(tx, projectId);
        const existing = await tx.artifact.findFirst({
          where: { id: artifactId, projectId },
        });

        if (!existing) {
          throw new Error(`Artifact not found: ${artifactId}`);
        }

        const previousApproved = await tx.artifact.findFirst({
          where: { projectId, nodeKey: existing.nodeKey, isApproved: true },
        });
        const shouldPropagateStale = previousApproved?.id !== artifactId;
        const structuredContentWithApproval = attachArtifactApprovalEvidence(existing);

        await tx.artifact.updateMany({
          where: { projectId, nodeKey: existing.nodeKey, isApproved: true },
          data: { isApproved: false },
        });

        const artifact = await tx.artifact.update({
          where: { id: artifactId },
          data: {
            status: "approved",
            isApproved: true,
            structuredContentJson: JSON.stringify(withRouteGenerationActions({
              projectId,
              artifactId,
              nodeKey: existing.nodeKey,
              kind: existing.kind,
              structuredContentJson: JSON.stringify(structuredContentWithApproval),
            })),
          },
        });

        await tx.workflowNode.update({
          where: { projectId_key: { projectId, key: existing.nodeKey } },
          data: { status: "approved", approvedArtifactId: artifact.id, staleReason: null },
        });
        const upstreamNode = await tx.workflowNode.findUnique({
          where: { projectId_key: { projectId, key: existing.nodeKey } },
        });

        const downstreamNodes = await tx.workflowNode.findMany({
          where: {
            projectId,
            status: "approved",
            approvedArtifactId: { not: null },
          },
        });
        const staleNodeIds = downstreamNodes
          .filter((node) => {
            const upstreamNodeKeys = JSON.parse(node.upstreamNodeKeysJson) as unknown;
            return Array.isArray(upstreamNodeKeys) && upstreamNodeKeys.includes(existing.nodeKey);
          })
          .map((node) => node.id);

        if (shouldPropagateStale && staleNodeIds.length > 0) {
          await tx.workflowNode.updateMany({
            where: { id: { in: staleNodeIds } },
            data: {
              status: "stale",
              staleReason: `「${upstreamNode?.title ?? existing.nodeKey}」已更新确认，需要重新检查相关内容。`,
            },
          });
        }

        return artifact;
      });
    },

    async getArtifact(projectId: string, artifactId: string) {
      return client.artifact.findFirst({
        where: { id: artifactId, projectId },
      });
    },

    async regenerateArtifact(projectId: string, artifactId: string, input: RegenerateArtifactInput) {
      return client.$transaction(async (tx) => {
        await assertActiveProjectForWrite(tx, projectId);
        const existing = await tx.artifact.findFirst({
          where: { id: artifactId, projectId },
        });

        if (!existing) {
          throw new Error(`Artifact not found: ${artifactId}`);
        }

        const latest = await tx.artifact.findFirst({
          where: { projectId, nodeKey: existing.nodeKey },
          orderBy: { version: "desc" },
        });

        if (input.expectedLatestVersion !== undefined && latest?.version !== input.expectedLatestVersion) {
          throw new Error(
            `Artifact version conflict: expected latest version ${input.expectedLatestVersion}, received ${latest?.version ?? "none"}`,
          );
        }

        const artifact = await tx.artifact.create({
          data: {
            projectId,
            nodeKey: existing.nodeKey,
            kind: existing.kind,
            title: input.title ?? existing.title,
            status: "needs_review",
            summary: input.summary,
            markdownContent: input.markdownContent,
            structuredContentJson: JSON.stringify(input.structuredContent ?? {}),
            version: latest ? latest.version + 1 : existing.version + 1,
            isApproved: false,
          },
        });

        await tx.workflowNode.update({
          where: { projectId_key: { projectId, key: existing.nodeKey } },
          data: { status: "needs_review" },
        });

        await tx.project.update({
          where: { id: projectId },
          data: { intentEpoch: { increment: 1 } },
        });

        return artifact;
      });
    },

    async getNode(projectId: string, nodeKey: string) {
      return client.workflowNode.findUnique({
        where: { projectId_key: { projectId, key: nodeKey } },
      });
    },

    async getApprovedArtifactsByNodeKeys(projectId: string, nodeKeys: string[]) {
      return client.artifact.findMany({
        where: {
          projectId,
          nodeKey: { in: nodeKeys },
          isApproved: true,
        },
        orderBy: [{ nodeKey: "asc" }, { version: "asc" }],
      });
    },

    async startAgentRun(projectId: string, input: StartAgentRunInput) {
      return client.$transaction(async (tx) => {
        await assertActiveProjectForWrite(tx, projectId);
        const run = await tx.agentRun.create({
          data: {
            projectId,
            nodeKey: input.nodeKey,
            runtime: input.runtime,
            status: "running",
          },
        });

        await tx.workflowNode.update({
          where: { projectId_key: { projectId, key: input.nodeKey } },
          data: { status: "in_progress" },
        });

        return run;
      });
    },

    async finishAgentRun(projectId: string, runId: string, input: FinishAgentRunInput) {
      return client.$transaction(async (tx) => {
        await assertActiveProjectForWrite(tx, projectId);
        const existing = await tx.agentRun.findFirst({
          where: { id: runId, projectId },
        });

        if (!existing) {
          throw new Error(`AgentRun not found: ${runId}`);
        }

        if (existing.status !== "running") {
          throw new Error(`AgentRun already finished: ${runId}`);
        }

        const latestRun = await tx.agentRun.findFirst({
          where: { projectId, nodeKey: existing.nodeKey },
          orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        });
        const isLatestRun = latestRun?.id === runId;

        if (input.status === "succeeded") {
          await assertAgentRunFinishEvidence(tx, projectId, existing.nodeKey, input);
        }

        const run = await tx.agentRun.update({
          where: { id: runId },
          data: {
            status: input.status,
            finishedAt: new Date(),
            errorMessage: input.errorMessage ?? null,
          },
        });

        if (input.status === "failed" && isLatestRun) {
          await tx.workflowNode.update({
            where: { projectId_key: { projectId, key: existing.nodeKey } },
            data: { status: "failed" },
          });
        }

        return run;
      });
    },

    async createGenerationJob(projectId: string, input: CreateGenerationJobInput, guard?: ProjectExecutionGuard) {
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
            },
          });
          await tx.stagedArtifactCommit.create({
            data: {
              projectId,
              generationJobId: job.id,
              state: "awaiting_result",
              intentEpoch: prepared.intentEpoch,
              inputHash: prepared.inputHash,
              holderId: guard?.holderId,
              fencingToken: guard?.fencingToken,
              actorUserId: guard?.identity.actorUserId,
              actorAuthMode: guard?.identity.actorAuthMode,
              authSessionId: guard?.identity.authSessionId,
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
    },

    async advanceProjectIntentEpoch(projectId: string, expectedIntentEpoch: number) {
      return client.$transaction(async (tx) => {
        await assertActiveProjectForWrite(tx, projectId);
        const updated = await tx.project.updateMany({
          where: { id: projectId, intentEpoch: expectedIntentEpoch },
          data: { intentEpoch: { increment: 1 } },
        });
        if (updated.count !== 1) throw new Error("Project intent epoch conflict.");
        return tx.project.findUniqueOrThrow({ where: { id: projectId } });
      });
    },

    async updateProjectGenerationIntensity(projectId: string, input: { intensity: string; expectedVersion: number }) {
      const updated = await client.project.updateMany({
        where: { id: projectId, archivedAt: null, deletedAt: null, intensityVersion: input.expectedVersion },
        data: { generationIntensity: input.intensity, intensityVersion: { increment: 1 } },
      });
      if (updated.count !== 1) {
        const project = await client.project.findUnique({ where: { id: projectId }, select: { archivedAt: true, deletedAt: true } });
        if (!project || project.archivedAt || project.deletedAt) {
          throw new ProjectLifecycleError("project_lifecycle_conflict", 409, "该项目当前不可继续编辑。");
        }
        throw new Error("Project generation intensity version conflict.");
      }
      return client.project.findUniqueOrThrow({ where: { id: projectId } });
    },

    async enqueueConversationTurn(projectId: string, input: EnqueueConversationTurnInput) {
      return client.$transaction(async (tx) => {
        await assertActiveProjectForWrite(tx, projectId);
        const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { generationIntensity: true, intensityVersion: true } });
        const teacherMessage = await tx.conversationMessage.findFirst({
          where: { id: input.teacherMessageId, projectId, role: "teacher" },
        });
        if (!teacherMessage) {
          throw new Error(`Teacher message not found: ${input.teacherMessageId}`);
        }

        if (input.idempotencyKey) {
          const existing = await tx.conversationTurnJob.findFirst({
            where: { projectId, idempotencyKey: input.idempotencyKey },
          });
          if (existing) return existing;
        }

        return tx.conversationTurnJob.create({
          data: {
            projectId,
            teacherMessageId: input.teacherMessageId,
            status: "queued",
            attempts: 0,
            maxAttempts: input.maxAttempts ?? 2,
            idempotencyKey: input.idempotencyKey,
            actorUserId: input.executionIdentity?.actorUserId,
            actorAuthMode: input.executionIdentity?.actorAuthMode,
            authSessionId: input.executionIdentity?.authSessionId,
            generationIntensity: project.generationIntensity,
            intensityVersion: project.intensityVersion,
          },
        });
      });
    },

    async enqueueMessageAndConversationTurn(projectId: string, input: EnqueueMessageAndConversationTurnInput) {
      async function findExistingByIdempotencyKey(idempotencyKey: string) {
        const job = await client.conversationTurnJob.findFirst({
          where: { projectId, idempotencyKey },
        });
        if (!job) return null;

        const message = await client.conversationMessage.findFirst({
          where: { id: job.teacherMessageId, projectId, role: "teacher" },
        });
        if (!message) {
          throw new Error(`Teacher message not found: ${job.teacherMessageId}`);
        }

        return { message, job };
      }

      if (input.idempotencyKey) {
        const existing = await findExistingByIdempotencyKey(input.idempotencyKey);
        if (existing) return existing;
      }

      try {
        return await client.$transaction(async (tx) => {
          await assertActiveProjectForWrite(tx, projectId);
          const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { generationIntensity: true, intensityVersion: true } });
          const message = await tx.conversationMessage.create({
            data: {
              projectId,
              role: input.role,
              content: input.content,
              artifactRefsJson: JSON.stringify(input.artifactRefs ?? []),
              metadataJson: JSON.stringify(input.metadata ?? {}),
            },
          });

          const job = await tx.conversationTurnJob.create({
            data: {
              projectId,
              teacherMessageId: message.id,
              status: "queued",
              attempts: 0,
              maxAttempts: input.maxAttempts ?? 2,
              idempotencyKey: input.idempotencyKey,
              actorUserId: input.executionIdentity?.actorUserId,
              actorAuthMode: input.executionIdentity?.actorAuthMode,
              authSessionId: input.executionIdentity?.authSessionId,
              generationIntensity: project.generationIntensity,
              intensityVersion: project.intensityVersion,
            },
          });

          return { message, job };
        });
      } catch (error) {
        if (input.idempotencyKey && isUniqueConstraintError(error)) {
          const existing = await findExistingByIdempotencyKey(input.idempotencyKey);
          if (existing) return existing;
        }
        throw error;
      }
    },

    async startNextConversationTurnJob(
      projectId: string,
      input: { lockedBy?: string; lockMs?: number; fence?: ProjectExecutionFence; now?: Date } = {},
    ) {
      return client.$transaction(async (tx) => {
        await assertActiveProjectForWrite(tx, projectId);
        const now = input.now ?? new Date();
        if (input.fence) await assertCurrentFence(tx, input.fence, now);
        const running = await tx.conversationTurnJob.findFirst({
          where: {
            projectId,
            status: "running",
            OR: [{ lockedUntil: null }, { lockedUntil: { gt: now } }],
          },
          orderBy: { createdAt: "asc" },
        });
        if (running) return null;

        const expiredRunning = await tx.conversationTurnJob.findFirst({
          where: {
            projectId,
            status: "running",
            lockedUntil: { lte: now },
          },
          orderBy: { createdAt: "asc" },
        });
        if (expiredRunning) {
          if (expiredRunning.attempts >= expiredRunning.maxAttempts) {
            return tx.conversationTurnJob.update({
              where: { id: expiredRunning.id },
              data: {
                status: "failed",
                lockedBy: null,
                lockedUntil: null,
                errorCode: "attempts_exhausted",
                errorMessage: "这条排队消息已达到最大重试次数，请重新发送或调整需求。",
                finishedAt: now,
              },
            });
          }

          if (input.fence && !(await validateJobExecutionIdentity(tx, expiredRunning, now))) {
            return quarantineTurnJob(tx, expiredRunning.id, "running", expiredRunning.fencingToken, "execution_identity_invalid", now);
          }
          const lockMs = input.lockMs ?? 10 * 60 * 1000;
          return tx.conversationTurnJob.update({
            where: { id: expiredRunning.id },
            data: {
              status: "running",
              attempts: expiredRunning.attempts + 1,
              lockedBy: input.lockedBy ?? "local-worker",
              lockedUntil: new Date(now.getTime() + lockMs),
              fencingToken: input.fence?.fencingToken,
              startedAt: now,
              finishedAt: null,
              errorCode: null,
              errorMessage: null,
            },
          });
        }

        const next = await tx.conversationTurnJob.findFirst({
          where: { projectId, status: "queued" },
          orderBy: { createdAt: "asc" },
        });
        if (!next) return null;
        if (input.fence && !(await validateJobExecutionIdentity(tx, next, now))) {
          return quarantineTurnJob(tx, next.id, "queued", next.fencingToken, "execution_identity_invalid", now);
        }
        if (next.attempts >= next.maxAttempts) {
          return tx.conversationTurnJob.update({
            where: { id: next.id },
            data: {
              status: "failed",
              errorCode: "attempts_exhausted",
              errorMessage: "这条排队消息已达到最大重试次数，请重新发送或调整需求。",
              finishedAt: new Date(),
            },
          });
        }

        const lockMs = input.lockMs ?? 10 * 60 * 1000;
        return tx.conversationTurnJob.update({
          where: { id: next.id },
          data: {
            status: "running",
            attempts: next.attempts + 1,
            lockedBy: input.lockedBy ?? "local-worker",
            lockedUntil: new Date(now.getTime() + lockMs),
            fencingToken: input.fence?.fencingToken,
            startedAt: now,
            finishedAt: null,
            errorCode: null,
            errorMessage: null,
          },
        });
      });
    },

    async finishConversationTurnJob(projectId: string, jobId: string, input: FinishConversationTurnInput, guard?: ProjectExecutionGuard) {
      return client.$transaction(async (tx) => {
        await assertActiveProjectForWrite(tx, projectId);
        const existing = await tx.conversationTurnJob.findFirst({ where: { id: jobId, projectId } });
        if (!existing) {
          throw new Error(`ConversationTurnJob not found: ${jobId}`);
        }
        if (existing.status !== "running") {
          throw new Error(`ConversationTurnJob is not running: ${jobId}`);
        }
        if (guard && !(await validateGuardForJob(tx, existing, guard))) {
          return quarantineTurnJob(tx, existing.id, "running", guard.fencingToken, "execution_fence_rejected", new Date());
        }
        return tx.conversationTurnJob.update({
          where: { id: jobId },
          data: {
            status: input.status ?? "succeeded",
            assistantMessageId: input.assistantMessageId,
            errorCode: input.errorCode ?? null,
            errorMessage: input.errorMessage ?? null,
            lockedBy: null,
            lockedUntil: null,
            finishedAt: new Date(),
          },
        });
      });
    },

    async failConversationTurnJob(projectId: string, jobId: string, input: FailConversationTurnInput, guard?: ProjectExecutionGuard) {
      return client.$transaction(async (tx) => {
        await assertActiveProjectForWrite(tx, projectId);
        const existing = await tx.conversationTurnJob.findFirst({ where: { id: jobId, projectId } });
        if (!existing) {
          throw new Error(`ConversationTurnJob not found: ${jobId}`);
        }
        if (existing.status !== "running") {
          throw new Error(`ConversationTurnJob is not running: ${jobId}`);
        }
        if (guard && !(await validateGuardForJob(tx, existing, guard))) {
          return quarantineTurnJob(tx, existing.id, "running", guard.fencingToken, "execution_fence_rejected", new Date());
        }
        return tx.conversationTurnJob.update({
          where: { id: jobId },
          data: {
            status: "failed",
            assistantMessageId: input.assistantMessageId,
            errorCode: input.errorCode ?? null,
            errorMessage: input.errorMessage,
            lockedBy: null,
            lockedUntil: null,
            finishedAt: new Date(),
          },
        });
      });
    },

    async startGenerationJob(projectId: string, jobId: string) {
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
    },

    async recordGenerationProviderTask(projectId: string, jobId: string, input: RecordGenerationProviderTaskInput) {
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
    },

    async markGenerationSubmissionUnknown(projectId: string, jobId: string, errorMessage: string) {
      return client.$transaction(async (tx) => {
        await assertActiveProjectForWrite(tx, projectId);
        const existing = await tx.generationJob.findFirst({ where: { id: jobId, projectId } });
        if (!existing) throw new Error(`GenerationJob not found: ${jobId}`);
        if (existing.providerTaskId) return existing;
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
    },

    async recordGenerationPoll(projectId: string, jobId: string) {
      const updated = await client.generationJob.updateMany({
        where: { id: jobId, projectId, status: "running", providerTaskId: { not: null } },
        data: { pollState: "polling", lastPolledAt: new Date() },
      });
      if (updated.count !== 1) throw new Error(`GenerationJob cannot record poll: ${jobId}`);
      return client.generationJob.findUniqueOrThrow({ where: { id: jobId } });
    },

    async getStagedGenerationResult(projectId: string, jobId: string) {
      return client.stagedArtifactCommit.findFirst({ where: { projectId, generationJobId: jobId } });
    },

    async stageGenerationResult(
      projectId: string,
      jobId: string,
      input: StageGenerationResultInput,
      guard?: ProjectExecutionGuard,
    ) {
      return client.$transaction(async (tx) => {
        await assertActiveProjectForWrite(tx, projectId);
        const job = await tx.generationJob.findFirst({ where: { id: jobId, projectId } });
        if (!job) throw new Error(`GenerationJob not found: ${jobId}`);

        const existingStage = await tx.stagedArtifactCommit.findUnique({ where: { generationJobId: jobId } });
        if (job.status === "succeeded" && existingStage?.state === "committed") {
          return { job, stage: existingStage };
        }
        if (job.status !== "running") {
          throw new Error(`GenerationJob is not running: ${jobId}`);
        }

        const structuredContent = input.structuredContent ?? {};
        const staged = await tx.stagedArtifactCommit.upsert({
          where: { generationJobId: jobId },
          update: {
            state: "staged",
            nodeKey: input.nodeKey,
            kind: input.kind,
            title: input.title,
            artifactStatus: input.status,
            summary: input.summary,
            markdownContent: input.markdownContent,
            structuredContentJson: JSON.stringify(structuredContent),
            storageRefsJson: JSON.stringify(extractStorageRefs(structuredContent)),
            intentEpoch: job.intentEpoch,
            inputHash: job.inputHash ?? `legacy:${job.id}`,
            holderId: guard?.holderId ?? existingStage?.holderId,
            fencingToken: guard?.fencingToken ?? existingStage?.fencingToken,
            actorUserId: guard?.identity.actorUserId ?? existingStage?.actorUserId,
            actorAuthMode: guard?.identity.actorAuthMode ?? existingStage?.actorAuthMode,
            authSessionId: guard?.identity.authSessionId ?? existingStage?.authSessionId,
            quarantineReason: null,
          },
          create: {
            projectId,
            generationJobId: job.id,
            state: "staged",
            nodeKey: input.nodeKey,
            kind: input.kind,
            title: input.title,
            artifactStatus: input.status,
            summary: input.summary,
            markdownContent: input.markdownContent,
            structuredContentJson: JSON.stringify(structuredContent),
            storageRefsJson: JSON.stringify(extractStorageRefs(structuredContent)),
            intentEpoch: job.intentEpoch,
            inputHash: job.inputHash ?? `legacy:${job.id}`,
            holderId: guard?.holderId,
            fencingToken: guard?.fencingToken,
            actorUserId: guard?.identity.actorUserId,
            actorAuthMode: guard?.identity.actorAuthMode,
            authSessionId: guard?.identity.authSessionId,
          },
        });

        if (!input.validationReport) {
          return quarantineGenerationResult(tx, job, staged, "validation_report_missing");
        }

        const existingReport = await tx.validationReportRecord.findUnique({
          where: { stagedArtifactCommitId: staged.id },
        });
        if (!existingReport) {
          await tx.validationReportRecord.create({
            data: validationReportRecordData({
              projectId,
              report: input.validationReport,
              generationJobId: job.id,
              stagedArtifactCommitId: staged.id,
            }),
          });
        } else if (
          existingReport.projectId !== projectId ||
          existingReport.generationJobId !== job.id ||
          existingReport.stagedArtifactCommitId !== staged.id ||
          existingReport.reportDigest !== input.validationReport.reportDigest
        ) {
          return quarantineGenerationResult(tx, job, staged, "validation_report_reused");
        }

        const validationIssue = validationReportIssue(input.validationReport, input, job);
        if (validationIssue) {
          return quarantineGenerationResult(tx, job, staged, validationIssue);
        }

        const project = await tx.project.findUnique({ where: { id: projectId }, select: { intentEpoch: true } });
        if (!project || project.intentEpoch !== job.intentEpoch) {
          return quarantineGenerationResult(tx, job, staged, "stale_intent");
        }
        if (guard && !(await validateGenerationCommitGuard(tx, projectId, guard))) {
          return quarantineGenerationResult(tx, job, staged, "execution_fence_rejected");
        }
        return { job, stage: staged };
      });
    },

    async promoteStagedGenerationResult(projectId: string, jobId: string, guard?: ProjectExecutionGuard) {
      return client.$transaction(async (tx) => {
        await assertActiveProjectForWrite(tx, projectId);
        const job = await tx.generationJob.findFirst({ where: { id: jobId, projectId } });
        if (!job) throw new Error(`GenerationJob not found: ${jobId}`);
        const stage = await tx.stagedArtifactCommit.findUnique({ where: { generationJobId: jobId } });
        if (!stage) throw new Error(`StagedArtifactCommit not found: ${jobId}`);

        if (job.status === "succeeded" && job.resultArtifactId && stage.state === "committed") {
          const artifact = await tx.artifact.findFirst({ where: { id: job.resultArtifactId, projectId } });
          const validationReport = await tx.validationReportRecord.findUnique({ where: { stagedArtifactCommitId: stage.id } });
          if (!artifact || stage.resultArtifactId !== artifact.id || validationReport?.artifactId !== artifact.id) {
            throw new Error(`Committed generation result is inconsistent: ${jobId}`);
          }
          return { status: "committed" as const, artifact, job, stage };
        }
        if (stage.state === "quarantined" || job.status === "quarantined") {
          return { status: "quarantined" as const, job, stage, reason: stage.quarantineReason ?? job.pollState };
        }
        if (stage.state !== "staged") {
          throw new Error(`Generation result is not staged: ${jobId}`);
        }
        if (job.status !== "running") {
          throw new Error(`GenerationJob is not running: ${jobId}`);
        }

        const project = await tx.project.findUnique({ where: { id: projectId }, select: { intentEpoch: true } });
        if (!project || project.intentEpoch !== job.intentEpoch || stage.intentEpoch !== job.intentEpoch) {
          return quarantineGenerationResult(tx, job, stage, "stale_intent");
        }
        if (stage.inputHash !== (job.inputHash ?? `legacy:${job.id}`)) {
          return quarantineGenerationResult(tx, job, stage, "input_hash_mismatch");
        }
        const validationRecord = await tx.validationReportRecord.findUnique({
          where: { stagedArtifactCommitId: stage.id },
        });
        if (!validationRecord) {
          return quarantineGenerationResult(tx, job, stage, "validation_report_missing");
        }
        const validationReport = parseValidationReport(validationRecord.payloadJson);
        const validationIssue = validationReport
          ? validationReportIssue(validationReport, stage, job)
          : "validation_report_invalid";
        if (
          validationIssue ||
          validationRecord.reportDigest !== validationReport?.reportDigest ||
          validationRecord.overallStatus !== "passed"
        ) {
          return quarantineGenerationResult(tx, job, stage, validationIssue ?? "validation_report_record_mismatch");
        }
        if (guard) {
          const stageFenceMatches = stage.holderId === guard.holderId && stage.fencingToken === guard.fencingToken;
          const currentGuardIsValid = await validateGenerationCommitGuard(tx, projectId, guard);
          const recoverableBySameIdentity = executionIdentityMatchesStage(stage, guard);
          if (!currentGuardIsValid || (!stageFenceMatches && !recoverableBySameIdentity)) {
            return quarantineGenerationResult(tx, job, stage, "execution_fence_rejected");
          }
        }

        if (!stage.nodeKey || !stage.kind || !stage.title || !stage.artifactStatus || stage.summary === null || stage.markdownContent === null) {
          throw new Error(`Staged generation result is incomplete: ${jobId}`);
        }
        const latest = await tx.artifact.findFirst({
          where: { projectId, nodeKey: stage.nodeKey },
          orderBy: { version: "desc" },
        });
        const artifact = await tx.artifact.create({
          data: {
            projectId,
            nodeKey: stage.nodeKey,
            kind: stage.kind,
            title: stage.title,
            status: stage.artifactStatus,
            summary: stage.summary,
            markdownContent: stage.markdownContent,
            structuredContentJson: stage.structuredContentJson,
            version: latest ? latest.version + 1 : 1,
          },
        });
        await tx.workflowNode.update({
          where: { projectId_key: { projectId, key: stage.nodeKey } },
          data: { status: stage.artifactStatus },
        });
        const updatedJob = await tx.generationJob.update({
          where: { id: job.id },
          data: {
            status: "succeeded",
            pollState: "completed",
            resultArtifactId: artifact.id,
            finishedAt: new Date(),
            errorMessage: null,
          },
        });
        const committedStage = await tx.stagedArtifactCommit.update({
          where: { id: stage.id },
          data: {
            state: "committed",
            resultArtifactId: artifact.id,
            quarantineReason: null,
            committedAt: new Date(),
            holderId: guard?.holderId ?? stage.holderId,
            fencingToken: guard?.fencingToken ?? stage.fencingToken,
          },
        });
        await tx.validationReportRecord.update({
          where: { id: validationRecord.id },
          data: { artifactId: artifact.id },
        });
        return { status: "committed" as const, artifact, job: updatedJob, stage: committedStage };
      });
    },

    async failGenerationJob(projectId: string, jobId: string, input: FailGenerationJobInput) {
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
    },

    async getMessages(projectId: string) {
      return client.conversationMessage.findMany({
        where: { projectId },
        orderBy: { createdAt: "asc" },
      });
    },

    async getMessageReactions(projectId: string, createdByUserId: string) {
      return client.messageReaction.findMany({
        where: { projectId, createdByUserId },
        orderBy: { updatedAt: "asc" },
      });
    },

    async setMessageReaction(input: { projectId: string; messageId: string; createdByUserId: string; value: "helpful" | "unhelpful" | null }) {
      return client.$transaction(async (tx) => {
        const message = await tx.conversationMessage.findFirst({
          where: { id: input.messageId, projectId: input.projectId, role: "assistant" },
        });
        if (!message) throw new Error(`ConversationMessage not found: ${input.messageId}`);
        if (!input.value) {
          await tx.messageReaction.deleteMany({ where: { messageId: input.messageId, createdByUserId: input.createdByUserId } });
          return null;
        }
        return tx.messageReaction.upsert({
          where: { messageId_createdByUserId: { messageId: input.messageId, createdByUserId: input.createdByUserId } },
          update: { value: input.value, projectId: input.projectId },
          create: { projectId: input.projectId, messageId: input.messageId, createdByUserId: input.createdByUserId, value: input.value },
        });
      });
    },

    async getNodes(projectId: string) {
      return client.workflowNode.findMany({
        where: { projectId },
        orderBy: { order: "asc" },
      });
    },

    async getArtifacts(projectId: string) {
      return client.artifact.findMany({
        where: { projectId },
        orderBy: [{ nodeKey: "asc" }, { version: "asc" }],
      });
    },

    async getAgentRuns(projectId: string) {
      return client.agentRun.findMany({
        where: { projectId },
        orderBy: { startedAt: "asc" },
      });
    },

    async getGenerationJobs(projectId: string) {
      return client.generationJob.findMany({
        where: { projectId },
        orderBy: { createdAt: "asc" },
      });
    },

    async upsertVideoShots(projectId: string, input: UpsertVideoShotsInput) {
      assertVideoShotPlan(input);
      return client.$transaction(async (tx) => {
        await assertActiveProjectForWrite(tx, projectId);
        const sourceArtifact = await tx.artifact.findFirst({ where: { id: input.sourceArtifactId, projectId } });
        if (!sourceArtifact) throw new Error(`Artifact not found: ${input.sourceArtifactId}`);

        return Promise.all(input.shots.map(async (shot) => {
          const existing = await tx.videoShot.findUnique({
            where: { projectId_sourceArtifactId_shotId: { projectId, sourceArtifactId: input.sourceArtifactId, shotId: shot.shotId } },
          });
          if (!existing) {
            return tx.videoShot.create({ data: { projectId, sourceArtifactId: input.sourceArtifactId, ...shot } });
          }
          const changedInput = existing.inputHash !== shot.inputHash || existing.ordinal !== shot.ordinal;
          return tx.videoShot.update({
            where: { id: existing.id },
            data: changedInput
              ? { ...shot, providerTaskId: null, selectedArtifactId: null, status: "planned", qaJson: "{}" }
              : { ordinal: shot.ordinal },
          });
        }));
      });
    },

    async recordVideoShotProviderTask(projectId: string, sourceArtifactId: string, shotId: string, providerTaskId: string) {
      const taskId = providerTaskId.trim();
      if (!taskId) throw new Error("VideoShot providerTaskId is required.");
      return client.$transaction(async (tx) => {
        await assertActiveProjectForWrite(tx, projectId);
        const shot = await tx.videoShot.findUnique({ where: { projectId_sourceArtifactId_shotId: { projectId, sourceArtifactId, shotId } } });
        if (!shot) throw new Error(`VideoShot not found: ${shotId}`);
        if (shot.providerTaskId && shot.providerTaskId !== taskId) throw new Error(`VideoShot providerTaskId conflict: ${shotId}`);
        if (!["planned", "submitted"].includes(shot.status)) throw new Error(`VideoShot cannot accept provider task from status: ${shot.status}`);
        return tx.videoShot.update({ where: { id: shot.id }, data: { providerTaskId: taskId, status: "submitted" } });
      });
    },

    async selectVideoShotArtifact(projectId: string, sourceArtifactId: string, shotId: string, artifactId: string, qa: Record<string, unknown> = {}) {
      return client.$transaction(async (tx) => {
        await assertActiveProjectForWrite(tx, projectId);
        const [shot, artifact] = await Promise.all([
          tx.videoShot.findUnique({ where: { projectId_sourceArtifactId_shotId: { projectId, sourceArtifactId, shotId } } }),
          tx.artifact.findFirst({ where: { id: artifactId, projectId, kind: "video_segment_generate", nodeKey: "video_segment_generate" } }),
        ]);
        if (!shot) throw new Error(`VideoShot not found: ${shotId}`);
        if (!artifact) throw new Error(`VideoShot selected artifact is invalid: ${artifactId}`);
        return tx.videoShot.update({ where: { id: shot.id }, data: { selectedArtifactId: artifact.id, status: "ready", qaJson: JSON.stringify(qa) } });
      });
    },

    async updateVideoShotQa(projectId: string, sourceArtifactId: string, shotId: string, status: "ready" | "needs_retake" | "failed", qa: Record<string, unknown>) {
      return client.$transaction(async (tx) => {
        await assertActiveProjectForWrite(tx, projectId);
        const shot = await tx.videoShot.findUnique({ where: { projectId_sourceArtifactId_shotId: { projectId, sourceArtifactId, shotId } } });
        if (!shot) throw new Error(`VideoShot not found: ${shotId}`);
        if (status === "ready" && !shot.selectedArtifactId) throw new Error(`VideoShot cannot be ready without a selected artifact: ${shotId}`);
        return tx.videoShot.update({ where: { id: shot.id }, data: { status, qaJson: JSON.stringify(qa) } });
      });
    },

    async getVideoShots(projectId: string, sourceArtifactId?: string) {
      return client.videoShot.findMany({
        where: { projectId, ...(sourceArtifactId ? { sourceArtifactId } : {}) },
        orderBy: [{ sourceArtifactId: "asc" }, { ordinal: "asc" }],
      });
    },

    async getConversationTurnJobs(projectId: string) {
      return client.conversationTurnJob.findMany({
        where: { projectId },
        orderBy: { createdAt: "asc" },
      });
    },

    acquireProjectExecutionLease: executionLeases.acquire,
    renewProjectExecutionLease: executionLeases.renew,
    releaseProjectExecutionLease: executionLeases.release,

    async assertExecutionGuard(projectId: string, guard: ProjectExecutionGuard, now = new Date()) {
      if (guard.projectId !== projectId) {
        throw new ProjectExecutionLeaseRejectedError("Execution guard project does not match the write target.");
      }
      await client.$transaction(async (tx) => {
        await assertCurrentFence(tx, guard, now);
        await assertExecutionIdentityCanWriteProject(tx, guard.identity, projectId, now);
      });
    },
  };
}

type TransactionClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

async function assertGenerationCommitGuard(
  tx: TransactionClient,
  projectId: string,
  guard: ProjectExecutionGuard,
  now = new Date(),
) {
  if (guard.projectId !== projectId) {
    throw new ProjectExecutionLeaseRejectedError("Execution guard project does not match the generation target.");
  }
  await assertCurrentFence(tx, guard, now);
  await assertExecutionIdentityCanWriteProject(tx, guard.identity, projectId, now);
}

async function validateGenerationCommitGuard(
  tx: TransactionClient,
  projectId: string,
  guard: ProjectExecutionGuard,
) {
  try {
    await assertGenerationCommitGuard(tx, projectId, guard);
    return true;
  } catch (error) {
    if (error instanceof ProjectExecutionLeaseRejectedError || error instanceof ExecutionIdentityRejectedError) return false;
    throw error;
  }
}

async function quarantineGenerationResult(
  tx: TransactionClient,
  job: { id: string; pollState: string },
  stage: { id: string },
  reason: string,
) {
  const now = new Date();
  const updatedJob = await tx.generationJob.update({
    where: { id: job.id },
    data: {
      status: "quarantined",
      pollState: reason,
      resultArtifactId: null,
      errorMessage: `Generation result quarantined: ${reason}`,
      finishedAt: now,
    },
  });
  const updatedStage = await tx.stagedArtifactCommit.update({
    where: { id: stage.id },
    data: {
      state: "quarantined",
      resultArtifactId: null,
      quarantineReason: reason,
      committedAt: null,
    },
  });
  return { status: "quarantined" as const, job: updatedJob, stage: updatedStage, reason };
}

function assertPassedValidationReportForDraft(
  report: ValidationReport,
  draft: Pick<SaveArtifactInput, "nodeKey" | "kind" | "title" | "summary" | "markdownContent" | "structuredContent">,
) {
  const issue = validationReportIssue(report, draft);
  if (issue) throw new Error(`Validation report rejected: ${issue}`);
}

function validationReportIssue(
  report: ValidationReport,
  draft: {
    nodeKey: string | null;
    kind: string | null;
    title: string | null;
    summary: string | null;
    markdownContent: string | null;
    structuredContent?: Record<string, unknown>;
    structuredContentJson?: string;
  },
  job?: { id: string; inputHash: string | null; intentEpoch: number },
): string | undefined {
  if (!hasValidValidationReportDigest(report)) return "validation_report_digest_mismatch";
  if (report.overallStatus !== "passed") return `validation_report_${report.overallStatus}`;
  if (!draft.nodeKey || !draft.kind || !draft.title || draft.summary === null || draft.markdownContent === null) {
    return "validation_target_incomplete";
  }
  const structuredContent = draft.structuredContent
    ?? (draft.structuredContentJson ? parseStructuredContent(draft.structuredContentJson) : {});
  const targetDigest = hashArtifactDraft({
    nodeKey: draft.nodeKey,
    kind: draft.kind,
    title: draft.title,
    summary: draft.summary,
    markdownContent: draft.markdownContent,
    structuredContent,
  });
  if (report.target.kind !== "artifact_draft" || report.target.targetDigest !== targetDigest) {
    return "validation_target_digest_mismatch";
  }
  if (job) {
    const expectedInputHash = job.inputHash ?? `legacy:${job.id}`;
    if (report.inputHash !== expectedInputHash) return "validation_input_hash_mismatch";
    if (report.intentEpoch !== job.intentEpoch) return "validation_intent_epoch_mismatch";
  }
  return undefined;
}

function validationReportRecordData(input: {
  projectId: string;
  report: ValidationReport;
  artifactId?: string;
  generationJobId?: string;
  stagedArtifactCommitId?: string;
}) {
  const report = input.report;
  const createdAt = new Date(report.createdAt);
  if (Number.isNaN(createdAt.getTime())) throw new Error("Validation report createdAt is invalid.");
  return {
    id: report.reportId,
    projectId: input.projectId,
    capabilityId: report.stage,
    stage: report.stage,
    authority: report.authority,
    domain: report.domain,
    targetKind: report.target.kind,
    targetId: report.target.targetId,
    targetVersion: report.target.targetVersion,
    targetDigest: report.target.targetDigest,
    inputHash: report.inputHash,
    intentEpoch: report.intentEpoch,
    contractId: report.contract.id,
    contractVersion: report.contract.version,
    overallStatus: report.overallStatus,
    reportDigest: report.reportDigest,
    payloadJson: JSON.stringify(report),
    artifactId: input.artifactId,
    generationJobId: input.generationJobId,
    stagedArtifactCommitId: input.stagedArtifactCommitId,
    createdAt,
  };
}

function parseValidationReport(value: string): ValidationReport | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) return undefined;
    return parsed as ValidationReport;
  } catch {
    return undefined;
  }
}

async function assertAgentRunFinishEvidence(
  tx: TransactionClient,
  projectId: string,
  nodeKey: string,
  input: FinishAgentRunInput,
) {
  if (!input.evidence) {
    throw new Error("缺少当前材料、校验结果或质量结论，不能标记为完成。");
  }
  const [artifact, validationRecord, decisionRecord] = await Promise.all([
    tx.artifact.findFirst({ where: { id: input.evidence.artifactId, projectId } }),
    tx.validationReportRecord.findFirst({ where: { id: input.evidence.validationReportId, projectId, artifactId: input.evidence.artifactId } }),
    tx.qualityDecisionRecord.findFirst({ where: { id: input.evidence.qualityDecisionId, projectId, artifactId: input.evidence.artifactId } }),
  ]);
  if (!artifact || !validationRecord || !decisionRecord || artifact.nodeKey !== nodeKey) {
    throw new Error("完成证据与当前材料不匹配，不能标记为完成。");
  }
  const latestArtifact = await tx.artifact.findFirst({
    where: { projectId, nodeKey },
    orderBy: { version: "desc" },
    select: { id: true },
  });
  if (latestArtifact?.id !== artifact.id) {
    throw new Error("完成证据不是当前材料的最新版本，不能标记为完成。");
  }
  const validationReport = parseValidationReport(validationRecord.payloadJson);
  const qualityDecision = parseQualityDecision(decisionRecord.payloadJson);
  const artifactDigest = hashArtifactDraft({
    nodeKey: artifact.nodeKey,
    kind: artifact.kind,
    title: artifact.title,
    summary: artifact.summary,
    markdownContent: artifact.markdownContent,
    structuredContent: parseStructuredContent(artifact.structuredContentJson),
  });
  const finish = guardFinish({
    artifact: { id: artifact.id, version: artifact.version, digest: artifactDigest },
    validationReport,
    qualityDecision,
  });
  if (!finish.allowed) {
    throw new Error("当前材料的完成证据未通过校验，不能标记为完成。");
  }
}

function parseQualityDecision(value: string): QualityDecision | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) return undefined;
    return parsed as QualityDecision;
  } catch {
    return undefined;
  }
}

function extractStorageRefs(value: unknown) {
  const refs = new Set<string>();
  collectStorageRefs(value, refs);
  return [...refs].sort();
}

function executionIdentityMatchesStage(
  stage: { actorUserId: string | null; actorAuthMode: string | null; authSessionId: string | null },
  guard: ProjectExecutionGuard,
) {
  return stage.actorUserId === guard.identity.actorUserId
    && stage.actorAuthMode === guard.identity.actorAuthMode
    && stage.authSessionId === guard.identity.authSessionId;
}

function collectStorageRefs(value: unknown, refs: Set<string>) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectStorageRefs(entry, refs));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (key === "localOutput" && typeof entry === "string") {
      const normalized = entry.trim().replaceAll("\\", "/").replace(/^\.\//, "");
      if (isSafeLogicalStorageRef(normalized)) refs.add(normalized);
    } else {
      collectStorageRefs(entry, refs);
    }
  }
}

function isSafeLogicalStorageRef(value: string) {
  if (!(value.startsWith(".tmp/") || value.startsWith("artifact-storage/"))) return false;
  return value.split("/").every((segment) => Boolean(segment) && segment !== "." && segment !== "..");
}

async function assertCurrentFence(tx: TransactionClient, fence: ProjectExecutionFence, now: Date) {
  const lease = await tx.projectExecutionLease.findFirst({
    where: {
      projectId: fence.projectId,
      holderId: fence.holderId,
      fencingToken: fence.fencingToken,
      leasedUntil: { gt: now },
    },
    select: { projectId: true },
  });
  if (!lease) throw new ProjectExecutionLeaseRejectedError("Project execution lease is missing, expired, or fenced out.");
}

async function validateJobExecutionIdentity(
  tx: TransactionClient,
  job: { projectId: string; actorUserId: string | null; actorAuthMode: string | null; authSessionId: string | null },
  now: Date,
) {
  if (!job.actorUserId || !isExecutionAuthMode(job.actorAuthMode)) return false;
  try {
    await assertExecutionIdentityCanWriteProject(tx, {
      actorUserId: job.actorUserId,
      actorAuthMode: job.actorAuthMode,
      authSessionId: job.authSessionId,
    }, job.projectId, now);
    return true;
  } catch (error) {
    if (error instanceof ExecutionIdentityRejectedError) return false;
    throw error;
  }
}

async function validateGuardForJob(
  tx: TransactionClient,
  job: { projectId: string; fencingToken: number | null },
  guard: ProjectExecutionGuard,
) {
  if (job.projectId !== guard.projectId || job.fencingToken !== guard.fencingToken) return false;
  try {
    await assertCurrentFence(tx, guard, new Date());
    await assertExecutionIdentityCanWriteProject(tx, guard.identity, guard.projectId);
    return true;
  } catch (error) {
    if (error instanceof ProjectExecutionLeaseRejectedError || error instanceof ExecutionIdentityRejectedError) return false;
    throw error;
  }
}

async function quarantineTurnJob(
  tx: TransactionClient,
  jobId: string,
  expectedStatus: string,
  expectedFencingToken: number | null,
  errorCode: string,
  now: Date,
) {
  const updated = await tx.conversationTurnJob.updateMany({
    where: { id: jobId, status: expectedStatus, fencingToken: expectedFencingToken },
    data: {
      status: "quarantined",
      errorCode,
      errorMessage: "后台执行身份或写租约已经失效，本次结果未提交。",
      lockedBy: null,
      lockedUntil: null,
      finishedAt: now,
      fencingToken: expectedFencingToken,
    },
  });
  if (updated.count !== 1) {
    throw new ProjectExecutionLeaseRejectedError("Conversation turn job was already claimed by a newer fence.");
  }
  const job = await tx.conversationTurnJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error(`ConversationTurnJob not found after quarantine: ${jobId}`);
  return job;
}

function isExecutionAuthMode(value: string | null): value is "local" | "password" | "oauth" | "sso" {
  return value === "local" || value === "password" || value === "oauth" || value === "sso";
}

async function prepareGenerationJobInput(client: PrismaClient, projectId: string, input: CreateGenerationJobInput) {
  const [project, sourceArtifact] = await Promise.all([
    client.project.findUnique({ where: { id: projectId }, select: { intentEpoch: true } }),
    client.artifact.findFirst({
      where: { id: input.sourceArtifactId, projectId },
      select: { id: true, nodeKey: true, kind: true, version: true, updatedAt: true },
    }),
  ]);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  if (!sourceArtifact) throw new Error(`Artifact not found: ${input.sourceArtifactId}`);

  const capabilityId = input.capabilityId?.trim() || input.kind;
  const sourceArtifactIds = input.sourceArtifactIds?.length ? [...input.sourceArtifactIds] : [sourceArtifact.id];
  const payload = {
    projectId,
    intentEpoch: project.intentEpoch,
    capabilityId,
    kind: input.kind,
    sourceArtifactIds,
    sourceArtifact: {
      id: sourceArtifact.id,
      nodeKey: sourceArtifact.nodeKey,
      kind: sourceArtifact.kind,
      version: sourceArtifact.version,
      updatedAt: sourceArtifact.updatedAt,
    },
    input: { ...(input.inputSnapshot ?? {}), ...(input.unitId?.trim() ? { unitId: input.unitId.trim() } : {}) },
  };
  const inputHash = hashRunInput(payload);
  const payloadJson = canonicalizeRunInput(payload);
  const idempotencyKey = input.idempotencyKey?.trim()
    || `generation:${capabilityId}:${sourceArtifact.id}:unit:${input.unitId?.trim() || "whole"}:epoch:${project.intentEpoch}`;
  if (!idempotencyKey) throw new Error("GenerationJob idempotencyKey is required.");

  return {
    capabilityId,
    sourceArtifactIds,
    intentEpoch: project.intentEpoch,
    inputHash,
    payloadJson,
    idempotencyKey,
  };
}

function isUniqueConstraintError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

function isSqliteWriteContentionError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code) : "";
  const message = "message" in error ? String(error.message).toLowerCase() : "";
  return code === "P1008" || message.includes("operation has timed out") || message.includes("database is locked");
}

function waitForConcurrentCommit(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function withRouteGenerationActions(input: {
  projectId: string;
  artifactId: string;
  nodeKey: string;
  kind: string;
  structuredContentJson: string;
}) {
  const structuredContent = parseStructuredContent(input.structuredContentJson);
  const capabilityId = routeGenerationCapabilityForArtifact(input);
  if (!capabilityId) return structuredContent;

  return {
    ...structuredContent,
    routeGenerationActions: {
      ...(isRecord(structuredContent.routeGenerationActions) ? structuredContent.routeGenerationActions : {}),
      [capabilityId]: {
        actionId: createHumanGateActionId({
          projectId: input.projectId,
          capabilityId,
          messageId: input.artifactId,
        }),
      },
    },
  };
}

function routeGenerationCapabilityForArtifact(input: { nodeKey: string; kind: string }) {
  if (input.nodeKey === "ppt_design_draft" && input.kind === "ppt_design_draft") return "coze_ppt";
  if (input.nodeKey === "ppt_draft" && input.kind === "ppt_draft") return "image_asset";
  if (input.nodeKey === "video_segment_plan" && input.kind === "video_segment_plan") return "video_segment_generate";
  return null;
}

function parseStructuredContent(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}");
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function attachArtifactApprovalEvidence(artifact: { nodeKey: string; kind: string; structuredContentJson: string }): Record<string, unknown> {
  const structuredContent = parseStructuredContent(artifact.structuredContentJson);
  if (artifact.nodeKey === "creative_theme_generate" && artifact.kind === "creative_theme_generate") {
    const review = structuredContent.videoCourseAnchorReview;
    if (!isPassedVideoReview(review, "video-course-anchor-review.v1")) {
      throw new Error("Video concept approval blocked: course_anchor_review_required");
    }
    return {
      ...structuredContent,
      videoCourseAnchorApproval: {
        schemaVersion: "video-course-anchor-approval.v1",
        decision: "approved",
        decisionSource: "artifact_approve_action",
        reviewEvidenceDigest: review.evidenceDigest,
        approvedAt: new Date().toISOString(),
      },
    };
  }
  if (artifact.nodeKey === "concat_only_assemble" && artifact.kind === "concat_only_assemble") {
    const review = structuredContent.videoFinalReview;
    if (!isPassedVideoReview(review, "video-final-review.v1")) {
      throw new Error("Final video approval blocked: video_final_review_required");
    }
    return {
      ...structuredContent,
      videoFinalApproval: {
        schemaVersion: "video-final-approval.v1",
        decision: "approved",
        decisionSource: "artifact_approve_action",
        reviewEvidenceDigest: review.evidenceDigest,
        approvedAt: new Date().toISOString(),
      },
    };
  }
  if ("pptKeySampleCandidate" in structuredContent && !("pptKeySampleSet" in structuredContent)) {
    throw new Error("PPT key sample approval blocked: dvp_review_required");
  }
  if ("pptFullDeckCandidate" in structuredContent && !("pptFullDeckPackage" in structuredContent)) {
    throw new Error("PPT full deck approval blocked: delivery_review_required");
  }
  if ("pptFullDeckPackage" in structuredContent && !validatePptFullDeckPackage(structuredContent.pptFullDeckPackage as PptFullDeckPackage)) {
    throw new Error("PPT full deck approval blocked: delivery_package_invalid");
  }
  // Full-deck artifacts retain their sample lineage for audit, but that lineage is
  // intentionally bound to the key-sample manifest rather than the full batch.
  if ("pptFullDeckPackage" in structuredContent) return structuredContent;
  if (!("pptKeySampleSet" in structuredContent)) return structuredContent;

  const designPackage = structuredContent.pptDesignPackage as PptDesignPackage | undefined;
  const requestBatch = structuredContent.pptAssetRequestBatch as PptAssetRequestBatch | undefined;
  const manifest = structuredContent.pptAssetManifest as PptAssetManifest | undefined;
  const sampleSet = structuredContent.pptKeySampleSet as PptKeySampleSet | undefined;
  if (!designPackage || !requestBatch || !manifest || !sampleSet) {
    throw new Error("PPT key sample approval evidence is incomplete.");
  }
  const sampleValidation = validatePptKeySampleSet({ designPackage, requestBatch, manifest, sampleSet });
  if (!sampleValidation.valid) {
    throw new Error(`PPT key sample approval blocked: ${sampleValidation.issues.map((item) => item.code).join(",")}`);
  }
  const approval: PptSampleApproval = {
    schemaVersion: "ppt-sample-approval.v1",
    decision: "approved",
    decisionSource: "artifact_approve_action",
    decisionText: "artifact_approve_action",
    teacherMessageId: null,
    designPackageDigest: sampleSet.designPackageDigest,
    sampleSetDigest: sampleSet.sampleSetDigest,
    approvedAt: new Date().toISOString(),
  };
  const approvalValidation = validatePptSampleApproval(sampleSet, approval);
  if (!approvalValidation.valid) {
    throw new Error(`PPT key sample approval blocked: ${approvalValidation.issues.map((item) => item.code).join(",")}`);
  }
  return { ...structuredContent, pptSampleApproval: approval };
}

function isPassedVideoReview(value: unknown, schemaVersion: string): value is Record<string, unknown> {
  return isRecord(value) && value.schemaVersion === schemaVersion && value.overallStatus === "passed" &&
    typeof value.evidenceDigest === "string" && /^[a-f0-9]{64}$/i.test(value.evidenceDigest);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function assertVideoShotPlan(input: UpsertVideoShotsInput) {
  if (!input.sourceArtifactId.trim() || input.shots.length < 3) throw new Error("VideoShot plan requires a source artifact and at least three shots.");
  const seen = new Set<string>();
  for (const [index, shot] of input.shots.entries()) {
    if (!/^shot_[a-z0-9_-]+$/i.test(shot.shotId) || seen.has(shot.shotId) || shot.ordinal !== index + 1 || !/^[a-f0-9]{64}$/i.test(shot.inputHash)) {
      throw new Error("VideoShot plan is invalid.");
    }
    seen.add(shot.shotId);
  }
}
