import { createHash } from "node:crypto";

import type { OrchestrationAuditEvent, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { hasValidTaskBrief, type TaskBrief } from "@/server/conversation/task-contract";
import type { WorkbenchActor } from "@/server/auth/local-session";
import { evaluateOrchestrationIngressAudit } from "@/server/workbench/orchestration-ingress-audit";
import { buildAuthorityFactsDigest } from "./orchestration-authority-facts-digest";
import { evaluateCurrentTaskToolBindings, readCurrentTaskProductFacts } from "./orchestration-authority-tool-facts";

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
  const facts = await readCurrentTaskProductFacts(tx, project);
  const events = await readCompleteProjectWindow(tx, {
    projectId: project.id,
    taskId: binding.boundTask?.taskId ?? null,
    teacherMessageId: binding.teacherMessageId,
    turnJobId: binding.turnJob?.id ?? null,
  }, facts);
  const attempts = evaluateAuditWindow(events, {
    projectId: project.id,
    actorUserId: input.actorUserId,
    hasTask: binding.boundTask !== null,
    teacherMessageId: binding.teacherMessageId,
    authSessionDigest: binding.turnJob?.authSessionId ? sha256(binding.turnJob.authSessionId) : null,
  }, violations);
  const tools = evaluateCurrentTaskToolBindings({ project, actorUserId: input.actorUserId, binding, events, facts, violations });
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
  subject: {
    projectId: string;
    actorUserId: string;
    hasTask: boolean;
    teacherMessageId: string | null;
    authSessionDigest: string | null;
  },
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

function buildAuthoritySummary(input: {
  project: { id: string; intentEpoch: number };
  actorUserId: string;
  binding: Awaited<ReturnType<typeof deriveSummarySubject>>;
  events: readonly OrchestrationAuditEvent[];
  attempts: Map<string, OrchestrationAuditEvent[]>;
  facts: Awaited<ReturnType<typeof readCurrentTaskProductFacts>>;
  tools: ReturnType<typeof evaluateCurrentTaskToolBindings>;
  violations: Set<string>;
}): OrchestrationAuthoritySummary {
  const { project, actorUserId, binding, events, attempts, facts, tools, violations } = input;
  const { aggregate, boundTask, teacherMessageId, turnJob } = binding;
  const { toolClaims, toolTerminals, sortedOrdinals, toolOrdinalsContiguous } = tools;
  const structuralCodes = new Set([
    "task_aggregate_binding_invalid", "turn_job_missing", "turn_job_ambiguous", "turn_job_actor_binding_invalid",
    "audit_attempt_id_missing", "audit_attempt_pair_invalid", "open_attempt", "external_audit_event_integrity_invalid",
    "external_actor_binding_invalid", "external_authority_invalid", "external_project_binding_invalid",
    "teacher_task_submission_missing", "teacher_task_submission_session_invalid", "teacher_task_submission_legacy_unbound",
    "tool_ordinal_discontinuous", "tool_plan_revision_non_monotonic", "tool_claim_subject_binding_invalid",
    "tool_audit_event_integrity_invalid", "tool_claim_contract_invalid",
    "tool_result_mode_contract_invalid", "tool_event_kind_invalid",
    "tool_invocation_binding_invalid", "tool_terminal_binding_invalid", "tool_observation_binding_invalid", "tool_observation_status_invalid",
    "tool_artifact_binding_invalid", "tool_event_binding_invalid", "tool_event_cardinality_invalid",
    "tool_invocation_audit_cardinality_invalid", "tool_observation_cardinality_invalid",
    "tool_observation_reverse_binding_invalid", "tool_event_reverse_binding_invalid",
    "tool_artifact_reverse_binding_invalid", "tool_unexpected_artifact_binding",
    "tool_artifact_generation_binding_invalid", "tool_generation_binding_invalid",
    "tool_generation_reverse_binding_invalid", "tool_validation_report_cardinality_invalid",
    "tool_validation_report_binding_invalid", "tool_validation_report_reverse_binding_invalid",
    "tool_historical_project_binding_invalid", "tool_historical_actor_binding_invalid",
    "tool_historical_aggregate_binding_invalid", "tool_historical_subject_binding_invalid",
    "tool_historical_sequence_invalid",
    "tool_observation_reason_codes_invalid",
  ]);
  const violationReasonCodes = [...violations].sort(compareText);
  const complete = !violationReasonCodes.some((code) => structuralCodes.has(code));
  const factsDigest = buildAuthorityFactsDigest(binding, events, facts);
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
  facts: Awaited<ReturnType<typeof readCurrentTaskProductFacts>>,
) {
  const selectors: Array<Record<string, unknown>> = [
    { claimedProjectId: subject.projectId },
    { resolvedProjectId: subject.projectId },
  ];
  if (subject.taskId) selectors.push({ taskId: subject.taskId });
  if (subject.teacherMessageId) selectors.push({ teacherMessageId: subject.teacherMessageId });
  if (subject.turnJobId) selectors.push({ turnJobId: subject.turnJobId });
  const taskIds = facts.taskAggregates.map((aggregate) => aggregate.taskId);
  const teacherMessageIds = facts.turnJobs.map((turnJob) => turnJob.teacherMessageId);
  const turnJobIds = facts.turnJobs.map((turnJob) => turnJob.id);
  const toolInvocationIds = facts.invocations.map((invocation) => invocation.invocationId);
  if (taskIds.length > 0) selectors.push({ taskId: { in: taskIds } });
  if (teacherMessageIds.length > 0) selectors.push({ teacherMessageId: { in: teacherMessageIds } });
  if (turnJobIds.length > 0) selectors.push({ turnJobId: { in: turnJobIds } });
  if (toolInvocationIds.length > 0) selectors.push({ toolInvocationId: { in: toolInvocationIds } });
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
  subject: {
    projectId: string;
    actorUserId: string;
    hasTask: boolean;
    teacherMessageId: string | null;
    authSessionDigest: string | null;
  },
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
  const taskSubmissionMessageIds = new Set<string>();
  let hasLegacyTaskSubmission = false;
  let hasCurrentSessionBinding = false;
  for (const event of committed) {
    const payload = parsedRecord(event.payloadJson);
    const operation = typeof payload?.operation === "string" ? payload.operation : null;
    const controlImpact = typeof payload?.controlImpact === "string" ? payload.controlImpact : null;
    if (!payload || !operation || !controlImpact) {
      violations.add("external_audit_payload_invalid");
      continue;
    }
    if (operation === "teacher_message_submit") {
      if (payload.schemaVersion === undefined && event.teacherMessageId === null) {
        hasLegacyTaskSubmission = true;
      } else if (event.teacherMessageId === subject.teacherMessageId && event.teacherMessageId) {
        taskSubmissionMessageIds.add(event.teacherMessageId);
        if (event.authSessionDigest === subject.authSessionDigest) hasCurrentSessionBinding = true;
      }
    }
    if (operation === "unclassified_external" || controlImpact === "unclassified_external") {
      violations.add("unclassified_external_mutation");
    } else if (controlImpact === "legacy_external_orchestration") {
      violations.add("legacy_external_orchestration");
    } else if (controlImpact === "artifact_route") {
      violations.add("external_artifact_route_orchestration");
    }
  }
  if (subject.hasTask && taskSubmissionMessageIds.size === 0) {
    violations.add(hasLegacyTaskSubmission
      ? "teacher_task_submission_legacy_unbound"
      : "teacher_task_submission_missing");
  }
  if (taskSubmissionMessageIds.size > 0 && !hasCurrentSessionBinding) {
    violations.add("teacher_task_submission_session_invalid");
  }
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
