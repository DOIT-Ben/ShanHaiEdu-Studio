import type {
  Artifact,
  ConversationMessage,
  ConversationTurnJob,
  GenerationJob,
  Project,
  VideoShot,
} from "@/generated/prisma/client";
import {
  legacyContentToMessageParts,
  normalizeMessageParts,
} from "@/lib/conversation-message-contract";
import { normalizeGenerationIntensity } from "@/server/generation-intensity/generation-intensity-policy";
import { stripConversationTurnSubmissionReceipt } from "./conversation-turn-repository-shared";
import { getProjectLifecycleState } from "./project-lifecycle-service";
import type {
  ArtifactRecord,
  ConversationMessageRecord,
  ConversationTurnJobRecord,
  GenerationJobRecord,
  ProjectRecord,
  VideoShotRecord,
} from "./types";

export function mapProject(project: Project): ProjectRecord {
  return {
    id: project.id,
    title: project.title,
    status: project.status as ProjectRecord["status"],
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

export function mapMessage(message: ConversationMessage, reaction?: string): ConversationMessageRecord {
  return {
    id: message.id,
    projectId: message.projectId,
    role: message.role as ConversationMessageRecord["role"],
    content: message.content,
    parts: messagePartsFromRecord(message),
    artifactRefs: parseJsonArray(message.artifactRefsJson),
    metadata: stripConversationTurnSubmissionReceipt(parseJsonObject(message.metadataJson ?? "{}")),
    ...(reaction === "helpful" || reaction === "unhelpful" ? { reaction } : {}),
    createdAt: message.createdAt.toISOString(),
  };
}

export function mapArtifact(artifact: Artifact): ArtifactRecord {
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

export function mapGenerationJob(job: GenerationJob): GenerationJobRecord {
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
    providerResultJson: job.providerResultJson,
    countsAsProviderSubmission: job.countsAsProviderSubmission,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

export function mapVideoShot(shot: VideoShot): VideoShotRecord {
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

export function mapConversationTurnJob(job: ConversationTurnJob): ConversationTurnJobRecord {
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

export function parseJsonArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

export function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

function messagePartsFromRecord(message: ConversationMessage) {
  const raw = parseJsonUnknownArray(message.partsJson ?? "[]");
  return raw.length > 0 ? normalizeMessageParts(raw) : legacyContentToMessageParts(message.content);
}

function parseJsonUnknownArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
