import { createHash, randomUUID } from "node:crypto";

import { prisma } from "@/server/db/client";
import { digestOrchestrationAuditEvent } from "@/server/conversation/orchestration-audit-event-digest";
import {
  findOrchestrationIngressClassification,
  normalizeWriteMethod,
  resolveOrchestrationIngressOperation,
  safeProjectId,
  type OrchestrationIngressControlImpact,
  type OrchestrationIngressOperation,
  type OrchestrationIngressWriteMethod,
} from "./orchestration-ingress-route";

export { resolveOrchestrationIngressOperation } from "./orchestration-ingress-route";
export type {
  OrchestrationIngressControlImpact,
  OrchestrationIngressOperation,
} from "./orchestration-ingress-route";

type WriteMethod = OrchestrationIngressWriteMethod;
type AuditRecordType = "attempted" | "resolved";
type AuditOutcome = "committed" | "rejected" | "failed" | null;
type AuditReasonCode = "http_2xx" | "http_3xx" | "http_4xx" | "http_5xx" | "handler_exception" | null;
type OrchestrationIngressAuditSchemaVersion =
  | "orchestration-ingress-audit.v1"
  | "orchestration-ingress-audit.v2";

const INGRESS_AUDIT_V1 = "orchestration-ingress-audit.v1" as const;
const INGRESS_AUDIT_V2 = "orchestration-ingress-audit.v2" as const;

type OrchestrationIngressPayload = {
  schemaVersion?: typeof INGRESS_AUDIT_V2;
  operation: OrchestrationIngressOperation;
  routeTemplate: string;
  method: WriteMethod;
  controlImpact: OrchestrationIngressControlImpact;
  httpStatus: number | null;
};

type ParsedOrchestrationIngressPayload = Omit<OrchestrationIngressPayload, "schemaVersion"> & {
  schemaVersion: OrchestrationIngressAuditSchemaVersion;
};

export type OrchestrationIngressAuditEventInput = {
  eventId: string;
  attemptId: string;
  recordType: AuditRecordType;
  outcome: AuditOutcome;
  operationKind: "external_mutation";
  authority: "teacher_http";
  claimedProjectId: string | null;
  resolvedProjectId: string | null;
  actorUserId: string;
  actorAuthMode: "local" | "password" | "oauth" | "sso";
  authSessionDigest: string | null;
  teacherMessageId: string | null;
  reasonCode: AuditReasonCode;
  payloadJson: string;
  eventDigest: string;
  occurredAt: string;
};

export type OrchestrationIngressAuditEvent = OrchestrationIngressAuditEventInput & {
  sequence: number;
};

export type OrchestrationIngressAuditStore = {
  append(event: OrchestrationIngressAuditEventInput): Promise<OrchestrationIngressAuditEvent>;
};

export const prismaOrchestrationIngressAuditStore: OrchestrationIngressAuditStore = {
  async append(event) {
    const delegate = (prisma as unknown as {
      orchestrationAuditEvent?: {
        create(input: { data: Record<string, unknown> }): Promise<{ sequence: number }>;
      };
    }).orchestrationAuditEvent;
    if (!delegate) throw new Error("orchestration_audit_store_unavailable");
    const row = await delegate.create({
      data: {
        ...event,
        occurredAt: new Date(event.occurredAt),
      },
    });
    if (!Number.isSafeInteger(row.sequence) || row.sequence < 1) {
      throw new Error("orchestration_audit_sequence_invalid");
    }
    return Object.freeze({ ...event, sequence: row.sequence });
  },
};

