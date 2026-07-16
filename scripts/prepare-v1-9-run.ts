import { createHash, randomBytes } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  createV1_9RunManifestV2,
  createV1_9RunManifestV2Digest,
  createV1_9RunState,
  markV1_9RunStateContractUpgradeTermination,
  normalizeV1_9RunState,
  type V1_9RunPredecessor,
} from "./lib/v1-9-e2e-contract.mjs";
import { createV1_9BaselineLock, type V1_9BaselineLock } from "./lib/v1-9-baseline-lock.mjs";
import {
  assertV1_9PredecessorBytesUnchanged,
  readV1_9PredecessorContext,
  readV1_9V2RunContext,
} from "./lib/v1-9-run-predecessor";
import {
  commitV1_9PrepareTransaction,
  recoverV1_9PrepareTransaction,
  withV1_9PrepareLock,
  type V1_9PrepareHookPhase,
  type V1_9PrepareTransaction,
  type V1_9PreparedRun,
  type V1_9PredecessorHistoryEvidence,
  type V1_9RunHistoryEntry,
  type V1_9RunHistoryIndex,
} from "./lib/v1-9-run-preparation-transaction";
import { resolveV1_9ExecutionLocks, type V1_9ResolvedExecutionLocks } from "./v1-9-product-preflight";

const POINTER_FILE = "v1-9-product-e2e-active.json";
const HISTORY_FILE = "v1-9-product-e2e-history.json";
const MANIFEST_FILE = "run-manifest.json";
const STATE_FILE = "run-state.json";
const JOURNAL_FILE = ".v1-9-prepare-transaction.json";

export const V1_9_HISTORICAL_PREDECESSOR_MANIFEST_SHA256 =
  "a7bae74ce472f9826dae9e85ab096b787f77527a153df4defc73bce0d2db698c";

export const V1_9_FROZEN_PROMPT = [
  "请为五年级数学《百分数》完成一套可直接备课验收的公开课材料包，",
  "包括结构化教案、约10页可编辑PPTX、课堂视觉图、30至90秒独立创意导入视频、",
  "唯一最小课程锚点、ClassroomRunSpec和版本一致ZIP。",
  "视频创意脱离教材仍成立，不固定儿童、教师、教室或课堂活动；标准范围内自主推进，失败只返修受影响页面、镜头或版本。",
].join("");

type PrepareEnvironment = Readonly<Record<string, string | undefined>>;

export type PreparedV1_9Run = V1_9PreparedRun;

export type PrepareV1_9RunDependencies = {
  createBaselineLock(input: { cwd: string; env: PrepareEnvironment }): V1_9BaselineLock;
  resolveExecutionLocks(input: { env: PrepareEnvironment }): Promise<V1_9ResolvedExecutionLocks>;
  now(): Date;
  randomBytes(size: number): Buffer;
  afterTransactionPhase(phase: V1_9PrepareHookPhase): void | Promise<void>;
};

export type PrepareV1_9RunInput = {
  rootDir?: string;
  env?: PrepareEnvironment;
  runId?: string;
  createdAt?: string;
  expectedPredecessorManifestSha256?: string;
  dependencies?: Partial<PrepareV1_9RunDependencies>;
};

export type TerminateV1_9RunForContractUpgradeInput = {
  rootDir?: string;
  predecessorRunId: string;
  expectedPredecessorManifestSha256: string;
  successorRunId: string;
  reasonCode: string;
  driftedFields?: string[];
  terminatedAt?: string;
  dependencies?: Pick<Partial<PrepareV1_9RunDependencies>, "now" | "randomBytes"> & {
    beforeTerminationCommit?(): void | Promise<void>;
  };
};

const defaults: PrepareV1_9RunDependencies = {
  createBaselineLock: (input) => createV1_9BaselineLock(input),
  resolveExecutionLocks: (input) => resolveV1_9ExecutionLocks(input),
  now: () => new Date(),
  randomBytes,
  afterTransactionPhase: async () => undefined,
};

