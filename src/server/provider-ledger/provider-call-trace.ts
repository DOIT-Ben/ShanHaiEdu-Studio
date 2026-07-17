import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type ProviderCallTraceContext = {
  projectId: string;
  taskId: string;
  runId: string;
  turnJobId: string | null;
  teacherMessageId: string;
  intentEpoch: number;
};

export type ProviderCallTraceInput = {
  provider: "openai_responses";
  channel: "primary" | "third" | "fallback" | "unknown";
  model: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  outcome: "succeeded" | "failed";
  httpStatus: number | null;
  timeout: boolean;
  requestIdDigest: string | null;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; cachedTokens: number; cacheWriteTokens: number } | null;
  retryCount: 0;
  errorCategory: "none" | "timeout" | "rate_limit" | "transport" | "provider" | "unknown";
};

export type ProviderCallTraceRecorder = {
  record(input: ProviderCallTraceInput): Promise<boolean>;
};

type ProviderCallTraceEnv = NodeJS.ProcessEnv & {
  SHANHAI_PROVIDER_CALL_TRACE_ENABLED?: string;
  SHANHAI_PROVIDER_CALL_TRACE_MODE?: string;
  SHANHAI_PROVIDER_CALL_TRACE_ROOT?: string;
  SHANHAI_PROVIDER_CALL_TRACE_CAMPAIGN_ID?: string;
};

const contextStorage = new AsyncLocalStorage<Readonly<ProviderCallTraceContext>>();

export function runWithProviderCallTraceContext<T>(
  context: ProviderCallTraceContext,
  operation: () => T,
): T {
  return contextStorage.run(Object.freeze(validateContext(context)), operation);
}

export function runWithProviderCallTraceBinding<T>(
  input: Omit<ProviderCallTraceContext, "runId" | "taskId"> & { taskId?: string },
  operation: () => T,
): T {
  return runWithProviderCallTraceContext({
    ...input,
    taskId: input.taskId?.trim() || `conversation-turn:${input.teacherMessageId}`,
    runId: `turn:${input.teacherMessageId}`,
  }, operation);
}

export function readProviderCallTraceContext() {
  return contextStorage.getStore();
}

export function createProviderCallTraceRecorder(input: {
  root: string;
  campaignId: string;
}): ProviderCallTraceRecorder {
  const root = path.resolve(input.root);
  const campaignId = safeIdentifier(input.campaignId, "campaignId");
  return Object.freeze({
    async record(event) {
      const context = contextStorage.getStore();
      if (!context) return false;
      const record = createRecord(campaignId, context, event);
      await mkdir(root, { recursive: true });
      const target = path.join(root, `${record.recordedAt.replaceAll(":", "-")}-${record.eventId}.json`);
      await writeFile(target, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      return true;
    },
  });
}

export function resolveProviderCallTraceRecorderFromEnv(
  env: ProviderCallTraceEnv = process.env,
  cwd = process.cwd(),
): ProviderCallTraceRecorder | undefined {
  if (env.SHANHAI_PROVIDER_CALL_TRACE_ENABLED?.trim() !== "1") return undefined;
  if (env.SHANHAI_PROVIDER_CALL_TRACE_MODE?.trim() !== "development") return undefined;
  const relativeRoot = normalizeRelativeTraceRoot(env.SHANHAI_PROVIDER_CALL_TRACE_ROOT);
  const campaignId = env.SHANHAI_PROVIDER_CALL_TRACE_CAMPAIGN_ID?.trim();
  if (!relativeRoot || !campaignId) return undefined;
  try {
    return createProviderCallTraceRecorder({
      root: path.resolve(cwd, ...relativeRoot.split("/")),
      campaignId,
    });
  } catch {
    return undefined;
  }
}

export function digestProviderRequestId(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  return createHash("sha256")
    .update("shanhai.provider-request-id.v1\0", "utf8")
    .update(normalized, "utf8")
    .digest("hex");
}

function createRecord(
  campaignId: string,
  context: Readonly<ProviderCallTraceContext>,
  input: ProviderCallTraceInput,
) {
  const startedAt = canonicalTimestamp(input.startedAt, "startedAt");
  const completedAt = canonicalTimestamp(input.completedAt, "completedAt");
  if (!Number.isSafeInteger(input.durationMs) || input.durationMs < 0) {
    throw new Error("Provider trace durationMs must be a non-negative integer.");
  }
  if (input.httpStatus !== null && (!Number.isInteger(input.httpStatus) || input.httpStatus < 100 || input.httpStatus > 599)) {
    throw new Error("Provider trace httpStatus is invalid.");
  }
  if (input.requestIdDigest !== null && !/^[a-f0-9]{64}$/u.test(input.requestIdDigest)) {
    throw new Error("Provider trace requestIdDigest is invalid.");
  }
  if (input.retryCount !== 0) throw new Error("Provider trace retryCount must remain zero.");
  const model = safeModel(input.model);
  return {
    schemaVersion: "shanhai-provider-call-trace.v1",
    eventId: randomUUID(),
    campaignId,
    recordedAt: new Date().toISOString(),
    context,
    provider: {
      kind: input.provider,
      channel: input.channel,
      model,
    },
    timing: {
      startedAt,
      completedAt,
      durationMs: input.durationMs,
    },
    result: {
      outcome: input.outcome,
      httpStatus: input.httpStatus,
      timeout: input.timeout,
      requestIdDigest: input.requestIdDigest,
      usage: input.usage,
      retryCount: input.retryCount,
      errorCategory: input.errorCategory,
    },
  };
}

function validateContext(input: ProviderCallTraceContext): ProviderCallTraceContext {
  const context = {
    projectId: safeIdentifier(input.projectId, "projectId"),
    taskId: safeIdentifier(input.taskId, "taskId"),
    runId: safeIdentifier(input.runId, "runId"),
    turnJobId: input.turnJobId === null ? null : safeIdentifier(input.turnJobId, "turnJobId"),
    teacherMessageId: safeIdentifier(input.teacherMessageId, "teacherMessageId"),
    intentEpoch: input.intentEpoch,
  };
  if (!Number.isSafeInteger(context.intentEpoch) || context.intentEpoch < 0) {
    throw new Error("Provider trace intentEpoch must be a non-negative integer.");
  }
  return context;
}

function safeIdentifier(value: string, label: string) {
  const normalized = value?.trim();
  if (!normalized || normalized.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9:._-]*$/u.test(normalized)) {
    throw new Error(`Provider trace ${label} is invalid.`);
  }
  return normalized;
}

function safeModel(value: string) {
  const normalized = value?.trim();
  if (!normalized || normalized.length > 160 || normalized.includes("://") || /[\r\n]/u.test(normalized)) {
    throw new Error("Provider trace model is invalid.");
  }
  return normalized;
}

function canonicalTimestamp(value: string, label: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`Provider trace ${label} must be a canonical timestamp.`);
  }
  return value;
}

function normalizeRelativeTraceRoot(value: string | undefined) {
  const normalized = value?.trim().replaceAll("\\", "/");
  if (!normalized || path.posix.isAbsolute(normalized) || path.win32.isAbsolute(normalized)) return null;
  const portable = path.posix.normalize(normalized).replace(/^\.\//u, "");
  if (portable === ".." || portable.startsWith("../")) return null;
  if (!portable.startsWith(".tmp/provider-continuity/capture/")) return null;
  return portable;
}
