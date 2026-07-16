import type { PrismaClient } from "@/generated/prisma/client";
import {
  appendAgentEvent,
  AGENT_EVENT_VERSION,
  type AgentEventEnvelope,
} from "@/server/conversation/agent-event-envelope";
import {
  normalizeExternalAuditRepairHandoff,
  type ExternalAuditRepairHandoff,
  type ExternalAuditTaskBinding,
} from "@/server/conversation/external-audit-repair-contract";
import {
  createMainAgentReActCheckpoint,
  restoreMainAgentReActCheckpoint,
  type MainAgentReActContinuationObservation,
} from "@/server/conversation/main-agent-react-checkpoint";
import {
  appendAgentObservationMetadata,
  appendRunCheckpointMetadata,
  createAgentObservation,
  createRunCheckpoint,
} from "@/server/conversation/react-control";
import {
  buildSemanticContextSnapshot,
  restoreSemanticContextSnapshot,
} from "@/server/conversation/context-semantic-snapshot";
import { hasValidTaskBrief, type TaskBrief } from "@/server/conversation/task-contract";
import type { TargetLocator } from "@/server/quality/quality-types";

type TransactionClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export type ExternalAuditRunStateBinding = ExternalAuditTaskBinding & {
  runId: string;
  manifestSha256: string;
  packageArtifactId: string;
  packageArtifactVersion: number;
  packageVersion: string;
  packageSha256: string;
};

