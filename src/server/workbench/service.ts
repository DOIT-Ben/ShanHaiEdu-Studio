import { createPrismaWorkbenchRepository, type WorkbenchRepository } from "./repository";
import type { WorkbenchActor } from "@/server/auth/local-session";
import type {
  AddMessageInput,
  AgentRunRecord,
  ArtifactRecord,
  ConversationMessageRecord,
  CreateProjectInput,
  FinishAgentRunInput,
  ProjectRecord,
  ProjectSnapshot,
  RegenerateArtifactInput,
  SaveArtifactInput,
  StartAgentRunInput,
  WorkflowNodeRecord,
} from "./types";
import type { AgentRun, Artifact, ConversationMessage, Project, WorkflowNode } from "@/generated/prisma/client";

export function createWorkbenchService(repository: WorkbenchRepository = createPrismaWorkbenchRepository(), actor?: WorkbenchActor) {
  async function ensureProjectAccess(projectId: string): Promise<Project> {
    const project = await repository.getProject(projectId);
    if (!project || !canAccessProject(project, actor)) {
      throw new Error(`Project not found: ${projectId}`);
    }
    return project;
  }

  return {
    async listProjects(): Promise<ProjectRecord[]> {
      const projects = await repository.listProjects({ actor });
      return projects.map(mapProject);
    },

    async createProject(input: CreateProjectInput): Promise<ProjectRecord> {
      const project = await repository.createProject({
        ...input,
        ownerUserId: input.ownerUserId ?? actor?.userId,
      });
      return mapProject(project);
    },

    async getProject(projectId: string): Promise<ProjectRecord> {
      const project = await ensureProjectAccess(projectId);
      return mapProject(project);
    },

    async addMessage(projectId: string, input: AddMessageInput): Promise<ConversationMessageRecord> {
      await ensureProjectAccess(projectId);
      const message = await repository.addMessage(projectId, input);
      return mapMessage(message);
    },

    async saveArtifact(projectId: string, input: SaveArtifactInput): Promise<ArtifactRecord> {
      await ensureProjectAccess(projectId);
      const artifact = await repository.saveArtifact(projectId, input);
      return mapArtifact(artifact);
    },

    async getArtifact(projectId: string, artifactId: string): Promise<ArtifactRecord> {
      await ensureProjectAccess(projectId);
      const artifact = await repository.getArtifact(projectId, artifactId);
      if (!artifact) {
        throw new Error(`Artifact not found: ${artifactId}`);
      }
      return mapArtifact(artifact);
    },

    async approveArtifact(projectId: string, artifactId: string): Promise<ArtifactRecord> {
      await ensureProjectAccess(projectId);
      const artifact = await repository.approveArtifact(projectId, artifactId);
      return mapArtifact(artifact);
    },

    async regenerateArtifact(projectId: string, artifactId: string, input: RegenerateArtifactInput): Promise<ArtifactRecord> {
      await ensureProjectAccess(projectId);
      const artifact = await repository.regenerateArtifact(projectId, artifactId, input);
      return mapArtifact(artifact);
    },

    async getApprovedInputs(projectId: string, nodeKey: WorkflowNodeRecord["key"]): Promise<ArtifactRecord[]> {
      await ensureProjectAccess(projectId);
      const node = await repository.getNode(projectId, nodeKey);
      if (!node) {
        throw new Error(`Workflow node not found: ${nodeKey}`);
      }

      const upstreamNodeKeys = parseJsonArray(node.upstreamNodeKeysJson);
      const artifacts = await repository.getApprovedArtifactsByNodeKeys(projectId, upstreamNodeKeys);
      return artifacts
        .map(mapArtifact)
        .sort((left, right) => upstreamNodeKeys.indexOf(left.nodeKey) - upstreamNodeKeys.indexOf(right.nodeKey));
    },

    async startAgentRun(projectId: string, input: StartAgentRunInput): Promise<AgentRunRecord> {
      await ensureProjectAccess(projectId);
      const run = await repository.startAgentRun(projectId, input);
      return mapAgentRun(run);
    },

    async finishAgentRun(projectId: string, runId: string, input: FinishAgentRunInput): Promise<AgentRunRecord> {
      await ensureProjectAccess(projectId);
      const run = await repository.finishAgentRun(projectId, runId, input);
      return mapAgentRun(run);
    },

    async getMessages(projectId: string): Promise<ConversationMessageRecord[]> {
      await ensureProjectAccess(projectId);
      const messages = await repository.getMessages(projectId);
      return messages.map(mapMessage);
    },

    async getArtifacts(projectId: string): Promise<ArtifactRecord[]> {
      await ensureProjectAccess(projectId);
      const artifacts = await repository.getArtifacts(projectId);
      return artifacts.map(mapArtifact);
    },

    async getProjectSnapshot(projectId: string): Promise<ProjectSnapshot> {
      const project = await ensureProjectAccess(projectId);
      const [messages, nodes, artifacts, agentRuns] = await Promise.all([
        repository.getMessages(projectId),
        repository.getNodes(projectId),
        repository.getArtifacts(projectId),
        repository.getAgentRuns(projectId),
      ]);

      return {
        project: mapProject(project),
        messages: messages.map(mapMessage),
        nodes: nodes.map(mapNode),
        artifacts: artifacts.map(mapArtifact),
        agentRuns: agentRuns.map(mapAgentRun),
      };
    },
  };
}

