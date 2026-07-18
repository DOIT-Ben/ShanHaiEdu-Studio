import { createHash } from "node:crypto";

import {
  projectV1_9OrchestrationAuthoritySummary,
  type V1_9RunState,
} from "../../scripts/lib/v1-9-e2e-contract.mjs";

export function projectReadyV1_9Authority(state: V1_9RunState) {
  const lock = state.taskContractLock;
  const { actorUserId, projectId, taskId, intentEpoch } = state.identity;
  const planRevision = state.ledger.currentPlanRevision;
  if (!lock || !actorUserId || !projectId || !taskId || intentEpoch === null || planRevision === null) {
    throw new Error("v1_9_authority_fixture_task_binding_missing");
  }
  const publicSummary = {
    schemaVersion: "orchestration-authority-summary.v1",
    subject: {
      projectId,
      actorUserId,
      taskId,
      taskBriefDigest: lock.taskBriefDigest,
      intentEpoch,
      teacherMessageId: lock.teacherMessageId,
      turnJobId: lock.turnJobId,
      planId: state.orchestrationAuthoritySummary?.subject.planId ?? "plan-fixture",
      planRevision,
    },
    windowStartSequence: 1,
    watermark: 4,
    eventCount: 4,
    attemptCount: 2,
    resolvedCount: 2,
    openAttemptCount: 0,
    toolClaimCount: 0,
    toolTerminalCount: 0,
    mainAgentToolCount: 0,
    nonMainAgentToolCount: 0,
    firstToolOrdinal: null,
    lastToolOrdinal: null,
    toolOrdinalsContiguous: true,
    authorities: ["teacher_http"],
    violationReasonCodes: [],
    factsDigest: "4".repeat(64),
    complete: true,
    readyEligible: true,
  };
  const summary = {
    ...publicSummary,
    summaryDigest: createHash("sha256")
      .update("shanhai-orchestration-authority-summary.v1\0", "utf8")
      .update(canonicalJson(publicSummary), "utf8")
      .digest("hex"),
  };
  return projectV1_9OrchestrationAuthoritySummary(state, {
    summary,
    projectedAt: state.updatedAt,
    requireReady: true,
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`).join(",")}}`;
}
