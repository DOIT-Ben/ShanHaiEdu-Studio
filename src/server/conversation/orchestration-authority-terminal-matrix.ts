import { createHash } from "node:crypto";

import type {
  AgentEventRecord,
  Artifact,
  GenerationJob,
  ObservationRecord,
  OrchestrationAuditEvent,
  RunInputSnapshot,
  ToolInvocationRecord,
  ValidationReportRecord,
} from "@/generated/prisma/client";

import { hasValidExecutionEnvelope, type ExecutionEnvelope } from "./task-contract";
import { digestToolAuditEvent } from "./orchestration-tool-audit-event";
import {
  readToolResultModeFromAuditPayload,
  resolveServerToolResultContract,
  type ToolResultContract,
} from "./tool-result-mode";
import {
  expectedToolTerminalEventKind,
  toolInvocationStatusForObservationStatus,
  type ToolInvocationTerminalStatus,
} from "./tool-terminal-status";
import {
  hasCompatibleArtifactPlanRevision,
  matchesGenerationInvocationContract,
} from "./tool-artifact-replay-contract";
import { matchesPersistedProviderValidationReport } from "./provider-validation-evidence";
import { evaluateGenerationReverseBindings } from "./orchestration-authority-generation-replay";

type ProjectToolFacts = {
  invocations: readonly ToolInvocationRecord[];
  observations: readonly ObservationRecord[];
  artifacts: readonly Artifact[];
  agentEvents: readonly AgentEventRecord[];
  generationJobs: readonly GenerationJob[];
  runInputSnapshots: readonly RunInputSnapshot[];
  validationReports: readonly ValidationReportRecord[];
};

export function evaluateProjectToolTerminalMatrix(input: {
  auditEvents: readonly OrchestrationAuditEvent[];
  facts: ProjectToolFacts;
  violations: Set<string>;
  evaluateGenerationReverse?: boolean;
}) {
  const { facts, violations } = input;
  const toolAuditEvents = input.auditEvents.filter((event) => event.operationKind === "tool_invocation");
  const claimsByInvocation = groupBy(
    toolAuditEvents.filter((event) => event.recordType === "attempted"),
    (event) => event.toolInvocationId,
  );
  const terminalsByInvocation = groupBy(
    toolAuditEvents.filter((event) => event.recordType === "resolved"),
    (event) => event.toolInvocationId,
  );
  const observationsByInvocation = groupBy(facts.observations, (row) => row.invocationId);
  const eventsByObservation = groupBy(facts.agentEvents, (event) => text(parsedRecord(event.payloadJson)?.observationId));
  const artifactById = new Map(facts.artifacts.map((row) => [row.id, row]));
  const generationJobById = new Map(facts.generationJobs.map((row) => [row.id, row]));
  const snapshotById = new Map(facts.runInputSnapshots.map((row) => [row.id, row]));
  const reportsByGenerationJob = groupBy(facts.validationReports, (row) => row.generationJobId);
  const reportsByArtifact = groupBy(facts.validationReports, (row) => row.artifactId);

  for (const invocation of facts.invocations) {
    evaluateInvocationTerminal({
      invocation,
      claims: claimsByInvocation.get(invocation.invocationId) ?? [],
      terminals: terminalsByInvocation.get(invocation.invocationId) ?? [],
      observations: observationsByInvocation.get(invocation.invocationId) ?? [],
      eventsByObservation,
      artifactById,
      generationJobById,
      snapshotById,
      reportsByGenerationJob,
      reportsByArtifact,
      violations,
    });
  }
  if (input.evaluateGenerationReverse !== false) evaluateGenerationReverseBindings({ facts, violations });
}

