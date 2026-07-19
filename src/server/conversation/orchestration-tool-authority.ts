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
import {
  createToolInvocationAuditPayload,
  readToolResultModeFromAuditPayload,
  resolveServerToolResultMode,
  type ToolResultMode,
} from "./tool-result-mode";
import { appendToolAuditEvent, digestToolAuditEvent } from "./orchestration-tool-audit-event";
import { evaluateProjectToolTerminalMatrix } from "./orchestration-authority-terminal-matrix";
import {
  toolInvocationStatusForObservationStatus,
  type ToolInvocationTerminalStatus,
} from "./tool-terminal-status";

export { toolInvocationStatusForObservationStatus } from "./tool-terminal-status";
export type { ToolInvocationTerminalStatus } from "./tool-terminal-status";

type ToolInvocationAuthority = "main_agent" | "artifact_route";
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
  const resultMode = resolveServerToolResultMode(toolName, input.request);

  return client.$transaction((tx) => claimToolInvocationInTransaction(tx, input, authority, {
    toolName,
    requestJson,
    executionEnvelopeJson,
    requestDigest,
    executionEnvelopeDigest,
    resultMode,
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
    resultMode: ToolResultMode;
  },
): Promise<RawToolInvocationClaim> {
    const { toolName, requestJson, executionEnvelopeJson, requestDigest, executionEnvelopeDigest, resultMode } = prepared;
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
        resultMode,
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
      payloadJson: JSON.stringify(createToolInvocationAuditPayload(resultMode)),
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
  const envelope = parsePersistedExecutionEnvelope(invocation.executionEnvelopeJson);
  if (
    !project ||
    project.intentEpoch !== invocation.intentEpoch ||
    !aggregate ||
    aggregate.taskId !== invocation.taskId ||
    aggregate.planId !== attempted.planId ||
    aggregate.planRevision !== invocation.planRevision ||
    aggregate.status !== "active" ||
    !taskBrief ||
    taskBrief.digest !== envelope.taskBriefDigest ||
    !turnJob ||
    turnJob.status !== "running" ||
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
): ToolInvocationTerminalStatus {
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
  const invocationStatus = toolInvocationStatusForObservationStatus(observationStatus, event.kind);
  if (!invocationStatus) throw new Error("Tool result Observation status is not terminal.");
  if (event.payload.status !== undefined && event.payload.status !== observationStatus) {
    throw new Error("Tool result event status does not match the committed Observation.");
  }
  if (typeof event.payload.toolName === "string" && event.payload.toolName.trim() &&
      event.payload.toolName.trim() !== invocation.toolName) {
    throw new Error("Tool result event Tool does not match the invocation.");
  }
  return invocationStatus;
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
    payloadJson: JSON.stringify(createToolInvocationAuditPayload(requireFrozenToolResultMode(input.attempted))),
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
  resultMode: ToolResultMode,
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
    readToolResultModeFromAuditPayload(attempted.payloadJson) !== resultMode ||
    attempted.invocationStatus !== "running" ||
    attempted.observationId !== null ||
    attempted.eventDigest !== digestToolAuditEvent(attempted) ||
    !Number.isInteger(attempted.toolOrdinal) ||
    (attempted.toolOrdinal ?? 0) < 1
  ) {
    throw new Error("Tool invocation authority or attempted audit binding conflicts with the replay.");
  }
  if (invocation.status === "running") return { kind: "in_progress", invocation };
  const [auditEvents, observations, artifacts, agentEvents, generationJobs, runInputSnapshots, validationReports] = await Promise.all([
    tx.orchestrationAuditEvent.findMany({
      where: { toolInvocationId: invocation.invocationId },
      orderBy: { sequence: "asc" },
    }),
    tx.observationRecord.findMany({ where: { invocationId: invocation.invocationId } }),
    tx.artifact.findMany({
      where: { projectId: invocation.projectId, taskId: invocation.taskId, intentEpoch: invocation.intentEpoch },
    }),
    tx.agentEventRecord.findMany({
      where: { projectId: invocation.projectId, taskId: invocation.taskId, intentEpoch: invocation.intentEpoch },
    }),
    tx.generationJob.findMany({
      where: { projectId: invocation.projectId, intentEpoch: invocation.intentEpoch },
    }),
    tx.runInputSnapshot.findMany({
      where: { projectId: invocation.projectId, intentEpoch: invocation.intentEpoch },
    }),
    tx.validationReportRecord.findMany({
      where: { projectId: invocation.projectId, intentEpoch: invocation.intentEpoch },
    }),
  ]);
  const violations = new Set<string>();
  evaluateProjectToolTerminalMatrix({
    auditEvents,
    facts: {
      invocations: [invocation], observations, artifacts, agentEvents,
      generationJobs, runInputSnapshots, validationReports,
    },
    violations,
    evaluateGenerationReverse: false,
  });
  if (violations.size > 0) {
    throw new Error("Tool invocation terminal replay facts are invalid: " + [...violations].sort().join(","));
  }
  const observation = observations.find((row) => row.observationId === invocation.observationId);
  if (!observation) throw new Error("Tool invocation terminal replay facts are invalid: Observation missing.");
  return { kind: "terminal_replay", invocation, observation };
}

function isValidAttemptedToolAudit(attempted: OrchestrationAuditEvent, invocation: ToolInvocationRecord) {
  const envelope = parsePersistedExecutionEnvelope(invocation.executionEnvelopeJson);
  const request = parseJson<Record<string, unknown>>(invocation.requestJson);
  const resultMode = resolveServerToolResultMode(invocation.toolName, request);
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
    readToolResultModeFromAuditPayload(attempted.payloadJson) === resultMode &&
    attempted.eventDigest === digestToolAuditEvent(attempted) &&
    Boolean(attempted.planId && attempted.turnJobId && attempted.teacherMessageId) &&
    Number.isInteger(attempted.toolOrdinal) &&
    (attempted.toolOrdinal ?? 0) > 0;
}

export function requireFrozenToolResultMode(
  attempted: Pick<OrchestrationAuditEvent, "payloadJson">,
): ToolResultMode {
  const resultMode = readToolResultModeFromAuditPayload(attempted.payloadJson);
  if (!resultMode) throw new Error("Tool invocation result mode is missing or invalid.");
  return resultMode;
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
