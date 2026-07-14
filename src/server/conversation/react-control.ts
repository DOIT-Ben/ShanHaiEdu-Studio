import { randomUUID } from "node:crypto";

import { hasValidValidationReportDigest } from "@/server/contracts/contract-validator";
import { hashRunInput } from "@/server/execution/run-input-snapshot";
import { hasValidQualityDecisionDigest } from "@/server/quality/quality-decision-engine";
import type { QualityDecision, TargetLocator, ValidationReport } from "@/server/quality/quality-types";

export type ReActNextAction = "continue" | "repair_unit" | "repair_upstream" | "ask_teacher" | "pause" | "finish";

export type AgentObservation = {
  observationId: string;
  projectId: string;
  source: "tool" | "validation" | "quality" | "budget" | "teacher_revision";
  status: "succeeded" | "failed" | "needs_input" | "repair" | "blocked" | "inconclusive";
  actionKey: string;
  inputHash: string;
  reasonCodes: string[];
  reportRefs: Array<{ kind: "validation" | "critic" | "quality_decision"; id: string; digest: string }>;
  targetLocators: TargetLocator[];
  responsibleStage?: string;
  minimalNextAction: Exclude<ReActNextAction, "finish">;
  teacherSafeSummary: string;
  failureSignature?: string;
  createdAt: string;
};

export type RunCheckpoint = {
  checkpointId: string;
  projectId: string;
  planVersion: number;
  status: "paused";
  reason: "budget_exhausted" | "repeated_failure" | "teacher_requested_pause";
  actionKey?: string;
  inputHash?: string;
  observationRefs: string[];
  createdAt: string;
};

export type ReActTransitionDecision =
  | {
      allowed: true;
      nextAction: ReActNextAction;
      reasonCodes: string[];
      repairTargets?: TargetLocator[];
    }
  | {
      allowed: false;
      nextAction: "repair_upstream";
      reasonCodes: string[];
      repairTargets?: undefined;
    }
  | {
      allowed: false;
      nextAction: "ask_teacher" | "pause";
      reasonCodes: string[];
      checkpoint: RunCheckpoint;
      repairTargets?: undefined;
    };

export type WorkingPlan = {
  planId: string;
  planVersion: number;
  goal: string;
  steps: Array<{ stage: string; status: "pending" | "active" | "succeeded" | "stale" }>;
  reportRefs: Array<{ id: string; stage: string }>;
  decisionRefs: Array<{ id: string; stage: string }>;
};

