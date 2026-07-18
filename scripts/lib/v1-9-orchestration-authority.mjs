import { createHash } from "node:crypto";

const SUMMARY_VERSION = "orchestration-authority-summary.v1";
const SUMMARY_DIGEST_DOMAIN = "shanhai-orchestration-authority-summary.v1";

const summaryFields = [
  "schemaVersion",
  "subject",
  "windowStartSequence",
  "watermark",
  "eventCount",
  "attemptCount",
  "resolvedCount",
  "openAttemptCount",
  "toolClaimCount",
  "toolTerminalCount",
  "mainAgentToolCount",
  "nonMainAgentToolCount",
  "firstToolOrdinal",
  "lastToolOrdinal",
  "toolOrdinalsContiguous",
  "authorities",
  "violationReasonCodes",
  "factsDigest",
  "complete",
  "readyEligible",
  "summaryDigest",
];

const subjectFields = [
  "projectId",
  "actorUserId",
  "taskId",
  "taskBriefDigest",
  "intentEpoch",
  "teacherMessageId",
  "turnJobId",
  "planId",
  "planRevision",
];

export function normalizeV1_9OrchestrationAuthoritySummary(value) {
  try {
    const summary = requiredRecord(value);
    assertOnlyFields(summary, summaryFields);
    if (summary.schemaVersion !== SUMMARY_VERSION) throw new Error("version");
    const subject = normalizeSubject(summary.subject, { requireTask: false });
    const windowStartSequence = requiredNonNegativeInteger(summary.windowStartSequence);
    const watermark = requiredNonNegativeInteger(summary.watermark);
    if (watermark < windowStartSequence) throw new Error("watermark");
    const eventCount = requiredNonNegativeInteger(summary.eventCount);
    const attemptCount = requiredNonNegativeInteger(summary.attemptCount);
    const resolvedCount = requiredNonNegativeInteger(summary.resolvedCount);
    const openAttemptCount = requiredNonNegativeInteger(summary.openAttemptCount);
    const toolClaimCount = requiredNonNegativeInteger(summary.toolClaimCount);
    const toolTerminalCount = requiredNonNegativeInteger(summary.toolTerminalCount);
    const mainAgentToolCount = requiredNonNegativeInteger(summary.mainAgentToolCount);
    const nonMainAgentToolCount = requiredNonNegativeInteger(summary.nonMainAgentToolCount);
    if (eventCount < attemptCount || resolvedCount > eventCount || openAttemptCount > attemptCount ||
        toolClaimCount > eventCount || toolTerminalCount > eventCount ||
        mainAgentToolCount + nonMainAgentToolCount !== toolClaimCount) {
      throw new Error("counts");
    }
    const firstToolOrdinal = optionalPositiveInteger(summary.firstToolOrdinal);
    const lastToolOrdinal = optionalPositiveInteger(summary.lastToolOrdinal);
    if ((firstToolOrdinal === null) !== (lastToolOrdinal === null) ||
        (firstToolOrdinal !== null && lastToolOrdinal < firstToolOrdinal)) {
      throw new Error("ordinals");
    }
    const toolOrdinalsContiguous = requiredBoolean(summary.toolOrdinalsContiguous);
    const authorities = normalizeSortedTextSet(summary.authorities);
    const violationReasonCodes = normalizeSortedTextSet(summary.violationReasonCodes);
    const complete = requiredBoolean(summary.complete);
    const readyEligible = requiredBoolean(summary.readyEligible);
    if (readyEligible && (!complete || violationReasonCodes.length !== 0 || nonMainAgentToolCount !== 0 ||
        !toolOrdinalsContiguous)) {
      throw new Error("ready");
    }
    const publicSummary = {
      schemaVersion: SUMMARY_VERSION,
      subject,
      windowStartSequence,
      watermark,
      eventCount,
      attemptCount,
      resolvedCount,
      openAttemptCount,
      toolClaimCount,
      toolTerminalCount,
      mainAgentToolCount,
      nonMainAgentToolCount,
      firstToolOrdinal,
      lastToolOrdinal,
      toolOrdinalsContiguous,
      authorities,
      violationReasonCodes,
      factsDigest: requiredDigest(summary.factsDigest),
      complete,
      readyEligible,
    };
    const summaryDigest = requiredDigest(summary.summaryDigest);
    if (summaryDigest !== digestDomain(SUMMARY_DIGEST_DOMAIN, publicSummary)) throw new Error("summaryDigest");
    return Object.freeze({ ...publicSummary, summaryDigest });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("v1_9_")) throw error;
    throw new Error("v1_9_orchestration_authority_summary_invalid", { cause: error });
  }
}

