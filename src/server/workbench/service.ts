import { createPrismaWorkbenchRepository, GenerationResultQuarantinedError, type WorkbenchRepository } from "./repository";
import { getProjectLifecycleState, mutateProjectLifecycle } from "./project-lifecycle-service";
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
  GenerationJobRecord,
  GenerationResultCommitRecord,
  ProjectRecord,
  ProjectLifecycleMutation,
  ProjectLifecycleState,
  ProjectSnapshot,
  RegenerateArtifactInput,
  RecoverConversationTurnInput,
  RecoverConversationTurnAfterProviderHealthInput,
  RecoverConversationTurnAfterContractRepairInput,
  SaveArtifactInput,
  SaveInteractiveCoursewareSpecInput,
  SetMessageReactionInput,
  StartAgentRunInput,
  WorkflowNodeRecord,
  ExecutionIdentitySnapshot,
  ProjectExecutionFence,
  ProjectExecutionGuard,
  RecordGenerationProviderTaskInput,
  StageGenerationResultInput,
  SubmitPptSampleReviewInput,
  SubmitPptFullDeckReviewInput,
  UpsertVideoShotsInput,
  VideoShotRecord,
} from "./types";
import { validateInteractiveCoursewareSpec } from "@/server/activities/interactive-courseware-spec";
import { deriveGenerationIntensitySuggestion, normalizeGenerationIntensity, type GenerationIntensity } from "@/server/generation-intensity/generation-intensity-policy";
import type { AgentRun, Artifact, ConversationMessage, ConversationTurnJob, GenerationJob, Project, VideoShot, WorkflowNode } from "@/generated/prisma/client";
import {
  legacyContentToMessageParts,
  normalizeMessageParts,
  projectConversationMessageParts,
} from "@/lib/conversation-message-contract";
import { hashArtifactDraft } from "@/server/contracts/contract-validator";
import type { TaskBrief } from "@/server/conversation/task-contract";
import { buildPptFullDeckReviewArtifact, buildPptSampleReviewArtifact } from "@/server/ppt-quality/ppt-review-artifact";
import { isArtifactTrustedForDownstream } from "@/server/quality/artifact-quality-state";
import { isArtifactBoundToRequestedOutput } from "@/server/quality/artifact-truth-boundary";