export async function ingestExternalAuditRepairEvidence(input: {
  client: PrismaClient;
  runStateBinding: ExternalAuditRunStateBinding;
  handoff: ExternalAuditRepairHandoff;
}) {
  const handoff = normalizeExternalAuditRepairHandoff(input.handoff);
  const binding = normalizeRunStateBinding(input.runStateBinding);
  assertRunStateBinding(handoff, binding);
  const observationId = `external-audit:${handoff.handoffDigest}`;

  return input.client.$transaction(async (tx) => {
    const existingObservation = await tx.observationRecord.findUnique({ where: { observationId } });
    if (existingObservation) {
      const payload = parseJson<Record<string, unknown>>(existingObservation.payloadJson, "external_audit_observation_invalid");
      if (payload.handoffDigest !== handoff.handoffDigest || existingObservation.projectId !== binding.projectId ||
          existingObservation.taskId !== binding.taskId || existingObservation.intentEpoch !== binding.intentEpoch) {
        throw new Error("external_audit_ingress_idempotency_conflict");
      }
      const committedPlanRevision = await requireCommittedReplay(tx, binding, handoff, payload);
      return result("replayed", binding, handoff, observationId, committedPlanRevision);
    }

    const aggregate = await requireTaskAggregate(tx, binding);
    const taskBrief = parseJson<TaskBrief>(aggregate.taskBriefJson, "external_audit_task_brief_invalid");
    if (!hasValidTaskBrief(taskBrief) || taskBrief.sourceMessageId !== binding.teacherMessageId) {
      throw new Error("external_audit_task_brief_invalid");
    }
    const [project, teacherMessage, turnJob, packageArtifact, boundSnapshot, activeOtherJobs] = await Promise.all([
      tx.project.findUnique({ where: { id: binding.projectId } }),
      tx.conversationMessage.findFirst({ where: { id: binding.teacherMessageId, projectId: binding.projectId } }),
      tx.conversationTurnJob.findFirst({ where: { id: binding.turnJobId, projectId: binding.projectId } }),
      tx.artifact.findFirst({ where: { id: binding.packageArtifactId, projectId: binding.projectId } }),
      tx.semanticContextSnapshotRecord.findUnique({
        where: {
          projectId_taskId_intentEpoch_planRevision: {
            projectId: binding.projectId,
            taskId: binding.taskId,
            intentEpoch: binding.intentEpoch,
            planRevision: binding.planRevision,
          },
        },
      }),
      tx.conversationTurnJob.count({
        where: { projectId: binding.projectId, id: { not: binding.turnJobId }, status: { in: ["queued", "running"] } },
      }),
    ]);
    if (!project || project.intentEpoch !== binding.intentEpoch) throw new Error("external_audit_intent_epoch_stale");
    if (project.ownerUserId !== null && project.ownerUserId !== binding.actorUserId) {
      throw new Error("external_audit_actor_binding_invalid");
    }
    if (!teacherMessage || !turnJob || turnJob.teacherMessageId !== binding.teacherMessageId || turnJob.status !== "succeeded" ||
        turnJob.actorUserId !== binding.actorUserId || turnJob.actorAuthMode !== binding.actorAuthMode) {
      throw new Error("external_audit_turn_job_invalid");
    }
    if (activeOtherJobs !== 0) throw new Error("external_audit_turn_job_conflict");
    if (!packageArtifact || packageArtifact.taskId !== binding.taskId || packageArtifact.intentEpoch !== binding.intentEpoch ||
        packageArtifact.version !== binding.packageArtifactVersion || packageArtifact.kind !== "final_delivery") {
      throw new Error("external_audit_package_binding_invalid");
    }
    if (!boundSnapshot) throw new Error("external_audit_semantic_snapshot_required");
    const previousSnapshot = restoreSemanticContextSnapshot(
      parseJson(boundSnapshot.payloadJson, "external_audit_semantic_snapshot_invalid"),
    );
    if (previousSnapshot.taskBrief.digest !== binding.taskBriefDigest ||
        previousSnapshot.plan.revision !== binding.planRevision) {
      throw new Error("external_audit_semantic_snapshot_invalid");
    }

    const previousCheckpoint = restoreMainAgentReActCheckpoint(
      parseJson(aggregate.checkpointJson, "external_audit_checkpoint_required"),
    );
    const nextPlanRevision = binding.planRevision + 1;
    const targetLocators = handoff.affectedUnits.map(toTargetLocator);
    const observation = createAgentObservation({
      observationId,
      createdAt: handoff.createdAt,
      projectId: binding.projectId,
      source: "external_audit",
      status: "repair",
      actionKey: "external_acceptance_audit",
      inputHash: handoff.handoffDigest,
      reasonCodes: ["external_acceptance_p0_repair_required"],
      reportRefs: [{ kind: "external_acceptance", id: handoff.reportId, digest: handoff.reportDigest }],
      targetLocators,
      responsibleStage: "external_acceptance",
      minimalNextAction: "repair_unit",
      teacherSafeSummary: "最终验收发现需要定点修正的内容，已保留其他版本并从受影响位置继续。",
    });
    const continuationObservation: MainAgentReActContinuationObservation = {
      observationId,
      status: "repair",
      reasonCodes: ["external_acceptance_p0_repair_required"],
      summary: observation.teacherSafeSummary,
      reportRefs: [{ id: handoff.reportId, kind: "external_acceptance", digest: handoff.reportDigest }],
      targetLocators,
      nextAction: "replan",
      advisoryNextToolIntents: [],
    };
    const checkpoint = createMainAgentReActCheckpoint({
      request: { instructions: "Resume the same task from persisted external audit evidence.", input: taskBrief.goal },
      seed: { ...previousCheckpoint.task, planRevision: nextPlanRevision },
      records: previousCheckpoint.completedRounds,
      currentToolNames: previousCheckpoint.currentToolNames,
      compactedHistory: previousCheckpoint.compactedHistory,
      externalObservations: [
        ...(previousCheckpoint.externalObservations ?? []).filter((item) => item.observationId !== observationId),
        continuationObservation,
      ],
    });
    const runCheckpoint = createRunCheckpoint({
      checkpointId: checkpoint.checkpointDigest,
      projectId: binding.projectId,
      planVersion: nextPlanRevision,
      reason: "external_acceptance_repair_required",
      actionKey: "external_acceptance_audit",
      inputHash: handoff.handoffDigest,
      observationRefs: [observationId],
      createdAt: handoff.createdAt,
    });
    const messageMetadata = appendRunCheckpointMetadata(
      appendAgentObservationMetadata(parseJson(teacherMessage.metadataJson, "external_audit_message_metadata_invalid"), observation),
      runCheckpoint,
    );
    const nextSnapshot = buildSemanticContextSnapshot({
      ...previousSnapshot,
      plan: { ...previousSnapshot.plan, revision: nextPlanRevision, status: "paused_recovery" },
      observationRefs: [
        ...previousSnapshot.observationRefs.filter((ref) => ref.observationId !== observationId),
        { observationId, reasonCodes: observation.reasonCodes, intentEpoch: binding.intentEpoch },
      ],
    });

    await tx.observationRecord.create({
      data: {
        observationId,
        projectId: binding.projectId,
        taskId: binding.taskId,
        invocationId: null,
        intentEpoch: binding.intentEpoch,
        status: "repair",
        reasonCodesJson: JSON.stringify(observation.reasonCodes),
        payloadJson: JSON.stringify({
          schemaVersion: "external-audit-observation.v1",
          reportId: handoff.reportId,
           reportDigest: handoff.reportDigest,
           handoffDigest: handoff.handoffDigest,
          runId: handoff.runId,
          manifestSha256: handoff.manifestSha256,
          auditRound: handoff.auditRound,
          taskBriefDigest: binding.taskBriefDigest,
          sourcePlanRevision: binding.planRevision,
          committedPlanRevision: nextPlanRevision,
          turnJobId: binding.turnJobId,
          teacherMessageId: binding.teacherMessageId,
           idempotencyKey: binding.idempotencyKey,
           actorUserId: binding.actorUserId,
           actorAuthMode: binding.actorAuthMode,
          findings: handoff.findings,
          openFindingIds: handoff.openFindingIds,
          affectedUnits: handoff.affectedUnits,
          preserveUnlistedVersions: handoff.preserveUnlistedVersions,
          packageArtifactId: handoff.packageArtifactId,
          packageArtifactVersion: handoff.packageArtifactVersion,
          packageVersion: handoff.packageVersion,
          packageSha256: handoff.packageSha256,
        }),
      },
    });
    await tx.taskAggregate.update({
      where: { taskId: binding.taskId },
      data: {
        planRevision: nextPlanRevision,
        status: "paused_recovery",
        checkpointJson: JSON.stringify(checkpoint),
      },
    });
    await tx.conversationMessage.update({ where: { id: binding.teacherMessageId }, data: { metadataJson: JSON.stringify(messageMetadata) } });
    const event = await appendQualityEvent(tx, binding, handoff, observationId, nextPlanRevision);
    await tx.semanticContextSnapshotRecord.create({
      data: {
        snapshotId: `external-audit-snapshot:${handoff.handoffDigest}`,
        projectId: binding.projectId,
        taskId: binding.taskId,
        intentEpoch: binding.intentEpoch,
        planRevision: nextPlanRevision,
        snapshotDigest: nextSnapshot.snapshotDigest,
        payloadJson: JSON.stringify(nextSnapshot),
        lastEventSequence: event.sequence,
        createdAt: new Date(handoff.createdAt),
      },
    });
    await tx.conversationTurnJob.update({
      where: { id: binding.turnJobId },
      data: {
        status: "queued",
        maxAttempts: Math.max(turnJob.maxAttempts, turnJob.attempts + 1),
        assistantMessageId: null,
        lockedBy: null,
        lockedUntil: null,
        errorCode: null,
        errorMessage: null,
        failureCategory: null,
        failureRetryability: null,
        failureEvidenceDigest: null,
        recoveryEvidenceDigest: handoff.handoffDigest,
        startedAt: null,
        finishedAt: null,
      },
    });

    return result("committed", binding, handoff, observationId, nextPlanRevision);
  });
}