export function normalizeV1_9OrchestrationAuthoritySubject(value) {
  try {
    return normalizeSubject(value, { requireTask: true });
  } catch (error) {
    throw new Error("v1_9_orchestration_authority_subject_invalid", { cause: error });
  }
}

export function assertV1_9OrchestrationAuthorityProjection({
  actual,
  projected = null,
  expectedSubject,
  requireReady = false,
}) {
  if (actual === null || actual === undefined) {
    throw new Error("v1_9_orchestration_authority_summary_missing");
  }
  const normalized = normalizeV1_9OrchestrationAuthoritySummary(actual);
  const subject = normalizeV1_9OrchestrationAuthoritySubject(expectedSubject);
  if (JSON.stringify(normalized.subject) !== JSON.stringify(subject)) {
    throw new Error("v1_9_orchestration_authority_subject_mismatch");
  }
  if (projected !== null && projected !== undefined) {
    const previous = normalizeV1_9OrchestrationAuthoritySummary(projected);
    if (!sameFrozenSubject(previous.subject, subject) || previous.subject.planRevision > normalized.subject.planRevision) {
      throw new Error("v1_9_orchestration_authority_subject_mismatch");
    }
    if (normalized.windowStartSequence !== previous.windowStartSequence) {
      throw new Error("v1_9_orchestration_authority_window_drift");
    }
    if (normalized.watermark < previous.watermark) {
      throw new Error("v1_9_orchestration_authority_watermark_regression");
    }
    if (normalized.watermark === previous.watermark &&
        (normalized.summaryDigest !== previous.summaryDigest || normalized.factsDigest !== previous.factsDigest)) {
      throw new Error("v1_9_orchestration_authority_digest_drift");
    }
  }
  if (requireReady && (!normalized.complete || !normalized.readyEligible ||
      normalized.openAttemptCount !== 0 || normalized.violationReasonCodes.length !== 0)) {
    throw new Error("v1_9_orchestration_authority_not_ready");
  }
  return normalized;
}

function sameFrozenSubject(left, right) {
  return subjectFields.every((field) => field === "planRevision" || left[field] === right[field]);
}

function normalizeSubject(value, { requireTask }) {
  const subject = requiredRecord(value);
  assertOnlyFields(subject, subjectFields);
  const normalized = {
    projectId: requiredText(subject.projectId),
    actorUserId: requiredText(subject.actorUserId),
    taskId: optionalText(subject.taskId),
    taskBriefDigest: optionalDigest(subject.taskBriefDigest),
    intentEpoch: requiredNonNegativeInteger(subject.intentEpoch),
    teacherMessageId: optionalText(subject.teacherMessageId),
    turnJobId: optionalText(subject.turnJobId),
    planId: optionalText(subject.planId),
    planRevision: subject.planRevision === null ? null : requiredNonNegativeInteger(subject.planRevision),
  };
  const taskValues = [
    normalized.taskId,
    normalized.taskBriefDigest,
    normalized.teacherMessageId,
    normalized.turnJobId,
    normalized.planId,
    normalized.planRevision,
  ];
  if (requireTask && taskValues.some((entry) => entry === null)) throw new Error("subject");
  return Object.freeze(normalized);
}

function requiredRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("record");
  return value;
}

function assertOnlyFields(value, allowed) {
  if (Object.keys(value).length !== allowed.length || Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error("fields");
  }
}

function requiredText(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > 500) throw new Error("text");
  return normalized;
}

function requiredDigest(value) {
  const normalized = requiredText(value).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error("digest");
  return normalized;
}

function optionalText(value) {
  return value === null ? null : requiredText(value);
}

function optionalDigest(value) {
  return value === null ? null : requiredDigest(value);
}

function requiredNonNegativeInteger(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("integer");
  return value;
}

function requiredPositiveInteger(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("integer");
  return value;
}

function optionalPositiveInteger(value) {
  return value === null ? null : requiredPositiveInteger(value);
}

function requiredBoolean(value) {
  if (typeof value !== "boolean") throw new Error("boolean");
  return value;
}

function normalizeSortedTextSet(value) {
  if (!Array.isArray(value)) throw new Error("array");
  const normalized = value.map(requiredText);
  if (new Set(normalized).size !== normalized.length ||
      normalized.some((entry, index) => index > 0 && compareText(normalized[index - 1], entry) >= 0)) {
    throw new Error("set");
  }
  return Object.freeze(normalized);
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
  return `{${Object.keys(value).sort(compareText)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
