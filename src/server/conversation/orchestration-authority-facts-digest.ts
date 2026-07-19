import { createHash } from "node:crypto";

import type {
  AgentEventRecord,
  Artifact,
  ConversationTurnJob,
  GenerationJob,
  ObservationRecord,
  OrchestrationAuditEvent,
  RunInputSnapshot,
  TaskAggregate,
  ToolInvocationRecord,
  ValidationReportRecord,
} from "@/generated/prisma/client";

import type { TaskBrief } from "./task-contract";

type DigestBinding = {
  aggregate: TaskAggregate | null;
  boundTask: TaskBrief | null;
  teacherMessageId: string | null;
  turnJob: ConversationTurnJob | null;
};

type AuthorityFacts = {
  invocations: readonly ToolInvocationRecord[];
  observations: readonly ObservationRecord[];
  artifacts: readonly Artifact[];
  agentEvents: readonly AgentEventRecord[];
  generationJobs: readonly GenerationJob[];
  runInputSnapshots: readonly RunInputSnapshot[];
  taskAggregates: readonly TaskAggregate[];
  turnJobs: readonly ConversationTurnJob[];
  validationReports: readonly ValidationReportRecord[];
};

export function buildAuthorityFactsDigest(
  binding: DigestBinding,
  events: readonly OrchestrationAuditEvent[],
  facts: AuthorityFacts,
) {
  const { aggregate, boundTask, turnJob } = binding;
  const boundGenerationJobIds = new Set(facts.agentEvents.flatMap((event) => {
    const generationJobId = text(parsedRecord(event.payloadJson)?.generationJobId);
    return generationJobId ? [generationJobId] : [];
  }));
  for (const job of facts.generationJobs) {
    if (job.status === "succeeded") boundGenerationJobIds.add(job.id);
  }
  const boundGenerationJobs = facts.generationJobs.filter((job) => boundGenerationJobIds.has(job.id));
  const boundSnapshotIds = new Set(boundGenerationJobs.flatMap((job) =>
    job.runInputSnapshotId ? [job.runInputSnapshotId] : []));
  const boundRunInputSnapshots = facts.runInputSnapshots.filter((snapshot) => boundSnapshotIds.has(snapshot.id));
  const boundArtifactIds = new Set(boundGenerationJobs.flatMap((job) => job.resultArtifactId ? [job.resultArtifactId] : []));
  const boundValidationReports = facts.validationReports.filter((report) =>
    (report.generationJobId && boundGenerationJobIds.has(report.generationJobId)) ||
    (report.artifactId && boundArtifactIds.has(report.artifactId)));
  return digestDomain("shanhai-orchestration-authority-facts.v3", {
    subjectBindingDigest: digestDomain("shanhai-orchestration-authority-subject.v2", {
      aggregate: aggregate ? {
        taskId: aggregate.taskId, projectId: aggregate.projectId, intentEpoch: aggregate.intentEpoch,
        planId: aggregate.planId, planRevision: aggregate.planRevision,
        taskBriefDigest: boundTask?.digest ?? null, intentGrantDigest: sha256(aggregate.intentGrantJson),
      } : null,
      turnJob: turnJob ? {
        id: turnJob.id, projectId: turnJob.projectId, teacherMessageId: turnJob.teacherMessageId,
        actorUserId: turnJob.actorUserId, actorAuthMode: turnJob.actorAuthMode,
        authSessionDigest: turnJob.authSessionId ? sha256(turnJob.authSessionId) : null,
      } : null,
    }),
    taskAggregates: facts.taskAggregates.map((row) => ({
      taskId: row.taskId, projectId: row.projectId, intentEpoch: row.intentEpoch,
      taskBriefDigest: sha256(row.taskBriefJson), intentGrantDigest: sha256(row.intentGrantJson),
      planId: row.planId, planRevision: row.planRevision, createdAt: row.createdAt.toISOString(),
    })),
    turnJobs: facts.turnJobs.map((row) => ({
      id: row.id, projectId: row.projectId, teacherMessageId: row.teacherMessageId,
      actorUserId: row.actorUserId, actorAuthMode: row.actorAuthMode,
      authSessionDigest: row.authSessionId ? sha256(row.authSessionId) : null,
      createdAt: row.createdAt.toISOString(),
    })),
    historyAuditEvents: events.map((event) => ({ sequence: event.sequence, eventDigest: event.eventDigest })),
    invocations: facts.invocations.map((row) => ({
      invocationId: row.invocationId, projectId: row.projectId, taskId: row.taskId,
      intentEpoch: row.intentEpoch, planRevision: row.planRevision, toolName: row.toolName,
      idempotencyKey: row.idempotencyKey, status: row.status, artifactId: row.artifactId,
      observationId: row.observationId, startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
      envelopeDigest: sha256(row.executionEnvelopeJson), requestDigest: sha256(row.requestJson),
    })),
    observations: facts.observations.map((row) => ({
      observationId: row.observationId, projectId: row.projectId, taskId: row.taskId,
      invocationId: row.invocationId, intentEpoch: row.intentEpoch, status: row.status,
      reasonCodesDigest: sha256(row.reasonCodesJson), artifactId: row.artifactId,
      payloadDigest: sha256(row.payloadJson), createdAt: row.createdAt.toISOString(),
    })),
    artifacts: facts.artifacts.map((row) => ({
      id: row.id, projectId: row.projectId, taskId: row.taskId, taskBriefDigest: row.taskBriefDigest,
      intentEpoch: row.intentEpoch, planRevision: row.planRevision, origin: row.origin,
      nodeKey: row.nodeKey, kind: row.kind, status: row.status, version: row.version,
      isApproved: row.isApproved, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      contentDigest: digestDomain("shanhai-orchestration-authority-artifact.v2", {
        title: row.title, summary: row.summary, markdownContent: row.markdownContent,
        structuredContentJson: row.structuredContentJson,
      }),
    })),
    generationJobs: boundGenerationJobs.map((row) => ({
      id: row.id, projectId: row.projectId, kind: row.kind, sourceArtifactId: row.sourceArtifactId,
      unitId: row.unitId, runInputSnapshotId: row.runInputSnapshotId, intentEpoch: row.intentEpoch,
      idempotencyKeyDigest: row.idempotencyKey ? sha256(row.idempotencyKey) : null,
      inputHash: row.inputHash, status: row.status, resultArtifactId: row.resultArtifactId,
      countsAsProviderSubmission: row.countsAsProviderSubmission, createdAt: row.createdAt.toISOString(),
    })),
    runInputSnapshots: boundRunInputSnapshots.map((row) => ({
      id: row.id, projectId: row.projectId, intentEpoch: row.intentEpoch, capabilityId: row.capabilityId,
      inputHash: row.inputHash, sourceArtifactIdsDigest: sha256(row.sourceArtifactIdsJson),
      payloadDigest: sha256(row.payloadJson), createdAt: row.createdAt.toISOString(),
    })),
    validationReports: boundValidationReports.map((row) => ({
      id: row.id, projectId: row.projectId, capabilityId: row.capabilityId,
      stage: row.stage, authority: row.authority, domain: row.domain,
      targetKind: row.targetKind, targetId: row.targetId, targetVersion: row.targetVersion,
      targetDigest: row.targetDigest, inputHash: row.inputHash, intentEpoch: row.intentEpoch,
      contractId: row.contractId, contractVersion: row.contractVersion,
      overallStatus: row.overallStatus, reportDigest: row.reportDigest,
      artifactId: row.artifactId, generationJobId: row.generationJobId,
      payloadDigest: sha256(row.payloadJson), createdAt: row.createdAt.toISOString(),
    })),
    agentEvents: facts.agentEvents.map((row) => ({
      eventId: row.eventId, projectId: row.projectId, taskId: row.taskId, runId: row.runId,
      intentEpoch: row.intentEpoch, sequence: row.sequence, kind: row.kind, visibility: row.visibility,
      occurredAt: row.occurredAt.toISOString(), envelopeDigest: sha256(row.envelopeJson),
      payloadDigest: sha256(row.payloadJson),
    })),
  });
}

function parsedRecord(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function digestDomain(domain: string, value: unknown) {
  return createHash("sha256").update(`${domain}\0`, "utf8").update(canonicalJson(value), "utf8").digest("hex");
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`).join(",")}}`;
}