export async function runWithOrchestrationIngressAudit(input: {
  request: Request;
  identity: {
    actorUserId: string;
    actorAuthMode: OrchestrationIngressAuditEventInput["actorAuthMode"];
    authSessionId: string | null;
  };
  handler(): Promise<Response>;
  store?: OrchestrationIngressAuditStore;
  randomId?: () => string;
  now?: () => Date;
}) {
  const route = resolveOrchestrationIngressOperation(input.request);
  if (!route) return input.handler();

  const store = input.store ?? prismaOrchestrationIngressAuditStore;
  const createId = input.randomId ?? randomUUID;
  const now = input.now ?? (() => new Date());
  const attemptId = requiredId(createId());
  const identity = {
    attemptId,
    operationKind: "external_mutation" as const,
    authority: "teacher_http" as const,
    claimedProjectId: route.claimedProjectId,
    actorUserId: requiredId(input.identity.actorUserId),
    actorAuthMode: input.identity.actorAuthMode,
    authSessionDigest: input.identity.authSessionId ? sha256(input.identity.authSessionId) : null,
    teacherMessageId: null,
  };
  const attempted = createEvent({
    ...identity,
    eventId: requiredId(createId()),
    recordType: "attempted",
    outcome: null,
    resolvedProjectId: null,
    reasonCode: null,
    payloadJson: createPayloadJson(route, normalizeWriteMethod(input.request.method)!, null),
    occurredAt: timestamp(now()),
  });
  await store.append(attempted);

  let response: Response;
  try {
    response = await input.handler();
  } catch (error) {
    await store.append(createEvent({
      ...identity,
      eventId: requiredId(createId()),
      recordType: "resolved",
      outcome: "failed",
      resolvedProjectId: null,
      reasonCode: "handler_exception",
      teacherMessageId: null,
      payloadJson: createPayloadJson(route, normalizeWriteMethod(input.request.method)!, null),
      occurredAt: timestamp(now()),
    }));
    throw error;
  }

  const classification = classifyResponse(response.status);
  const resolvedProjectId = route.operation === "project_create" && classification.outcome === "committed"
    ? await readCreatedProjectId(response)
    : route.claimedProjectId;
  const teacherMessageId = route.operation === "teacher_message_submit" && classification.outcome === "committed"
    ? await readSubmittedTeacherMessageId(response)
    : null;
  if (route.operation === "project_create" && classification.outcome === "committed" && !resolvedProjectId) {
    throw new Error("orchestration_audit_project_resolution_failed");
  }
  if (route.operation === "teacher_message_submit" && classification.outcome === "committed" && !teacherMessageId) {
    throw new Error("orchestration_audit_teacher_message_resolution_failed");
  }
  await store.append(createEvent({
    ...identity,
    eventId: requiredId(createId()),
    recordType: "resolved",
    outcome: classification.outcome,
    resolvedProjectId,
    teacherMessageId,
    reasonCode: classification.reasonCode,
    payloadJson: createPayloadJson(route, normalizeWriteMethod(input.request.method)!, response.status),
    occurredAt: timestamp(now()),
  }));
  return response;
}

export function evaluateOrchestrationIngressAudit(events: readonly OrchestrationIngressAuditEvent[]) {
  const attempts = new Map<string, OrchestrationIngressAuditEvent[]>();
  for (const event of events) {
    const entries = attempts.get(event.attemptId) ?? [];
    entries.push(event);
    attempts.set(event.attemptId, entries);
  }

  const openAttemptIds: string[] = [];
  const invalidAttemptIds: string[] = [];
  let resolvedCount = 0;
  for (const [attemptId, source] of attempts) {
    const entries = [...source].sort((left, right) => left.sequence - right.sequence);
    const attempted = entries.find((event) => event.recordType === "attempted");
    const resolved = entries.find((event) => event.recordType === "resolved");
    const duplicateRecordType = new Set(entries.map((event) => event.recordType)).size !== entries.length;
    if (!attempted || duplicateRecordType || entries.length > 2 || !isValidEvent(attempted) || attempted.outcome !== null) {
      invalidAttemptIds.push(attemptId);
      continue;
    }
    if (!resolved) {
      openAttemptIds.push(attemptId);
      continue;
    }
    if (resolved.sequence <= attempted.sequence || !isValidEvent(resolved) || resolved.outcome === null ||
        !sameAttemptIdentity(attempted, resolved)) {
      invalidAttemptIds.push(attemptId);
      continue;
    }
    resolvedCount += 1;
  }
  openAttemptIds.sort();
  invalidAttemptIds.sort();
  return {
    go: openAttemptIds.length === 0 && invalidAttemptIds.length === 0,
    attemptCount: attempts.size,
    resolvedCount,
    openAttemptIds,
    invalidAttemptIds,
  };
}

function createEvent(input: Omit<OrchestrationIngressAuditEventInput, "eventDigest">): OrchestrationIngressAuditEventInput {
  const event = { ...input, eventDigest: "" } as OrchestrationIngressAuditEventInput;
  const payload = parsePayload(event.payloadJson);
  if (!payload) throw new Error("orchestration_audit_payload_invalid");
  return Object.freeze({ ...event, eventDigest: digestEvent(event, payload.schemaVersion) });
}

