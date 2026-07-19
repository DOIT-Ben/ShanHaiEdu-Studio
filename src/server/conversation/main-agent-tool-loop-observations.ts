import { randomUUID } from "node:crypto";

import type { Artifact } from "@/generated/prisma/client";
import {
  createValidationReport,
  hasValidValidationReportDigest,
} from "@/server/contracts/contract-validator";
import type { ValidationReport } from "@/server/quality/quality-types";
import { createPersistedAgentToolReport } from "@/server/tools/agent-tool-report";
import type { AgentToolInvocationEnvelope } from "@/server/tools/agent-tool-invocation";
import type { AgentToolRouterResult } from "@/server/tools/agent-tool-router";
import type { ArtifactRecord } from "@/server/workbench/types";

import type { MainAgentReActDispatchResult } from "./main-agent-controlled-react-loop";
import type { ToolInvocationClaim } from "./control-plane-store";
import { createAgentObservation, type AgentObservation } from "./react-control";
import type { createExecutionEnvelope } from "./task-contract";
import type { MainAgentToolLoopContext } from "./main-agent-tool-loop-types";

export function bindFailureValidationReportToInvocation(
  report: ValidationReport | undefined,
  invocationId: string,
  intentEpoch: number,
): ValidationReport | undefined {
  if (!report || report.overallStatus !== "failed" || !hasValidValidationReportDigest(report)) return undefined;
  return createValidationReport({
    authority: report.authority,
    domain: report.domain,
    stage: report.stage,
    contract: report.contract,
    ...(report.inputHash !== undefined ? { inputHash: report.inputHash } : {}),
    overallStatus: report.overallStatus,
    gates: report.gates,
    reportId: randomUUID(),
    createdAt: new Date().toISOString(),
    target: { kind: "tool_invocation", targetId: invocationId },
    intentEpoch,
  });
}

export function observationFromReport(
  envelope: AgentToolInvocationEnvelope,
  result: AgentToolRouterResult,
  report: ReturnType<typeof createPersistedAgentToolReport>,
): AgentObservation {
  const successful = result.status === "succeeded";
  const failureDetails = successful ? [] : safeFailureDetails(result.observation.internalReasonSanitized);
  const explicitFailureDetails = successful ? [] : [
    ...(result.observation.reasonCode ? [result.observation.reasonCode] : []),
    ...(result.observation.reasonDetails ?? []),
  ];
  const policy = successful && "policyOutcome" in result ? result.policyOutcome : undefined;
  const structured = successful ? result.structuredOutput : null;
  const status = resolveObservationStatus(result, policy, structured);
  const targetLocators = successful && Array.isArray(structured?.targetLocators)
    ? structured.targetLocators.filter(isTargetLocator)
    : [];
  const responsibleStage = successful && typeof structured?.responsibleStage === "string"
    ? structured.responsibleStage
    : envelope.arguments.stage as string | undefined;
  return createAgentObservation({
    projectId: envelope.projectId,
    source: envelope.toolId === "delivery_critic.review" ? "quality" : "tool",
    status,
    actionKey: envelope.toolId,
    inputHash: envelope.inputHash,
    reasonCodes: policy?.reasonCodes?.length
      ? policy.reasonCodes
      : successful
        ? [`agent_tool_${status}`]
        : [...new Set([result.errorCategory ?? result.observation.kind, ...explicitFailureDetails, ...failureDetails])],
    reportRefs: envelope.toolId === "delivery_critic.review"
      ? [{ kind: "critic", id: report.reportId, digest: report.reportDigest }]
      : [],
    targetLocators,
    responsibleStage,
    minimalNextAction: resolveAgentToolNextAction(result, status, targetLocators),
    teacherSafeSummary: report.assistantSummary,
  });
}

function resolveAgentToolNextAction(
  result: AgentToolRouterResult,
  status: AgentObservation["status"],
  targetLocators: AgentObservation["targetLocators"],
): AgentObservation["minimalNextAction"] {
  if (status === "succeeded") return "continue";
  if (status === "repair") return targetLocators.length ? "repair_unit" : "repair_upstream";
  if (result.status !== "succeeded") {
    if (result.observation.kind === "blocked_by_policy" && result.observation.retryPolicy.nextAction === "ask_teacher") {
      return "ask_teacher";
    }
    if (result.observation.retryPolicy.nextAction === "retry_later") return "pause";
  }
  return "repair_upstream";
}

function resolveObservationStatus(
  result: AgentToolRouterResult,
  policy: Extract<AgentToolRouterResult, { status: "succeeded" }>["policyOutcome"] | undefined,
  structured: Record<string, unknown> | null,
): AgentObservation["status"] {
  if (result.status !== "succeeded") {
    if (result.status === "needs_input") return "needs_input";
    if (result.status === "inconclusive") return "inconclusive";
    return "failed";
  }
  if (policy) {
    if (policy.passed) return "succeeded";
    if (policy.reviewOutcome === "blocked") return "blocked";
    if (policy.reviewOutcome === "inconclusive") return "inconclusive";
    return "repair";
  }
  if (structured?.decision === "repair") return "repair";
  if (structured?.decision === "blocked") return "blocked";
  if (structured?.decision === "needs_input") return "needs_input";
  return "succeeded";
}

export function safeFailureDetails(value: string | undefined): string[] {
  const normalized = String(value ?? "")
    .replace(/^Agent Tool output failed contract validation:\s*/i, "")
    .trim();
  if (!normalized) return [];
  return [...new Set(normalized
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part.length <= 160 && /^[A-Za-z0-9_.$:[\]-]+$/.test(part))
    .slice(0, 40))];
}