export function createAgentObservation(input: Omit<AgentObservation, "observationId" | "failureSignature" | "createdAt"> & {
  observationId?: string;
  createdAt?: string;
}): AgentObservation {
  const reasonCodes = [...new Set(input.reasonCodes)].sort();
  const failureSignature = input.status === "failed" || input.status === "blocked" || input.status === "inconclusive"
    ? hashRunInput({ actionKey: input.actionKey, inputHash: input.inputHash, reasonCodes })
    : undefined;
  return {
    ...input,
    observationId: input.observationId ?? randomUUID(),
    reasonCodes,
    reportRefs: [...input.reportRefs].sort((a, b) => `${a.kind}:${a.id}:${a.digest}`.localeCompare(`${b.kind}:${b.id}:${b.digest}`)),
    targetLocators: normalizeLocators(input.targetLocators),
    failureSignature,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function guardReActTransition(input: {
  projectId: string;
  planVersion: number;
  candidate: { actionKey: string; inputHash: string; requestedNextAction: ReActNextAction };
  latestObservation?: AgentObservation;
  observationHistory: AgentObservation[];
  budgetExhausted?: boolean;
  finishEvidence?: FinishEvidence;
}): ReActTransitionDecision {
  if (input.budgetExhausted) {
    return pauseDecision(input, "budget_exhausted");
  }

  if (input.candidate.requestedNextAction === "finish") {
    const finish = guardFinish(input.finishEvidence);
    return finish.allowed
      ? { allowed: true, nextAction: "finish" as const, reasonCodes: [] as string[] }
      : { allowed: false, nextAction: "repair_upstream" as const, reasonCodes: finish.reasonCodes };
  }

  const latest = input.latestObservation;
  if (latest?.failureSignature &&
    latest.projectId === input.projectId &&
    latest.actionKey === input.candidate.actionKey &&
    latest.inputHash === input.candidate.inputHash &&
    countConsecutiveSameFailure(input.observationHistory, latest.failureSignature) >= 2) {
    return pauseDecision(input, "repeated_failure");
  }

  if (latest?.status === "repair") {
    const hasUnitTargets = latest.targetLocators.some((locator) => ["page", "asset", "shot", "track", "timeline", "frame_range"].includes(locator.kind));
    return {
      allowed: true,
      nextAction: hasUnitTargets ? "repair_unit" as const : "repair_upstream" as const,
      reasonCodes: latest.reasonCodes,
      repairTargets: latest.targetLocators,
    };
  }

  return {
    allowed: true,
    nextAction: input.candidate.requestedNextAction,
    reasonCodes: latest?.reasonCodes ?? [],
  };
}

export type FinishEvidence = {
  artifact: { id: string; version: number; digest: string };
  validationReport?: ValidationReport | null;
  qualityDecision?: QualityDecision | null;
};

export function guardFinish(evidence?: FinishEvidence) {
  const reasonCodes: string[] = [];
  if (!evidence?.validationReport || !hasValidValidationReportDigest(evidence.validationReport) || evidence.validationReport.overallStatus !== "passed") {
    reasonCodes.push("validation_evidence_missing_or_invalid");
  }
  if (!evidence?.qualityDecision || !hasValidQualityDecisionDigest(evidence.qualityDecision) || evidence.qualityDecision.outcome !== "pass") {
    reasonCodes.push("quality_decision_missing_or_invalid");
  }
  if (evidence?.validationReport && (
    evidence.validationReport.target.targetDigest !== evidence.artifact.digest ||
    (evidence.validationReport.target.targetId !== undefined && evidence.validationReport.target.targetId !== evidence.artifact.id) ||
    (evidence.validationReport.target.targetVersion !== undefined && evidence.validationReport.target.targetVersion !== evidence.artifact.version)
  )) {
    reasonCodes.push("validation_target_mismatch");
  }
  if (evidence?.qualityDecision && (
    evidence.qualityDecision.target.artifactId !== evidence.artifact.id ||
    evidence.qualityDecision.target.artifactVersion !== evidence.artifact.version ||
    evidence.qualityDecision.target.artifactDigest !== evidence.artifact.digest
  )) {
    reasonCodes.push("quality_target_mismatch");
  }
  if (evidence?.validationReport && evidence?.qualityDecision &&
    !evidence.qualityDecision.validationReportDigests.includes(evidence.validationReport.reportDigest)) {
    reasonCodes.push("quality_validation_binding_mismatch");
  }
  return { allowed: reasonCodes.length === 0, reasonCodes };
}

export function createRunCheckpoint(input: Omit<RunCheckpoint, "checkpointId" | "status" | "createdAt"> & {
  checkpointId?: string;
  createdAt?: string;
}): RunCheckpoint {
  return {
    ...input,
    checkpointId: input.checkpointId ?? randomUUID(),
    status: "paused",
    observationRefs: [...new Set(input.observationRefs)].sort(),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function applyTeacherRevision(input: {
  projectId: string;
  plan: WorkingPlan;
  revisedStage: string;
  newGoal?: string;
}) {
  const stageIndex = input.plan.steps.findIndex((step) => step.stage === input.revisedStage);
  if (stageIndex < 0) throw new Error(`Unknown revised stage: ${input.revisedStage}`);
  const invalidatedStages = new Set(input.plan.steps.slice(stageIndex).map((step) => step.stage));
  return {
    plan: {
      ...input.plan,
      planVersion: input.plan.planVersion + 1,
      goal: input.newGoal?.trim() || input.plan.goal,
      steps: input.plan.steps.map((step, index) => index < stageIndex ? step : {
        ...step,
        status: (index === stageIndex ? "active" : "stale") as "active" | "stale",
      }),
      reportRefs: input.plan.reportRefs.filter((ref) => !invalidatedStages.has(ref.stage)),
      decisionRefs: input.plan.decisionRefs.filter((ref) => !invalidatedStages.has(ref.stage)),
    },
    invalidatedReportRefs: input.plan.reportRefs.filter((ref) => invalidatedStages.has(ref.stage)).map((ref) => ref.id),
    invalidatedDecisionRefs: input.plan.decisionRefs.filter((ref) => invalidatedStages.has(ref.stage)).map((ref) => ref.id),
    observation: createAgentObservation({
      projectId: input.projectId,
      source: "teacher_revision",
      status: "repair",
      actionKey: `revise:${input.revisedStage}`,
      inputHash: hashRunInput({ planId: input.plan.planId, planVersion: input.plan.planVersion + 1, stage: input.revisedStage, goal: input.newGoal }),
      reasonCodes: ["teacher_revised_upstream"],
      reportRefs: [],
      targetLocators: [],
      responsibleStage: input.revisedStage,
      minimalNextAction: "repair_upstream",
      teacherSafeSummary: "已按你的修改回到相关阶段，后续内容会重新核对。",
    }),
  };
}

export function requiresWorkingPlan(input: { interactionKind: "chat" | "single_tool" | "multi_step"; actionCount: number }) {
  return input.interactionKind === "multi_step" && input.actionCount > 1;
}

export function appendAgentObservationMetadata(metadata: unknown, observation: AgentObservation) {
  const base = isRecord(metadata) ? metadata : {};
  const existing = readAgentObservationsFromMetadata(base);
  return {
    ...base,
    agentObservations: [...existing.filter((item) => item.observationId !== observation.observationId), observation],
  };
}

export function readAgentObservationsFromMetadata(metadata: unknown): AgentObservation[] {
  if (!isRecord(metadata) || !Array.isArray(metadata.agentObservations)) return [];
  return metadata.agentObservations.filter(isAgentObservation);
}

export function readAgentObservationsFromMessages(messages: Array<{ metadata?: unknown }>) {
  return messages.flatMap((message) => readAgentObservationsFromMetadata(message.metadata));
}

export function appendRunCheckpointMetadata(metadata: unknown, checkpoint: RunCheckpoint) {
  const base = isRecord(metadata) ? metadata : {};
  return { ...base, agentRunCheckpoint: checkpoint };
}

export function clearRunCheckpointMetadata(metadata: unknown) {
  const base = isRecord(metadata) ? metadata : {};
  return { ...base, agentRunCheckpoint: null };
}

export function readRunCheckpointFromMetadata(metadata: unknown): RunCheckpoint | null {
  if (!isRecord(metadata) || !isRunCheckpoint(metadata.agentRunCheckpoint)) return null;
  return metadata.agentRunCheckpoint;
}

export function readLatestRunCheckpointFromMessages(messages: Array<{ metadata?: unknown }>) {
  for (const message of [...messages].reverse()) {
    if (isRecord(message.metadata) && Object.prototype.hasOwnProperty.call(message.metadata, "agentRunCheckpoint") && message.metadata.agentRunCheckpoint === null) {
      return null;
    }
    const checkpoint = readRunCheckpointFromMetadata(message.metadata);
    if (checkpoint) return checkpoint;
  }
  return null;
}

function pauseDecision(
  input: { projectId: string; planVersion: number; candidate: { actionKey: string; inputHash: string }; observationHistory: AgentObservation[] },
  reason: RunCheckpoint["reason"],
) {
  return {
    allowed: false,
    nextAction: "pause" as const,
    reasonCodes: [reason],
    checkpoint: createRunCheckpoint({
      projectId: input.projectId,
      planVersion: input.planVersion,
      reason,
      actionKey: input.candidate.actionKey,
      inputHash: input.candidate.inputHash,
      observationRefs: input.observationHistory.map((observation) => observation.observationId),
    }),
  };
}

function countConsecutiveSameFailure(history: AgentObservation[], signature: string) {
  let count = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].failureSignature !== signature) break;
    count += 1;
  }
  return count;
}

function normalizeLocators(locators: TargetLocator[]) {
  const byDigest = new Map(locators.map((locator) => [hashRunInput(locator), locator]));
  return [...byDigest.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, locator]) => locator);
}