function digestEvent(
  event: OrchestrationIngressAuditEventInput | OrchestrationIngressAuditEvent,
  schemaVersion: OrchestrationIngressAuditSchemaVersion,
) {
  if (schemaVersion === INGRESS_AUDIT_V2) {
    return digestOrchestrationAuditEvent(event, "shanhai-orchestration-audit-event.v2");
  }
  const payload = {
    eventId: event.eventId,
    attemptId: event.attemptId,
    recordType: event.recordType,
    outcome: event.outcome,
    operationKind: event.operationKind,
    authority: event.authority,
    claimedProjectId: event.claimedProjectId,
    resolvedProjectId: event.resolvedProjectId,
    actorUserId: event.actorUserId,
    actorAuthMode: event.actorAuthMode,
    authSessionDigest: event.authSessionDigest,
    reasonCode: event.reasonCode,
    payloadJson: event.payloadJson,
    occurredAt: normalizeOccurredAt(event.occurredAt),
  };
  return createHash("sha256")
    .update("shanhai-orchestration-audit-event.v1\0", "utf8")
    .update(canonicalJson(payload), "utf8")
    .digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`).join(",")}}`;
}

function isValidEvent(event: OrchestrationIngressAuditEvent) {
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) return false;
  const payload = parsePayload(event.payloadJson);
  return payload !== null && hasValidExternalEventCore(event) &&
    hasValidExternalRecordSemantics(event, payload) && hasValidTeacherMessageBinding(event, payload) &&
    event.eventDigest === digestEvent(event, payload.schemaVersion);
}

function sameAttemptIdentity(left: OrchestrationIngressAuditEvent, right: OrchestrationIngressAuditEvent) {
  const sameColumns = [
    "attemptId", "operationKind", "authority", "actorUserId", "actorAuthMode",
    "authSessionDigest", "claimedProjectId",
  ].every((field) => left[field as keyof OrchestrationIngressAuditEvent] === right[field as keyof OrchestrationIngressAuditEvent]);
  const leftPayload = parsePayload(left.payloadJson);
  const rightPayload = parsePayload(right.payloadJson);
  return sameColumns && leftPayload !== null && rightPayload !== null &&
    leftPayload.schemaVersion === rightPayload.schemaVersion &&
    leftPayload.operation === rightPayload.operation &&
    leftPayload.routeTemplate === rightPayload.routeTemplate &&
    leftPayload.method === rightPayload.method &&
    leftPayload.controlImpact === rightPayload.controlImpact;
}

function createPayloadJson(
  route: ReturnType<typeof resolveOrchestrationIngressOperation> & {},
  method: WriteMethod,
  httpStatus: number | null,
) {
  const payload: OrchestrationIngressPayload = {
    schemaVersion: INGRESS_AUDIT_V2,
    operation: route.operation,
    routeTemplate: route.routeTemplate,
    method,
    controlImpact: route.controlImpact,
    httpStatus,
  };
  return JSON.stringify(payload);
}

function classifyResponse(status: number) {
  if (status >= 200 && status < 300) return { outcome: "committed" as const, reasonCode: "http_2xx" as const };
  if (status >= 300 && status < 400) return { outcome: "rejected" as const, reasonCode: "http_3xx" as const };
  if (status >= 400 && status < 500) return { outcome: "rejected" as const, reasonCode: "http_4xx" as const };
  return { outcome: "failed" as const, reasonCode: "http_5xx" as const };
}

async function readCreatedProjectId(response: Response) {
  try {
    const value = await response.clone().json() as { project?: { id?: unknown } };
    return safeProjectId(value.project?.id);
  } catch {
    return null;
  }
}

async function readSubmittedTeacherMessageId(response: Response) {
  try {
    const value = await response.clone().json() as { message?: { id?: unknown } };
    return safeAuditId(value.message?.id);
  } catch {
    return null;
  }
}

function requiredId(value: unknown) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > 200) throw new Error("orchestration_audit_id_invalid");
  return normalized;
}

function safeAuditId(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 200 ? normalized : null;
}

function timestamp(value: Date) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error("orchestration_audit_timestamp_invalid");
  return value.toISOString();
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeOccurredAt(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("orchestration_audit_timestamp_invalid");
  return date.toISOString();
}

