import { createHash, randomUUID } from "node:crypto";

import type {
  ObservationRecord,
  OrchestrationAuditEvent,
  PrismaClient,
  ToolInvocationRecord,
} from "@/generated/prisma/client";
import { canonicalizeRunInput } from "@/server/execution/run-input-snapshot";

import {
  hasValidExecutionEnvelope,
  type ExecutionEnvelope,
  type IntentGrant,
  type TaskBrief,
} from "./task-contract";

type ToolInvocationAuthority = "main_agent" | "artifact_route";
export type ToolInvocationTerminalStatus = "succeeded" | "failed" | "blocked";
export type StartToolInvocationInput = {
  invocationId: string;
  envelope: ExecutionEnvelope;
  toolName: string;
  request: Record<string, unknown>;
};
export type RawToolInvocationClaim =
  | { kind: "claimed"; invocation: ToolInvocationRecord }
  | { kind: "in_progress"; invocation: ToolInvocationRecord }
  | { kind: "terminal_replay"; invocation: ToolInvocationRecord; observation: ObservationRecord };

export type ToolAuthorityTransaction = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export function claimMainAgentToolInvocationAuthority(client: PrismaClient, input: StartToolInvocationInput) {
  return claimToolInvocationAuthority(client, input, "main_agent");
}

export function claimArtifactRouteToolInvocationAuthority(client: PrismaClient, input: StartToolInvocationInput) {
  return claimToolInvocationAuthority(client, input, "artifact_route");
}

async function claimToolInvocationAuthority(
  client: PrismaClient,
  input: StartToolInvocationInput,
  authority: ToolInvocationAuthority,
): Promise<RawToolInvocationClaim> {
  if (!hasValidExecutionEnvelope(input.envelope)) {
    throw new Error("Tool invocation requires a valid ExecutionEnvelope.");
  }
  const toolName = input.toolName.trim();
  if (!toolName) throw new Error("Tool invocation toolName is required.");
  const expectedActionDigest = sha256(JSON.stringify({ toolName, arguments: input.request }));
  if (input.envelope.actionDigest !== expectedActionDigest) {
    throw new Error("Tool invocation action does not match its ExecutionEnvelope.");
  }
  const requestJson = JSON.stringify(input.request);
  const executionEnvelopeJson = JSON.stringify(input.envelope);
  const requestDigest = sha256(requestJson);
  const executionEnvelopeDigest = sha256(executionEnvelopeJson);

  return client.$transaction((tx) => claimToolInvocationInTransaction(tx, input, authority, {
    toolName,
    requestJson,
    executionEnvelopeJson,
    requestDigest,
    executionEnvelopeDigest,
  }));
}

