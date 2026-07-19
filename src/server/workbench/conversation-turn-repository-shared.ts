import type { PrismaClient } from "@/generated/prisma/client";
import { canonicalizeRunInput, hashRunInput } from "@/server/execution/run-input-snapshot";
import type {
  EnqueueConversationTurnInput,
  EnqueueMessageAndConversationTurnInput,
} from "./types";

export type TransactionClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export const CONVERSATION_TURN_SUBMISSION_KEY = "conversationTurnSubmission";

export class ConversationTurnIdempotencyConflictError extends Error {
  readonly code = "conversation_turn_idempotency_conflict";

  constructor() {
    super("Conversation turn idempotency key already exists with a different payload.");
    this.name = "ConversationTurnIdempotencyConflictError";
  }
}

export function conversationTurnPayload(input: EnqueueConversationTurnInput) {
  return {
    schemaVersion: "conversation-turn-enqueue.v1",
    teacherMessageId: input.teacherMessageId,
    maxAttempts: input.maxAttempts ?? 2,
    executionIdentity: normalizeExecutionIdentity(input.executionIdentity),
  };
}

export function messageTurnPayload(input: EnqueueMessageAndConversationTurnInput) {
  return {
    schemaVersion: "conversation-message-turn-enqueue.v1",
    role: input.role,
    content: input.content,
    parts: input.parts ?? [],
    artifactRefs: input.artifactRefs ?? [],
    metadata: input.metadata ?? {},
    maxAttempts: input.maxAttempts ?? 2,
    executionIdentity: normalizeExecutionIdentity(input.executionIdentity),
    preemptiveControl: input.preemptiveControl ?? null,
  };
}

export function assertCanonicalPayloadMatch(actual: unknown, expected: unknown) {
  if (canonicalizeRunInput(actual) !== canonicalizeRunInput(expected)) {
    throw new ConversationTurnIdempotencyConflictError();
  }
}

export function messageTurnPayloadDigest(input: EnqueueMessageAndConversationTurnInput) {
  return canonicalPayloadDigest(messageTurnPayload(input));
}

export function canonicalPayloadDigest(value: unknown) {
  return hashRunInput(value);
}

export function submissionReceipt(
  payloadDigest: string,
  preemptiveControl: EnqueueMessageAndConversationTurnInput["preemptiveControl"],
) {
  return {
    schemaVersion: "conversation-turn-submission.v1",
    payloadDigest,
    preemptiveControl: preemptiveControl ?? null,
  };
}

export function parseSubmissionReceipt(value: unknown) {
  const receipt = parseRecord(value);
  if (receipt.schemaVersion !== "conversation-turn-submission.v1" ||
      !isSha256(String(receipt.payloadDigest ?? ""))) return null;
  if (receipt.preemptiveControl !== null && receipt.preemptiveControl !== undefined &&
      !isRecord(receipt.preemptiveControl)) return null;
  return {
    payloadDigest: String(receipt.payloadDigest).toLowerCase(),
    preemptiveControl: receipt.preemptiveControl ?? null,
  };
}

export function stripConversationTurnSubmissionReceipt(metadata: Record<string, unknown>) {
  const projected = { ...metadata };
  delete projected[CONVERSATION_TURN_SUBMISSION_KEY];
  return projected;
}

export function parseRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function parseArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function requiredRecoveryText(value: string) {
  return Boolean(value.trim());
}

export function isSha256(value: string) {
  return /^[a-f0-9]{64}$/i.test(value.trim());
}

export function isUniqueConstraintError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

export function isSqliteWriteContentionError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code) : "";
  const message = "message" in error ? String(error.message).toLowerCase() : "";
  return code === "P1008" || message.includes("operation has timed out") || message.includes("database is locked");
}

export function waitForConcurrentCommit(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeExecutionIdentity(input: EnqueueConversationTurnInput["executionIdentity"]) {
  return {
    actorUserId: input?.actorUserId ?? null,
    actorAuthMode: input?.actorAuthMode ?? null,
    authSessionId: input?.authSessionId ?? null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
