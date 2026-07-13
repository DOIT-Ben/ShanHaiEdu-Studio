import { randomUUID } from "crypto";

export type ToolObservationKind =
  | "provider_unavailable"
  | "tool_failed"
  | "quality_gate_failed"
  | "blocked_by_policy"
  | "retry_exhausted";

export type ToolObservationStatus = "active" | "resolved" | "superseded";

export type ToolObservationRetryAction =
  | "retry_later"
  | "fix_inputs"
  | "ask_teacher"
  | "skip_or_replan"
  | "wait_for_provider"
  | "do_not_retry_automatically";

export interface ToolObservationRetryPolicy {
  retryable: boolean;
  nextAction: ToolObservationRetryAction;
}

export interface ToolObservation {
  observationId: string;
  projectId: string;
  turnId?: string;
  jobId?: string;
  sourceMessageId?: string;
  capabilityId: string;
  expectedArtifactKind?: string;
  kind: ToolObservationKind;
  status: ToolObservationStatus;
  teacherSafeSummary: string;
  internalReasonSanitized: string;
  retryPolicy: ToolObservationRetryPolicy;
  artifactCreated: false;
  dedupeKey: string;
  createdAt: string;
}

export interface CreateToolObservationInput {
  projectId: string;
  turnId?: string;
  jobId?: string;
  sourceMessageId?: string;
  capabilityId: string;
  expectedArtifactKind?: string;
  kind: ToolObservationKind;
  status?: ToolObservationStatus;
  teacherSafeSummary: string;
  internalReasonSanitized: string;
  retryPolicy?: ToolObservationRetryPolicy;
}

type Metadata = Record<string, unknown>;

const TOOL_OBSERVATIONS_METADATA_KEY = "toolObservations";

const defaultRetryPolicyByKind: Record<ToolObservationKind, ToolObservationRetryPolicy> = {
  provider_unavailable: { retryable: true, nextAction: "wait_for_provider" },
  tool_failed: { retryable: true, nextAction: "retry_later" },
  quality_gate_failed: { retryable: false, nextAction: "fix_inputs" },
  blocked_by_policy: { retryable: false, nextAction: "ask_teacher" },
  retry_exhausted: { retryable: false, nextAction: "do_not_retry_automatically" },
};