async function claimToolInvocationInTransaction(
  tx: ToolAuthorityTransaction,
  input: StartToolInvocationInput,
  authority: ToolInvocationAuthority,
  prepared: {
    toolName: string;
    requestJson: string;
    executionEnvelopeJson: string;
    requestDigest: string;
    executionEnvelopeDigest: string;
  },
): Promise<RawToolInvocationClaim> {
    const { toolName, requestJson, executionEnvelopeJson, requestDigest, executionEnvelopeDigest } = prepared;
    const existing = await tx.toolInvocationRecord.findUnique({
      where: {
        projectId_idempotencyKey: {
          projectId: input.envelope.projectId,
          idempotencyKey: input.envelope.idempotencyKey,
        },
      },
    });
    if (existing) {
      return classifyExistingInvocation(
        tx,
        existing,
        toolName,
        executionEnvelopeJson,
        requestJson,
        authority,
        executionEnvelopeDigest,
        requestDigest,
      );
    }

    const aggregate = await tx.taskAggregate.findUnique({
      where: {
        projectId_intentEpoch: {
          projectId: input.envelope.projectId,
          intentEpoch: input.envelope.intentEpoch,
        },
      },
      select: {
        taskId: true,
        planId: true,
        planRevision: true,
        status: true,
        taskBriefJson: true,
        intentGrantJson: true,
      },
    });
    const taskBrief = aggregate ? parseJson<TaskBrief>(aggregate.taskBriefJson) : null;
    if (
      !aggregate ||
      aggregate.status !== "active" ||
      aggregate.taskId !== input.envelope.taskId ||
      aggregate.planRevision !== input.envelope.planRevision ||
      !taskBrief ||
      taskBrief.digest !== input.envelope.taskBriefDigest ||
      canonicalizeRunInput(parseJson<IntentGrant>(aggregate.intentGrantJson)) !== canonicalizeRunInput(input.envelope.intentGrant)
    ) {
      throw new Error("Tool invocation ExecutionEnvelope is stale.");
    }
    const turnJobs = await tx.conversationTurnJob.findMany({
      where: {
        projectId: input.envelope.projectId,
        teacherMessageId: taskBrief.sourceMessageId,
        status: "running",
      },
      select: {
        id: true,
        projectId: true,
        teacherMessageId: true,
        actorUserId: true,
        actorAuthMode: true,
        authSessionId: true,
      },
      take: 2,
    });
    if (turnJobs.length !== 1) throw new Error("Tool invocation requires exactly one running TurnJob.");
    const turnJob = turnJobs[0];
    if (turnJob.actorUserId !== input.envelope.actorUserId) {
      throw new Error("Tool invocation TurnJob actor does not match its ExecutionEnvelope.");
    }
    if (!isToolAuditAuthMode(turnJob.actorAuthMode)) {
      throw new Error("Tool invocation TurnJob actor auth mode is invalid.");
    }
    const latestAttempt = await tx.orchestrationAuditEvent.findFirst({
      where: {
        resolvedProjectId: input.envelope.projectId,
        taskId: input.envelope.taskId,
        intentEpoch: input.envelope.intentEpoch,
        operationKind: "tool_invocation",
        recordType: "attempted",
      },
      orderBy: { toolOrdinal: "desc" },
      select: { toolOrdinal: true },
    });
    const toolOrdinal = (latestAttempt?.toolOrdinal ?? 0) + 1;
    const invocation = await tx.toolInvocationRecord.create({
      data: {
        invocationId: input.invocationId,
        projectId: input.envelope.projectId,
        taskId: input.envelope.taskId,
        intentEpoch: input.envelope.intentEpoch,
        planRevision: input.envelope.planRevision,
        toolName,
        executionEnvelopeJson,
        requestJson,
        idempotencyKey: input.envelope.idempotencyKey,
      },
    });
    await appendToolAuditEvent(tx, {
      eventId: randomUUID(),
      attemptId: invocation.invocationId,
      recordType: "attempted",
      outcome: null,
      operationKind: "tool_invocation",
      authority,
      claimedProjectId: invocation.projectId,
      resolvedProjectId: invocation.projectId,
      actorUserId: turnJob.actorUserId,
      actorAuthMode: turnJob.actorAuthMode,
      authSessionDigest: turnJob.authSessionId ? sha256(turnJob.authSessionId) : null,
      taskId: invocation.taskId,
      turnJobId: turnJob.id,
      teacherMessageId: turnJob.teacherMessageId,
      toolInvocationId: invocation.invocationId,
      intentEpoch: invocation.intentEpoch,
      planRevision: invocation.planRevision,
      planId: aggregate.planId,
      toolOrdinal,
      toolName: invocation.toolName,
      actionDigest: input.envelope.actionDigest,
      idempotencyKey: invocation.idempotencyKey,
      observationId: null,
      invocationStatus: "running",
      executionEnvelopeDigest,
      requestDigest,
      reasonCode: "tool_invocation_claimed",
      payloadJson: JSON.stringify({ schemaVersion: "tool-invocation-audit.v1" }),
      occurredAt: invocation.startedAt,
    });
    return { kind: "claimed", invocation };
}