function evaluateInvocationTerminal(input: {
  invocation: ToolInvocationRecord;
  claims: OrchestrationAuditEvent[];
  terminals: OrchestrationAuditEvent[];
  observations: ObservationRecord[];
  eventsByObservation: Map<string, AgentEventRecord[]>;
  artifactById: Map<string, Artifact>;
  generationJobById: Map<string, GenerationJob>;
  snapshotById: Map<string, RunInputSnapshot>;
  reportsByGenerationJob: Map<string, ValidationReportRecord[]>;
  reportsByArtifact: Map<string, ValidationReportRecord[]>;
  violations: Set<string>;
}) {
  const {
    invocation,
    claims,
    terminals,
    observations,
    eventsByObservation,
    artifactById,
    generationJobById,
    snapshotById,
    reportsByGenerationJob,
    reportsByArtifact,
    violations,
  } = input;
  const terminalExpected = invocation.status !== "running";
  if (claims.length !== 1 || terminals.length !== (terminalExpected ? 1 : 0)) {
    violations.add("tool_invocation_audit_cardinality_invalid");
    return;
  }
  const claim = claims[0];
  const parsed = parseInvocationContract(invocation);
  if (!parsed || !matchesInvocationAudit(claim, invocation, parsed.envelope, parsed.request)) {
    violations.add("tool_invocation_binding_invalid");
    return;
  }
  if (readToolResultModeFromAuditPayload(claim.payloadJson) !== parsed.contract.resultMode) {
    violations.add("tool_result_mode_contract_invalid");
  }
  if (!terminalExpected) return;

  const terminal = terminals[0];
  if (!matchesTerminalAudit(claim, terminal, invocation.status, parsed.contract)) {
    violations.add("tool_terminal_binding_invalid");
  }
  if (observations.length !== 1 || observations[0].observationId !== invocation.observationId ||
      terminal.observationId !== invocation.observationId) {
    violations.add("tool_observation_cardinality_invalid");
    return;
  }
  const observation = observations[0];
  const boundEvents = eventsByObservation.get(observation.observationId) ?? [];
  if (boundEvents.length !== 1) {
    violations.add("tool_event_cardinality_invalid");
    return;
  }
  const event = boundEvents[0];
  const reasonCodes = parseReasonCodes(observation.reasonCodesJson);
  const payload = parsedRecord(event.payloadJson);
  if (!reasonCodes) violations.add("tool_observation_reason_codes_invalid");
  if (toolInvocationStatusForObservationStatus(observation.status, event.kind) !== invocation.status) {
    violations.add("tool_observation_status_invalid");
  }
  if (event.kind !== expectedToolTerminalEventKind(
    observation.status,
    invocation.status as ToolInvocationTerminalStatus,
    parsed.contract.resultMode,
  )) {
    violations.add("tool_event_kind_invalid");
  }
  const expectedRunId = claim.authority === "artifact_route"
    ? `artifact-route:${invocation.invocationId}`
    : `turn:${claim.teacherMessageId}`;
  if (event.projectId !== invocation.projectId || event.taskId !== invocation.taskId ||
      event.intentEpoch !== invocation.intentEpoch || event.runId !== expectedRunId || !payload ||
      payload.observationId !== observation.observationId || payload.status !== observation.status ||
      payload.toolName !== invocation.toolName || !equalTextArrays(payload.reasonCodes, reasonCodes)) {
    violations.add("tool_event_binding_invalid");
  }
  evaluateGenerationBinding({
    invocation,
    observation,
    eventPayload: payload,
    generationJobById,
    snapshotById,
    sourceArtifacts: [...artifactById.values()],
    request: parsed.request,
    contract: parsed.contract,
    authority: claim.authority,
    artifactById,
    reportsByGenerationJob,
    reportsByArtifact,
    violations,
  });
  evaluateArtifactBinding({
    invocation,
    observation,
    eventPayload: payload,
    artifactById,
    generationJobById,
    snapshotById,
    envelope: parsed.envelope,
    request: parsed.request,
    contract: parsed.contract,
    authority: claim.authority,
    violations,
  });
}

