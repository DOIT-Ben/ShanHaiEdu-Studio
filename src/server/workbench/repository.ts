import { prisma } from "@/server/db/client";
import type { PrismaClient } from "@/generated/prisma/client";
import { DEFAULT_WORKFLOW_NODES, FIRST_WORKFLOW_NODE_KEY } from "./workflow-defaults";
import type {
  AddMessageInput,
  CreateProjectInput,
  FinishAgentRunInput,
  RegenerateArtifactInput,
  SaveArtifactInput,
  StartAgentRunInput,
} from "./types";

export type WorkbenchRepository = ReturnType<typeof createPrismaWorkbenchRepository>;

export function createPrismaWorkbenchRepository(client: PrismaClient = prisma) {
  return {
    async listProjects() {
      return client.project.findMany({ orderBy: { updatedAt: "desc" } });
    },

    async createProject(input: CreateProjectInput) {
      return client.$transaction(async (tx) => {
        const project = await tx.project.create({
          data: {
            title: input.title,
            currentNodeKey: FIRST_WORKFLOW_NODE_KEY,
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

        const run = await tx.agentRun.update({
          where: { id: runId },
          data: {
            status: input.status,
            finishedAt: new Date(),
            errorMessage: input.errorMessage ?? null,
          },
        });

        if (input.status === "failed") {
          await tx.workflowNode.update({
            where: { projectId_key: { projectId, key: existing.nodeKey } },
            data: { status: "failed" },
          });
        }

        return run;
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
  };
}