const sensitiveQueryKeyPattern = /([?&])([^=&#]*?(?:token|key|secret)[^=&#]*=)[^&#]*/gi;
const bearerTokenPattern = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const windowsPathPattern = /\b[A-Za-z]:\\[^\r\n;]+/g;
const fileUrlPattern = /file:\/\/[^\s]+/gi;
const unixAbsolutePathPattern = /(?<!:)\/(?:Users|home|var|tmp|etc|opt|mnt|Volumes|private|usr)\/[^\s]+/g;
const assignmentSecretPattern = /\b(?:token|access_token|refreshToken|refresh_token|id_token|apiKey|api_key|clientSecret|client_secret|key|API_KEY|SECRET|credential)\b\s*[:=]\s*[^\s&;]+/gi;
const engineeringAssignmentPattern = /\b(?:status|capability|capabilityId|capability_id|providerMode|providerStatus|provider_mode|provider_status|runtimeKind|runtime_kind|deterministicFallback|localPath|localOutput|path)\b\s*[:=]\s*[^\r\n;]+/gi;
const forbiddenWordPattern = /provider[\w_]*|capability[\w_]*|runtime[\w_]*|deterministicFallback|schema|storage|debug|token|API|apiKey|API_KEY|SECRET|credential|manifest|node_id|local\s+path/gi;

export function createToolObservation(input: CreateToolObservationInput): ToolObservation {
  return {
    observationId: randomUUID(),
    projectId: input.projectId,
    turnId: input.turnId,
    jobId: input.jobId,
    sourceMessageId: input.sourceMessageId,
    capabilityId: input.capabilityId,
    expectedArtifactKind: input.expectedArtifactKind,
    kind: input.kind,
    status: input.status ?? "active",
    teacherSafeSummary: sanitizeToolObservationText(input.teacherSafeSummary),
    internalReasonSanitized: sanitizeToolObservationText(input.internalReasonSanitized),
    retryPolicy: input.retryPolicy ?? defaultRetryPolicyByKind[input.kind],
    artifactCreated: false,
    dedupeKey: `${input.projectId}:${input.capabilityId}:${input.kind}:${input.expectedArtifactKind ?? ""}`,
    createdAt: new Date().toISOString(),
  };
}

export function appendToolObservationMetadata(metadata: unknown, observation: ToolObservation): Metadata {
  const baseMetadata = isPlainObject(metadata) ? metadata : {};
  const existingObservations = readToolObservationsFromMetadata(baseMetadata);

  return {
    ...baseMetadata,
    [TOOL_OBSERVATIONS_METADATA_KEY]: [...existingObservations, observation],
  };
}

export function readToolObservationsFromMetadata(metadata: unknown): ToolObservation[] {
  if (!isPlainObject(metadata)) {
    return [];
  }

  const observations = metadata[TOOL_OBSERVATIONS_METADATA_KEY];
  if (!Array.isArray(observations)) {
    return [];
  }

  return observations.filter(isToolObservation);
}

export function readActiveToolObservationsFromMessages(messages: unknown): ToolObservation[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages.flatMap((message) => {
    if (!isPlainObject(message)) {
      return [];
    }

    return readToolObservationsFromMetadata(message.metadata).filter((observation) => observation.status === "active");
  });
}

function sanitizeToolObservationText(value: string): string {
  return value
    .replace(fileUrlPattern, "[已隐藏]")
    .replace(bearerTokenPattern, "[已隐藏]")
    .replace(windowsPathPattern, "[已隐藏]")
    .replace(unixAbsolutePathPattern, "[已隐藏]")
    .replace(sensitiveQueryKeyPattern, "$1$2[已隐藏]")
    .replace(engineeringAssignmentPattern, "[已隐藏]")
    .replace(assignmentSecretPattern, "[已隐藏]")
    .replace(forbiddenWordPattern, "[已隐藏]");
}

function isPlainObject(value: unknown): value is Metadata {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isToolObservation(value: unknown): value is ToolObservation {
  if (!isPlainObject(value)) {
    return false;
  }

  return (
    typeof value.observationId === "string" &&
    typeof value.projectId === "string" &&
    typeof value.capabilityId === "string" &&
    (value.expectedArtifactKind === undefined || typeof value.expectedArtifactKind === "string") &&
    isToolObservationKind(value.kind) &&
    isToolObservationStatus(value.status) &&
    typeof value.teacherSafeSummary === "string" &&
    typeof value.internalReasonSanitized === "string" &&
    isRetryPolicy(value.retryPolicy) &&
    value.artifactCreated === false &&
    typeof value.dedupeKey === "string" &&
    typeof value.createdAt === "string"
  );
}

function isRetryPolicy(value: unknown): value is ToolObservationRetryPolicy {
  return isPlainObject(value) && typeof value.retryable === "boolean" && isRetryAction(value.nextAction);
}

function isToolObservationKind(value: unknown): value is ToolObservationKind {
  return (
    value === "provider_unavailable" ||
    value === "tool_failed" ||
    value === "quality_gate_failed" ||
    value === "blocked_by_policy" ||
    value === "retry_exhausted"
  );
}

function isToolObservationStatus(value: unknown): value is ToolObservationStatus {
  return value === "active" || value === "resolved" || value === "superseded";
}

function isRetryAction(value: unknown): value is ToolObservationRetryAction {
  return (
    value === "retry_later" ||
    value === "fix_inputs" ||
    value === "ask_teacher" ||
    value === "skip_or_replan" ||
    value === "wait_for_provider" ||
    value === "do_not_retry_automatically"
  );
}
