import { prisma } from "@/server/db/client";
import type { PrismaClient } from "@/generated/prisma/client";
import type { WorkbenchActor } from "@/server/auth/actor";
import { createHumanGateActionId } from "@/server/guards/human-gate";
import { DEFAULT_WORKFLOW_NODES, FIRST_WORKFLOW_NODE_KEY } from "./workflow-defaults";
import { assertActiveProjectForWrite } from "./project-lifecycle-service";
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
  FinishGenerationJobInput,
  RegenerateArtifactInput,
  SaveArtifactInput,
  StartAgentRunInput,
  ProjectLifecycleState,
} from "./types";

export type WorkbenchRepository = ReturnType<typeof createPrismaWorkbenchRepository>;

export function createPrismaWorkbenchRepository(client: PrismaClient = prisma) {
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
              structuredContentJson: existing.structuredContentJson,
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

    async createGenerationJob(projectId: string, input: CreateGenerationJobInput) {
      return client.$transaction(async (tx) => {
        await assertActiveProjectForWrite(tx, projectId);
        return tx.generationJob.create({
          data: {
            projectId,
            kind: input.kind,
            sourceArtifactId: input.sourceArtifactId,
            status: "queued",
            attempts: 0,
            maxAttempts: input.maxAttempts ?? 2,
          },
        });
      });
    },

    async enqueueConversationTurn(projectId: string, input: EnqueueConversationTurnInput) {
      return client.$transaction(async (tx) => {
        await assertActiveProjectForWrite(tx, projectId);
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

    async startNextConversationTurnJob(projectId: string, input: { lockedBy?: string; lockMs?: number } = {}) {
      return client.$transaction(async (tx) => {
        await assertActiveProjectForWrite(tx, projectId);
        const now = new Date();
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

          const lockMs = input.lockMs ?? 10 * 60 * 1000;
          return tx.conversationTurnJob.update({
            where: { id: expiredRunning.id },
            data: {
              status: "running",
              attempts: expiredRunning.attempts + 1,
              lockedBy: input.lockedBy ?? "local-worker",
              lockedUntil: new Date(Date.now() + lockMs),
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
            lockedUntil: new Date(Date.now() + lockMs),
            startedAt: new Date(),
            finishedAt: null,
            errorCode: null,
            errorMessage: null,
          },
        });
      });
    },

    async finishConversationTurnJob(projectId: string, jobId: string, input: FinishConversationTurnInput) {
      return client.$transaction(async (tx) => {
        await assertActiveProjectForWrite(tx, projectId);
        const existing = await tx.conversationTurnJob.findFirst({ where: { id: jobId, projectId } });
        if (!existing) {
          throw new Error(`ConversationTurnJob not found: ${jobId}`);
        }
        if (existing.status !== "running") {
          throw new Error(`ConversationTurnJob is not running: ${jobId}`);
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

    async failConversationTurnJob(projectId: string, jobId: string, input: FailConversationTurnInput) {
      return client.$transaction(async (tx) => {
        await assertActiveProjectForWrite(tx, projectId);
        const existing = await tx.conversationTurnJob.findFirst({ where: { id: jobId, projectId } });
        if (!existing) {
          throw new Error(`ConversationTurnJob not found: ${jobId}`);
        }
        if (existing.status !== "running") {
          throw new Error(`ConversationTurnJob is not running: ${jobId}`);
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
        if (existing.status !== "queued" && existing.status !== "failed") {
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
            startedAt: new Date(),
            finishedAt: null,
            errorMessage: null,
          },
        });
      });
    },

    async finishGenerationJob(projectId: string, jobId: string, input: FinishGenerationJobInput) {
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
            status: "succeeded",
            resultArtifactId: input.resultArtifactId,
            finishedAt: new Date(),
            errorMessage: null,
          },
        });
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

    async getConversationTurnJobs(projectId: string) {
      return client.conversationTurnJob.findMany({
        where: { projectId },
        orderBy: { createdAt: "asc" },
      });
    },
  };
}

function isUniqueConstraintError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