async function requireTaskAggregate(tx: TransactionClient, binding: ExternalAuditRunStateBinding) {
  const aggregate = await tx.taskAggregate.findUnique({
    where: { projectId_intentEpoch: { projectId: binding.projectId, intentEpoch: binding.intentEpoch } },
  });
  const taskBrief = aggregate
    ? parseJson<TaskBrief>(aggregate.taskBriefJson, "external_audit_task_aggregate_invalid")
    : null;
  if (!aggregate || aggregate.taskId !== binding.taskId || taskBrief?.digest !== binding.taskBriefDigest ||
      aggregate.planRevision !== binding.planRevision) {
    throw new Error("external_audit_task_aggregate_invalid");
  }
  return aggregate;
}

async function requireCommittedReplay(
  tx: TransactionClient,
  binding: ExternalAuditRunStateBinding,
  handoff: ExternalAuditRepairHandoff,
  payload: Record<string, unknown>,
) {
  const committedPlanRevision = requiredNonNegativeInteger(payload.committedPlanRevision);
  if (
    committedPlanRevision !== binding.planRevision + 1 ||
    payload.runId !== binding.runId ||
    payload.manifestSha256 !== binding.manifestSha256 ||
    payload.reportDigest !== handoff.reportDigest ||
    payload.taskBriefDigest !== binding.taskBriefDigest ||
    payload.sourcePlanRevision !== binding.planRevision ||
    payload.turnJobId !== binding.turnJobId ||
    payload.teacherMessageId !== binding.teacherMessageId ||
    payload.idempotencyKey !== binding.idempotencyKey
    || payload.actorUserId !== binding.actorUserId
    || payload.actorAuthMode !== binding.actorAuthMode
  ) {
    throw new Error("external_audit_ingress_idempotency_conflict");
  }

  const [project, aggregate, event, snapshot] = await Promise.all([
    tx.project.findUnique({ where: { id: binding.projectId } }),
    tx.taskAggregate.findUnique({
      where: { projectId_intentEpoch: { projectId: binding.projectId, intentEpoch: binding.intentEpoch } },
    }),
    tx.agentEventRecord.findUnique({ where: { eventId: `external-audit-event:${handoff.handoffDigest}` } }),
    tx.semanticContextSnapshotRecord.findUnique({
      where: { snapshotId: `external-audit-snapshot:${handoff.handoffDigest}` },
    }),
  ]);
  if (!project || project.intentEpoch !== binding.intentEpoch) {
    throw new Error("external_audit_intent_epoch_stale");
  }
  if (project.ownerUserId !== null && project.ownerUserId !== binding.actorUserId) {
    throw new Error("external_audit_actor_binding_invalid");
  }
  const taskBrief = aggregate
    ? parseJson<TaskBrief>(aggregate.taskBriefJson, "external_audit_replay_invalid")
    : null;
  if (
    !aggregate ||
    aggregate.projectId !== binding.projectId ||
    aggregate.taskId !== binding.taskId ||
    taskBrief?.digest !== binding.taskBriefDigest ||
    aggregate.planRevision < committedPlanRevision ||
    !event ||
    event.projectId !== binding.projectId ||
    event.taskId !== binding.taskId ||
    event.intentEpoch !== binding.intentEpoch ||
    !snapshot ||
    snapshot.projectId !== binding.projectId ||
    snapshot.taskId !== binding.taskId ||
    snapshot.intentEpoch !== binding.intentEpoch ||
    snapshot.planRevision !== committedPlanRevision
  ) {
    throw new Error("external_audit_replay_invalid");
  }
  return committedPlanRevision;
}