export function validationFailureDetails(
  report: { gates: Array<{ status: string; reasonCode?: string; gateId: string }> } | undefined,
): string[] {
  if (!report) return [];
  return [...new Set(report.gates
    .filter((gate) => gate.status === "failed" || gate.status === "inconclusive")
    .map((gate) => gate.reasonCode ?? gate.gateId)
    .filter((code) => code.length > 0 && code.length <= 160 && /^[A-Za-z0-9_.$:[\]-]+$/.test(code))
    .slice(0, 40))];
}

export function compactContinuationObservation(
  status: MainAgentReActDispatchResult["observation"]["status"],
  reasonCodes: string[],
  extras: Partial<MainAgentReActDispatchResult["observation"]> = {},
): MainAgentReActDispatchResult["observation"] {
  return { status, reasonCodes: [...new Set(reasonCodes)], ...extras };
}

export function observationForContinuation(
  observation: AgentObservation,
  extras: Partial<MainAgentReActDispatchResult["observation"]> = {},
): MainAgentReActDispatchResult["observation"] {
  return compactContinuationObservation(observation.status, observation.reasonCodes, {
    observationId: observation.observationId,
    summary: observation.teacherSafeSummary,
    reportRefs: observation.reportRefs,
    targetLocators: observation.targetLocators,
    nextAction: observation.minimalNextAction,
    ...extras,
  });
}

export function nextToolIntentsFromStructuredOutput(structuredOutput: Record<string, unknown> | null) {
  if (!structuredOutput || !Array.isArray(structuredOutput.nextToolIntents)) return [];
  return structuredOutput.nextToolIntents
    .filter((value): value is string => typeof value === "string" && /^[a-z0-9_.-]+$/i.test(value))
    .slice(0, 12);
}

export function observationStatusForModel(
  observation: AgentObservation,
): MainAgentReActDispatchResult["status"] {
  if (observation.status === "succeeded") return "succeeded";
  if (observation.status === "blocked" || observation.status === "needs_input") return "blocked";
  if (observation.status === "inconclusive") return "inconclusive";
  return "failed";
}

export function toolInvocationReplayResult(
  claim: Exclude<ToolInvocationClaim, { kind: "claimed" }>,
): MainAgentReActDispatchResult {
  if (claim.kind === "in_progress") {
    return {
      status: "inconclusive",
      observation: compactContinuationObservation("inconclusive", ["tool_invocation_in_progress"], {
        summary: "这一步仍在执行中，系统不会重复提交。",
        nextAction: "pause",
      }),
    };
  }
  const status = persistedObservationStatusForModel(claim.observation.status);
  const summary = typeof claim.observation.payload.teacherSafeSummary === "string"
    ? claim.observation.payload.teacherSafeSummary
    : typeof claim.observation.payload.summary === "string"
      ? claim.observation.payload.summary
      : status === "succeeded"
        ? "已读取这一步先前保存的结果。"
        : "已读取这一步先前保存的失败结果。";
  return {
    status,
    observation: compactContinuationObservation(status, claim.observation.reasonCodes, {
      observationId: claim.observation.observationId,
      summary,
      nextAction: status === "succeeded" ? "continue" : "replan",
      ...(claim.observation.artifactId ? { artifactRefs: [{ artifactId: claim.observation.artifactId }] } : {}),
    }),
  };
}

function persistedObservationStatusForModel(status: string): MainAgentReActDispatchResult["status"] {
  if (status === "succeeded") return "succeeded";
  if (status === "blocked" || status === "needs_input") return "blocked";
  if (status === "inconclusive") return "inconclusive";
  return "failed";
}

export async function persistAgentToolObservation(input: {
  controlPlaneStore: MainAgentToolLoopContext["controlPlaneStore"];
  invocationId: string;
  executionEnvelope: ReturnType<typeof createExecutionEnvelope> | undefined;
  triggerMessageId: string;
  observation: AgentObservation;
}) {
  if (!input.executionEnvelope) throw new Error("Agent Tool result requires an ExecutionEnvelope.");
  await input.controlPlaneStore.commitToolObservation({
    invocationId: input.invocationId,
    observation: {
      observationId: input.observation.observationId,
      status: input.observation.status,
      reasonCodes: input.observation.reasonCodes,
      payload: structuredClone(input.observation) as unknown as Record<string, unknown>,
    },
    event: {
      eventId: randomUUID(),
      projectId: input.executionEnvelope.projectId,
      taskId: input.executionEnvelope.taskId,
      runId: `turn:${input.triggerMessageId}`,
      intentEpoch: input.executionEnvelope.intentEpoch,
      kind: "tool_observed",
      visibility: "internal",
      occurredAt: new Date().toISOString(),
      payload: { observationId: input.observation.observationId, status: input.observation.status },
    },
  });
}

export function mapCommittedArtifact(artifact: Artifact): ArtifactRecord {
  return {
    id: artifact.id,
    projectId: artifact.projectId,
    taskId: artifact.taskId,
    taskBriefDigest: artifact.taskBriefDigest,
    intentEpoch: artifact.intentEpoch,
    planRevision: artifact.planRevision,
    origin: artifact.origin as ArtifactRecord["origin"],
    nodeKey: artifact.nodeKey as ArtifactRecord["nodeKey"],
    title: artifact.title,
    kind: artifact.kind as ArtifactRecord["kind"],
    status: artifact.status as ArtifactRecord["status"],
    summary: artifact.summary,
    markdownContent: artifact.markdownContent,
    structuredContent: JSON.parse(artifact.structuredContentJson) as Record<string, unknown>,
    version: artifact.version,
    isApproved: artifact.isApproved,
    createdAt: artifact.createdAt.toISOString(),
    updatedAt: artifact.updatedAt.toISOString(),
  };
}

function isTargetLocator(value: unknown): value is AgentObservation["targetLocators"][number] {
  return isRecord(value) && typeof value.kind === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