function canAccessProject(project: Project, actor?: WorkbenchActor) {
  if (!actor) return true;
  return !project.ownerUserId || project.ownerUserId === actor.userId;
}

function mapProject(project: Project): ProjectRecord {
  return {
    id: project.id,
    title: project.title,
    status: project.status as ProjectRecord["status"],
    currentNodeKey: project.currentNodeKey as ProjectRecord["currentNodeKey"],
    grade: project.grade,
    subject: project.subject,
    textbookVersion: project.textbookVersion,
    lessonTopic: project.lessonTopic,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

function mapMessage(message: ConversationMessage): ConversationMessageRecord {
  return {
    id: message.id,
    projectId: message.projectId,
    role: message.role as ConversationMessageRecord["role"],
    content: message.content,
    artifactRefs: parseJsonArray(message.artifactRefsJson),
    createdAt: message.createdAt.toISOString(),
  };
}

function mapNode(node: WorkflowNode): WorkflowNodeRecord {
  return {
    id: node.id,
    projectId: node.projectId,
    key: node.key as WorkflowNodeRecord["key"],
    title: node.title,
    status: node.status as WorkflowNodeRecord["status"],
    order: node.order,
    upstreamNodeKeys: parseJsonArray(node.upstreamNodeKeysJson) as WorkflowNodeRecord["upstreamNodeKeys"],
    approvedArtifactId: node.approvedArtifactId,
    staleReason: node.staleReason,
    updatedAt: node.updatedAt.toISOString(),
  };
}

function mapArtifact(artifact: Artifact): ArtifactRecord {
  return {
    id: artifact.id,
    projectId: artifact.projectId,
    nodeKey: artifact.nodeKey as ArtifactRecord["nodeKey"],
    title: artifact.title,
    kind: artifact.kind as ArtifactRecord["kind"],
    status: artifact.status as ArtifactRecord["status"],
    summary: artifact.summary,
    markdownContent: artifact.markdownContent,
    structuredContent: parseJsonObject(artifact.structuredContentJson),
    version: artifact.version,
    isApproved: artifact.isApproved,
    createdAt: artifact.createdAt.toISOString(),
    updatedAt: artifact.updatedAt.toISOString(),
  };
}

function mapAgentRun(run: AgentRun): AgentRunRecord {
  return {
    id: run.id,
    projectId: run.projectId,
    nodeKey: run.nodeKey as AgentRunRecord["nodeKey"],
    status: run.status,
    runtime: run.runtime,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    errorMessage: run.errorMessage,
  };
}

function parseJsonArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}