async function appendQualityEvent(
  tx: TransactionClient,
  binding: ExternalAuditRunStateBinding,
  handoff: ExternalAuditRepairHandoff,
  observationId: string,
  planRevision: number,
) {
  const latest = await tx.agentEventRecord.findFirst({
    where: { projectId: binding.projectId },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });
  const event: AgentEventEnvelope = {
    schemaVersion: AGENT_EVENT_VERSION,
    eventId: `external-audit-event:${handoff.handoffDigest}`,
    projectId: binding.projectId,
    taskId: binding.taskId,
    runId: handoff.runId,
    intentEpoch: binding.intentEpoch,
    sequence: (latest?.sequence ?? 0) + 1,
    kind: "quality_updated",
    visibility: "internal",
    occurredAt: handoff.createdAt,
    payload: {
      observationId,
      reportId: handoff.reportId,
      reportDigest: handoff.reportDigest,
      openFindingIds: handoff.openFindingIds,
      affectedUnitIds: handoff.affectedUnits.map((unit) => unit.unitId),
      planRevision,
    },
  };
  appendAgentEvent(undefined, { ...event, sequence: 1 });
  await tx.agentEventRecord.create({
    data: {
      eventId: event.eventId,
      projectId: event.projectId,
      taskId: event.taskId,
      runId: event.runId,
      intentEpoch: event.intentEpoch,
      sequence: event.sequence,
      kind: event.kind,
      visibility: event.visibility,
      envelopeJson: JSON.stringify(event),
      payloadJson: JSON.stringify(event.payload),
      occurredAt: new Date(event.occurredAt),
    },
  });
  return event;
}