function evaluateArtifactBinding(input: {
  invocation: ToolInvocationRecord;
  observation: ObservationRecord;
  eventPayload: Record<string, unknown> | null;
  artifactById: Map<string, Artifact>;
  generationJobById: Map<string, GenerationJob>;
  snapshotById: Map<string, RunInputSnapshot>;
  envelope: ExecutionEnvelope;
  request: Record<string, unknown>;
  contract: ToolResultContract;
  authority: string;
  violations: Set<string>;
}) {
  const {
    invocation,
    observation,
    eventPayload,
    artifactById,
    generationJobById,
    snapshotById,
    envelope,
    request,
    contract,
    authority,
    violations,
  } = input;
  const eventArtifactId = text(eventPayload?.artifactId);
  const artifactRequired = observation.status === "succeeded" && contract.resultMode === "artifact_required";
  if (!artifactRequired) {
    if (invocation.artifactId || observation.artifactId || eventArtifactId) {
      violations.add("tool_unexpected_artifact_binding");
    }
    return;
  }
  const artifact = invocation.artifactId ? artifactById.get(invocation.artifactId) : undefined;
  if (!artifact || observation.artifactId !== artifact.id || eventArtifactId !== artifact.id ||
      artifact.projectId !== invocation.projectId || artifact.taskId !== invocation.taskId ||
      artifact.intentEpoch !== invocation.intentEpoch ||
      !hasCompatibleArtifactPlanRevision(artifact.planRevision ?? -1, invocation.planRevision) ||
      artifact.taskBriefDigest !== envelope.taskBriefDigest || artifact.origin !== "tool_result" ||
      (contract.artifactKind !== null && (artifact.kind !== contract.artifactKind || artifact.nodeKey !== contract.artifactKind))) {
    violations.add("tool_artifact_binding_invalid");
    return;
  }
  if (authority === "artifact_route") {
    const generationJobId = text(eventPayload?.generationJobId);
    const generationJob = generationJobId ? generationJobById.get(generationJobId) : undefined;
    const snapshot = generationJob?.runInputSnapshotId
      ? snapshotById.get(generationJob.runInputSnapshotId)
      : undefined;
    if (!contract.capabilityId || !generationJob || !snapshot ||
        generationJob.status !== "succeeded" || generationJob.resultArtifactId !== artifact.id ||
        !contract.expectedGenerationKind || !contract.primarySourceArtifactKind ||
        !matchesGenerationInvocationContract({
          authority,
          invocation,
          request,
          capabilityId: contract.capabilityId,
          expectedGenerationKind: contract.expectedGenerationKind,
          requiredArtifactKinds: contract.requiredArtifactKinds,
          primarySourceArtifactKind: contract.primarySourceArtifactKind,
          sourceArtifacts: [...artifactById.values()],
          generationJob,
          snapshot,
        })) {
      violations.add("tool_artifact_generation_binding_invalid");
    }
  }
}

function evaluateGenerationBinding(input: {
  invocation: ToolInvocationRecord;
  observation: ObservationRecord;
  eventPayload: Record<string, unknown> | null;
  generationJobById: Map<string, GenerationJob>;
  snapshotById: Map<string, RunInputSnapshot>;
  sourceArtifacts: readonly Artifact[];
  request: Record<string, unknown>;
  contract: ToolResultContract;
  authority: string;
  artifactById: Map<string, Artifact>;
  reportsByGenerationJob: Map<string, ValidationReportRecord[]>;
  reportsByArtifact: Map<string, ValidationReportRecord[]>;
  violations: Set<string>;
}) {
  const generationJobId = text(input.eventPayload?.generationJobId);
  if (!generationJobId) {
    if (input.observation.status === "succeeded" && input.contract.requiresGenerationEvidence) {
      input.violations.add("tool_generation_binding_invalid");
    }
    return;
  }
  const generationJob = input.generationJobById.get(generationJobId);
  const snapshot = generationJob?.runInputSnapshotId
    ? input.snapshotById.get(generationJob.runInputSnapshotId)
    : undefined;
  const expectedStatuses = input.observation.status === "succeeded"
    ? ["succeeded"]
    : ["failed", "submission_unknown"];
  if (!input.contract.capabilityId || !input.contract.requiresGenerationEvidence ||
      !input.contract.expectedGenerationKind || !input.contract.primarySourceArtifactKind || !generationJob || !snapshot ||
      !expectedStatuses.includes(generationJob.status) ||
      !matchesGenerationInvocationContract({
        authority: input.authority,
        invocation: input.invocation,
        request: input.request,
        capabilityId: input.contract.capabilityId,
        expectedGenerationKind: input.contract.expectedGenerationKind,
        requiredArtifactKinds: input.contract.requiredArtifactKinds,
        primarySourceArtifactKind: input.contract.primarySourceArtifactKind,
        sourceArtifacts: input.sourceArtifacts,
        generationJob,
        snapshot,
  })) {
    input.violations.add("tool_generation_binding_invalid");
    return;
  }
  if (input.observation.status === "succeeded") {
    const artifact = input.invocation.artifactId
      ? input.artifactById.get(input.invocation.artifactId)
      : undefined;
    const reports = uniqueById([
      ...(input.reportsByGenerationJob.get(generationJob.id) ?? []),
      ...(artifact ? input.reportsByArtifact.get(artifact.id) ?? [] : []),
    ]);
    if (!artifact || generationJob.resultArtifactId !== artifact.id || reports.length !== 1) {
      input.violations.add("tool_validation_report_cardinality_invalid");
    } else if (!matchesPersistedProviderValidationReport({
      invocation: input.invocation,
      generationJob,
      artifact,
      record: reports[0],
    })) {
      input.violations.add("tool_validation_report_binding_invalid");
    }
  }
}

