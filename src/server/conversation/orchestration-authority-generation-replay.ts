import type {
  AgentEventRecord,
  Artifact,
  GenerationJob,
  ObservationRecord,
  RunInputSnapshot,
  ToolInvocationRecord,
  ValidationReportRecord,
} from "@/generated/prisma/client";

import { matchesPersistedProviderValidationReport } from "./provider-validation-evidence";

type GenerationReverseFacts = {
  invocations: readonly ToolInvocationRecord[];
  observations: readonly ObservationRecord[];
  artifacts: readonly Artifact[];
  agentEvents: readonly AgentEventRecord[];
  generationJobs: readonly GenerationJob[];
  runInputSnapshots: readonly RunInputSnapshot[];
  validationReports: readonly ValidationReportRecord[];
};

export function evaluateGenerationReverseBindings(input: {
  facts: GenerationReverseFacts;
  violations: Set<string>;
}) {
  const { facts, violations } = input;
  const artifactById = new Map(facts.artifacts.map((row) => [row.id, row]));
  const snapshotById = new Map(facts.runInputSnapshots.map((row) => [row.id, row]));
  const reportsByGenerationJob = groupBy(facts.validationReports, (row) => row.generationJobId);
  const reportsByArtifact = groupBy(facts.validationReports, (row) => row.artifactId);
  const invocationById = new Map(facts.invocations.map((row) => [row.invocationId, row]));
  const observationById = new Map(facts.observations.map((row) => [row.observationId, row]));
  const succeededJobs = facts.generationJobs.filter((job) => job.status === "succeeded");
  if (succeededJobs.some((job) => !job.resultArtifactId)) {
    violations.add("tool_generation_reverse_binding_invalid");
  }
  const terminalJobs = succeededJobs.filter((job) => job.resultArtifactId);
  const jobsByResultArtifact = groupBy(terminalJobs, (job) => job.resultArtifactId);
  const eventsByGenerationJob = groupBy(
    facts.agentEvents,
    (event) => text(parsedRecord(event.payloadJson)?.generationJobId),
  );

  for (const job of terminalJobs) {
    const artifact = job.resultArtifactId ? artifactById.get(job.resultArtifactId) : undefined;
    const completeRefs = (eventsByGenerationJob.get(job.id) ?? []).flatMap((event) => {
      const payload = parsedRecord(event.payloadJson);
      const observationId = text(payload?.observationId);
      const observation = observationId ? observationById.get(observationId) : undefined;
      const invocation = observation?.invocationId ? invocationById.get(observation.invocationId) : undefined;
      return artifact && observation && invocation && payload?.artifactId === artifact.id &&
        observation.artifactId === artifact.id && invocation.artifactId === artifact.id &&
        invocation.observationId === observation.observationId
        ? [{ event, invocation }]
        : [];
    });
    const originalRefs = completeRefs.filter(({ event, invocation }) =>
      isOriginalGenerationRun(event.runId, invocation) && invocation.taskId === artifact?.taskId &&
      invocation.intentEpoch === artifact?.intentEpoch && invocation.planRevision === artifact?.planRevision);
    if (!artifact || (jobsByResultArtifact.get(artifact.id) ?? []).length !== 1 ||
        completeRefs.length === 0 || originalRefs.length !== 1 ||
        !job.runInputSnapshotId || !snapshotById.has(job.runInputSnapshotId)) {
      violations.add("tool_generation_reverse_binding_invalid");
      continue;
    }

    const reports = uniqueById([
      ...(reportsByGenerationJob.get(job.id) ?? []),
      ...(reportsByArtifact.get(artifact.id) ?? []),
    ]);
    if (reports.length !== 1) {
      violations.add("tool_validation_report_cardinality_invalid");
    } else if (!matchesPersistedProviderValidationReport({
      invocation: originalRefs[0].invocation,
      generationJob: job,
      artifact,
      record: reports[0],
    })) {
      violations.add("tool_validation_report_binding_invalid");
    }
  }

  const terminalJobIds = new Set(terminalJobs.map((job) => job.id));
  const terminalArtifactIds = new Set(terminalJobs.flatMap((job) => job.resultArtifactId ? [job.resultArtifactId] : []));
  for (const report of facts.validationReports.filter((row) =>
    row.generationJobId || (row.artifactId && terminalArtifactIds.has(row.artifactId)))) {
    if (!report.generationJobId || !report.artifactId ||
        !terminalJobIds.has(report.generationJobId) || !terminalArtifactIds.has(report.artifactId)) {
      violations.add("tool_validation_report_reverse_binding_invalid");
    }
  }
}

function isOriginalGenerationRun(runId: string, invocation: ToolInvocationRecord) {
  return runId.startsWith("turn:") || runId === `artifact-route:${invocation.invocationId}`;
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