export async function requireActiveToolInvocationAuthority(
  tx: ToolAuthorityTransaction,
  invocationId: string,
) {
  const invocation = await tx.toolInvocationRecord.findUnique({ where: { invocationId } });
  if (!invocation || invocation.status !== "running") throw new Error("Tool invocation is not active.");
  const attempted = await tx.orchestrationAuditEvent.findFirst({
    where: { toolInvocationId: invocation.invocationId, recordType: "attempted" },
  });
  if (!attempted || !isValidAttemptedToolAudit(attempted, invocation)) {
    throw new Error("Tool invocation attempted audit is missing or invalid.");
  }
  const [project, aggregate, turnJob] = await Promise.all([
    tx.project.findUnique({ where: { id: invocation.projectId }, select: { intentEpoch: true } }),
    tx.taskAggregate.findUnique({
      where: { projectId_intentEpoch: { projectId: invocation.projectId, intentEpoch: invocation.intentEpoch } },
      select: { taskId: true, planId: true, planRevision: true, status: true, taskBriefJson: true },
    }),
    tx.conversationTurnJob.findUnique({ where: { id: attempted.turnJobId ?? "" } }),
  ]);
  const taskBrief = aggregate ? parseJson<TaskBrief>(aggregate.taskBriefJson) : null;
  if (
    !project ||
    project.intentEpoch !== invocation.intentEpoch ||
    !aggregate ||
    aggregate.taskId !== invocation.taskId ||
    aggregate.planId !== attempted.planId ||
    aggregate.planRevision !== invocation.planRevision ||
    aggregate.status !== "active" ||
    !taskBrief ||
    taskBrief.sourceMessageId !== attempted.teacherMessageId ||
    !turnJob ||
    turnJob.projectId !== invocation.projectId ||
    turnJob.teacherMessageId !== attempted.teacherMessageId ||
    turnJob.actorUserId !== attempted.actorUserId ||
    turnJob.actorAuthMode !== attempted.actorAuthMode ||
    (turnJob.authSessionId ? sha256(turnJob.authSessionId) : null) !== attempted.authSessionDigest
  ) {
    throw new Error("Tool invocation is stale and cannot promote a result.");
  }
  return { invocation, attempted };
}

export function assertToolTerminalEventBinding(
  event: { projectId: string; taskId: string; intentEpoch: number; kind: string; payload: Record<string, unknown> },
  invocation: Pick<ToolInvocationRecord, "projectId" | "taskId" | "intentEpoch" | "toolName">,
  observationId: string,
  observationStatus: string,
  invocationStatus: ToolInvocationTerminalStatus,
) {
  if (
    event.projectId !== invocation.projectId ||
    event.taskId !== invocation.taskId ||
    event.intentEpoch !== invocation.intentEpoch
  ) {
    throw new Error("Tool result event does not match invocation scope.");
  }
  if (event.payload.observationId !== observationId) {
    throw new Error("Tool result event Observation does not match the committed Observation.");
  }
  if (toolInvocationStatusForObservationStatus(observationStatus, event.kind) !== invocationStatus) {
    throw new Error("Tool result Observation status does not match the invocation terminal status.");
  }
  if (event.payload.status !== undefined && event.payload.status !== observationStatus) {
    throw new Error("Tool result event status does not match the committed Observation.");
  }
  if (typeof event.payload.toolName === "string" && event.payload.toolName.trim() &&
      event.payload.toolName.trim() !== invocation.toolName) {
    throw new Error("Tool result event Tool does not match the invocation.");
  }
}

export function toolInvocationStatusForObservationStatus(
  observationStatus: string,
  eventKind?: string,
): ToolInvocationTerminalStatus | null {
  if (observationStatus === "succeeded") return "succeeded";
  if (observationStatus === "needs_input") return eventKind === "decision_pending" ? "succeeded" : "blocked";
  if (observationStatus === "blocked") return "blocked";
  if (observationStatus === "failed" || observationStatus === "repair" || observationStatus === "inconclusive") {
    return "failed";
  }
  return null;
}

