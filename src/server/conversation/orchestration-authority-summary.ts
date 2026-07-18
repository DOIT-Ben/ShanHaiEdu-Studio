import { createHash } from "node:crypto";

import type { OrchestrationAuditEvent, PrismaClient } from "@/generated/prisma/client";
import { toolInvocationStatusForObservationStatus } from "@/server/conversation/orchestration-tool-authority";
import { prisma } from "@/server/db/client";
import { hasValidTaskBrief, type TaskBrief } from "@/server/conversation/task-contract";
import type { WorkbenchActor } from "@/server/auth/local-session";
import { evaluateOrchestrationIngressAudit } from "@/server/workbench/orchestration-ingress-audit";

type TransactionClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export const ORCHESTRATION_AUTHORITY_SUMMARY_VERSION = "orchestration-authority-summary.v1" as const;

export type OrchestrationAuthoritySummary = Readonly<{
  schemaVersion: typeof ORCHESTRATION_AUTHORITY_SUMMARY_VERSION;
  subject: Readonly<{
    projectId: string; actorUserId: string; taskId: string | null; taskBriefDigest: string | null;
    intentEpoch: number; teacherMessageId: string | null; turnJobId: string | null;
    planId: string | null; planRevision: number | null;
  }>;
  windowStartSequence: number; watermark: number; eventCount: number;
  attemptCount: number; resolvedCount: number; openAttemptCount: number;
  toolClaimCount: number; toolTerminalCount: number;
  mainAgentToolCount: number; nonMainAgentToolCount: number;
  firstToolOrdinal: number | null;
  lastToolOrdinal: number | null;
  toolOrdinalsContiguous: boolean;
  authorities: readonly string[];
  violationReasonCodes: readonly string[];
  factsDigest: string;
  summaryDigest: string;
  complete: boolean;
  readyEligible: boolean;
}>;

export async function readOrchestrationAuthoritySummary(
  input: { projectId: string; actor: Pick<WorkbenchActor, "userId"> },
  client: PrismaClient = prisma,
): Promise<OrchestrationAuthoritySummary> {
  assertSummaryInput(input);
  return client.$transaction((tx) => readSummaryInTransaction(tx, {
    projectId: input.projectId.trim(),
    actorUserId: input.actor.userId.trim(),
  }));
}

async function readSummaryInTransaction(
  tx: TransactionClient,
  input: { projectId: string; actorUserId: string },
): Promise<OrchestrationAuthoritySummary> {
  const project = await tx.project.findUnique({
    where: { id: input.projectId },
    select: { id: true, intentEpoch: true },
  });
  if (!project) throw new Error("orchestration_authority_project_missing");
  const violations = new Set<string>();
  const binding = await deriveSummarySubject(tx, project, input.actorUserId, violations);
  const events = await readCompleteProjectWindow(tx, {
    projectId: project.id,
    taskId: binding.boundTask?.taskId ?? null,
    teacherMessageId: binding.teacherMessageId,
    turnJobId: binding.turnJob?.id ?? null,
  });
  const attempts = evaluateAuditWindow(events, {
    projectId: project.id,
    actorUserId: input.actorUserId,
    hasTask: binding.boundTask !== null,
  }, violations);
  const facts = await readProductFacts(tx, project.id);
  const tools = evaluateToolBindings({ project, actorUserId: input.actorUserId, binding, events, facts, violations });
  return buildAuthoritySummary({ project, actorUserId: input.actorUserId, binding, events, attempts, facts, tools, violations });
}