function assertRunStateBinding(handoff: ExternalAuditRepairHandoff, binding: ExternalAuditRunStateBinding) {
  if (handoff.runId !== binding.runId || handoff.manifestSha256 !== binding.manifestSha256 ||
      handoff.packageArtifactId !== binding.packageArtifactId ||
      handoff.packageArtifactVersion !== binding.packageArtifactVersion ||
      handoff.packageVersion !== binding.packageVersion || handoff.packageSha256 !== binding.packageSha256 ||
      JSON.stringify(handoff.taskBinding) !== JSON.stringify(pickTaskBinding(binding))) {
    throw new Error("external_audit_run_state_binding_mismatch");
  }
}

function normalizeRunStateBinding(value: ExternalAuditRunStateBinding): ExternalAuditRunStateBinding {
  const binding = value as unknown as Record<string, unknown>;
  return {
    actorUserId: requiredText(binding.actorUserId),
    actorAuthMode: requiredAuthMode(binding.actorAuthMode),
    runId: requiredText(binding.runId),
    manifestSha256: requiredDigest(binding.manifestSha256),
    packageArtifactId: requiredText(binding.packageArtifactId),
    packageArtifactVersion: requiredPositiveInteger(binding.packageArtifactVersion),
    packageVersion: requiredText(binding.packageVersion),
    packageSha256: requiredDigest(binding.packageSha256),
    projectId: requiredText(binding.projectId),
    taskId: requiredText(binding.taskId),
    intentEpoch: requiredNonNegativeInteger(binding.intentEpoch),
    taskBriefDigest: requiredDigest(binding.taskBriefDigest),
    planRevision: requiredNonNegativeInteger(binding.planRevision),
    turnJobId: requiredText(binding.turnJobId),
    teacherMessageId: requiredText(binding.teacherMessageId),
    idempotencyKey: requiredText(binding.idempotencyKey),
  };
}

function pickTaskBinding(binding: ExternalAuditRunStateBinding): ExternalAuditTaskBinding {
  return {
    actorUserId: binding.actorUserId,
    actorAuthMode: binding.actorAuthMode,
    projectId: binding.projectId,
    taskId: binding.taskId,
    intentEpoch: binding.intentEpoch,
    taskBriefDigest: binding.taskBriefDigest,
    planRevision: binding.planRevision,
    turnJobId: binding.turnJobId,
    teacherMessageId: binding.teacherMessageId,
    idempotencyKey: binding.idempotencyKey,
  };
}

function requiredAuthMode(value: unknown): "local" | "password" | "oauth" | "sso" {
  if (value !== "local" && value !== "password" && value !== "oauth" && value !== "sso") {
    throw new Error("external_audit_run_state_binding_invalid");
  }
  return value;
}

function toTargetLocator(unit: ExternalAuditRepairHandoff["affectedUnits"][number]): TargetLocator {
  if (unit.kind === "page") return { kind: "page", pageId: String(unit.pageNumber), parentArtifactId: unit.artifactId };
  if (unit.kind === "shot") return { kind: "shot", shotId: unit.shotId!, parentArtifactId: unit.artifactId };
  return { kind: "artifact", artifactKind: unit.artifactRole, artifactId: unit.artifactId };
}

function result(
  status: "committed" | "replayed",
  binding: ExternalAuditRunStateBinding,
  handoff: ExternalAuditRepairHandoff,
  observationId: string,
  planRevision: number,
) {
  return {
    status,
    projectId: binding.projectId,
    taskId: binding.taskId,
    intentEpoch: binding.intentEpoch,
    turnJobId: binding.turnJobId,
    observationId,
    planRevision,
    openFindingIds: [...handoff.openFindingIds],
    affectedUnitIds: handoff.affectedUnits.map((unit) => unit.unitId),
  };
}

function parseJson<T = Record<string, unknown>>(value: string, errorCode: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(errorCode);
  }
}

function requiredText(value: unknown) {
  if (typeof value !== "string" || !value.trim()) throw new Error("external_audit_run_state_binding_invalid");
  return value.trim();
}

function requiredDigest(value: unknown) {
  const digest = requiredText(value).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("external_audit_run_state_binding_invalid");
  return digest;
}

function requiredNonNegativeInteger(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error("external_audit_run_state_binding_invalid");
  return Number(value);
}

function requiredPositiveInteger(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error("external_audit_run_state_binding_invalid");
  return Number(value);
}