export async function appendResolvedToolInvocationAudit(
  tx: ToolAuthorityTransaction,
  input: {
    attempted: OrchestrationAuditEvent;
    observationId: string;
    invocationStatus: ToolInvocationTerminalStatus;
    occurredAt: Date;
  },
) {
  const outcome = input.invocationStatus === "succeeded"
    ? "committed"
    : input.invocationStatus === "blocked" ? "rejected" : "failed";
  return appendToolAuditEvent(tx, {
    eventId: randomUUID(),
    attemptId: input.attempted.attemptId,
    recordType: "resolved",
    outcome,
    operationKind: "tool_invocation",
    authority: input.attempted.authority,
    claimedProjectId: input.attempted.claimedProjectId,
    resolvedProjectId: input.attempted.resolvedProjectId,
    actorUserId: input.attempted.actorUserId,
    actorAuthMode: input.attempted.actorAuthMode,
    authSessionDigest: input.attempted.authSessionDigest,
    taskId: input.attempted.taskId,
    turnJobId: input.attempted.turnJobId,
    teacherMessageId: input.attempted.teacherMessageId,
    toolInvocationId: input.attempted.toolInvocationId,
    intentEpoch: input.attempted.intentEpoch,
    planRevision: input.attempted.planRevision,
    planId: input.attempted.planId,
    toolOrdinal: input.attempted.toolOrdinal,
    toolName: input.attempted.toolName,
    actionDigest: input.attempted.actionDigest,
    idempotencyKey: input.attempted.idempotencyKey,
    observationId: input.observationId,
    invocationStatus: input.invocationStatus,
    executionEnvelopeDigest: input.attempted.executionEnvelopeDigest,
    requestDigest: input.attempted.requestDigest,
    reasonCode: `tool_invocation_${input.invocationStatus}`,
    payloadJson: JSON.stringify({ schemaVersion: "tool-invocation-audit.v1" }),
    occurredAt: input.occurredAt,
  });
}

async function classifyExistingInvocation(
  tx: ToolAuthorityTransaction,
  invocation: ToolInvocationRecord,
  toolName: string,
  executionEnvelopeJson: string,
  requestJson: string,
  authority: ToolInvocationAuthority,
  executionEnvelopeDigest: string,
  requestDigest: string,
): Promise<RawToolInvocationClaim> {
  if (
    invocation.toolName !== toolName ||
    invocation.executionEnvelopeJson !== executionEnvelopeJson ||
    invocation.requestJson !== requestJson
  ) {
    throw new Error("Tool invocation idempotency key conflicts with a different request.");
  }
  const attempted = await tx.orchestrationAuditEvent.findFirst({
    where: { toolInvocationId: invocation.invocationId, recordType: "attempted" },
  });
  const envelope = parsePersistedExecutionEnvelope(invocation.executionEnvelopeJson);
  if (!attempted ||
    attempted.authority !== authority ||
    attempted.operationKind !== "tool_invocation" ||
    attempted.attemptId !== invocation.invocationId ||
    attempted.resolvedProjectId !== invocation.projectId ||
    attempted.taskId !== invocation.taskId ||
    attempted.intentEpoch !== invocation.intentEpoch ||
    attempted.planRevision !== invocation.planRevision ||
    attempted.toolInvocationId !== invocation.invocationId ||
    attempted.toolName !== invocation.toolName ||
    attempted.actionDigest !== envelope.actionDigest ||
    attempted.idempotencyKey !== invocation.idempotencyKey ||
    attempted.executionEnvelopeDigest !== executionEnvelopeDigest ||
    attempted.requestDigest !== requestDigest ||
    attempted.invocationStatus !== "running" ||
    attempted.observationId !== null ||
    attempted.eventDigest !== digestToolAuditEvent(attempted) ||
    !Number.isInteger(attempted.toolOrdinal) ||
    (attempted.toolOrdinal ?? 0) < 1
  ) {
    throw new Error("Tool invocation authority or attempted audit binding conflicts with the replay.");
  }
  if (invocation.status === "running") return { kind: "in_progress", invocation };
  if (!invocation.observationId) throw new Error("Terminal Tool invocation is missing its Observation.");
  const observation = await tx.observationRecord.findUnique({ where: { observationId: invocation.observationId } });
  if (!observation) throw new Error("Terminal Tool invocation Observation is missing.");
  return { kind: "terminal_replay", invocation, observation };
}

