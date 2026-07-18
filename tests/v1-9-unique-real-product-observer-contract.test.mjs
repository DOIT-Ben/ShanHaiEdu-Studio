import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  assertV1_9OrchestrationAuthorityProjection,
  normalizeV1_9OrchestrationAuthoritySummary,
} from "../scripts/lib/v1-9-orchestration-authority.mjs";

const digest = (character) => character.repeat(64);

test("V1-9 accepts a complete ready product authority summary bound to the frozen task", () => {
  const summary = authoritySummary();

  assert.deepEqual(normalizeV1_9OrchestrationAuthoritySummary(summary), summary);
  assert.deepEqual(assertV1_9OrchestrationAuthorityProjection({
    actual: summary,
    projected: null,
    expectedSubject: summary.subject,
    requireReady: true,
  }), summary);
});

test("V1-9 rejects missing summaries, subject drift, and non-ready product authority", () => {
  const summary = authoritySummary();
  assert.throws(() => assertV1_9OrchestrationAuthorityProjection({
    actual: null,
    projected: null,
    expectedSubject: summary.subject,
    requireReady: true,
  }), /v1_9_orchestration_authority_summary_missing/);
  assert.throws(() => assertV1_9OrchestrationAuthorityProjection({
    actual: authoritySummary({ subject: { ...summary.subject, taskId: "task-other" } }),
    projected: null,
    expectedSubject: summary.subject,
    requireReady: true,
  }), /v1_9_orchestration_authority_subject_mismatch/);

  for (const actual of [
    authoritySummary({
      resolvedCount: 1,
      openAttemptCount: 1,
      complete: false,
      readyEligible: false,
      violationReasonCodes: ["open_attempt"],
    }),
    authoritySummary({ violationReasonCodes: ["unclassified_external_mutation"], readyEligible: false }),
    authoritySummary({ complete: false, readyEligible: false }),
    authoritySummary({ readyEligible: false }),
  ]) {
    assert.throws(() => assertV1_9OrchestrationAuthorityProjection({
      actual,
      projected: null,
      expectedSubject: summary.subject,
      requireReady: true,
    }), /v1_9_orchestration_authority_not_ready/);
  }
});

test("V1-9 requires monotonic authority watermarks and stable digests at the same watermark", () => {
  const projected = authoritySummary({ watermark: 8 });
  assert.throws(() => assertV1_9OrchestrationAuthorityProjection({
    actual: authoritySummary({ watermark: 7 }),
    projected,
    expectedSubject: projected.subject,
    requireReady: true,
  }), /v1_9_orchestration_authority_watermark_regression/);
  assert.throws(() => assertV1_9OrchestrationAuthorityProjection({
    actual: authoritySummary({
      watermark: 8,
      eventCount: 6,
      attemptCount: 3,
      resolvedCount: 3,
      factsDigest: digest("9"),
    }),
    projected,
    expectedSubject: projected.subject,
    requireReady: true,
  }), /v1_9_orchestration_authority_digest_drift/);

  const advanced = authoritySummary({
    subject: { ...projected.subject, planRevision: 1 },
    watermark: 9,
    eventCount: 6,
    attemptCount: 3,
    resolvedCount: 3,
    factsDigest: digest("a"),
  });
  assert.deepEqual(assertV1_9OrchestrationAuthorityProjection({
    actual: advanced,
    projected,
    expectedSubject: advanced.subject,
    requireReady: true,
  }), advanced);
  assert.throws(() => assertV1_9OrchestrationAuthorityProjection({
    actual: projected,
    projected: advanced,
    expectedSubject: projected.subject,
  }), /v1_9_orchestration_authority_subject_mismatch/);
});

test("V1-9 normalization rejects unknown fields and inconsistent aggregate counts", () => {
  const summary = authoritySummary();
  assert.throws(
    () => normalizeV1_9OrchestrationAuthoritySummary({ ...summary, browserLedgerCount: 0 }),
    /v1_9_orchestration_authority_summary_invalid/,
  );
  assert.throws(
    () => normalizeV1_9OrchestrationAuthoritySummary({ ...summary, resolvedCount: summary.attemptCount + 1 }),
    /v1_9_orchestration_authority_summary_invalid/,
  );
  assert.throws(
    () => normalizeV1_9OrchestrationAuthoritySummary({ ...summary, authorities: ["teacher_http", "teacher_http"] }),
    /v1_9_orchestration_authority_summary_invalid/,
  );
  assert.throws(
    () => normalizeV1_9OrchestrationAuthoritySummary({ ...summary, readyEligible: false }),
    /v1_9_orchestration_authority_summary_invalid/,
  );
  const fresh = authoritySummary({
    subject: {
      projectId: "project-1",
      actorUserId: "teacher-1",
      taskId: null,
      taskBriefDigest: null,
      intentEpoch: 0,
      teacherMessageId: null,
      turnJobId: null,
      planId: null,
      planRevision: null,
    },
    windowStartSequence: 0,
    watermark: 0,
    eventCount: 0,
    attemptCount: 0,
    resolvedCount: 0,
    authorities: [],
    violationReasonCodes: ["task_aggregate_binding_invalid"],
    complete: false,
    readyEligible: false,
  });
  assert.deepEqual(normalizeV1_9OrchestrationAuthoritySummary(fresh), fresh);
  const invalidAggregate = authoritySummary({
    ...fresh,
    subject: { ...fresh.subject, planId: "plan-invalid", planRevision: 0 },
  });
  assert.deepEqual(normalizeV1_9OrchestrationAuthoritySummary(invalidAggregate), invalidAggregate);
});

function authoritySummary(overrides = {}) {
  const publicOverrides = { ...overrides };
  delete publicOverrides.summaryDigest;
  const publicSummary = {
    schemaVersion: "orchestration-authority-summary.v1",
    subject: {
      projectId: "project-1",
      actorUserId: "teacher-1",
      taskId: "task-1",
      taskBriefDigest: digest("1"),
      intentEpoch: 0,
      teacherMessageId: "teacher-message-1",
      turnJobId: "turn-job-1",
      planId: "plan-1",
      planRevision: 0,
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
    factsDigest: digest("2"),
    complete: true,
    readyEligible: true,
    ...publicOverrides,
  };
  return {
    ...publicSummary,
    summaryDigest: digestDomain("shanhai-orchestration-authority-summary.v1", publicSummary),
  };
}

function digestDomain(domain, value) {
  return createHash("sha256")
    .update(`${domain}\0`, "utf8")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}