function parseInvocationContract(invocation: ToolInvocationRecord) {
  try {
    const envelope = JSON.parse(invocation.executionEnvelopeJson) as ExecutionEnvelope;
    const request = parsedRecord(invocation.requestJson);
    if (!hasValidExecutionEnvelope(envelope) || !request) return null;
    return { envelope, request, contract: resolveServerToolResultContract(invocation.toolName, request) };
  } catch {
    return null;
  }
}

function matchesInvocationAudit(
  claim: OrchestrationAuditEvent,
  invocation: ToolInvocationRecord,
  envelope: ExecutionEnvelope,
  request: Record<string, unknown>,
) {
  const actionDigest = sha256(JSON.stringify({ toolName: invocation.toolName.trim(), arguments: request }));
  return claim.recordType === "attempted" && claim.outcome === null &&
    claim.operationKind === "tool_invocation" &&
    (claim.authority === "main_agent" || claim.authority === "artifact_route") &&
    claim.attemptId === invocation.invocationId && claim.claimedProjectId === invocation.projectId &&
    claim.observationId === null && claim.invocationStatus === "running" &&
    claim.reasonCode === "tool_invocation_claimed" && claim.eventDigest === digestToolAuditEvent(claim) &&
    Number.isInteger(claim.toolOrdinal) && (claim.toolOrdinal ?? 0) > 0 &&
    claim.toolInvocationId === invocation.invocationId && claim.taskId === invocation.taskId &&
    claim.resolvedProjectId === invocation.projectId && claim.intentEpoch === invocation.intentEpoch &&
    claim.planRevision === invocation.planRevision && claim.toolName === invocation.toolName &&
    claim.idempotencyKey === invocation.idempotencyKey && claim.actionDigest === actionDigest &&
    claim.executionEnvelopeDigest === sha256(invocation.executionEnvelopeJson) &&
    claim.requestDigest === sha256(invocation.requestJson) && envelope.actionDigest === actionDigest &&
    envelope.projectId === invocation.projectId && envelope.taskId === invocation.taskId &&
    envelope.intentEpoch === invocation.intentEpoch && envelope.planRevision === invocation.planRevision;
}

function matchesTerminalAudit(
  claim: OrchestrationAuditEvent,
  terminal: OrchestrationAuditEvent,
  invocationStatus: string,
  contract: ToolResultContract,
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
    terminal.eventDigest === digestToolAuditEvent(terminal) && terminal.invocationStatus === invocationStatus &&
    terminal.outcome === expectedOutcome && terminal.reasonCode === `tool_invocation_${invocationStatus}` &&
    readToolResultModeFromAuditPayload(terminal.payloadJson) === contract.resultMode &&
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

function uniqueById<T extends { id: string }>(values: readonly T[]) {
  return [...new Map(values.map((value) => [value.id, value])).values()];
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