function isValidAttemptedToolAudit(attempted: OrchestrationAuditEvent, invocation: ToolInvocationRecord) {
  const envelope = parsePersistedExecutionEnvelope(invocation.executionEnvelopeJson);
  return attempted.recordType === "attempted" &&
    attempted.outcome === null &&
    attempted.operationKind === "tool_invocation" &&
    (attempted.authority === "main_agent" || attempted.authority === "artifact_route") &&
    attempted.attemptId === invocation.invocationId &&
    attempted.claimedProjectId === invocation.projectId &&
    attempted.resolvedProjectId === invocation.projectId &&
    attempted.taskId === invocation.taskId &&
    attempted.toolInvocationId === invocation.invocationId &&
    attempted.intentEpoch === invocation.intentEpoch &&
    attempted.planRevision === invocation.planRevision &&
    attempted.toolName === invocation.toolName &&
    attempted.actionDigest === envelope.actionDigest &&
    attempted.idempotencyKey === invocation.idempotencyKey &&
    attempted.observationId === null &&
    attempted.invocationStatus === "running" &&
    attempted.executionEnvelopeDigest === sha256(invocation.executionEnvelopeJson) &&
    attempted.requestDigest === sha256(invocation.requestJson) &&
    attempted.eventDigest === digestToolAuditEvent(attempted) &&
    Boolean(attempted.planId && attempted.turnJobId && attempted.teacherMessageId) &&
    Number.isInteger(attempted.toolOrdinal) &&
    (attempted.toolOrdinal ?? 0) > 0;
}

type ToolAuditEventInput = Omit<OrchestrationAuditEvent, "sequence" | "eventDigest" | "createdAt">;

async function appendToolAuditEvent(tx: ToolAuthorityTransaction, input: ToolAuditEventInput) {
  return tx.orchestrationAuditEvent.create({
    data: { ...input, eventDigest: digestToolAuditEvent(input) },
  });
}

function digestToolAuditEvent(event: ToolAuditEventInput | OrchestrationAuditEvent) {
  const payload = {
    eventId: event.eventId,
    attemptId: event.attemptId,
    recordType: event.recordType,
    outcome: event.outcome,
    operationKind: event.operationKind,
    authority: event.authority,
    claimedProjectId: event.claimedProjectId,
    resolvedProjectId: event.resolvedProjectId,
    actorUserId: event.actorUserId,
    actorAuthMode: event.actorAuthMode,
    authSessionDigest: event.authSessionDigest,
    taskId: event.taskId,
    turnJobId: event.turnJobId,
    teacherMessageId: event.teacherMessageId,
    toolInvocationId: event.toolInvocationId,
    intentEpoch: event.intentEpoch,
    planRevision: event.planRevision,
    planId: event.planId,
    toolOrdinal: event.toolOrdinal,
    toolName: event.toolName,
    actionDigest: event.actionDigest,
    idempotencyKey: event.idempotencyKey,
    observationId: event.observationId,
    invocationStatus: event.invocationStatus,
    executionEnvelopeDigest: event.executionEnvelopeDigest,
    requestDigest: event.requestDigest,
    reasonCode: event.reasonCode,
    payloadJson: event.payloadJson,
    occurredAt: event.occurredAt.toISOString(),
  };
  return createHash("sha256")
    .update("shanhai-orchestration-audit-event.v1\0", "utf8")
    .update(canonicalJson(payload), "utf8")
    .digest("hex");
}

function parsePersistedExecutionEnvelope(value: string): ExecutionEnvelope {
  const envelope = parseJson<ExecutionEnvelope>(value);
  if (!hasValidExecutionEnvelope(envelope)) throw new Error("Persisted ExecutionEnvelope is invalid.");
  return envelope;
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function isToolAuditAuthMode(value: string | null): value is "local" | "password" | "oauth" | "sso" {
  return value === "local" || value === "password" || value === "oauth" || value === "sso";
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
