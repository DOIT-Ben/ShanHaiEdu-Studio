import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type ProviderCallTraceContext = {
  projectId: string;
  taskId: string;
  runId: string;
  turnJobId: string | null;
  teacherMessageId: string;
  intentEpoch: number;
  phase: "intake" | "initial" | "tool" | "post_tool";
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
const campaignOrdinalState = new Map<string, Map<string, number>>();

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

export function runWithProviderCallTracePhase<T>(
  phase: ProviderCallTraceContext["phase"],
  operation: () => T,
): T {
  const context = contextStorage.getStore();
  return context ? runWithProviderCallTraceContext({ ...context, phase }, operation) : operation();
}

export function createProviderCallTraceRecorder(input: {
  root: string;
  campaignId: string;
}): ProviderCallTraceRecorder {
  const root = path.resolve(input.root);
  const campaignId = safeIdentifier(input.campaignId, "campaignId");
  const campaignKey = `${root}\0${campaignId}`;
  const ordinals = campaignOrdinalState.get(campaignKey) ?? new Map<string, number>();
  campaignOrdinalState.set(campaignKey, ordinals);
  return Object.freeze({
    async record(event) {
      const context = contextStorage.getStore();
      if (!context) return false;
      const ordinalKey = [context.projectId, context.teacherMessageId, context.turnJobId ?? "none"].join("\0");
      const callOrdinal = (ordinals.get(ordinalKey) ?? 0) + 1;
      ordinals.set(ordinalKey, callOrdinal);
      const record = createRecord(campaignId, context, callOrdinal, event);
      await mkdir(root, { recursive: true });
      assertOrdinaryPhysicalDirectory(root, "Provider trace root");
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
  if (env.SHANHAI_PROVIDER_CALL_TRACE_MODE?.trim() !== "development") {
    throw new Error("Provider trace mode must be development when capture is enabled.");
  }
  const campaignIdValue = env.SHANHAI_PROVIDER_CALL_TRACE_CAMPAIGN_ID?.trim();
  if (!campaignIdValue) throw new Error("Provider trace capture configuration is incomplete.");
  const campaignId = safeIdentifier(campaignIdValue, "campaignId");
  const relativeRoot = normalizeRelativeTraceRoot(env.SHANHAI_PROVIDER_CALL_TRACE_ROOT, campaignId);
  if (!relativeRoot) throw new Error("Provider trace capture configuration does not match the campaign.");
  const root = path.resolve(cwd, ...relativeRoot.split("/"));
  assertPhysicalDescendant(cwd, root, "Provider trace root");
  return createProviderCallTraceRecorder({ root, campaignId });
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
  callOrdinal: number,
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
  const modelFingerprint = digestProviderModel(input.model);
  return {
    schemaVersion: "shanhai-provider-call-trace.v1",
    eventId: randomUUID(),
    campaignId,
    recordedAt: new Date().toISOString(),
    context,
    continuity: { phase: context.phase, callOrdinal },
    provider: {
      kind: input.provider,
      mode: "real-provider",
      channel: input.channel,
      modelFingerprint,
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
    phase: input.phase,
  };
  if (!Number.isSafeInteger(context.intentEpoch) || context.intentEpoch < 0) {
    throw new Error("Provider trace intentEpoch must be a non-negative integer.");
  }
  if (!["intake", "initial", "tool", "post_tool"].includes(context.phase)) {
    throw new Error("Provider trace phase is invalid.");
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

export function digestProviderModel(value: string) {
  const normalized = value?.trim();
  if (!normalized || normalized.length > 160 || normalized.includes("://") || /[\r\n]/u.test(normalized)) {
    throw new Error("Provider trace model is invalid.");
  }
  return createHash("sha256").update("shanhai.provider-model.v1\0", "utf8").update(normalized, "utf8").digest("hex");
}

function assertPhysicalDescendant(cwd: string, target: string, label: string) {
  const physicalRoot = realpathSync(path.resolve(cwd));
  let existing = path.resolve(target);
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error(`${label} has no existing physical parent.`);
    existing = parent;
  }
  assertNoLinkAncestors(physicalRoot, existing, label);
  const physicalExisting = realpathSync(existing);
  const relative = path.relative(physicalRoot, physicalExisting);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`${label} escapes the repository.`);
}

function assertNoLinkAncestors(root: string, target: string, label: string) {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`${label} escapes its root.`);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (lstatSync(current).isSymbolicLink()) throw new Error(`${label} must not traverse a link.`);
  }
}

function assertOrdinaryPhysicalDirectory(target: string, label: string) {
  const stat = lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be an ordinary directory.`);
  realpathSync(target);
}

function canonicalTimestamp(value: string, label: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`Provider trace ${label} must be a canonical timestamp.`);
  }
  return value;
}

function normalizeRelativeTraceRoot(value: string | undefined, campaignId: string) {
  const normalized = value?.trim().replaceAll("\\", "/");
  if (!normalized || path.posix.isAbsolute(normalized) || path.win32.isAbsolute(normalized)) return null;
  const portable = path.posix.normalize(normalized).replace(/^\.\//u, "");
  if (portable === ".." || portable.startsWith("../")) return null;
  if (portable !== `.tmp/provider-continuity/campaigns/${campaignId}/capture`) return null;
  return portable;
}
