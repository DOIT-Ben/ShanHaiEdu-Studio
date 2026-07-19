import { createHash } from "node:crypto";

export function digestOrchestrationAuditEvent(event: object, domain: string) {
  return createHash("sha256")
    .update(`${domain}\0`, "utf8")
    .update(canonicalJson(orchestrationAuditEventDigestPayload(event)), "utf8")
    .digest("hex");
}

export function orchestrationAuditEventDigestPayload(event: object) {
  const source = event as Record<string, unknown>;
  return {
    eventId: value(source, "eventId"),
    attemptId: value(source, "attemptId"),
    recordType: value(source, "recordType"),
    outcome: value(source, "outcome"),
    operationKind: value(source, "operationKind"),
    authority: value(source, "authority"),
    claimedProjectId: value(source, "claimedProjectId"),
    resolvedProjectId: value(source, "resolvedProjectId"),
    actorUserId: value(source, "actorUserId"),
    actorAuthMode: value(source, "actorAuthMode"),
    authSessionDigest: value(source, "authSessionDigest"),
    taskId: value(source, "taskId"),
    turnJobId: value(source, "turnJobId"),
    teacherMessageId: value(source, "teacherMessageId"),
    toolInvocationId: value(source, "toolInvocationId"),
    intentEpoch: value(source, "intentEpoch"),
    planRevision: value(source, "planRevision"),
    planId: value(source, "planId"),
    toolOrdinal: value(source, "toolOrdinal"),
    toolName: value(source, "toolName"),
    actionDigest: value(source, "actionDigest"),
    idempotencyKey: value(source, "idempotencyKey"),
    observationId: value(source, "observationId"),
    invocationStatus: value(source, "invocationStatus"),
    executionEnvelopeDigest: value(source, "executionEnvelopeDigest"),
    requestDigest: value(source, "requestDigest"),
    reasonCode: value(source, "reasonCode"),
    payloadJson: value(source, "payloadJson"),
    occurredAt: normalizeOccurredAt(source.occurredAt),
  };
}

function value(source: Record<string, unknown>, key: string) {
  return source[key] ?? null;
}

function normalizeOccurredAt(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) throw new Error("orchestration_audit_timestamp_invalid");
  return date.toISOString();
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`).join(",")}}`;
}
