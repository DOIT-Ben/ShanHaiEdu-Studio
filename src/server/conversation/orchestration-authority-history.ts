import { createHash } from "node:crypto";

import type {
  ConversationTurnJob,
  OrchestrationAuditEvent,
  TaskAggregate,
  ToolInvocationRecord,
} from "@/generated/prisma/client";
import { canonicalizeRunInput } from "@/server/execution/run-input-snapshot";
import { generationIntensityIds } from "@/server/generation-intensity/generation-intensity-policy";

import { digestToolAuditEvent } from "./orchestration-tool-audit-event";
import {
  hasValidExecutionEnvelope,
  hasValidTaskBrief,
  INTENT_GRANT_VERSION,
  type ExecutionEnvelope,
  type IntentGrant,
  type TaskBrief,
} from "./task-contract";

type HistoricalFacts = {
  taskAggregates: readonly TaskAggregate[];
  turnJobs: readonly ConversationTurnJob[];
  invocations: readonly ToolInvocationRecord[];
};

type HistoricalSubject = {
  aggregate: TaskAggregate;
  taskBrief: TaskBrief;
  intentGrant: IntentGrant;
  turnJob: ConversationTurnJob | null;
};

export function evaluateHistoricalToolSubjects(input: {
  events: readonly OrchestrationAuditEvent[];
  facts: HistoricalFacts;
  projectId: string;
  actorUserId: string;
  violations: Set<string>;
}) {
  const { events, facts, projectId, actorUserId, violations } = input;
  const subjects = new Map<string, HistoricalSubject>();
  const jobsByMessage = groupBy(facts.turnJobs, (job) => job.teacherMessageId);
  for (const aggregate of facts.taskAggregates) {
    const subject = parseHistoricalSubject(aggregate, jobsByMessage.get(sourceMessageId(aggregate)) ?? [], projectId);
    if (!subject) {
      violations.add("tool_historical_aggregate_binding_invalid");
      continue;
    }
    subjects.set(subject.taskBrief.taskId, subject);
  }

  const invocationById = new Map(facts.invocations.map((invocation) => [invocation.invocationId, invocation]));
  const claimsBySubject = new Map<string, OrchestrationAuditEvent[]>();
  for (const event of events.filter((candidate) => candidate.operationKind === "tool_invocation")) {
    if (event.eventDigest !== digestToolAuditEvent(event)) violations.add("tool_audit_event_integrity_invalid");
    if (event.authority !== "main_agent") violations.add("tool_selector_authority_invalid");
    if (event.claimedProjectId !== projectId || event.resolvedProjectId !== projectId) {
      violations.add("tool_historical_project_binding_invalid");
    }
    if (event.actorUserId !== actorUserId) violations.add("tool_historical_actor_binding_invalid");
    const invocation = event.toolInvocationId ? invocationById.get(event.toolInvocationId) : undefined;
    if (!invocation) violations.add("tool_historical_subject_binding_invalid");
    if (event.recordType !== "attempted") continue;

    const subject = event.taskId ? subjects.get(event.taskId) : undefined;
    if (!subject || !invocation || !matchesHistoricalClaim(event, invocation, subject, actorUserId)) {
      violations.add("tool_historical_subject_binding_invalid");
      continue;
    }
    const key = `${subject.taskBrief.intentEpoch}:${subject.taskBrief.taskId}`;
    const claims = claimsBySubject.get(key) ?? [];
    claims.push(event);
    claimsBySubject.set(key, claims);
  }

  for (const claims of claimsBySubject.values()) {
    claims.sort((left, right) => left.sequence - right.sequence);
    if (claims.some((claim, index) => claim.toolOrdinal !== index + 1)) {
      violations.add("tool_historical_sequence_invalid");
    }
    if (claims.some((claim, index) => index > 0 &&
        (claim.planRevision === null || claims[index - 1].planRevision === null ||
         claim.planRevision <= claims[index - 1].planRevision!))) {
      violations.add("tool_historical_sequence_invalid");
    }
  }
}

