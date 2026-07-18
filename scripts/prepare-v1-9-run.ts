import { createHash, randomBytes } from "node:crypto";
import { access, readFile } from "node:fs/promises";
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
import {
  V1_9BaselineLockDriftError,
  assertCurrentV1_9BaselineLock,
  compareV1_9BaselineLock,
  createV1_9BaselineLock,
  type V1_9BaselineLock,
} from "./lib/v1-9-baseline-lock.mjs";
import {
  assertV1_9PredecessorBytesUnchanged,
  readV1_9PredecessorContext,
  readV1_9V2RunContext,
} from "./lib/v1-9-run-predecessor";
import {
  assertV1_9PreparePath,
  commitV1_9PrepareTransaction,
  ensureV1_9PrepareResultsRoot,
  recoverV1_9PrepareTransaction,
  withV1_9PrepareLock,
  writeV1_9RunStateCooperativeCas,
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

type PrepareEnvironment = Readonly<Record<string, string | undefined>>;

export type PreparedV1_9Run = V1_9PreparedRun;

export type PrepareV1_9RunDependencies = {
  createBaselineLock(input: { cwd: string; env: PrepareEnvironment }): V1_9BaselineLock;
  assertCurrentBaselineLock(
    expected: V1_9BaselineLock,
    input: { cwd: string; env: PrepareEnvironment },
  ): V1_9BaselineLock;
  resolveExecutionLocks(input: { env: PrepareEnvironment }): Promise<V1_9ResolvedExecutionLocks>;
  now(): Date;
  randomBytes(size: number): Buffer;
  afterTransactionPhase(phase: V1_9PrepareHookPhase): void | Promise<void>;
  afterLockTakeoverClaimed(): void | Promise<void>;
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
  assertCurrentBaselineLock: (expected, input) => assertCurrentV1_9BaselineLock(expected, input),
  resolveExecutionLocks: (input) => resolveV1_9ExecutionLocks(input),
  now: () => new Date(),
  randomBytes,
  afterTransactionPhase: async () => undefined,
  afterLockTakeoverClaimed: async () => undefined,
};

export async function prepareV1_9Run(input: PrepareV1_9RunInput = {}): Promise<PreparedV1_9Run> {
  const rootDir = path.resolve(input.rootDir ?? process.cwd());
  const env = input.env ?? process.env;
  const dependencies = { ...defaults, ...input.dependencies };
  if (input.dependencies?.createBaselineLock && !input.dependencies.assertCurrentBaselineLock) {
    dependencies.assertCurrentBaselineLock = (expected, context) => {
      const current = dependencies.createBaselineLock(context);
      const comparison = compareV1_9BaselineLock(expected, current);
      if (!comparison.isCurrent) throw new V1_9BaselineLockDriftError(comparison.driftedFields);
      return current;
    };
  }
  validateEnvironment(env);
  const requestedValue = input.runId ?? env.V1_9_SUCCESSOR_RUN_ID?.trim();
  const requestedRunId = requestedValue ? requiredRunId(requestedValue, "v1_9_run_id_invalid") : null;
  const predecessorRunIdValue = env.V1_9_PREDECESSOR_RUN_ID?.trim() || null;
  const predecessorManifestValue = input.expectedPredecessorManifestSha256?.trim()
    || env.V1_9_PREDECESSOR_MANIFEST_SHA256?.trim()
    || null;
  if ((predecessorRunIdValue === null) !== (predecessorManifestValue === null)) {
    fail("v1_9_predecessor_pair_invalid");
  }
  const expectedPredecessorRunId = predecessorRunIdValue
    ? requiredRunId(predecessorRunIdValue, "v1_9_predecessor_invalid")
    : null;
  const expectedManifestDigest = predecessorManifestValue
    ? requiredDigest(predecessorManifestValue, "v1_9_predecessor_manifest_digest_invalid")
    : null;
  const resultsRoot = path.join(rootDir, "test-results");
  await ensureV1_9PrepareResultsRoot(rootDir, resultsRoot);

  return withV1_9PrepareLock(resultsRoot, dependencies, async () => {
    const recovered = await recoverV1_9PrepareTransaction({
      rootDir,
      testResultsRoot: resultsRoot,
      expectedPredecessorRunId,
      expectedPredecessorManifestSha256: expectedManifestDigest,
      requestedRunId,
      randomBytes: dependencies.randomBytes,
      assertBaselineLockCurrent: (expected) => {
        dependencies.assertCurrentBaselineLock(expected, { cwd: rootDir, env });
      },
    });
    if (recovered) return recovered;

    const pointerPath = path.join(resultsRoot, POINTER_FILE);
    assertV1_9PreparePath(resultsRoot, pointerPath, { allowMissing: true });
    const pointerBytes = await readOptional(pointerPath);
    if (!expectedPredecessorRunId && pointerBytes) fail("v1_9_fresh_active_pointer_conflict");
    const historyPath = path.join(resultsRoot, HISTORY_FILE);
    assertV1_9PreparePath(resultsRoot, historyPath, { allowMissing: true });
    const historyBytes = await readOptional(historyPath);
    const createdAt = timestamp(input.createdAt ?? dependencies.now().toISOString());
    const runId = requestedRunId ?? createRunId(createdAt, dependencies.randomBytes);
    let predecessorContext: Awaited<ReturnType<typeof readV1_9PredecessorContext>> | null = null;
    let predecessor: V1_9RunPredecessor | null = null;
    let historyEvidence: V1_9PredecessorHistoryEvidence | null = null;
    let nextHistory: V1_9RunHistoryIndex | null = null;
    if (expectedPredecessorRunId && expectedManifestDigest) {
      if (!pointerBytes) fail("v1_9_active_pointer_missing");
      const context = await readV1_9PredecessorContext({
        rootDir,
        pointerBytes,
        expectedPredecessorRunId,
        successorRunId: runId,
      });
      predecessorContext = context;
      if (context.manifestSha256 !== expectedManifestDigest) {
        fail("v1_9_predecessor_manifest_digest_mismatch");
      }
      const history = parseHistory(historyBytes);
      if (history.entries.some((entry) => entry.runId === context.pointerRunId)) {
        fail("v1_9_run_history_predecessor_duplicate");
      }
      if (runId === context.pointerRunId) fail("v1_9_run_id_invalid");
      predecessor = {
        runId: context.pointerRunId,
        relativeRunRoot: context.relativeRunRoot,
        manifestSha256: context.manifestSha256,
        disposition: context.disposition,
      };
      historyEvidence = {
        schemaVersion: "v1-9-predecessor-history-evidence.v1",
        predecessor,
        predecessorPointerSha256: sha256(pointerBytes),
        successorRunId: runId,
        verifiedAt: createdAt,
      };
      nextHistory = {
        schemaVersion: "v1-9-run-history.v1",
        entries: [...history.entries, {
          ...predecessor,
          manifestPath: `${predecessor.relativeRunRoot}/${MANIFEST_FILE}`,
          successorRunId: runId,
          recordedAt: createdAt,
        }],
      };
    }
    const relativeRunRoot = `test-results/${runId}`;
    if (await exists(resolveRunRoot(rootDir, relativeRunRoot))) fail("v1_9_run_root_exists");

    const baselineLock = dependencies.createBaselineLock({ cwd: rootDir, env });
    const executionLocks = await dependencies.resolveExecutionLocks({ env });
    const manifest = createV1_9RunManifestV2({
      runId,
      relativeRunRoot,
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
    const temporaryRunDirectoryName = `.v1-9-prepare-${runId}-${dependencies.randomBytes(4).toString("hex")}`;
    const transaction: V1_9PrepareTransaction = {
      schemaVersion: "v1-9-prepare-transaction.v2",
      mode: predecessor ? "successor" : "fresh",
      phase: "staged",
      predecessorRunId: predecessor?.runId ?? null,
      previousPointerSha256: pointerBytes ? sha256(pointerBytes) : null,
      predecessorManifestSha256: predecessor?.manifestSha256 ?? null,
      predecessorStateSha256: predecessorContext?.stateBytes ? sha256(predecessorContext.stateBytes) : null,
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
      assertSourceUnchanged: async ({ historyPublished, pointerPublished }) => {
        dependencies.assertCurrentBaselineLock(baselineLock, { cwd: rootDir, env });
        if (predecessorContext) {
          await assertV1_9PredecessorBytesUnchanged({
            pointerPath,
            context: predecessorContext,
            checkPointer: !pointerPublished,
          });
        } else if (!pointerPublished) {
          await assertOptionalBytesUnchanged(pointerPath, pointerBytes, "v1_9_active_pointer_drift");
        }
        if (pointerPublished) {
          const expectedPointerBytes = Buffer.from(`${JSON.stringify({
            schemaVersion: "v1-9-active-run.v2",
            ...prepared,
          }, null, 2)}\n`, "utf8");
          await assertOptionalBytesUnchanged(pointerPath, expectedPointerBytes, "v1_9_active_pointer_drift");
        }
        const expectedHistoryBytes = historyPublished && nextHistory
          ? Buffer.from(`${JSON.stringify(nextHistory, null, 2)}\n`, "utf8")
          : historyBytes;
        await assertOptionalBytesUnchanged(historyPath, expectedHistoryBytes, "v1_9_run_history_drift");
      },
    });
  });
}

export async function terminateV1_9RunForContractUpgrade(input: TerminateV1_9RunForContractUpgradeInput) {
  const rootDir = path.resolve(input.rootDir ?? process.cwd());
  const dependencies = { ...defaults, ...input.dependencies };
  const resultsRoot = path.join(rootDir, "test-results");
  await ensureV1_9PrepareResultsRoot(rootDir, resultsRoot);
  const predecessorRunId = requiredRunId(input.predecessorRunId, "v1_9_predecessor_invalid");
  const expectedManifest = requiredDigest(input.expectedPredecessorManifestSha256, "v1_9_predecessor_manifest_digest_invalid");
  const successorRunId = requiredRunId(input.successorRunId, "v1_9_run_id_invalid");
  if (successorRunId === predecessorRunId) fail("v1_9_successor_run_id_invalid");
  return withV1_9PrepareLock(resultsRoot, dependencies, async () => {
    if (await exists(path.join(resultsRoot, JOURNAL_FILE))) fail("v1_9_prepare_transaction_active");
    const pointerPath = path.join(resultsRoot, POINTER_FILE);
    assertV1_9PreparePath(resultsRoot, pointerPath, { kind: "file" });
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
      if (!context.stateBytes) fail("v1_9_predecessor_state_drift");
      await writeV1_9RunStateCooperativeCas({
        testResultsRoot: resultsRoot,
        statePath: context.statePath,
        expectedBytes: context.stateBytes,
        nextState,
        randomBytes: dependencies.randomBytes,
        prepareLockHeld: true,
        beforeCommit: input.dependencies?.beforeTerminationCommit,
      });
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
  requiredText(env.SHANHAI_SKILLS_SOURCE_ROOT, "v1_9_skills_source_root_required");
  requiredText(env.SHANHAI_SKILLS_RUNTIME_ROOT, "v1_9_skills_runtime_root_required");
}

async function readOptional(filePath: string) {
  try { return await readFile(filePath); } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}
async function assertOptionalBytesUnchanged(filePath: string, expected: Buffer | null, reason: string) {
  const current = await readOptional(filePath);
  if ((expected === null) !== (current === null) || (expected && current && !expected.equals(current))) fail(reason);
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
