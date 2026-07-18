import { createHash, randomUUID } from "node:crypto";

import { prisma } from "@/server/db/client";
import operationRegistry from "../../../config/orchestration-write-operations.json";

export type OrchestrationIngressOperation =
  | "project_create"
  | "project_lifecycle_update"
  | "teacher_message_submit"
  | "message_reaction_set"
  | "legacy_agent_run_start"
  | "legacy_agent_run_finish"
  | "generation_intensity_update"
  | "project_member_add"
  | "project_member_role_update"
  | "project_member_remove"
  | "teacher_artifact_create"
  | "artifact_approve"
  | "artifact_regenerate"
  | "ppt_sample_review_submit"
  | "ppt_full_deck_review_submit"
  | "artifact_route_coze_ppt"
  | "artifact_route_image"
  | "artifact_route_video"
  | "unclassified_external";

export type OrchestrationIngressControlImpact =
  | "teacher_write"
  | "teacher_task_submission"
  | "legacy_external_orchestration"
  | "artifact_route"
  | "unclassified_external";

type WriteMethod = "POST" | "PUT" | "PATCH" | "DELETE";
type AuditRecordType = "attempted" | "resolved";
type AuditOutcome = "committed" | "rejected" | "failed" | null;
type AuditReasonCode = "http_2xx" | "http_3xx" | "http_4xx" | "http_5xx" | "handler_exception" | null;

type OrchestrationIngressPayload = {
  operation: OrchestrationIngressOperation;
  routeTemplate: string;
  method: WriteMethod;
  controlImpact: OrchestrationIngressControlImpact;
  httpStatus: number | null;
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

type RegistryEntry = {
  method: WriteMethod;
  routeTemplate: string;
  operation: Exclude<OrchestrationIngressOperation, "unclassified_external">;
  controlImpact: Exclude<OrchestrationIngressControlImpact, "unclassified_external">;
};

const registry = Object.freeze(operationRegistry.map(parseRegistryEntry));

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

export function resolveOrchestrationIngressOperation(request: Request) {
  const method = normalizeWriteMethod(request.method);
  if (!method) return null;
  const pathname = new URL(request.url).pathname;
  if (pathname !== "/api/workbench/projects" && !pathname.startsWith("/api/workbench/projects/")) return null;
  for (const candidate of registry) {
    if (candidate.method !== method) continue;
    const routeParams = matchRouteTemplate(candidate.routeTemplate, pathname);
    if (!routeParams) continue;
    return {
      operation: candidate.operation,
      routeTemplate: candidate.routeTemplate,
      claimedProjectId: safeProjectId(routeParams.projectId),
      controlImpact: candidate.controlImpact,
    };
  }
  return {
    operation: "unclassified_external" as const,
    routeTemplate: "/api/workbench/projects/:unclassified",
    claimedProjectId: safeProjectId(/^\/api\/workbench\/projects\/([^/]+)/.exec(pathname)?.[1]),
    controlImpact: "unclassified_external" as const,
  };
}

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
      payloadJson: createPayloadJson(route, normalizeWriteMethod(input.request.method)!, null),
      occurredAt: timestamp(now()),
    }));
    throw error;
  }

  const classification = classifyResponse(response.status);
  const resolvedProjectId = route.operation === "project_create" && classification.outcome === "committed"
    ? await readCreatedProjectId(response)
    : route.claimedProjectId;
  if (route.operation === "project_create" && classification.outcome === "committed" && !resolvedProjectId) {
    throw new Error("orchestration_audit_project_resolution_failed");
  }
  await store.append(createEvent({
    ...identity,
    eventId: requiredId(createId()),
    recordType: "resolved",
    outcome: classification.outcome,
    resolvedProjectId,
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
  return Object.freeze({ ...event, eventDigest: digestEvent(event) });
}

function digestEvent(event: OrchestrationIngressAuditEventInput | OrchestrationIngressAuditEvent) {
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

function parseRegistryEntry(value: unknown): RegistryEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("orchestration_operation_registry_invalid");
  const source = value as Record<string, unknown>;
  const method = normalizeWriteMethod(String(source.method ?? ""));
  if (!method || typeof source.routeTemplate !== "string" || !source.routeTemplate.startsWith("/api/workbench/projects")) {
    throw new Error("orchestration_operation_registry_invalid");
  }
  return {
    method,
    routeTemplate: source.routeTemplate,
    operation: source.operation as RegistryEntry["operation"],
    controlImpact: source.controlImpact as RegistryEntry["controlImpact"],
  };
}

function matchRouteTemplate(template: string, pathname: string) {
  const templateSegments = template.split("/").filter(Boolean);
  const pathSegments = pathname.split("/").filter(Boolean);
  if (templateSegments.length !== pathSegments.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < templateSegments.length; index += 1) {
    const templateSegment = templateSegments[index];
    const pathSegment = pathSegments[index];
    if (templateSegment.startsWith(":")) {
      params[templateSegment.slice(1)] = pathSegment;
    } else if (templateSegment !== pathSegment) {
      return null;
    }
  }
  return params;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`).join(",")}}`;
}

function isValidEvent(event: OrchestrationIngressAuditEvent) {
  return Number.isSafeInteger(event.sequence) && event.sequence > 0 && parsePayload(event.payloadJson) !== null &&
    event.eventDigest === digestEvent(event);
}

function sameAttemptIdentity(left: OrchestrationIngressAuditEvent, right: OrchestrationIngressAuditEvent) {
  const sameColumns = [
    "attemptId", "operationKind", "authority", "actorUserId", "actorAuthMode",
    "authSessionDigest", "claimedProjectId",
  ].every((field) => left[field as keyof OrchestrationIngressAuditEvent] === right[field as keyof OrchestrationIngressAuditEvent]);
  const leftPayload = parsePayload(left.payloadJson);
  const rightPayload = parsePayload(right.payloadJson);
  return sameColumns && leftPayload !== null && rightPayload !== null &&
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

function normalizeWriteMethod(value: string): WriteMethod | null {
  const method = value.toUpperCase();
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE" ? method : null;
}

function safeProjectId(value: unknown) {
  if (typeof value !== "string") return null;
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { return null; }
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(decoded) ? decoded : null;
}

function requiredId(value: unknown) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > 200) throw new Error("orchestration_audit_id_invalid");
  return normalized;
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

function parsePayload(value: string): OrchestrationIngressPayload | null {
  try {
    const parsed = JSON.parse(value) as Partial<OrchestrationIngressPayload>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    if (typeof parsed.operation !== "string" || typeof parsed.routeTemplate !== "string") return null;
    const method = normalizeWriteMethod(String(parsed.method ?? ""));
    if (!method || typeof parsed.controlImpact !== "string") return null;
    if (parsed.httpStatus === undefined) return null;
    const httpStatus = parsed.httpStatus;
    if (httpStatus !== null && (typeof httpStatus !== "number" || !Number.isInteger(httpStatus) || httpStatus < 100 || httpStatus > 599)) return null;
    const classification = parsed.operation === "unclassified_external"
      ? { routeTemplate: "/api/workbench/projects/:unclassified", controlImpact: "unclassified_external" }
      : registry.find((entry) => entry.operation === parsed.operation);
    if (!classification || classification.routeTemplate !== parsed.routeTemplate ||
        classification.controlImpact !== parsed.controlImpact ||
        ("method" in classification && classification.method !== method)) return null;
    return parsed as OrchestrationIngressPayload;
  } catch {
    return null;
  }
}
