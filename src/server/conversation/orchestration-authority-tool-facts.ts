import { createHash } from "node:crypto";

import type {
  ConversationTurnJob,
  OrchestrationAuditEvent,
  PrismaClient,
  TaskAggregate,
} from "@/generated/prisma/client";
import { canonicalizeRunInput } from "@/server/execution/run-input-snapshot";

import { evaluateProjectToolTerminalMatrix } from "./orchestration-authority-terminal-matrix";
import { evaluateHistoricalToolSubjects } from "./orchestration-authority-history";
import {
  readToolResultModeFromAuditPayload,
  type ToolResultMode,
} from "./tool-result-mode";
import {
  hasValidExecutionEnvelope,
  type ExecutionEnvelope,
  type IntentGrant,
  type TaskBrief,
} from "./task-contract";
import { toolInvocationStatusForObservationStatus } from "./orchestration-tool-authority";
import { hasCompatibleArtifactPlanRevision } from "./tool-artifact-replay-contract";

type TransactionClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export type AuthoritySummaryBinding = {
  aggregate: TaskAggregate | null;
  boundTask: TaskBrief | null;
  teacherMessageId: string | null;
  turnJob: ConversationTurnJob | null;
};

export async function readCurrentTaskProductFacts(
  tx: TransactionClient,
  project: { id: string; intentEpoch: number },
) {
  const scope = { projectId: project.id };
  const [invocations, observations, artifacts, agentEvents, generationJobs, runInputSnapshots,
    taskAggregates, turnJobs, validationReports] = await Promise.all([
    tx.toolInvocationRecord.findMany({ where: scope, orderBy: [{ startedAt: "asc" }, { invocationId: "asc" }] }),
    tx.observationRecord.findMany({ where: scope, orderBy: [{ createdAt: "asc" }, { observationId: "asc" }] }),
    tx.artifact.findMany({ where: scope, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    tx.agentEventRecord.findMany({ where: scope, orderBy: [{ sequence: "asc" }, { eventId: "asc" }] }),
    tx.generationJob.findMany({ where: scope, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    tx.runInputSnapshot.findMany({ where: scope, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    tx.taskAggregate.findMany({ where: scope, orderBy: [{ intentEpoch: "asc" }, { taskId: "asc" }] }),
    tx.conversationTurnJob.findMany({ where: scope, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    tx.validationReportRecord.findMany({ where: scope, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
  ]);
  return {
    invocations, observations, artifacts, agentEvents, generationJobs, runInputSnapshots,
    taskAggregates, turnJobs, validationReports,
  };
}

export function evaluateCurrentTaskToolBindings(input: {
  project: { id: string; intentEpoch: number };
  actorUserId: string;
  binding: AuthoritySummaryBinding;
  events: readonly OrchestrationAuditEvent[];
  facts: Awaited<ReturnType<typeof readCurrentTaskProductFacts>>;
  violations: Set<string>;
}) {
  const { project, actorUserId, binding, events, facts, violations } = input;
  evaluateHistoricalToolSubjects({ events, facts, projectId: project.id, actorUserId, violations });
  evaluateProjectToolTerminalMatrix({ auditEvents: events, facts, violations });
  const currentToolEvents = events.filter((event) =>
    event.operationKind === "tool_invocation" &&
    event.taskId === binding.boundTask?.taskId &&
    event.intentEpoch === project.intentEpoch,
  );
  const projectToolEvents = events.filter((event) => event.operationKind === "tool_invocation");
  const toolClaims = currentToolEvents.filter((event) => event.recordType === "attempted");
  const toolTerminals = currentToolEvents.filter((event) => event.recordType === "resolved");
  const sortedOrdinals = toolClaims
    .flatMap((event) => Number.isSafeInteger(event.toolOrdinal) ? [event.toolOrdinal!] : [])
    .sort((left, right) => left - right);
  const toolOrdinalsContiguous = sortedOrdinals.length === toolClaims.length &&
    sortedOrdinals.every((ordinal, index) => ordinal === index + 1);
  if (!toolOrdinalsContiguous) violations.add("tool_ordinal_discontinuous");
  const claimsBySequence = [...toolClaims].sort((left, right) => left.sequence - right.sequence);
  if (claimsBySequence.some((claim, index) => claim.toolOrdinal !== index + 1)) {
    violations.add("tool_ordinal_discontinuous");
  }
  if (claimsBySequence.some((claim, index) => index > 0 &&
      (claim.planRevision === null || claimsBySequence[index - 1].planRevision === null ||
       claim.planRevision <= claimsBySequence[index - 1].planRevision!))) {
    violations.add("tool_plan_revision_non_monotonic");
  }

  const invocationById = new Map(facts.invocations.map((row) => [row.invocationId, row]));
  const observationById = new Map(facts.observations.map((row) => [row.observationId, row]));
  const artifactById = new Map(facts.artifacts.map((row) => [row.id, row]));
  const claimsByInvocation = groupBy(
    projectToolEvents.filter((event) => event.recordType === "attempted"),
    (event) => event.toolInvocationId,
  );
  const terminalsByInvocation = groupBy(
    projectToolEvents.filter((event) => event.recordType === "resolved"),
    (event) => event.toolInvocationId,
  );
  const observationsByInvocation = groupBy(facts.observations, (row) => row.invocationId);
  const eventsByObservation = groupBy(facts.agentEvents, (event) => text(parsedRecord(event.payloadJson)?.observationId));

  for (const claim of toolClaims) {
    evaluateClaim({ claim, project, actorUserId, binding, invocationById, observationById, artifactById,
      terminalsByInvocation, eventsByObservation, violations });
  }
  evaluateReverseCardinality({ facts, claimsByInvocation, terminalsByInvocation, observationsByInvocation,
    eventsByObservation, invocationById, observationById, artifactById, violations });
  return { toolClaims, toolTerminals, sortedOrdinals, toolOrdinalsContiguous };
}

function evaluateClaim(input: {
  claim: OrchestrationAuditEvent;
  project: { id: string; intentEpoch: number };
  actorUserId: string;
  binding: AuthoritySummaryBinding;
  invocationById: Map<string, Awaited<ReturnType<typeof readCurrentTaskProductFacts>>["invocations"][number]>;
  observationById: Map<string, Awaited<ReturnType<typeof readCurrentTaskProductFacts>>["observations"][number]>;
  artifactById: Map<string, Awaited<ReturnType<typeof readCurrentTaskProductFacts>>["artifacts"][number]>;
  terminalsByInvocation: Map<string, OrchestrationAuditEvent[]>;
  eventsByObservation: Map<string, Awaited<ReturnType<typeof readCurrentTaskProductFacts>>["agentEvents"]>;
  violations: Set<string>;
}) {
  const { claim, project, actorUserId, binding, invocationById, observationById, artifactById,
    terminalsByInvocation, eventsByObservation, violations } = input;
  const { aggregate, boundTask, teacherMessageId, turnJob } = binding;
  const resultMode = readToolResultModeFromAuditPayload(claim.payloadJson);
  if (!resultMode || claim.outcome !== null || claim.invocationStatus !== "running" ||
      claim.reasonCode !== "tool_invocation_claimed") {
    violations.add("tool_claim_contract_invalid");
  }
  const expectedSessionDigest = turnJob?.authSessionId ? sha256(turnJob.authSessionId) : null;
  if (!boundTask || !aggregate || !turnJob || claim.claimedProjectId !== project.id ||
      claim.resolvedProjectId !== project.id || claim.taskId !== boundTask.taskId ||
      claim.intentEpoch !== project.intentEpoch || claim.teacherMessageId !== teacherMessageId ||
      claim.turnJobId !== turnJob.id || claim.actorUserId !== actorUserId ||
      claim.actorAuthMode !== turnJob.actorAuthMode || claim.authSessionDigest !== expectedSessionDigest ||
      claim.planId !== aggregate.planId || claim.planRevision === null || claim.planRevision > aggregate.planRevision) {
    violations.add("tool_claim_subject_binding_invalid");
  }
  const invocation = claim.toolInvocationId ? invocationById.get(claim.toolInvocationId) : undefined;
  if (!invocation || !matchesInvocationClaim(claim, invocation, actorUserId, binding)) {
    violations.add("tool_invocation_binding_invalid");
    return;
  }
  const terminals = terminalsByInvocation.get(invocation.invocationId) ?? [];
  if (terminals.length !== 1 || !matchesToolTerminalClaim(claim, terminals[0], invocation.status, resultMode)) {
    violations.add("tool_terminal_binding_invalid");
    return;
  }
  const terminal = terminals[0];
  const observation = terminal.observationId ? observationById.get(terminal.observationId) : undefined;
  if (!observation || observation.invocationId !== invocation.invocationId ||
      observation.projectId !== project.id || observation.taskId !== invocation.taskId ||
      observation.intentEpoch !== invocation.intentEpoch || invocation.observationId !== observation.observationId) {
    violations.add("tool_observation_binding_invalid");
    return;
  }
  const reasonCodes = parseReasonCodes(observation.reasonCodesJson);
  if (!reasonCodes) violations.add("tool_observation_reason_codes_invalid");
  const boundEvents = eventsByObservation.get(observation.observationId) ?? [];
  if (boundEvents.length !== 1) {
    violations.add("tool_event_cardinality_invalid");
    return;
  }
  const boundEvent = boundEvents[0];
  const eventPayload = parsedRecord(boundEvent.payloadJson);
  if (toolInvocationStatusForObservationStatus(observation.status, boundEvent.kind) !== invocation.status) {
    violations.add("tool_observation_status_invalid");
  }
  const expectedRunId = claim.authority === "artifact_route"
    ? `artifact-route:${invocation.invocationId}`
    : `turn:${claim.teacherMessageId}`;
  if (boundEvent.projectId !== invocation.projectId || boundEvent.taskId !== invocation.taskId ||
      boundEvent.intentEpoch !== invocation.intentEpoch || boundEvent.runId !== expectedRunId ||
      !eventPayload || eventPayload.observationId !== observation.observationId ||
      (eventPayload.status !== undefined && eventPayload.status !== observation.status) ||
      eventPayload.toolName !== invocation.toolName ||
      !equalTextArrays(eventPayload.reasonCodes, reasonCodes)) {
    violations.add("tool_event_binding_invalid");
  }
  evaluateArtifactBinding({ resultMode, invocation, observation, boundEventPayload: eventPayload,
    artifactById, boundTask, violations });
}

function evaluateArtifactBinding(input: {
  resultMode: ToolResultMode | null;
  invocation: Awaited<ReturnType<typeof readCurrentTaskProductFacts>>["invocations"][number];
  observation: Awaited<ReturnType<typeof readCurrentTaskProductFacts>>["observations"][number];
  boundEventPayload: Record<string, unknown> | null;
  artifactById: Map<string, Awaited<ReturnType<typeof readCurrentTaskProductFacts>>["artifacts"][number]>;
  boundTask: TaskBrief | null;
  violations: Set<string>;
}) {
  const { resultMode, invocation, observation, boundEventPayload, artifactById, boundTask, violations } = input;
  const eventArtifactId = text(boundEventPayload?.artifactId);
  const hasArtifactReference = Boolean(invocation.artifactId || observation.artifactId || eventArtifactId);
  const artifactRequired = resultMode === "artifact_required" && observation.status === "succeeded";
  if (artifactRequired) {
    const artifact = invocation.artifactId ? artifactById.get(invocation.artifactId) : undefined;
    if (!artifact || observation.artifactId !== artifact.id || eventArtifactId !== artifact.id ||
        artifact.projectId !== invocation.projectId || artifact.taskId !== invocation.taskId ||
        artifact.intentEpoch !== invocation.intentEpoch ||
        !hasCompatibleArtifactPlanRevision(artifact.planRevision ?? -1, invocation.planRevision) ||
        artifact.taskBriefDigest !== boundTask?.digest) {
      violations.add("tool_artifact_binding_invalid");
    }
  } else if (hasArtifactReference) {
    violations.add("tool_unexpected_artifact_binding");
  }
}

function evaluateReverseCardinality(input: {
  facts: Awaited<ReturnType<typeof readCurrentTaskProductFacts>>;
  claimsByInvocation: Map<string, OrchestrationAuditEvent[]>;
  terminalsByInvocation: Map<string, OrchestrationAuditEvent[]>;
  observationsByInvocation: Map<string, Awaited<ReturnType<typeof readCurrentTaskProductFacts>>["observations"]>;
  eventsByObservation: Map<string, Awaited<ReturnType<typeof readCurrentTaskProductFacts>>["agentEvents"]>;
  invocationById: Map<string, Awaited<ReturnType<typeof readCurrentTaskProductFacts>>["invocations"][number]>;
  observationById: Map<string, Awaited<ReturnType<typeof readCurrentTaskProductFacts>>["observations"][number]>;
  artifactById: Map<string, Awaited<ReturnType<typeof readCurrentTaskProductFacts>>["artifacts"][number]>;
  violations: Set<string>;
}) {
  const { facts, claimsByInvocation, terminalsByInvocation, observationsByInvocation, eventsByObservation,
    invocationById, observationById, artifactById, violations } = input;
  const invocationsByArtifact = groupBy(facts.invocations, (row) => row.artifactId);
  const observationsByArtifact = groupBy(facts.observations, (row) => row.artifactId);
  const eventsByArtifact = groupBy(facts.agentEvents, (row) => text(parsedRecord(row.payloadJson)?.artifactId));
  for (const invocation of facts.invocations) {
    const claims = claimsByInvocation.get(invocation.invocationId) ?? [];
    const terminals = terminalsByInvocation.get(invocation.invocationId) ?? [];
    if (claims.length !== 1 || (invocation.status === "running" ? terminals.length !== 0 : terminals.length !== 1)) {
      violations.add("tool_invocation_audit_cardinality_invalid");
    }
    const observations = observationsByInvocation.get(invocation.invocationId) ?? [];
    if (invocation.status !== "running" &&
        (observations.length !== 1 || observations[0].observationId !== invocation.observationId)) {
      violations.add("tool_observation_cardinality_invalid");
    }
    if (invocation.artifactId && !artifactById.has(invocation.artifactId)) violations.add("tool_artifact_binding_invalid");
  }
  for (const observation of facts.observations) {
    if (!observation.invocationId) continue;
    if (!invocationById.has(observation.invocationId) ||
        (eventsByObservation.get(observation.observationId) ?? []).length !== 1 ||
        (terminalsByInvocation.get(observation.invocationId) ?? [])
          .filter((event) => event.observationId === observation.observationId).length !== 1) {
      violations.add("tool_observation_reverse_binding_invalid");
    }
  }
  for (const event of facts.agentEvents) {
    const observationId = text(parsedRecord(event.payloadJson)?.observationId);
    if (observationId && !observationById.has(observationId) &&
        (event.kind === "tool_observed" || event.kind === "artifact_committed" || event.kind === "decision_pending")) {
      violations.add("tool_event_reverse_binding_invalid");
    }
  }
  for (const artifact of facts.artifacts.filter((row) => row.origin === "tool_result")) {
    const invocationRefs = invocationsByArtifact.get(artifact.id) ?? [];
    const observationRefs = observationsByArtifact.get(artifact.id) ?? [];
    const eventRefs = eventsByArtifact.get(artifact.id) ?? [];
    const completeInvocationRefs = invocationRefs.length > 0 && invocationRefs.every((invocation) => {
      const observation = invocation.observationId ? observationById.get(invocation.observationId) : undefined;
      const events = observation ? eventsByObservation.get(observation.observationId) ?? [] : [];
      const terminals = terminalsByInvocation.get(invocation.invocationId) ?? [];
      return observation?.invocationId === invocation.invocationId && observation.artifactId === artifact.id &&
        events.length === 1 && parsedRecord(events[0].payloadJson)?.artifactId === artifact.id &&
        terminals.filter((event) => event.observationId === observation.observationId).length === 1;
    });
    const completeObservationRefs = observationRefs.every((observation) => {
      const invocation = observation.invocationId ? invocationById.get(observation.invocationId) : undefined;
      const events = eventsByObservation.get(observation.observationId) ?? [];
      return invocation?.artifactId === artifact.id && invocation.observationId === observation.observationId &&
        events.length === 1 && parsedRecord(events[0].payloadJson)?.artifactId === artifact.id;
    });
    const completeEventRefs = eventRefs.every((event) => {
      const observationId = text(parsedRecord(event.payloadJson)?.observationId);
      const observation = observationId ? observationById.get(observationId) : undefined;
      const invocation = observation?.invocationId ? invocationById.get(observation.invocationId) : undefined;
      return observation?.artifactId === artifact.id && invocation?.artifactId === artifact.id &&
        invocation.observationId === observation.observationId;
    });
    const hasOriginalProductionRef = invocationRefs.some((invocation) =>
      invocation.projectId === artifact.projectId && invocation.taskId === artifact.taskId &&
      invocation.intentEpoch === artifact.intentEpoch && invocation.planRevision === artifact.planRevision);
    if (!completeInvocationRefs || !completeObservationRefs || !completeEventRefs || !hasOriginalProductionRef ||
        invocationRefs.length !== observationRefs.length || invocationRefs.length !== eventRefs.length) {
      violations.add("tool_artifact_reverse_binding_invalid");
    }
  }
}

function matchesInvocationClaim(
  claim: OrchestrationAuditEvent,
  invocation: Awaited<ReturnType<typeof readCurrentTaskProductFacts>>["invocations"][number],
  actorUserId: string,
  binding: AuthoritySummaryBinding,
) {
  let envelope: ExecutionEnvelope;
  let request: Record<string, unknown> | null;
  try {
    envelope = JSON.parse(invocation.executionEnvelopeJson) as ExecutionEnvelope;
    request = parsedRecord(invocation.requestJson);
  } catch {
    return false;
  }
  if (!hasValidExecutionEnvelope(envelope) || !request || !binding.boundTask || !binding.aggregate) return false;
  const persistedGrant = parseIntentGrant(binding.aggregate.intentGrantJson);
  const expectedActionDigest = sha256(JSON.stringify({ toolName: invocation.toolName.trim(), arguments: request }));
  return invocation.projectId === claim.resolvedProjectId && invocation.taskId === claim.taskId &&
    invocation.intentEpoch === claim.intentEpoch && invocation.planRevision === claim.planRevision &&
    invocation.toolName === claim.toolName && invocation.idempotencyKey === claim.idempotencyKey &&
    claim.executionEnvelopeDigest === sha256(invocation.executionEnvelopeJson) &&
    claim.requestDigest === sha256(invocation.requestJson) && claim.actionDigest === expectedActionDigest &&
    envelope.actionDigest === expectedActionDigest && envelope.idempotencyKey === invocation.idempotencyKey &&
    envelope.actorUserId === actorUserId && envelope.projectId === invocation.projectId &&
    envelope.taskId === invocation.taskId && envelope.intentEpoch === invocation.intentEpoch &&
    envelope.planRevision === invocation.planRevision && envelope.taskBriefDigest === binding.boundTask.digest &&
    persistedGrant !== null && canonicalizeRunInput(envelope.intentGrant) === canonicalizeRunInput(persistedGrant);
}

function matchesToolTerminalClaim(
  claim: OrchestrationAuditEvent,
  terminal: OrchestrationAuditEvent,
  invocationStatus: string,
  resultMode: ToolResultMode | null,
) {
  const frozenFields: Array<keyof OrchestrationAuditEvent> = [
    "attemptId", "operationKind", "authority", "claimedProjectId", "resolvedProjectId",
    "actorUserId", "actorAuthMode", "authSessionDigest", "taskId", "turnJobId", "teacherMessageId",
    "toolInvocationId", "intentEpoch", "planRevision", "planId", "toolOrdinal", "toolName",
    "actionDigest", "idempotencyKey", "executionEnvelopeDigest", "requestDigest",
  ];
  const expectedOutcome = invocationStatus === "succeeded"
    ? "committed"
    : invocationStatus === "blocked" || invocationStatus === "rejected" ? "rejected" : "failed";
  return resultMode !== null && terminal.recordType === "resolved" && terminal.sequence > claim.sequence &&
    terminal.outcome === expectedOutcome && terminal.invocationStatus === invocationStatus &&
    terminal.reasonCode === `tool_invocation_${invocationStatus}` &&
    readToolResultModeFromAuditPayload(terminal.payloadJson) === resultMode &&
    frozenFields.every((field) => terminal[field] === claim[field]);
}

function groupBy<T>(values: readonly T[], keyFor: (value: T) => string | null | undefined) {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = keyFor(value);
    if (!key) continue;
    const entries = groups.get(key) ?? [];
    entries.push(value);
    groups.set(key, entries);
  }
  return groups;
}

function parseReasonCodes(value: string): string[] | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string" && item.trim()) &&
      new Set(parsed).size === parsed.length ? parsed as string[] : null;
  } catch {
    return null;
  }
}

function equalTextArrays(value: unknown, expected: string[] | null) {
  return expected !== null && Array.isArray(value) && value.length === expected.length &&
    value.every((item, index) => item === expected[index]);
}

function parseIntentGrant(value: string): IntentGrant | null {
  const parsed = parsedRecord(value);
  return parsed?.schemaVersion === "intent-grant.v1" ? parsed as IntentGrant : null;
}

function parsedRecord(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
