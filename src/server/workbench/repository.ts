import { prisma } from "@/server/db/client";
import type { PrismaClient } from "@/generated/prisma/client";
import type { WorkbenchActor } from "@/server/auth/actor";
import { DEFAULT_WORKFLOW_NODES, FIRST_WORKFLOW_NODE_KEY } from "./workflow-defaults";
import type {
  AddMessageInput,
  CreateProjectInput,
  CreateGenerationJobInput,
  FailGenerationJobInput,
  FinishAgentRunInput,
  FinishGenerationJobInput,
  RegenerateArtifactInput,
  SaveArtifactInput,
  StartAgentRunInput,
} from "./types";

export type WorkbenchRepository = ReturnType<typeof createPrismaWorkbenchRepository>;

export function createPrismaWorkbenchRepository(client: PrismaClient = prisma) {
  return {
    async listProjects(input: { actor?: WorkbenchActor } = {}) {
      return client.project.findMany({
        where: input.actor
          ? {
              OR: [
                { ownerUserId: input.actor.userId },
                ...((input.actor.authMode ?? "local") === "local" ? [{ ownerUserId: null }] : []),
                { memberships: { some: { userId: input.actor.userId } } },
              ],
            }
          : undefined,
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
      return client.conversationMessage.create({
        data: {
          projectId,
          role: input.role,
          content: input.content,
          artifactRefsJson: JSON.stringify(input.artifactRefs ?? []),
        },
      });
    },

    async saveArtifact(projectId: string, input: SaveArtifactInput) {
      return client.$transaction(async (tx) => {
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
          data: { status: "approved", isApproved: true },
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
      return client.generationJob.create({
        data: {
          projectId,
          kind: input.kind,
          sourceArtifactId: input.sourceArtifactId,
          status: "queued",
          attempts: 0,
          maxAttempts: input.maxAttempts ?? 2,
        },
      });
    },

    async startGenerationJob(projectId: string, jobId: string) {
      return client.$transaction(async (tx) => {
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
  };
}