function parsePayload(value: string): ParsedOrchestrationIngressPayload | null {
  try {
    const parsed = JSON.parse(value) as Partial<OrchestrationIngressPayload>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    if (parsed.schemaVersion !== undefined && parsed.schemaVersion !== INGRESS_AUDIT_V2) return null;
    if (typeof parsed.operation !== "string" || typeof parsed.routeTemplate !== "string") return null;
    const method = normalizeWriteMethod(String(parsed.method ?? ""));
    if (!method || typeof parsed.controlImpact !== "string") return null;
    if (parsed.httpStatus === undefined) return null;
    const httpStatus = parsed.httpStatus;
    if (httpStatus !== null && (typeof httpStatus !== "number" || !Number.isInteger(httpStatus) || httpStatus < 100 || httpStatus > 599)) return null;
    const classification = findOrchestrationIngressClassification(parsed.operation);
    if (!classification || classification.routeTemplate !== parsed.routeTemplate ||
        classification.controlImpact !== parsed.controlImpact ||
        ("method" in classification && classification.method !== method)) return null;
    return {
      schemaVersion: parsed.schemaVersion ?? INGRESS_AUDIT_V1,
      operation: parsed.operation as OrchestrationIngressOperation,
      routeTemplate: parsed.routeTemplate,
      method,
      controlImpact: parsed.controlImpact as OrchestrationIngressControlImpact,
      httpStatus,
    };
  } catch {
    return null;
  }
}

function hasValidTeacherMessageBinding(
  event: OrchestrationIngressAuditEvent,
  payload: ParsedOrchestrationIngressPayload,
) {
  if (payload.schemaVersion === INGRESS_AUDIT_V1) return event.teacherMessageId === null;
  if (event.recordType === "attempted") return event.teacherMessageId === null;
  const requiresTeacherMessage = payload.operation === "teacher_message_submit" && event.outcome === "committed";
  if (!requiresTeacherMessage) return event.teacherMessageId === null;
  return safeAuditId(event.teacherMessageId) === event.teacherMessageId;
}

function hasValidExternalEventCore(event: OrchestrationIngressAuditEvent) {
  const source = event as unknown as Record<string, unknown>;
  const toolOnlyFields = [
    "taskId", "turnJobId", "toolInvocationId", "intentEpoch", "planRevision", "planId", "toolOrdinal",
    "toolName", "actionDigest", "idempotencyKey", "observationId", "invocationStatus",
    "executionEnvelopeDigest", "requestDigest",
  ];
  return safeAuditId(event.eventId) === event.eventId && safeAuditId(event.attemptId) === event.attemptId &&
    event.operationKind === "external_mutation" && event.authority === "teacher_http" &&
    safeAuditId(event.actorUserId) === event.actorUserId &&
    ["local", "password", "oauth", "sso"].includes(event.actorAuthMode) &&
    (event.authSessionDigest === null || /^[a-f0-9]{64}$/.test(event.authSessionDigest)) &&
    (event.claimedProjectId === null || safeProjectId(event.claimedProjectId) === event.claimedProjectId) &&
    (event.resolvedProjectId === null || safeProjectId(event.resolvedProjectId) === event.resolvedProjectId) &&
    toolOnlyFields.every((field) => source[field] === null || source[field] === undefined);
}

function hasValidExternalRecordSemantics(
  event: OrchestrationIngressAuditEvent,
  payload: ParsedOrchestrationIngressPayload,
) {
  const projectCreate = payload.operation === "project_create";
  if ((projectCreate && event.claimedProjectId !== null) ||
      (!projectCreate && event.claimedProjectId === null)) return false;
  if (event.recordType === "attempted") {
    return event.outcome === null && event.reasonCode === null && payload.httpStatus === null &&
      event.resolvedProjectId === null;
  }
  if (event.recordType !== "resolved" || event.outcome === null) return false;
  if (payload.httpStatus === null) {
    return event.outcome === "failed" && event.reasonCode === "handler_exception" &&
      event.resolvedProjectId === null;
  }
  const expected = classifyResponse(payload.httpStatus);
  if (event.outcome !== expected.outcome || event.reasonCode !== expected.reasonCode) return false;
  if (projectCreate) {
    return event.outcome === "committed"
      ? event.resolvedProjectId !== null
      : event.resolvedProjectId === null;
  }
  return event.resolvedProjectId === event.claimedProjectId;
}