async function deriveSummarySubject(
  tx: TransactionClient,
  project: { id: string; intentEpoch: number },
  actorUserId: string,
  violations: Set<string>,
) {
  const aggregate = await tx.taskAggregate.findUnique({
    where: { projectId_intentEpoch: { projectId: project.id, intentEpoch: project.intentEpoch } },
  });
  const taskBrief = parseTaskBrief(aggregate?.taskBriefJson);
  if (!aggregate || !taskBrief || !hasValidTaskBrief(taskBrief) ||
      taskBrief.projectId !== project.id || taskBrief.intentEpoch !== project.intentEpoch ||
      taskBrief.taskId !== aggregate.taskId) {
    violations.add("task_aggregate_binding_invalid");
  }
  const boundTask = aggregate && taskBrief && hasValidTaskBrief(taskBrief) ? taskBrief : null;
  const teacherMessageId = boundTask?.sourceMessageId ?? null;
  const turnJobs = teacherMessageId
    ? await tx.conversationTurnJob.findMany({
        where: { projectId: project.id, teacherMessageId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      })
    : [];
  if (teacherMessageId && turnJobs.length === 0) violations.add("turn_job_missing");
  if (turnJobs.length > 1) violations.add("turn_job_ambiguous");
  const turnJob = turnJobs.length === 1 ? turnJobs[0] : null;
  if (turnJob && (turnJob.actorUserId !== actorUserId || !turnJob.actorAuthMode)) {
    violations.add("turn_job_actor_binding_invalid");
  }
  return { aggregate, boundTask, teacherMessageId, turnJob };
}

function evaluateAuditWindow(
  events: readonly OrchestrationAuditEvent[],
  subject: { projectId: string; actorUserId: string; hasTask: boolean },
  violations: Set<string>,
) {
  const attempts = groupAttempts(events, violations);
  const externalEvents = events.filter((event) => event.operationKind === "external_mutation");
  if (externalEvents.length > 0) {
    const evaluated = evaluateOrchestrationIngressAudit(externalEvents as never);
    if (evaluated.invalidAttemptIds.length > 0) violations.add("external_audit_event_integrity_invalid");
  }
  evaluateExternalPolicy(externalEvents, subject, violations);
  return attempts;
}

async function readProductFacts(tx: TransactionClient, projectId: string) {
  const [invocations, observations, artifacts, agentEvents] = await Promise.all([
    tx.toolInvocationRecord.findMany({ where: { projectId }, orderBy: [{ startedAt: "asc" }, { invocationId: "asc" }] }),
    tx.observationRecord.findMany({ where: { projectId }, orderBy: [{ createdAt: "asc" }, { observationId: "asc" }] }),
    tx.artifact.findMany({ where: { projectId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    tx.agentEventRecord.findMany({ where: { projectId }, orderBy: [{ sequence: "asc" }, { eventId: "asc" }] }),
  ]);
  return { invocations, observations, artifacts, agentEvents };
}

function evaluateToolBindings(input: {
  project: { id: string; intentEpoch: number };
  actorUserId: string;
  binding: Awaited<ReturnType<typeof deriveSummarySubject>>;
  events: readonly OrchestrationAuditEvent[];
  facts: Awaited<ReturnType<typeof readProductFacts>>;
  violations: Set<string>;
}) {
  const { project, actorUserId, binding, events, facts, violations } = input;
  const { aggregate, boundTask, teacherMessageId, turnJob } = binding;
  const toolClaims = events.filter((event) => event.operationKind === "tool_invocation" && event.recordType === "attempted");
  const toolTerminals = events.filter((event) => event.operationKind === "tool_invocation" && event.recordType === "resolved");
  if (events.some((event) => event.operationKind === "tool_invocation" && event.eventDigest !== auditEventDigest(event))) {
    violations.add("tool_audit_event_integrity_invalid");
  }
  const ordinals = toolClaims.flatMap((event) => Number.isSafeInteger(event.toolOrdinal) ? [event.toolOrdinal!] : []);
  const sortedOrdinals = [...ordinals].sort((left, right) => left - right);
  const toolOrdinalsContiguous = sortedOrdinals.length === toolClaims.length &&
    sortedOrdinals.every((ordinal, index) => ordinal === index + 1);
  if (!toolOrdinalsContiguous) violations.add("tool_ordinal_discontinuous");

  const invocationById = new Map(facts.invocations.map((row) => [row.invocationId, row]));
  const observationById = new Map(facts.observations.map((row) => [row.observationId, row]));
  const artifactById = new Map(facts.artifacts.map((row) => [row.id, row]));
  for (const claim of toolClaims) {
    if (claim.authority !== "main_agent") violations.add("tool_selector_authority_invalid");
    if (claim.outcome !== null || claim.invocationStatus !== "running" ||
        claim.reasonCode !== "tool_invocation_claimed" ||
        parsedRecord(claim.payloadJson)?.schemaVersion !== "tool-invocation-audit.v1") {
      violations.add("tool_claim_contract_invalid");
    }
    if (!boundTask || !aggregate || !turnJob ||
        claim.resolvedProjectId !== project.id || claim.taskId !== boundTask.taskId ||
        claim.intentEpoch !== project.intentEpoch || claim.teacherMessageId !== teacherMessageId ||
        claim.turnJobId !== turnJob.id || claim.actorUserId !== actorUserId ||
        claim.actorAuthMode !== turnJob.actorAuthMode || claim.planId !== aggregate.planId ||
        claim.planRevision === null || claim.planRevision > aggregate.planRevision) {
      violations.add("tool_claim_subject_binding_invalid");
    }
    const invocation = claim.toolInvocationId ? invocationById.get(claim.toolInvocationId) : undefined;
    if (!invocation || !matchesInvocationClaim(claim, invocation, actorUserId, boundTask)) {
      violations.add("tool_invocation_binding_invalid");
      continue;
    }
    const terminal = toolTerminals.find((event) => event.attemptId === claim.attemptId);
    if (!terminal || !matchesToolTerminalClaim(claim, terminal, invocation.status)) {
      violations.add("tool_terminal_binding_invalid");
      continue;
    }
    const observation = terminal.observationId ? observationById.get(terminal.observationId) : undefined;
    if (!observation || observation.invocationId !== invocation.invocationId ||
        observation.projectId !== project.id || observation.taskId !== invocation.taskId ||
        observation.intentEpoch !== invocation.intentEpoch || invocation.observationId !== observation.observationId) {
      violations.add("tool_observation_binding_invalid");
      continue;
    }
    const boundEvent = facts.agentEvents.find((event) => event.taskId === invocation.taskId &&
      event.intentEpoch === invocation.intentEpoch && parsedRecord(event.payloadJson)?.observationId === observation.observationId);
    const boundEventPayload = boundEvent ? parsedRecord(boundEvent.payloadJson) : null;
    if (toolInvocationStatusForObservationStatus(observation.status, boundEvent?.kind) !== invocation.status)
      violations.add("tool_observation_status_invalid");
    if (invocation.artifactId || observation.artifactId || boundEvent?.kind === "artifact_committed") {
      const artifact = invocation.artifactId ? artifactById.get(invocation.artifactId) : undefined;
      if (!artifact || observation.artifactId !== artifact.id || artifact.taskId !== invocation.taskId ||
          artifact.intentEpoch !== invocation.intentEpoch || artifact.planRevision !== invocation.planRevision ||
          artifact.taskBriefDigest !== boundTask?.digest) {
        violations.add("tool_artifact_binding_invalid");
      }
    }
    if (!boundEvent || (boundEventPayload?.status !== undefined && boundEventPayload.status !== observation.status)) {
      violations.add("tool_event_binding_invalid");
    }
  }
  return { toolClaims, toolTerminals, sortedOrdinals, toolOrdinalsContiguous };
}

function buildFactsDigest(
  binding: Awaited<ReturnType<typeof deriveSummarySubject>>,
  events: readonly OrchestrationAuditEvent[],
  facts: Awaited<ReturnType<typeof readProductFacts>>,
) {
  const { aggregate, boundTask, turnJob } = binding;
  const { invocations, observations, artifacts, agentEvents } = facts;
  return digestDomain("shanhai-orchestration-authority-facts.v1", {
    subjectBindingDigest: digestDomain("shanhai-orchestration-authority-subject.v1", {
      aggregate: aggregate ? {
        taskId: aggregate.taskId, projectId: aggregate.projectId, intentEpoch: aggregate.intentEpoch,
        planId: aggregate.planId, planRevision: aggregate.planRevision, status: aggregate.status,
        taskBriefDigest: boundTask?.digest ?? null,
      } : null,
      turnJob: turnJob ? {
        id: turnJob.id, projectId: turnJob.projectId, teacherMessageId: turnJob.teacherMessageId,
        actorUserId: turnJob.actorUserId, actorAuthMode: turnJob.actorAuthMode, status: turnJob.status,
      } : null,
    }),
    events: events.map((event) => ({ sequence: event.sequence, eventDigest: event.eventDigest })),
    invocations: invocations.map((row) => ({
      invocationId: row.invocationId, status: row.status, artifactId: row.artifactId, observationId: row.observationId,
      envelopeDigest: sha256(row.executionEnvelopeJson), requestDigest: sha256(row.requestJson),
    })),
    observations: observations.map((row) => ({
      observationId: row.observationId, invocationId: row.invocationId, status: row.status,
      artifactId: row.artifactId, payloadDigest: sha256(row.payloadJson),
    })),
    artifacts: artifacts.map((row) => ({
      id: row.id, taskId: row.taskId, intentEpoch: row.intentEpoch, planRevision: row.planRevision,
      status: row.status, version: row.version,
      contentDigest: digestDomain("shanhai-orchestration-authority-artifact.v1", {
        nodeKey: row.nodeKey, title: row.title, kind: row.kind, status: row.status, summary: row.summary,
        markdownContent: row.markdownContent, structuredContentJson: row.structuredContentJson, origin: row.origin,
      }),
    })),
    agentEvents: agentEvents.map((row) => ({
      eventId: row.eventId, sequence: row.sequence, kind: row.kind, runId: row.runId, intentEpoch: row.intentEpoch,
      envelopeDigest: sha256(row.envelopeJson), payloadDigest: sha256(row.payloadJson),
    })),
  });
}

function buildAuthoritySummary(input: {
  project: { id: string; intentEpoch: number };
  actorUserId: string;
  binding: Awaited<ReturnType<typeof deriveSummarySubject>>;
  events: readonly OrchestrationAuditEvent[];
  attempts: Map<string, OrchestrationAuditEvent[]>;
  facts: Awaited<ReturnType<typeof readProductFacts>>;
  tools: ReturnType<typeof evaluateToolBindings>;
  violations: Set<string>;
}): OrchestrationAuthoritySummary {
  const { project, actorUserId, binding, events, attempts, facts, tools, violations } = input;
  const { aggregate, boundTask, teacherMessageId, turnJob } = binding;
  const { toolClaims, toolTerminals, sortedOrdinals, toolOrdinalsContiguous } = tools;
  const structuralCodes = new Set([
    "task_aggregate_binding_invalid", "turn_job_missing", "turn_job_ambiguous", "turn_job_actor_binding_invalid",
    "audit_attempt_id_missing", "audit_attempt_pair_invalid", "open_attempt", "external_audit_event_integrity_invalid",
    "external_actor_binding_invalid", "external_authority_invalid", "external_project_binding_invalid",
    "teacher_task_submission_missing", "tool_ordinal_discontinuous", "tool_claim_subject_binding_invalid",
    "tool_audit_event_integrity_invalid", "tool_claim_contract_invalid",
    "tool_invocation_binding_invalid", "tool_terminal_binding_invalid", "tool_observation_binding_invalid", "tool_observation_status_invalid",
    "tool_artifact_binding_invalid", "tool_event_binding_invalid",
  ]);
  const violationReasonCodes = [...violations].sort(compareText);
  const complete = !violationReasonCodes.some((code) => structuralCodes.has(code));
  const factsDigest = buildFactsDigest(binding, events, facts);
  const publicSummary = {
    schemaVersion: ORCHESTRATION_AUTHORITY_SUMMARY_VERSION,
    subject: {
      projectId: project.id,
      actorUserId,
      taskId: boundTask?.taskId ?? null,
      taskBriefDigest: boundTask?.digest ?? null,
      intentEpoch: project.intentEpoch,
      teacherMessageId,
      turnJobId: turnJob?.id ?? null,
      planId: aggregate?.planId ?? null,
      planRevision: aggregate?.planRevision ?? null,
    },
    windowStartSequence: events[0]?.sequence ?? 0,
    watermark: events.at(-1)?.sequence ?? 0,
    eventCount: events.length,
    attemptCount: attempts.size,
    resolvedCount: events.filter((event) => event.recordType === "resolved").length,
    openAttemptCount: [...attempts.values()].filter((entries) => !entries.some((event) => event.recordType === "resolved")).length,
    toolClaimCount: toolClaims.length,
    toolTerminalCount: toolTerminals.length,
    mainAgentToolCount: toolClaims.filter((event) => event.authority === "main_agent").length,
    nonMainAgentToolCount: toolClaims.filter((event) => event.authority !== "main_agent").length,
    firstToolOrdinal: sortedOrdinals[0] ?? null,
    lastToolOrdinal: sortedOrdinals.at(-1) ?? null,
    toolOrdinalsContiguous,
    authorities: [...new Set(events.map((event) => event.authority))].sort(compareText),
    violationReasonCodes,
    factsDigest,
    complete,
    readyEligible: complete && violationReasonCodes.length === 0,
  };
  return Object.freeze({
    ...publicSummary,
    subject: Object.freeze(publicSummary.subject),
    authorities: Object.freeze(publicSummary.authorities),
    violationReasonCodes: Object.freeze(publicSummary.violationReasonCodes),
    summaryDigest: digestDomain("shanhai-orchestration-authority-summary.v1", publicSummary),
  });
}

async function readCompleteProjectWindow(
  tx: TransactionClient,
  subject: { projectId: string; taskId: string | null; teacherMessageId: string | null; turnJobId: string | null },
) {
  const selectors: Array<Record<string, unknown>> = [
    { claimedProjectId: subject.projectId },
    { resolvedProjectId: subject.projectId },
  ];
  if (subject.taskId) selectors.push({ taskId: subject.taskId });
  if (subject.teacherMessageId) selectors.push({ teacherMessageId: subject.teacherMessageId });
  if (subject.turnJobId) selectors.push({ turnJobId: subject.turnJobId });
  const primary = await tx.orchestrationAuditEvent.findMany({
    where: { OR: selectors },
    orderBy: { sequence: "asc" },
  });
  const attemptIds = [...new Set(primary.flatMap((event) => event.attemptId ? [event.attemptId] : []))];
  const pairs = attemptIds.length > 0
    ? await tx.orchestrationAuditEvent.findMany({ where: { attemptId: { in: attemptIds } }, orderBy: { sequence: "asc" } })
    : [];
  return [...new Map([...primary, ...pairs].map((event) => [event.eventId, event])).values()]
    .sort((left, right) => left.sequence - right.sequence);
}

function groupAttempts(events: readonly OrchestrationAuditEvent[], violations: Set<string>) {
  const groups = new Map<string, OrchestrationAuditEvent[]>();
  for (const event of events) {
    if (!event.attemptId) {
      violations.add("audit_attempt_id_missing");
      continue;
    }
    const entries = groups.get(event.attemptId) ?? [];
    entries.push(event);
    groups.set(event.attemptId, entries);
  }
  for (const entries of groups.values()) {
    const attempted = entries.filter((event) => event.recordType === "attempted");
    const resolved = entries.filter((event) => event.recordType === "resolved");
    if (attempted.length !== 1 || resolved.length > 1 || entries.length > 2 ||
        (resolved[0] && resolved[0].sequence <= attempted[0]!.sequence)) {
      violations.add("audit_attempt_pair_invalid");
    } else if (resolved.length === 0) {
      violations.add("open_attempt");
    }
  }
  return groups;
}

function evaluateExternalPolicy(
  events: readonly OrchestrationAuditEvent[],
  subject: { projectId: string; actorUserId: string; hasTask: boolean },
  violations: Set<string>,
) {
  for (const event of events) {
    if (event.actorUserId !== subject.actorUserId) violations.add("external_actor_binding_invalid");
    if (event.authority !== "teacher_http") violations.add("external_authority_invalid");
    if ((event.claimedProjectId && event.claimedProjectId !== subject.projectId) ||
        (event.resolvedProjectId && event.resolvedProjectId !== subject.projectId)) {
      violations.add("external_project_binding_invalid");
    }
  }
  const committed = events.filter((event) => event.recordType === "resolved" && event.outcome === "committed");
  let taskSubmissions = 0;
  for (const event of committed) {
    const payload = parsedRecord(event.payloadJson);
    const operation = typeof payload?.operation === "string" ? payload.operation : null;
    const controlImpact = typeof payload?.controlImpact === "string" ? payload.controlImpact : null;
    if (!operation || !controlImpact) {
      violations.add("external_audit_payload_invalid");
      continue;
    }
    if (operation === "teacher_message_submit") taskSubmissions += 1;
    if (operation === "unclassified_external" || controlImpact === "unclassified_external") {
      violations.add("unclassified_external_mutation");
    } else if (controlImpact === "legacy_external_orchestration") {
      violations.add("legacy_external_orchestration");
    } else if (controlImpact === "artifact_route") {
      violations.add("external_artifact_route_orchestration");
    }
  }
  if (subject.hasTask && taskSubmissions === 0) violations.add("teacher_task_submission_missing");
  if (taskSubmissions > 1) violations.add("duplicate_teacher_task_submission");
}

function matchesInvocationClaim(
  claim: OrchestrationAuditEvent,
  invocation: {
    projectId: string;
    taskId: string;
    intentEpoch: number;
    planRevision: number;
    toolName: string;
    executionEnvelopeJson: string;
    requestJson: string;
    idempotencyKey: string;
  },
  actorUserId: string,
  taskBrief: TaskBrief | null,
) {
  const envelope = parsedRecord(invocation.executionEnvelopeJson);
  const request = parsedRecord(invocation.requestJson);
  if (!envelope || !request || !taskBrief) return false;
  const expectedActionDigest = sha256(JSON.stringify({ toolName: invocation.toolName.trim(), arguments: request }));
  return invocation.projectId === claim.resolvedProjectId && invocation.taskId === claim.taskId &&
    invocation.intentEpoch === claim.intentEpoch && invocation.planRevision === claim.planRevision &&
    invocation.toolName === claim.toolName && invocation.idempotencyKey === claim.idempotencyKey &&
    claim.executionEnvelopeDigest === sha256(invocation.executionEnvelopeJson) &&
    claim.requestDigest === sha256(invocation.requestJson) && claim.actionDigest === expectedActionDigest &&
    envelope.actionDigest === expectedActionDigest && envelope.idempotencyKey === invocation.idempotencyKey &&
    envelope.actorUserId === actorUserId && envelope.projectId === invocation.projectId &&
    envelope.taskId === invocation.taskId && envelope.intentEpoch === invocation.intentEpoch &&
    envelope.planRevision === invocation.planRevision && envelope.taskBriefDigest === taskBrief.digest;
}

function matchesToolTerminalClaim(
  claim: OrchestrationAuditEvent,
  terminal: OrchestrationAuditEvent,
  invocationStatus: string,
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
  return terminal.recordType === "resolved" && terminal.sequence > claim.sequence &&
    terminal.outcome === expectedOutcome && terminal.invocationStatus === invocationStatus &&
    terminal.reasonCode === `tool_invocation_${invocationStatus}` &&
    parsedRecord(terminal.payloadJson)?.schemaVersion === "tool-invocation-audit.v1" &&
    frozenFields.every((field) => terminal[field] === claim[field]);
}

function parseTaskBrief(value: string | undefined): TaskBrief | null {
  const parsed = value ? parsedRecord(value) : null;
  return parsed as TaskBrief | null;
}

function parsedRecord(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function assertSummaryInput(value: unknown): asserts value is { projectId: string; actor: Pick<WorkbenchActor, "userId"> } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("orchestration_authority_input_invalid");
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((key) => key !== "projectId" && key !== "actor") ||
      typeof source.projectId !== "string" || !source.projectId.trim() ||
      !source.actor || typeof source.actor !== "object" || Array.isArray(source.actor) ||
      typeof (source.actor as { userId?: unknown }).userId !== "string" ||
      !(source.actor as { userId: string }).userId.trim()) {
    throw new Error("orchestration_authority_input_invalid");
  }
}

function digestDomain(domain: string, value: unknown) {
  return createHash("sha256").update(`${domain}\0`, "utf8").update(canonicalJson(value), "utf8").digest("hex");
}

function auditEventDigest(event: OrchestrationAuditEvent) {
  const source = Object.fromEntries(Object.entries(event)
    .filter(([key]) => key !== "sequence" && key !== "eventDigest" && key !== "createdAt")
    .map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]));
  return digestDomain("shanhai-orchestration-audit-event.v1", source);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source).sort(compareText).map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`).join(",")}}`;
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}
