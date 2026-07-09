import { createPrismaWorkbenchRepository, type WorkbenchRepository } from "./repository";
import type { WorkbenchActor } from "@/server/auth/actor";
import { canReadProject, canTriggerGeneration, canWriteProjectContent } from "@/server/auth/authorization";
import type {
  AddMessageInput,
  AgentRunRecord,
  ArtifactRecord,
  ConversationMessageRecord,
  ConversationTurnJobRecord,
  CreateGenerationJobInput,
  CreateProjectInput,
  EnqueueMessageAndConversationTurnInput,
  EnqueueConversationTurnInput,
  FailConversationTurnInput,
  FailGenerationJobInput,
  FinishConversationTurnInput,
  FinishAgentRunInput,
  FinishGenerationJobInput,
  GenerationJobRecord,
  ProjectRecord,
  ProjectSnapshot,
  RegenerateArtifactInput,
  SaveArtifactInput,
  StartAgentRunInput,
  WorkflowNodeRecord,
} from "./types";
import type { AgentRun, Artifact, ConversationMessage, ConversationTurnJob, GenerationJob, Project, WorkflowNode } from "@/generated/prisma/client";

export function createWorkbenchService(repository: WorkbenchRepository = createPrismaWorkbenchRepository(), actor?: WorkbenchActor) {
  async function ensureProjectAccess(projectId: string, access: "read" | "write" | "generate" = "read"): Promise<Project> {
    const project = await repository.getProject(projectId);
    if (!project || !canAccessProject(project, actor, access)) {
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
      await ensureProjectAccess(projectId, "write");
      const message = await repository.addMessage(projectId, input);
      return mapMessage(message);
    },

    async updateMessageMetadata(
      projectId: string,
      messageId: string,
      metadata: Record<string, unknown>,
    ): Promise<ConversationMessageRecord> {
      await ensureProjectAccess(projectId, "write");
      const message = await repository.updateMessageMetadata(projectId, messageId, metadata);
      return mapMessage(message);
    },

    async saveArtifact(projectId: string, input: SaveArtifactInput): Promise<ArtifactRecord> {
      await ensureProjectAccess(projectId, "write");
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
      await ensureProjectAccess(projectId, "write");
      const artifact = await repository.approveArtifact(projectId, artifactId);
      return mapArtifact(artifact);
    },

    async regenerateArtifact(projectId: string, artifactId: string, input: RegenerateArtifactInput): Promise<ArtifactRecord> {
      await ensureProjectAccess(projectId, "write");
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
      await ensureProjectAccess(projectId, "write");
      const run = await repository.startAgentRun(projectId, input);
      return mapAgentRun(run);
    },

    async finishAgentRun(projectId: string, runId: string, input: FinishAgentRunInput): Promise<AgentRunRecord> {
      await ensureProjectAccess(projectId, "write");
      const run = await repository.finishAgentRun(projectId, runId, input);
      return mapAgentRun(run);
    },

    async createGenerationJob(projectId: string, input: CreateGenerationJobInput): Promise<GenerationJobRecord> {
      await ensureProjectAccess(projectId, "generate");
      const sourceArtifact = await repository.getArtifact(projectId, input.sourceArtifactId);
      if (!sourceArtifact) {
        throw new Error(`Artifact not found: ${input.sourceArtifactId}`);
      }
      const job = await repository.createGenerationJob(projectId, input);
      return mapGenerationJob(job);
    },

    async startGenerationJob(projectId: string, jobId: string): Promise<GenerationJobRecord> {
      await ensureProjectAccess(projectId, "generate");
      const job = await repository.startGenerationJob(projectId, jobId);
      return mapGenerationJob(job);
    },

    async finishGenerationJob(projectId: string, jobId: string, input: FinishGenerationJobInput): Promise<GenerationJobRecord> {
      await ensureProjectAccess(projectId, "generate");
      const job = await repository.finishGenerationJob(projectId, jobId, input);
      return mapGenerationJob(job);
    },

    async failGenerationJob(projectId: string, jobId: string, input: FailGenerationJobInput): Promise<GenerationJobRecord> {
      await ensureProjectAccess(projectId, "generate");
      const job = await repository.failGenerationJob(projectId, jobId, input);
      return mapGenerationJob(job);
    },

    async getGenerationJobs(projectId: string): Promise<GenerationJobRecord[]> {
      await ensureProjectAccess(projectId);
      const jobs = await repository.getGenerationJobs(projectId);
      return jobs.map(mapGenerationJob);
    },

    async enqueueConversationTurn(projectId: string, input: EnqueueConversationTurnInput): Promise<ConversationTurnJobRecord> {
      await ensureProjectAccess(projectId, "write");
      const job = await repository.enqueueConversationTurn(projectId, input);
      return mapConversationTurnJob(job);
    },

    async enqueueMessageAndConversationTurn(
      projectId: string,
      input: EnqueueMessageAndConversationTurnInput,
    ): Promise<{ message: ConversationMessageRecord; job: ConversationTurnJobRecord }> {
      await ensureProjectAccess(projectId, "write");
      const result = await repository.enqueueMessageAndConversationTurn(projectId, input);
      return { message: mapMessage(result.message), job: mapConversationTurnJob(result.job) };
    },

    async startNextConversationTurnJob(
      projectId: string,
      input: { lockedBy?: string; lockMs?: number } = {},
    ): Promise<ConversationTurnJobRecord | null> {
      await ensureProjectAccess(projectId, "generate");
      const job = await repository.startNextConversationTurnJob(projectId, input);
      return job ? mapConversationTurnJob(job) : null;
    },

    async finishConversationTurnJob(projectId: string, jobId: string, input: FinishConversationTurnInput): Promise<ConversationTurnJobRecord> {
      await ensureProjectAccess(projectId, "generate");
      const job = await repository.finishConversationTurnJob(projectId, jobId, input);
      return mapConversationTurnJob(job);
    },

    async failConversationTurnJob(projectId: string, jobId: string, input: FailConversationTurnInput): Promise<ConversationTurnJobRecord> {
      await ensureProjectAccess(projectId, "generate");
      const job = await repository.failConversationTurnJob(projectId, jobId, input);
      return mapConversationTurnJob(job);
    },

    async getConversationTurnJobs(projectId: string): Promise<ConversationTurnJobRecord[]> {
      await ensureProjectAccess(projectId);
      const jobs = await repository.getConversationTurnJobs(projectId);
      return jobs.map(mapConversationTurnJob);
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

    async getNodes(projectId: string): Promise<WorkflowNodeRecord[]> {
      await ensureProjectAccess(projectId);
      const nodes = await repository.getNodes(projectId);
      return nodes.map(mapNode);
    },

    async getProjectSnapshot(projectId: string): Promise<ProjectSnapshot> {
      const project = await ensureProjectAccess(projectId);
      const [messages, nodes, artifacts, agentRuns, generationJobs, turnJobs] = await Promise.all([
        repository.getMessages(projectId),
        repository.getNodes(projectId),
        repository.getArtifacts(projectId),
        repository.getAgentRuns(projectId),
        repository.getGenerationJobs(projectId),
        repository.getConversationTurnJobs(projectId),
      ]);

      return {
        project: mapProject(project),
        messages: messages.map(mapMessage),
        nodes: nodes.map(mapNode),
        artifacts: artifacts.map(mapArtifact),
        agentRuns: agentRuns.map(mapAgentRun),
        generationJobs: generationJobs.map(mapGenerationJob),
        turnJobs: turnJobs.map(mapConversationTurnJob),
      };
    },
  };
}

function canAccessProject(project: Project, actor: WorkbenchActor | undefined, access: "read" | "write" | "generate") {
  if (access === "write") return canWriteProjectContent(project, actor);
  if (access === "generate") return canTriggerGeneration(project, actor);
  return canReadProject(project, actor);
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
    metadata: parseJsonObject(message.metadataJson ?? "{}"),
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

function mapGenerationJob(job: GenerationJob): GenerationJobRecord {
  return {
    id: job.id,
    projectId: job.projectId,
    kind: job.kind as GenerationJobRecord["kind"],
    sourceArtifactId: job.sourceArtifactId,
    status: job.status as GenerationJobRecord["status"],
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    resultArtifactId: job.resultArtifactId,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

function mapConversationTurnJob(job: ConversationTurnJob): ConversationTurnJobRecord {
  return {
    id: job.id,
    projectId: job.projectId,
    teacherMessageId: job.teacherMessageId,
    assistantMessageId: job.assistantMessageId,
    status: job.status as ConversationTurnJobRecord["status"],
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    idempotencyKey: job.idempotencyKey,
    lockedBy: job.lockedBy,
    lockedUntil: job.lockedUntil?.toISOString() ?? null,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
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