function parseHistoricalSubject(
  aggregate: TaskAggregate,
  turnJobs: readonly ConversationTurnJob[],
  projectId: string,
): HistoricalSubject | null {
  const taskBrief = parseRecord(aggregate.taskBriefJson) as TaskBrief | null;
  const intentGrant = parseIntentGrant(aggregate.intentGrantJson);
  if (!taskBrief || !hasValidTaskBrief(taskBrief) || !intentGrant ||
      aggregate.projectId !== projectId || taskBrief.projectId !== projectId ||
      taskBrief.taskId !== aggregate.taskId || taskBrief.intentEpoch !== aggregate.intentEpoch ||
      intentGrant.taskId !== aggregate.taskId || intentGrant.projectId !== projectId ||
      intentGrant.intentEpoch !== aggregate.intentEpoch || intentGrant.intensity !== taskBrief.generationIntensity ||
      !aggregate.planId.trim() || !Number.isInteger(aggregate.planRevision) || aggregate.planRevision < 0 ||
      turnJobs.length !== 1) {
    return null;
  }
  return { aggregate, taskBrief, intentGrant, turnJob: turnJobs[0] };
}

function matchesHistoricalClaim(
  claim: OrchestrationAuditEvent,
  invocation: ToolInvocationRecord,
  subject: HistoricalSubject,
  actorUserId: string,
) {
  const { aggregate, taskBrief, intentGrant, turnJob } = subject;
  if (!turnJob) return false;
  const envelope = parseRecord(invocation.executionEnvelopeJson) as ExecutionEnvelope | null;
  return envelope !== null && hasValidExecutionEnvelope(envelope) &&
    claim.taskId === taskBrief.taskId && claim.intentEpoch === taskBrief.intentEpoch &&
    claim.teacherMessageId === taskBrief.sourceMessageId && claim.turnJobId === turnJob.id &&
    claim.actorUserId === actorUserId && turnJob.actorUserId === actorUserId &&
    claim.actorAuthMode === turnJob.actorAuthMode && Boolean(turnJob.actorAuthMode) &&
    claim.authSessionDigest === (turnJob.authSessionId ? sha256(turnJob.authSessionId) : null) &&
    claim.planId === aggregate.planId && claim.planRevision !== null && claim.planRevision >= 0 &&
    claim.planRevision <= aggregate.planRevision && invocation.taskId === taskBrief.taskId &&
    invocation.projectId === taskBrief.projectId && invocation.intentEpoch === taskBrief.intentEpoch &&
    invocation.planRevision === claim.planRevision && envelope.actorUserId === actorUserId &&
    envelope.projectId === taskBrief.projectId && envelope.taskId === taskBrief.taskId &&
    envelope.intentEpoch === taskBrief.intentEpoch && envelope.taskBriefDigest === taskBrief.digest &&
    envelope.planRevision === claim.planRevision &&
    canonicalizeRunInput(envelope.intentGrant) === canonicalizeRunInput(intentGrant);
}

function parseIntentGrant(value: string): IntentGrant | null {
  const grant = parseRecord(value) as IntentGrant | null;
  if (!grant || grant.schemaVersion !== INTENT_GRANT_VERSION || !grant.taskId?.trim() ||
      !grant.projectId?.trim() || !Number.isInteger(grant.intentEpoch) || grant.intentEpoch < 0 ||
      typeof grant.standardWorkAuthorized !== "boolean" ||
      !generationIntensityIds.includes(grant.intensity) ||
      !Array.isArray(grant.requiredCheckpoints) ||
      !grant.requiredCheckpoints.every((value) => typeof value === "string" && value.trim()) ||
      !nullableNonNegativeNumber(grant.maxCostCredits) ||
      !nullableNonNegativeInteger(grant.maxExternalProviderCalls) ||
      !(grant.budgetPolicyVersion === null || typeof grant.budgetPolicyVersion === "string") ||
      !(grant.expiresAt === null || typeof grant.expiresAt === "string")) {
    return null;
  }
  return grant;
}

function sourceMessageId(aggregate: TaskAggregate) {
  return (parseRecord(aggregate.taskBriefJson) as Partial<TaskBrief> | null)?.sourceMessageId ?? "";
}

function nullableNonNegativeNumber(value: unknown) {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function nullableNonNegativeInteger(value: unknown) {
  return value === null || (Number.isInteger(value) && (value as number) >= 0);
}

function parseRecord(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function groupBy<T>(values: readonly T[], keyFor: (value: T) => string) {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = keyFor(value);
    const entries = groups.get(key) ?? [];
    entries.push(value);
    groups.set(key, entries);
  }
  return groups;
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