export async function prepareV1_9Run(input: PrepareV1_9RunInput = {}): Promise<PreparedV1_9Run> {
  const rootDir = path.resolve(input.rootDir ?? process.cwd());
  const env = input.env ?? process.env;
  const dependencies = { ...defaults, ...input.dependencies };
  validateEnvironment(env);
  const resultsRoot = path.join(rootDir, "test-results");
  await mkdir(resultsRoot, { recursive: true });
  const requestedValue = input.runId ?? env.V1_9_SUCCESSOR_RUN_ID?.trim();
  const requestedRunId = requestedValue ? requiredRunId(requestedValue, "v1_9_run_id_invalid") : null;
  const expectedPredecessorRunId = requiredRunId(env.V1_9_PREDECESSOR_RUN_ID, "v1_9_predecessor_invalid");
  const expectedManifestDigest = input.expectedPredecessorManifestSha256
    ?? env.V1_9_PREDECESSOR_MANIFEST_SHA256?.trim()
    ?? null;

  return withV1_9PrepareLock(resultsRoot, dependencies, async () => {
    const recovered = await recoverV1_9PrepareTransaction({
      rootDir,
      testResultsRoot: resultsRoot,
      expectedPredecessorRunId,
      expectedPredecessorManifestSha256: expectedManifestDigest,
      requestedRunId,
      randomBytes: dependencies.randomBytes,
    });
    if (recovered) return recovered;

    const pointerPath = path.join(resultsRoot, POINTER_FILE);
    const pointerBytes = await readFile(pointerPath).catch(() => fail("v1_9_active_pointer_missing"));
    const createdAt = timestamp(input.createdAt ?? dependencies.now().toISOString());
    const runId = requestedRunId ?? createRunId(createdAt, dependencies.randomBytes);
    const predecessorContext = await readV1_9PredecessorContext({
      rootDir,
      pointerBytes,
      expectedPredecessorRunId,
      successorRunId: runId,
    });
    const expected = requiredDigest(
      expectedManifestDigest ?? (predecessorContext.disposition === "historical_failed"
        ? V1_9_HISTORICAL_PREDECESSOR_MANIFEST_SHA256
        : fail("v1_9_predecessor_manifest_digest_required")),
      "v1_9_predecessor_manifest_digest_invalid",
    );
    if (predecessorContext.manifestSha256 !== expected) fail("v1_9_predecessor_manifest_digest_mismatch");

    const historyPath = path.join(resultsRoot, HISTORY_FILE);
    const historyBytes = await readOptional(historyPath);
    const history = parseHistory(historyBytes);
    if (history.entries.some((entry) => entry.runId === predecessorContext.pointerRunId)) {
      fail("v1_9_run_history_predecessor_duplicate");
    }
    if (runId === predecessorContext.pointerRunId) fail("v1_9_run_id_invalid");
    const relativeRunRoot = `test-results/${runId}`;
    if (await exists(resolveRunRoot(rootDir, relativeRunRoot))) fail("v1_9_run_root_exists");

    const baselineLock = dependencies.createBaselineLock({ cwd: rootDir, env });
    const executionLocks = await dependencies.resolveExecutionLocks({ env });
    const predecessor: V1_9RunPredecessor = {
      runId: predecessorContext.pointerRunId,
      relativeRunRoot: predecessorContext.relativeRunRoot,
      manifestSha256: predecessorContext.manifestSha256,
      disposition: predecessorContext.disposition,
    };
    const manifest = createV1_9RunManifestV2({
      runId,
      relativeRunRoot,
      prompt: V1_9_FROZEN_PROMPT,
      createdAt,
      baselineLock,
      skillLock: executionLocks.skillLock,
      agentBrain: { providerLock: executionLocks.providerLock },
      providerRuntimeLocks: executionLocks.providerRuntimeLocks,
      predecessor,
    });
    const manifestSha256 = createV1_9RunManifestV2Digest(manifest);
    const state = createV1_9RunState({ manifest, createdAt });
    const prepared: PreparedV1_9Run = {
      runId,
      relativeRunRoot,
      manifestPath: `${relativeRunRoot}/${MANIFEST_FILE}`,
      manifestSha256,
      statePath: `${relativeRunRoot}/${STATE_FILE}`,
    };
    const historyEvidence: V1_9PredecessorHistoryEvidence = {
      schemaVersion: "v1-9-predecessor-history-evidence.v1",
      predecessor,
      predecessorPointerSha256: sha256(pointerBytes),
      successorRunId: runId,
      verifiedAt: createdAt,
    };
    const nextHistory: V1_9RunHistoryIndex = {
      schemaVersion: "v1-9-run-history.v1",
      entries: [...history.entries, {
        ...predecessor,
        manifestPath: `${predecessor.relativeRunRoot}/${MANIFEST_FILE}`,
        successorRunId: runId,
        recordedAt: createdAt,
      }],
    };
    const temporaryRunDirectoryName = `.v1-9-prepare-${runId}-${dependencies.randomBytes(4).toString("hex")}`;
    const transaction: V1_9PrepareTransaction = {
      schemaVersion: "v1-9-prepare-transaction.v1",
      phase: "staged",
      predecessorRunId: predecessor.runId,
      predecessorPointerSha256: sha256(pointerBytes),
      predecessorManifestSha256: predecessor.manifestSha256,
      predecessorStateSha256: predecessorContext.stateBytes ? sha256(predecessorContext.stateBytes) : null,
      previousHistorySha256: historyBytes ? sha256(historyBytes) : null,
      temporaryRunDirectoryName,
      prepared,
      manifest,
      state,
      historyEvidence,
      nextHistory,
      createdAt,
    };
    return commitV1_9PrepareTransaction({
      rootDir,
      testResultsRoot: resultsRoot,
      transaction,
      dependencies,
      assertPredecessorUnchanged: () => assertV1_9PredecessorBytesUnchanged({
        pointerPath,
        context: predecessorContext,
      }),
    });
  });
}

