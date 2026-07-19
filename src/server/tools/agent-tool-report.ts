import { randomUUID } from "node:crypto";

import { hashRunInput } from "@/server/execution/run-input-snapshot";
import { omitObjectKeys } from "@/server/contracts/object-projection";

import type { AgentToolArtifactRef, AgentToolInvocationEnvelope } from "./agent-tool-invocation";
import type { AgentToolRouterResult } from "./agent-tool-router";
import type { AgentToolId, AgentToolPolicyOutcome } from "./agent-tool-types";

export type PersistedAgentToolReport = {
  reportId: string;
  reportDigest: string;
  projectId: string;
  intentEpoch: number;
  sourceMessageId: string;
  invocationId: string;
  toolId: AgentToolId;
  status: "succeeded" | "needs_input" | "failed" | "inconclusive";
  assistantSummary: string;
  structuredOutput: Record<string, unknown> | null;
  policyOutcome: AgentToolPolicyOutcome | null;
  approvedArtifactRefs: AgentToolArtifactRef[];
  inputHash: string;
  actionDigest: string;
  createdAt: string;
};

const metadataKey = "agentToolReports";
const persistedReportKeys = new Set<keyof PersistedAgentToolReport>([
  "reportId",
  "reportDigest",
  "projectId",
  "intentEpoch",
  "sourceMessageId",
  "invocationId",
  "toolId",
  "status",
  "assistantSummary",
  "structuredOutput",
  "policyOutcome",
  "approvedArtifactRefs",
  "inputHash",
  "actionDigest",
  "createdAt",
]);

export function createPersistedAgentToolReport(
  envelope: AgentToolInvocationEnvelope,
  result: AgentToolRouterResult,
  input: { reportId?: string; createdAt?: string } = {},
): PersistedAgentToolReport {
  const reportId = input.reportId ?? randomUUID();
  const createdAt = input.createdAt ?? new Date().toISOString();
  const payload = {
    projectId: envelope.projectId,
    intentEpoch: envelope.intentEpoch,
    sourceMessageId: envelope.sourceMessageId,
    invocationId: envelope.invocationId,
    toolId: envelope.toolId as AgentToolId,
    status: result.status,
    assistantSummary: result.status === "succeeded"
      ? result.assistantSummary
      : result.observation.teacherSafeSummary,
    structuredOutput: result.status === "succeeded" ? structuredClone(result.structuredOutput) : null,
    policyOutcome: result.status === "succeeded" && "policyOutcome" in result && result.policyOutcome
      ? structuredClone(result.policyOutcome)
      : null,
    approvedArtifactRefs: structuredClone(envelope.approvedArtifactRefs),
    inputHash: envelope.inputHash,
    actionDigest: envelope.actionDigest,
  };

  return {
    reportId,
    reportDigest: hashRunInput(payload),
    ...payload,
    createdAt,
  };
}

export function appendAgentToolReportMetadata(metadata: unknown, report: PersistedAgentToolReport) {
  const base = isRecord(metadata) ? metadata : {};
  const existing = readAgentToolReportsFromMetadata(base);
  return {
    ...base,
    [metadataKey]: [...existing.filter((item) => item.reportId !== report.reportId), report],
  };
}

export function readAgentToolReportsFromMetadata(metadata: unknown): PersistedAgentToolReport[] {
  if (!isRecord(metadata) || !Array.isArray(metadata[metadataKey])) return [];
  return metadata[metadataKey].filter(isPersistedAgentToolReport);
}

export function readAgentToolReportsFromMessages(messages: Array<{ metadata?: unknown }>) {
  return messages.flatMap((message) => readAgentToolReportsFromMetadata(message.metadata));
}

function isPersistedAgentToolReport(value: unknown): value is PersistedAgentToolReport {
  if (!isRecord(value) ||
      !hasOnlyPersistedReportKeys(value) ||
      typeof value.reportId !== "string" ||
      typeof value.reportDigest !== "string" ||
      typeof value.projectId !== "string" ||
      !Number.isInteger(value.intentEpoch) ||
      typeof value.sourceMessageId !== "string" ||
      typeof value.invocationId !== "string" ||
      typeof value.toolId !== "string" ||
      !isStatus(value.status) ||
      typeof value.assistantSummary !== "string" ||
      typeof value.inputHash !== "string" ||
      typeof value.actionDigest !== "string" ||
      typeof value.createdAt !== "string" ||
      !Number.isFinite(Date.parse(value.createdAt))) {
    return false;
  }
  const payload = omitObjectKeys(value, ["reportId", "reportDigest", "createdAt"]);
  return hashRunInput(payload) === value.reportDigest;
}

function hasOnlyPersistedReportKeys(value: Record<string, unknown>): boolean {
  return Reflect.ownKeys(value).every(
    (key) => typeof key === "string" && persistedReportKeys.has(key as keyof PersistedAgentToolReport),
  );
}

function isStatus(value: unknown): value is PersistedAgentToolReport["status"] {
  return value === "succeeded" || value === "needs_input" || value === "failed" || value === "inconclusive";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