export function createWorkbenchService(
  repository: WorkbenchRepository = createPrismaWorkbenchRepository(),
  actor?: WorkbenchActor,
  executionIdentity?: ExecutionIdentitySnapshot,
  executionGuard?: ProjectExecutionGuard,
) {
  async function ensureProjectAccess(projectId: string, access: "read" | "write" | "generate" = "read"): Promise<Project> {
    const project = await repository.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    if (executionGuard && access !== "read") {
      await repository.assertExecutionGuard(projectId, executionGuard);
      return project;
    }
    if (!canAccessProject(project, actor, access)) {
      throw new Error(`Project not found: ${projectId}`);
    }
    return project;
  }

  async function withProjectedMessageParts<T extends AddMessageInput>(projectId: string, input: T) {
    if (input.parts) return { ...input, parts: normalizeMessageParts(input.parts) };
    const referencedIds = input.artifactRefs ?? [];
    const artifacts = referencedIds.length > 0 ? await repository.getArtifacts(projectId) : [];
    const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
    const artifactRefs = referencedIds.flatMap((artifactId) => {
      const artifact = byId.get(artifactId);
      if (!artifact) return [];
      const structuredContent = parseJsonObject(artifact.structuredContentJson);
      const qualityState = structuredContent.artifactQualityState &&
        typeof structuredContent.artifactQualityState === "object" &&
        !Array.isArray(structuredContent.artifactQualityState)
        ? structuredContent.artifactQualityState as Record<string, unknown>
        : {};
      return [{
        artifactId: artifact.id,
        version: artifact.version,
        digest: hashArtifactDraft({
          nodeKey: artifact.nodeKey,
          kind: artifact.kind,
          title: artifact.title,
          summary: artifact.summary,
          markdownContent: artifact.markdownContent,
          structuredContent,
        }),
        title: artifact.title,
        summary: artifact.summary,
        qualityOutcome: qualityState.downstreamEligibility === "eligible"
          ? "passed" as const
          : artifact.status === "failed" ? "failed" as const : "pending" as const,
      }];
    });
    return {
      ...input,
      parts: projectConversationMessageParts({
        role: input.role,
        content: input.content,
        artifactRefs,
        metadata: input.metadata,
      }),
    };
  }

  return {
    async listProjects(view: ProjectLifecycleState = "active"): Promise<ProjectRecord[]> {
      const projects = await repository.listProjects({ actor, view });
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
      const message = await repository.addMessage(projectId, await withProjectedMessageParts(projectId, input));
      return mapMessage(message);
    },

    async mutateProjectLifecycle(projectId: string, mutation: ProjectLifecycleMutation) {
      const result = await mutateProjectLifecycle({ projectId, actor, mutation });
      return { changed: result.changed, project: mapProject(result.project) };
    },

    async updateMessageMetadata(
      projectId: string,
      messageId: string,
      metadata: Record<string, unknown>,
    ): Promise<ConversationMessageRecord> {
      await ensureProjectAccess(projectId, "write");
      const existing = (await repository.getMessages(projectId)).find((candidate) => candidate.id === messageId);
      if (!existing) throw new Error(`ConversationMessage not found: ${messageId}`);
      const projected = await withProjectedMessageParts(projectId, {
        role: existing.role as AddMessageInput["role"],
        content: existing.content,
        artifactRefs: parseJsonArray(existing.artifactRefsJson),
        metadata,
      });
      const message = await repository.updateMessageMetadata(projectId, messageId, metadata, projected.parts);
      return mapMessage(message);
    },

    async setMessageReaction(projectId: string, input: SetMessageReactionInput) {
      await ensureProjectAccess(projectId, "write");
      if (!actor?.userId) throw new Error("A signed-in teacher is required.");
      const reaction = await repository.setMessageReaction({
        projectId,
        messageId: input.messageId,
        createdByUserId: actor.userId,
        value: input.value,
      });
      return reaction ? { messageId: reaction.messageId, value: reaction.value as "helpful" | "unhelpful" } : { messageId: input.messageId, value: null };
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

    async saveInteractiveCoursewareSpec(projectId: string, input: SaveInteractiveCoursewareSpecInput): Promise<ArtifactRecord> {
      await ensureProjectAccess(projectId, "write");
      const validation = validateInteractiveCoursewareSpec(input.spec);
      if (!validation.ok) {
        const details = validation.errors.map((entry) => `${entry.path}: ${entry.code}`).join("; ");
        throw new Error(`Interactive courseware spec is invalid: ${details}`);
      }

      const activityCount = input.spec.pages.reduce((total, page) => total + page.activities.length, 0);
      const artifact = await repository.saveArtifact(projectId, {
        nodeKey: "interactive_courseware_spec",
        kind: "interactive_courseware_spec",
        title: `互动课件：${input.spec.title}`,
        status: "needs_review",
        summary: `包含 ${input.spec.pages.length} 个页面和 ${activityCount} 个互动活动，等待教师审阅。`,
        markdownContent: `# ${input.spec.title}\n\n互动课件规格草稿，包含 ${input.spec.pages.length} 个页面和 ${activityCount} 个互动活动。`,
        structuredContent: { interactiveCoursewareSpec: input.spec },
      });
      return mapArtifact(artifact);
    },

    async submitPptSampleReview(projectId: string, artifactId: string, input: SubmitPptSampleReviewInput): Promise<ArtifactRecord> {
      await ensureProjectAccess(projectId, "write");
      const stored = await repository.getArtifact(projectId, artifactId);
      if (!stored) throw new Error(`Artifact not found: ${artifactId}`);
      const artifact = mapArtifact(stored);
      const saved = await repository.saveArtifact(projectId, buildPptSampleReviewArtifact(artifact, input));
      return mapArtifact(saved);
    },

    async submitPptFullDeckReview(projectId: string, artifactId: string, input: SubmitPptFullDeckReviewInput): Promise<ArtifactRecord> {
      await ensureProjectAccess(projectId, "write");
      const stored = await repository.getArtifact(projectId, artifactId);
      if (!stored) throw new Error(`Artifact not found: ${artifactId}`);
      const artifact = mapArtifact(stored);
      const saved = await repository.saveArtifact(projectId, buildPptFullDeckReviewArtifact(artifact, input));
      return mapArtifact(saved);
    },

    async regenerateArtifact(projectId: string, artifactId: string, input: RegenerateArtifactInput): Promise<ArtifactRecord> {
      await ensureProjectAccess(projectId, "write");
      const artifact = await repository.regenerateArtifact(projectId, artifactId, input);
      return mapArtifact(artifact);
    },

    async getApprovedInputs(
      projectId: string,
      nodeKey: WorkflowNodeRecord["key"],
      taskBrief?: TaskBrief,
    ): Promise<ArtifactRecord[]> {
      await ensureProjectAccess(projectId);
      const node = await repository.getNode(projectId, nodeKey);
      if (!node) {
        throw new Error(`Workflow node not found: ${nodeKey}`);
      }

      const upstreamNodeKeys = parseJsonArray(node.upstreamNodeKeysJson);
      const artifacts = await repository.getApprovedArtifactsByNodeKeys(projectId, upstreamNodeKeys);
      const mapped = artifacts
        .map(mapArtifact)
        .sort((left, right) => upstreamNodeKeys.indexOf(left.nodeKey) - upstreamNodeKeys.indexOf(right.nodeKey));
      return taskBrief
        ? mapped.filter((artifact) =>
            isArtifactTrustedForDownstream(artifact) && isArtifactBoundToRequestedOutput(artifact, taskBrief))
        : mapped;
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
      const job = await repository.createGenerationJob(projectId, input, executionGuard);
      return mapGenerationJob(job);
    },

    async startGenerationJob(projectId: string, jobId: string): Promise<GenerationJobRecord> {
      await ensureProjectAccess(projectId, "generate");
      const job = await repository.startGenerationJob(projectId, jobId);
      return mapGenerationJob(job);
    },

    async startGenerationJobForExecution(projectId: string, jobId: string) {
      await ensureProjectAccess(projectId, "generate");
      const job = await repository.startGenerationJob(projectId, jobId);
      return {
        job: mapGenerationJob(job),
        providerTaskId: job.providerTaskId,
        pollState: job.pollState,
      };
    },

    async commitGenerationResult(
      projectId: string,
      jobId: string,
      input: StageGenerationResultInput,
    ): Promise<GenerationResultCommitRecord> {
      await ensureProjectAccess(projectId, "generate");
      const staged = await repository.stageGenerationResult(projectId, jobId, input, executionGuard);
      if ("status" in staged && staged.status === "quarantined") {
        throw new GenerationResultQuarantinedError(staged.reason);
      }
      const promoted = await repository.promoteStagedGenerationResult(projectId, jobId, executionGuard);
      if (promoted.status === "quarantined") {
        throw new GenerationResultQuarantinedError(promoted.reason);
      }
      return { artifact: mapArtifact(promoted.artifact), job: mapGenerationJob(promoted.job) };
    },

    async resumeStagedGenerationResult(projectId: string, jobId: string): Promise<GenerationResultCommitRecord | null> {
      await ensureProjectAccess(projectId, "generate");
      const stage = await repository.getStagedGenerationResult(projectId, jobId);
      if (!stage || stage.state === "awaiting_result") return null;
      if (stage.state === "quarantined") {
        throw new GenerationResultQuarantinedError(stage.quarantineReason ?? "quarantined");
      }
      const promoted = await repository.promoteStagedGenerationResult(projectId, jobId, executionGuard);
      if (promoted.status === "quarantined") {
        throw new GenerationResultQuarantinedError(promoted.reason);
      }
      return { artifact: mapArtifact(promoted.artifact), job: mapGenerationJob(promoted.job) };
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

    async upsertVideoShots(projectId: string, input: UpsertVideoShotsInput): Promise<VideoShotRecord[]> {
      await ensureProjectAccess(projectId, "generate");
      return (await repository.upsertVideoShots(projectId, input)).map(mapVideoShot);
    },

    async recordVideoShotProviderTask(projectId: string, sourceArtifactId: string, shotId: string, providerTaskId: string): Promise<VideoShotRecord> {
      await ensureProjectAccess(projectId, "generate");
      return mapVideoShot(await repository.recordVideoShotProviderTask(projectId, sourceArtifactId, shotId, providerTaskId));
    },

    async selectVideoShotArtifact(projectId: string, sourceArtifactId: string, shotId: string, artifactId: string, qa: Record<string, unknown> = {}): Promise<VideoShotRecord> {
      await ensureProjectAccess(projectId, "generate");
      return mapVideoShot(await repository.selectVideoShotArtifact(projectId, sourceArtifactId, shotId, artifactId, qa));
    },

    async updateVideoShotQa(projectId: string, sourceArtifactId: string, shotId: string, status: "ready" | "needs_retake" | "failed", qa: Record<string, unknown>): Promise<VideoShotRecord> {
      await ensureProjectAccess(projectId, "generate");
      return mapVideoShot(await repository.updateVideoShotQa(projectId, sourceArtifactId, shotId, status, qa));
    },

    async getVideoShots(projectId: string, sourceArtifactId?: string): Promise<VideoShotRecord[]> {
      await ensureProjectAccess(projectId);
      return (await repository.getVideoShots(projectId, sourceArtifactId)).map(mapVideoShot);
    },

    async recordGenerationProviderTask(
      projectId: string,
      jobId: string,
      input: RecordGenerationProviderTaskInput,
    ): Promise<GenerationJobRecord> {
      await ensureProjectAccess(projectId, "generate");
      return mapGenerationJob(await repository.recordGenerationProviderTask(projectId, jobId, input));
    },

    async markGenerationSubmissionUnknown(projectId: string, jobId: string, errorMessage: string): Promise<GenerationJobRecord> {
      await ensureProjectAccess(projectId, "generate");
      return mapGenerationJob(await repository.markGenerationSubmissionUnknown(projectId, jobId, errorMessage));
    },

    async recordGenerationPoll(projectId: string, jobId: string): Promise<GenerationJobRecord> {
      await ensureProjectAccess(projectId, "generate");
      return mapGenerationJob(await repository.recordGenerationPoll(projectId, jobId));
    },

    async advanceProjectIntentEpoch(projectId: string, expectedIntentEpoch: number): Promise<number> {
      await ensureProjectAccess(projectId, "write");
      const project = await repository.advanceProjectIntentEpoch(projectId, expectedIntentEpoch);
      return project.intentEpoch;
    },

    async updateProjectGenerationIntensity(projectId: string, input: { intensity: GenerationIntensity; expectedVersion: number }) {
      await ensureProjectAccess(projectId, "write");
      const project = await repository.updateProjectGenerationIntensity(projectId, {
        intensity: normalizeGenerationIntensity(input.intensity),
        expectedVersion: input.expectedVersion,
      });
      return mapProject(project);
    },

    async enqueueConversationTurn(projectId: string, input: EnqueueConversationTurnInput): Promise<ConversationTurnJobRecord> {
      await ensureProjectAccess(projectId, "write");
      const job = await repository.enqueueConversationTurn(projectId, { ...input, executionIdentity });
      return mapConversationTurnJob(job);
    },

    async enqueueMessageAndConversationTurn(
      projectId: string,
      input: EnqueueMessageAndConversationTurnInput,
    ): Promise<{ message: ConversationMessageRecord; job: ConversationTurnJobRecord }> {
      await ensureProjectAccess(projectId, "write");
      const result = await repository.enqueueMessageAndConversationTurn(projectId, {
        ...await withProjectedMessageParts(projectId, input),
        executionIdentity,
      });
      return { message: mapMessage(result.message), job: mapConversationTurnJob(result.job) };
    },

    async startNextConversationTurnJob(
      projectId: string,
      input: { lockedBy?: string; lockMs?: number; fence?: ProjectExecutionFence; now?: Date } = {},
    ): Promise<ConversationTurnJobRecord | null> {
      await ensureProjectAccess(projectId, "generate");
      const job = await repository.startNextConversationTurnJob(projectId, input);
      return job ? mapConversationTurnJob(job) : null;
    },

    async finishConversationTurnJob(projectId: string, jobId: string, input: FinishConversationTurnInput): Promise<ConversationTurnJobRecord> {
      if (!executionGuard) await ensureProjectAccess(projectId, "generate");
      const job = await repository.finishConversationTurnJob(projectId, jobId, input, executionGuard);
      return mapConversationTurnJob(job);
    },

    async failConversationTurnJob(projectId: string, jobId: string, input: FailConversationTurnInput): Promise<ConversationTurnJobRecord> {
      if (!executionGuard) await ensureProjectAccess(projectId, "generate");
      const job = await repository.failConversationTurnJob(projectId, jobId, input, executionGuard);
      return mapConversationTurnJob(job);
    },

    async requeueConversationTurnJobForRecovery(
      projectId: string,
      jobId: string,
      input: RecoverConversationTurnInput,
    ): Promise<ConversationTurnJobRecord | null> {
      await ensureProjectAccess(projectId, "generate");
      const job = await repository.requeueConversationTurnJobForRecovery(projectId, jobId, input);
      return job ? mapConversationTurnJob(job) : null;
    },

    async requeueConversationTurnJobAfterProviderHealth(
      projectId: string,
      jobId: string,
      input: RecoverConversationTurnAfterProviderHealthInput,
    ): Promise<ConversationTurnJobRecord | null> {
      await ensureProjectAccess(projectId, "generate");
      const job = await repository.requeueConversationTurnJobAfterProviderHealth(projectId, jobId, input);
      return job ? mapConversationTurnJob(job) : null;
    },

    async requeueConversationTurnJobAfterContractRepair(
      projectId: string,
      jobId: string,
      input: RecoverConversationTurnAfterContractRepairInput,
    ): Promise<ConversationTurnJobRecord | null> {
      await ensureProjectAccess(projectId, "generate");
      const job = await repository.requeueConversationTurnJobAfterContractRepair(projectId, jobId, input);
      return job ? mapConversationTurnJob(job) : null;
    },

    async getConversationTurnJobs(projectId: string): Promise<ConversationTurnJobRecord[]> {
      await ensureProjectAccess(projectId);
      const jobs = await repository.getConversationTurnJobs(projectId);
      return jobs.map(mapConversationTurnJob);
    },

    async getMessages(projectId: string): Promise<ConversationMessageRecord[]> {
      await ensureProjectAccess(projectId);
      const messages = await repository.getMessages(projectId);
      return messages.map((message) => mapMessage(message));
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
      const [messages, nodes, artifacts, agentRuns, generationJobs, videoShots, turnJobs, reactions] = await Promise.all([
        repository.getMessages(projectId),
        repository.getNodes(projectId),
        repository.getArtifacts(projectId),
        repository.getAgentRuns(projectId),
        repository.getGenerationJobs(projectId),
        typeof repository.getVideoShots === "function"
          ? repository.getVideoShots(projectId)
          : Promise.resolve([]),
        repository.getConversationTurnJobs(projectId),
        actor?.userId && typeof repository.getMessageReactions === "function"
          ? repository.getMessageReactions(projectId, actor.userId)
          : Promise.resolve([]),
      ]);
      const reactionsByMessageId = new Map(reactions.map((reaction) => [reaction.messageId, reaction.value]));

      const mappedProject = mapProject(project);
      const mappedTurnJobs = turnJobs.map(mapConversationTurnJob);
      mappedProject.generationIntensitySuggestion = deriveGenerationIntensitySuggestion({
        current: mappedProject.generationIntensity ?? "standard",
        intentEpoch: mappedProject.intentEpoch ?? 0,
        recentJobs: mappedTurnJobs,
      });
      return {
        project: mappedProject,
        messages: messages.map((message) => mapMessage(message, reactionsByMessageId.get(message.id))),
        nodes: nodes.map(mapNode),
        artifacts: artifacts.map(mapArtifact),
        agentRuns: agentRuns.map(mapAgentRun),
        generationJobs: generationJobs.map(mapGenerationJob),
        videoShots: videoShots.map(mapVideoShot),
        turnJobs: mappedTurnJobs,
      };
    },

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
    lifecycleState: getProjectLifecycleState(project),
    lifecycleVersion: project.lifecycleVersion,
    intentEpoch: project.intentEpoch,
    generationIntensity: normalizeGenerationIntensity(project.generationIntensity),
    intensityVersion: project.intensityVersion,
    archivedAt: project.archivedAt?.toISOString() ?? null,
    deletedAt: project.deletedAt?.toISOString() ?? null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

function mapMessage(message: ConversationMessage, reaction?: string): ConversationMessageRecord {
  return {
    id: message.id,
    projectId: message.projectId,
    role: message.role as ConversationMessageRecord["role"],
    content: message.content,
    parts: messagePartsFromRecord(message),
    artifactRefs: parseJsonArray(message.artifactRefsJson),
    metadata: parseJsonObject(message.metadataJson ?? "{}"),
    ...(reaction === "helpful" || reaction === "unhelpful" ? { reaction } : {}),
    createdAt: message.createdAt.toISOString(),
  };
}

function messagePartsFromRecord(message: ConversationMessage) {
  const raw = parseJsonUnknownArray(message.partsJson ?? "[]");
  return raw.length > 0 ? normalizeMessageParts(raw) : legacyContentToMessageParts(message.content);
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
  const record: ArtifactRecord = {
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
  Object.defineProperties(record, {
    taskId: { value: artifact.taskId, enumerable: false },
    taskBriefDigest: { value: artifact.taskBriefDigest, enumerable: false },
    intentEpoch: { value: artifact.intentEpoch, enumerable: false },
    planRevision: { value: artifact.planRevision, enumerable: false },
    origin: { value: artifact.origin as ArtifactRecord["origin"], enumerable: false },
  });
  return record;
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
    unitId: job.unitId,
    intentEpoch: job.intentEpoch,
    inputHash: job.inputHash,
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

function mapVideoShot(shot: VideoShot): VideoShotRecord {
  return {
    id: shot.id,
    projectId: shot.projectId,
    sourceArtifactId: shot.sourceArtifactId,
    shotId: shot.shotId,
    ordinal: shot.ordinal,
    inputHash: shot.inputHash,
    providerTaskId: shot.providerTaskId,
    selectedArtifactId: shot.selectedArtifactId,
    status: shot.status as VideoShotRecord["status"],
    qa: parseJsonObject(shot.qaJson),
    createdAt: shot.createdAt.toISOString(),
    updatedAt: shot.updatedAt.toISOString(),
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
    actorUserId: job.actorUserId,
    actorAuthMode: job.actorAuthMode,
    authSessionId: job.authSessionId,
    fencingToken: job.fencingToken,
    generationIntensity: normalizeGenerationIntensity(job.generationIntensity),
    intensityVersion: job.intensityVersion,
    lockedBy: job.lockedBy,
    lockedUntil: job.lockedUntil?.toISOString() ?? null,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    failureCategory: job.failureCategory,
    failureRetryability: job.failureRetryability as ConversationTurnJobRecord["failureRetryability"],
    failureEvidenceDigest: job.failureEvidenceDigest,
    recoveryEvidenceDigest: job.recoveryEvidenceDigest,
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

function parseJsonUnknownArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}