export async function terminateV1_9RunForContractUpgrade(input: TerminateV1_9RunForContractUpgradeInput) {
  const rootDir = path.resolve(input.rootDir ?? process.cwd());
  const dependencies = { ...defaults, ...input.dependencies };
  const resultsRoot = path.join(rootDir, "test-results");
  await mkdir(resultsRoot, { recursive: true });
  const predecessorRunId = requiredRunId(input.predecessorRunId, "v1_9_predecessor_invalid");
  const expectedManifest = requiredDigest(input.expectedPredecessorManifestSha256, "v1_9_predecessor_manifest_digest_invalid");
  const successorRunId = requiredRunId(input.successorRunId, "v1_9_run_id_invalid");
  if (successorRunId === predecessorRunId) fail("v1_9_successor_run_id_invalid");
  return withV1_9PrepareLock(resultsRoot, dependencies, async () => {
    if (await exists(path.join(resultsRoot, JOURNAL_FILE))) fail("v1_9_prepare_transaction_active");
    const pointerPath = path.join(resultsRoot, POINTER_FILE);
    const pointerBytes = await readFile(pointerPath).catch(() => fail("v1_9_active_pointer_missing"));
    const context = await readV1_9V2RunContext({ rootDir, pointerBytes, expectedRunId: predecessorRunId });
    if (context.manifestSha256 !== expectedManifest) fail("v1_9_predecessor_manifest_digest_mismatch");
    if (context.state.status === "completed") fail("v1_9_predecessor_state_invalid");
    const nextState = markV1_9RunStateContractUpgradeTermination(context.state, {
      reasonCode: input.reasonCode,
      successorRunId,
      driftedFields: input.driftedFields ?? [],
      recoveryEntry: `test-results/${successorRunId}/${STATE_FILE}`,
      terminatedAt: timestamp(input.terminatedAt ?? dependencies.now().toISOString()),
    });
    if (context.state.status !== "terminated_contract_upgrade") {
      await input.dependencies?.beforeTerminationCommit?.();
      if (!context.stateBytes || !(await readFile(context.statePath)).equals(context.stateBytes)) {
        fail("v1_9_predecessor_state_drift");
      }
      await writeJsonAtomic(context.statePath, nextState, dependencies.randomBytes);
    }
    await assertV1_9PredecessorBytesUnchanged({
      pointerPath,
      context: { ...context, statePath: null, stateBytes: null },
    });
    const persisted = normalizeV1_9RunState(JSON.parse(await readFile(context.statePath, "utf8")));
    if (JSON.stringify(persisted) !== JSON.stringify(nextState)) fail("v1_9_predecessor_state_write_failed");
    return {
      runId: predecessorRunId,
      successorRunId,
      status: "terminated_contract_upgrade" as const,
      manifestSha256: context.manifestSha256,
      recoveryEntry: nextState.termination?.recoveryEntry,
    };
  });
}