function isAgentObservation(value: unknown): value is AgentObservation {
  return isRecord(value) &&
    typeof value.observationId === "string" &&
    typeof value.projectId === "string" &&
    isObservationSource(value.source) &&
    isObservationStatus(value.status) &&
    typeof value.actionKey === "string" &&
    typeof value.inputHash === "string" &&
    Array.isArray(value.reasonCodes) && value.reasonCodes.every((reason) => typeof reason === "string") &&
    Array.isArray(value.reportRefs) && value.reportRefs.every(isReportRef) &&
    Array.isArray(value.targetLocators) &&
    isReActNextAction(value.minimalNextAction) && value.minimalNextAction !== "finish" &&
    typeof value.teacherSafeSummary === "string" &&
    (value.failureSignature === undefined || typeof value.failureSignature === "string") &&
    typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt));
}

function isRunCheckpoint(value: unknown): value is RunCheckpoint {
  return isRecord(value) &&
    typeof value.checkpointId === "string" &&
    typeof value.projectId === "string" &&
    Number.isInteger(value.planVersion) && Number(value.planVersion) >= 0 &&
    value.status === "paused" &&
    (value.reason === "budget_exhausted" || value.reason === "repeated_failure" || value.reason === "teacher_requested_pause") &&
    (value.actionKey === undefined || typeof value.actionKey === "string") &&
    (value.inputHash === undefined || typeof value.inputHash === "string") &&
    Array.isArray(value.observationRefs) && value.observationRefs.every((ref) => typeof ref === "string") &&
    typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt));
}

function isObservationSource(value: unknown): value is AgentObservation["source"] {
  return value === "tool" || value === "validation" || value === "quality" || value === "budget" || value === "teacher_revision";
}

function isObservationStatus(value: unknown): value is AgentObservation["status"] {
  return value === "succeeded" || value === "failed" || value === "needs_input" || value === "repair" || value === "blocked" || value === "inconclusive";
}

function isReportRef(value: unknown): value is AgentObservation["reportRefs"][number] {
  return isRecord(value) &&
    (value.kind === "validation" || value.kind === "critic" || value.kind === "quality_decision") &&
    typeof value.id === "string" &&
    typeof value.digest === "string";
}

function isReActNextAction(value: unknown): value is ReActNextAction {
  return value === "continue" || value === "repair_unit" || value === "repair_upstream" || value === "ask_teacher" || value === "pause" || value === "finish";
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