function parseHistory(bytes: Buffer | null): V1_9RunHistoryIndex {
  if (!bytes) return { schemaVersion: "v1-9-run-history.v1", entries: [] };
  let value: Record<string, unknown>;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { return fail("v1_9_run_history_invalid"); }
  if (!value || value.schemaVersion !== "v1-9-run-history.v1" || !Array.isArray(value.entries) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(["entries", "schemaVersion"])) {
    fail("v1_9_run_history_invalid");
  }
  const entries = value.entries.map((raw): V1_9RunHistoryEntry => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("v1_9_run_history_invalid");
    const entry = raw as Record<string, unknown>;
    if (JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify([
      "disposition", "manifestPath", "manifestSha256", "recordedAt", "relativeRunRoot", "runId", "successorRunId",
    ])) fail("v1_9_run_history_invalid");
    const runId = requiredRunId(entry.runId, "v1_9_run_history_invalid");
    const relativeRunRoot = requiredRunRoot(entry.relativeRunRoot);
    const disposition = entry.disposition;
    if (path.posix.basename(relativeRunRoot) !== runId ||
        !["historical_failed", "terminated_contract_upgrade", "completed"].includes(String(disposition)) ||
        String(entry.manifestPath).replaceAll("\\", "/") !== `${relativeRunRoot}/${MANIFEST_FILE}`) {
      fail("v1_9_run_history_invalid");
    }
    return {
      runId,
      relativeRunRoot,
      manifestSha256: requiredDigest(entry.manifestSha256, "v1_9_run_history_invalid"),
      disposition: disposition as V1_9RunPredecessor["disposition"],
      manifestPath: `${relativeRunRoot}/${MANIFEST_FILE}`,
      successorRunId: requiredRunId(entry.successorRunId, "v1_9_run_history_invalid"),
      recordedAt: timestamp(entry.recordedAt, "v1_9_run_history_invalid"),
    };
  });
  if (new Set(entries.map((entry) => entry.runId)).size !== entries.length) fail("v1_9_run_history_invalid");
  return { schemaVersion: "v1-9-run-history.v1", entries };
}

function validateEnvironment(env: PrepareEnvironment) {
  if (env.V1_9_RUN_MODE?.trim() !== "start-new") fail("v1_9_run_mode_invalid");
  requiredRunId(env.V1_9_PREDECESSOR_RUN_ID, "v1_9_predecessor_invalid");
  requiredText(env.SHANHAI_SKILLS_SOURCE_ROOT, "v1_9_skills_source_root_required");
  requiredText(env.SHANHAI_SKILLS_RUNTIME_ROOT, "v1_9_skills_runtime_root_required");
}

async function writeJsonAtomic(filePath: string, value: unknown, createRandomBytes: (size: number) => Buffer) {
  const temporary = `${filePath}.tmp-${process.pid}-${createRandomBytes(6).toString("hex")}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, filePath);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function readOptional(filePath: string) {
  try { return await readFile(filePath); } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}
async function exists(filePath: string) { try { await access(filePath); return true; } catch { return false; } }
function resolveRunRoot(rootDir: string, relativeRunRoot: string) {
  const resultsRoot = path.resolve(rootDir, "test-results");
  const runRoot = path.resolve(rootDir, ...requiredRunRoot(relativeRunRoot).split("/"));
  const relative = path.relative(resultsRoot, runRoot);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) fail("v1_9_run_root_invalid");
  return runRoot;
}
function requiredRunRoot(value: unknown) { const result = requiredText(value, "v1_9_run_root_invalid").replaceAll("\\", "/"); if (!/^test-results\/v1-9-[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(result) || result.includes("..")) fail("v1_9_run_root_invalid"); return result; }
function requiredRunId(value: unknown, reason: string) { const result = String(value ?? "").trim(); if (!/^v1-9-[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(result)) fail(reason); return result; }
function requiredDigest(value: unknown, reason: string) { const result = String(value ?? "").trim().toLowerCase(); if (!/^[a-f0-9]{64}$/.test(result)) fail(reason); return result; }
function requiredText(value: unknown, reason: string) { const result = String(value ?? "").trim(); if (!result) fail(reason); return result; }
function timestamp(value: unknown, reason = "v1_9_created_at_invalid") { const result = String(value ?? "").trim(); if (!result || !Number.isFinite(Date.parse(result))) fail(reason); return new Date(result).toISOString(); }
function createRunId(createdAt: string, createRandomBytes: (size: number) => Buffer) { return `v1-9-${createdAt.replace(/[-:TZ.]/g, "").slice(0, 14)}-${createRandomBytes(4).toString("hex")}`; }
function sha256(value: Buffer) { return createHash("sha256").update(value).digest("hex"); }
function fail(reason: string): never { throw new Error(reason); }

async function main() {
  const prepared = await prepareV1_9Run();
  process.stdout.write(`${JSON.stringify(prepared, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "v1_9_run_preparation_failed"}\n`);
    process.exitCode = 1;
  });
}
