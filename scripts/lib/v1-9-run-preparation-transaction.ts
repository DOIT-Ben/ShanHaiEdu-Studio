import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createV1_9RunManifestV2Digest,
  normalizeV1_9RunManifestV2,
  normalizeV1_9RunState,
  type V1_9RunManifestV2,
  type V1_9RunPredecessor,
  type V1_9RunState,
} from "./v1-9-e2e-contract.mjs";
const POINTER_FILE = "v1-9-product-e2e-active.json";
const HISTORY_FILE = "v1-9-product-e2e-history.json";
const MANIFEST_FILE = "run-manifest.json";
const STATE_FILE = "run-state.json";
const EVIDENCE_FILE = "predecessor-history-evidence.json";
const LOCK_DIR = ".v1-9-prepare.lock";
const LOCK_OWNER_FILE = "owner.json";
const JOURNAL_FILE = ".v1-9-prepare-transaction.json";
export type V1_9PrepareTransactionPhase =
  | "staged"
  | "run_published"
  | "history_published"
  | "pointer_published";
export type V1_9PrepareHookPhase =
  | "journal_written"
  | "manifest_staged"
  | "state_staged"
  | "evidence_staged"
  | V1_9PrepareTransactionPhase;
export type V1_9PreparedRun = {
  runId: string;
  relativeRunRoot: string;
  manifestPath: string;
  manifestSha256: string;
  statePath: string;
};
export type V1_9RunHistoryEntry = V1_9RunPredecessor & {
  manifestPath: string;
  successorRunId: string;
  recordedAt: string;
};
export type V1_9RunHistoryIndex = {
  schemaVersion: "v1-9-run-history.v1";
  entries: V1_9RunHistoryEntry[];
};

export type V1_9PredecessorHistoryEvidence = {
  schemaVersion: "v1-9-predecessor-history-evidence.v1";
  predecessor: V1_9RunPredecessor;
  predecessorPointerSha256: string;
  successorRunId: string;
  verifiedAt: string;
};

export type V1_9PrepareTransaction = {
  schemaVersion: "v1-9-prepare-transaction.v1";
  phase: V1_9PrepareTransactionPhase;
  predecessorRunId: string;
  predecessorPointerSha256: string;
  predecessorManifestSha256: string;
  predecessorStateSha256: string | null;
  previousHistorySha256: string | null;
  temporaryRunDirectoryName: string;
  prepared: V1_9PreparedRun;
  manifest: V1_9RunManifestV2;
  state: V1_9RunState;
  historyEvidence: V1_9PredecessorHistoryEvidence;
  nextHistory: V1_9RunHistoryIndex;
  createdAt: string;
};

export type V1_9PrepareIoDependencies = {
  now(): Date;
  randomBytes(size: number): Buffer;
  afterTransactionPhase(phase: V1_9PrepareHookPhase): void | Promise<void>;
};

type LockOwner = {
  schemaVersion: "v1-9-prepare-lock.v1";
  pid: number;
  token: string;
  createdAt: string;
};

export async function withV1_9PrepareLock<T>(
  testResultsRoot: string,
  dependencies: Pick<V1_9PrepareIoDependencies, "now" | "randomBytes">,
  operation: () => Promise<T>,
): Promise<T> {
  const owner = await acquireLock(testResultsRoot, dependencies);
  try {
    return await operation();
  } finally {
    await releaseLock(testResultsRoot, owner);
  }
}

export async function commitV1_9PrepareTransaction(input: {
  rootDir: string;
  testResultsRoot: string;
  transaction: V1_9PrepareTransaction;
  dependencies: V1_9PrepareIoDependencies;
  assertPredecessorUnchanged(): Promise<void>;
}) {
  const journalPath = path.join(input.testResultsRoot, JOURNAL_FILE);
  let transaction = normalizeTransaction(input.transaction);
  const temporaryRunRoot = resolveTemporaryRoot(
    input.testResultsRoot,
    transaction.temporaryRunDirectoryName,
  );
  const runRoot = resolveRunRoot(input.rootDir, transaction.prepared.relativeRunRoot);
  await writeJsonExclusive(journalPath, transaction);
  await input.dependencies.afterTransactionPhase("journal_written");
  await mkdir(temporaryRunRoot, { recursive: false });
  await writeJsonExclusive(path.join(temporaryRunRoot, MANIFEST_FILE), transaction.manifest);
  await input.dependencies.afterTransactionPhase("manifest_staged");
  await writeJsonExclusive(path.join(temporaryRunRoot, STATE_FILE), transaction.state);
  await input.dependencies.afterTransactionPhase("state_staged");
  await writeJsonExclusive(path.join(temporaryRunRoot, EVIDENCE_FILE), transaction.historyEvidence);
  await input.dependencies.afterTransactionPhase("evidence_staged");
  await verifyStagedRoot(temporaryRunRoot, transaction);
  await input.assertPredecessorUnchanged();
  await input.dependencies.afterTransactionPhase("staged");
  await rename(temporaryRunRoot, runRoot);
  transaction = await setPhase(journalPath, transaction, "run_published", input.dependencies.randomBytes);
  await input.dependencies.afterTransactionPhase("run_published");
  await input.assertPredecessorUnchanged();
  await writeJsonAtomic(path.join(input.testResultsRoot, HISTORY_FILE), transaction.nextHistory, input.dependencies.randomBytes);
  transaction = await setPhase(journalPath, transaction, "history_published", input.dependencies.randomBytes);
  await input.dependencies.afterTransactionPhase("history_published");
  await input.assertPredecessorUnchanged();
  await writeJsonAtomic(path.join(input.testResultsRoot, POINTER_FILE), activePointer(transaction), input.dependencies.randomBytes);
  transaction = await setPhase(journalPath, transaction, "pointer_published", input.dependencies.randomBytes);
  await input.dependencies.afterTransactionPhase("pointer_published");
  await verifyCommitted(input.rootDir, input.testResultsRoot, transaction);
  await rm(journalPath, { force: true });
  return transaction.prepared;
}

export async function recoverV1_9PrepareTransaction(input: {
  rootDir: string;
  testResultsRoot: string;
  expectedPredecessorRunId: string;
  expectedPredecessorManifestSha256: string | null;
  requestedRunId: string | null;
  randomBytes(size: number): Buffer;
}): Promise<V1_9PreparedRun | null> {
  const journalPath = path.join(input.testResultsRoot, JOURNAL_FILE);
  const bytes = await readOptional(journalPath);
  if (!bytes) return null;
  const transaction = parseTransaction(bytes);
  if (transaction.predecessorRunId !== input.expectedPredecessorRunId ||
      (input.requestedRunId && transaction.prepared.runId !== input.requestedRunId) ||
      (input.expectedPredecessorManifestSha256 &&
        transaction.predecessorManifestSha256 !== digest(input.expectedPredecessorManifestSha256))) {
    fail("v1_9_prepare_transaction_conflict");
  }
  const pointerPath = path.join(input.testResultsRoot, POINTER_FILE);
  const pointerBytes = await readFile(pointerPath).catch(() => fail("v1_9_active_pointer_missing"));
  const targetPointerBytes = Buffer.from(serialize(activePointer(transaction)), "utf8");
  if (sha256(pointerBytes) === sha256(targetPointerBytes)) {
    await verifyCommitted(input.rootDir, input.testResultsRoot, transaction);
    await rm(journalPath, { force: true });
    return transaction.prepared;
  }
  if (sha256(pointerBytes) !== transaction.predecessorPointerSha256) {
    fail("v1_9_prepare_transaction_conflict");
  }
  await verifyPredecessor(input.rootDir, transaction);
  const temporaryRoot = resolveTemporaryRoot(input.testResultsRoot, transaction.temporaryRunDirectoryName);
  const runRoot = resolveRunRoot(input.rootDir, transaction.prepared.relativeRunRoot);
  const temporaryExists = await exists(temporaryRoot);
  const runExists = await exists(runRoot);
  if (temporaryExists && runExists) fail("v1_9_prepare_transaction_conflict");
  if (!runExists) {
    if (temporaryExists) await rm(temporaryRoot, { recursive: true, force: true });
    await materializeStagedRoot(temporaryRoot, transaction);
    await rename(temporaryRoot, runRoot);
  }
  await verifyPreparedRoot(runRoot, transaction.prepared);
  const historyPath = path.join(input.testResultsRoot, HISTORY_FILE);
  const historyBytes = await readOptional(historyPath);
  const targetHistoryBytes = Buffer.from(serialize(transaction.nextHistory), "utf8");
  const historyDigest = historyBytes ? sha256(historyBytes) : null;
  if (historyDigest !== sha256(targetHistoryBytes)) {
    if (historyDigest !== transaction.previousHistorySha256) fail("v1_9_prepare_transaction_conflict");
    await writeJsonAtomic(historyPath, transaction.nextHistory, input.randomBytes);
  }
  await verifyPredecessor(input.rootDir, transaction);
  if (sha256(await readFile(pointerPath)) !== transaction.predecessorPointerSha256) {
    fail("v1_9_prepare_transaction_conflict");
  }
  await writeJsonAtomic(pointerPath, activePointer(transaction), input.randomBytes);
  await verifyCommitted(input.rootDir, input.testResultsRoot, transaction);
  await rm(journalPath, { force: true });
  return transaction.prepared;
}

async function acquireLock(
  testResultsRoot: string,
  dependencies: Pick<V1_9PrepareIoDependencies, "now" | "randomBytes">,
) {
  const token = dependencies.randomBytes(12).toString("hex");
  const owner: LockOwner = {
    schemaVersion: "v1-9-prepare-lock.v1",
    pid: process.pid,
    token,
    createdAt: dependencies.now().toISOString(),
  };
  const lockPath = path.join(testResultsRoot, LOCK_DIR);
  const candidate = path.join(testResultsRoot, `.v1-9-prepare-lock-candidate-${token}`);
  await mkdir(candidate);
  await writeJsonExclusive(path.join(candidate, LOCK_OWNER_FILE), owner);
  try {
    await rename(candidate, lockPath);
    return owner;
  } catch (error) {
    if (!alreadyExists(error)) {
      await rm(candidate, { recursive: true, force: true });
      throw error;
    }
  }
  let existing: LockOwner;
  try {
    existing = parseLockOwner(await readFile(path.join(lockPath, LOCK_OWNER_FILE)));
  } catch {
    await rm(candidate, { recursive: true, force: true });
    return fail("v1_9_prepare_locked");
  }
  if (processAlive(existing.pid)) {
    await rm(candidate, { recursive: true, force: true });
    return fail("v1_9_prepare_locked");
  }
  const stale = path.join(testResultsRoot, `.v1-9-prepare-lock-stale-${token}`);
  try {
    await rename(lockPath, stale);
    const quarantined = parseLockOwner(await readFile(path.join(stale, LOCK_OWNER_FILE)));
    if (quarantined.token !== existing.token || processAlive(quarantined.pid)) {
      fail("v1_9_prepare_lock_takeover_conflict");
    }
    await rename(candidate, lockPath);
    await rm(stale, { recursive: true, force: true });
    return owner;
  } catch (error) {
    await rm(candidate, { recursive: true, force: true });
    if (await exists(stale)) {
      if (!(await exists(lockPath))) await rename(stale, lockPath).catch(() => undefined);
      else {
        const staleOwner = await readFile(path.join(stale, LOCK_OWNER_FILE)).then(parseLockOwner).catch(() => null);
        if (staleOwner?.token === existing.token && !processAlive(staleOwner.pid)) {
          await rm(stale, { recursive: true, force: true });
        }
      }
    }
    if (error instanceof Error && error.message === "v1_9_prepare_lock_takeover_conflict") throw error;
    return fail("v1_9_prepare_locked");
  }
}

async function releaseLock(testResultsRoot: string, owner: LockOwner) {
  const lockPath = path.join(testResultsRoot, LOCK_DIR);
  const persisted = parseLockOwner(
    await readFile(path.join(lockPath, LOCK_OWNER_FILE)).catch(() => fail("v1_9_prepare_lock_lost")),
  );
  if (persisted.token !== owner.token || persisted.pid !== owner.pid) fail("v1_9_prepare_lock_lost");
  await rm(lockPath, { recursive: true, force: false });
}

async function setPhase(
  journalPath: string,
  transaction: V1_9PrepareTransaction,
  phase: V1_9PrepareTransactionPhase,
  randomBytes: (size: number) => Buffer,
) {
  const next = { ...transaction, phase };
  await writeJsonAtomic(journalPath, next, randomBytes);
  return next;
}

async function verifyCommitted(rootDir: string, resultsRoot: string, transaction: V1_9PrepareTransaction) {
  await verifyPreparedRoot(resolveRunRoot(rootDir, transaction.prepared.relativeRunRoot), transaction.prepared);
  if (!(await readFile(path.join(resultsRoot, POINTER_FILE))).equals(Buffer.from(serialize(activePointer(transaction))))) {
    fail("v1_9_prepare_transaction_commit_invalid");
  }
  if (!(await readFile(path.join(resultsRoot, HISTORY_FILE))).equals(Buffer.from(serialize(transaction.nextHistory)))) {
    fail("v1_9_prepare_transaction_commit_invalid");
  }
  await verifyPredecessor(rootDir, transaction);
}

async function verifyPredecessor(rootDir: string, transaction: V1_9PrepareTransaction) {
  const entry = transaction.nextHistory.entries.find((item) => item.runId === transaction.predecessorRunId);
  if (!entry) fail("v1_9_prepare_transaction_commit_invalid");
  if (sha256(await readFile(path.resolve(rootDir, ...entry.manifestPath.split("/")))) !==
      transaction.predecessorManifestSha256) fail("v1_9_predecessor_manifest_drift");
  if (transaction.predecessorStateSha256) {
    const statePath = path.resolve(rootDir, ...`${entry.relativeRunRoot}/${STATE_FILE}`.split("/"));
    if (sha256(await readFile(statePath)) !== transaction.predecessorStateSha256) {
      fail("v1_9_predecessor_state_drift");
    }
  }
}

async function materializeStagedRoot(root: string, transaction: V1_9PrepareTransaction) {
  await mkdir(root);
  await writeJsonExclusive(path.join(root, MANIFEST_FILE), transaction.manifest);
  await writeJsonExclusive(path.join(root, STATE_FILE), transaction.state);
  await writeJsonExclusive(path.join(root, EVIDENCE_FILE), transaction.historyEvidence);
  await verifyStagedRoot(root, transaction);
}

async function verifyStagedRoot(root: string, transaction: V1_9PrepareTransaction) {
  await verifyPreparedRoot(root, transaction.prepared);
  if (!(await readFile(path.join(root, EVIDENCE_FILE))).equals(Buffer.from(serialize(transaction.historyEvidence)))) {
    fail("v1_9_prepare_transaction_evidence_invalid");
  }
}

async function verifyPreparedRoot(root: string, prepared: V1_9PreparedRun) {
  const manifestBytes = await readFile(path.join(root, MANIFEST_FILE));
  if (sha256(manifestBytes) !== prepared.manifestSha256) fail("v1_9_prepare_transaction_manifest_invalid");
  const manifest = normalizeV1_9RunManifestV2(JSON.parse(manifestBytes.toString("utf8")));
  const state = normalizeV1_9RunState(JSON.parse(await readFile(path.join(root, STATE_FILE), "utf8")));
  if (createV1_9RunManifestV2Digest(manifest) !== prepared.manifestSha256 ||
      manifest.runId !== prepared.runId || manifest.relativeRunRoot !== prepared.relativeRunRoot ||
      state.runId !== prepared.runId || state.manifestSha256 !== prepared.manifestSha256 ||
      state.status !== "prepared") fail("v1_9_prepare_transaction_state_invalid");
}

function normalizeTransaction(value: V1_9PrepareTransaction) {
  return parseTransaction(Buffer.from(serialize(value)));
}

function parseTransaction(bytes: Buffer): V1_9PrepareTransaction {
  const value = record(JSON.parse(bytes.toString("utf8")));
  exact(value, ["schemaVersion", "phase", "predecessorRunId", "predecessorPointerSha256",
    "predecessorManifestSha256", "predecessorStateSha256", "previousHistorySha256",
    "temporaryRunDirectoryName", "prepared", "manifest", "state", "historyEvidence", "nextHistory", "createdAt"]);
  if (value.schemaVersion !== "v1-9-prepare-transaction.v1" ||
      !["staged", "run_published", "history_published", "pointer_published"].includes(String(value.phase))) {
    fail("v1_9_prepare_transaction_invalid");
  }
  const prepared = preparedRun(value.prepared);
  const manifest = normalizeV1_9RunManifestV2(value.manifest);
  const state = normalizeV1_9RunState(value.state);
  const historyEvidence = evidence(value.historyEvidence);
  const nextHistory = history(value.nextHistory);
  const predecessorRunId = runId(value.predecessorRunId);
  const temporaryRunDirectoryName = text(value.temporaryRunDirectoryName);
  if (!/^\.v1-9-prepare-v1-9-[A-Za-z0-9._-]+-[a-f0-9]{8}$/.test(temporaryRunDirectoryName) ||
      createV1_9RunManifestV2Digest(manifest) !== prepared.manifestSha256 ||
      manifest.runId !== prepared.runId || manifest.relativeRunRoot !== prepared.relativeRunRoot ||
      state.runId !== prepared.runId || state.manifestSha256 !== prepared.manifestSha256 || state.status !== "prepared" ||
      historyEvidence.successorRunId !== prepared.runId || historyEvidence.predecessor.runId !== predecessorRunId ||
      nextHistory.entries.filter((entry) => entry.successorRunId === prepared.runId).length !== 1) {
    fail("v1_9_prepare_transaction_invalid");
  }
  return {
    schemaVersion: "v1-9-prepare-transaction.v1",
    phase: value.phase as V1_9PrepareTransactionPhase,
    predecessorRunId,
    predecessorPointerSha256: digest(value.predecessorPointerSha256),
    predecessorManifestSha256: digest(value.predecessorManifestSha256),
    predecessorStateSha256: value.predecessorStateSha256 === null ? null : digest(value.predecessorStateSha256),
    previousHistorySha256: value.previousHistorySha256 === null ? null : digest(value.previousHistorySha256),
    temporaryRunDirectoryName,
    prepared,
    manifest,
    state,
    historyEvidence,
    nextHistory,
    createdAt: timestamp(value.createdAt),
  };
}

function preparedRun(value: unknown): V1_9PreparedRun {
  const item = record(value);
  exact(item, ["runId", "relativeRunRoot", "manifestPath", "manifestSha256", "statePath"]);
  const id = runId(item.runId);
  const root = runRoot(item.relativeRunRoot);
  if (path.posix.basename(root) !== id) fail("v1_9_prepare_transaction_invalid");
  return { runId: id, relativeRunRoot: root, manifestPath: runFile(item.manifestPath, root, MANIFEST_FILE),
    manifestSha256: digest(item.manifestSha256), statePath: runFile(item.statePath, root, STATE_FILE) };
}

function evidence(value: unknown): V1_9PredecessorHistoryEvidence {
  const item = record(value);
  exact(item, ["schemaVersion", "predecessor", "predecessorPointerSha256", "successorRunId", "verifiedAt"]);
  if (item.schemaVersion !== "v1-9-predecessor-history-evidence.v1") fail("v1_9_prepare_transaction_invalid");
  return { schemaVersion: "v1-9-predecessor-history-evidence.v1", predecessor: predecessor(item.predecessor),
    predecessorPointerSha256: digest(item.predecessorPointerSha256), successorRunId: runId(item.successorRunId),
    verifiedAt: timestamp(item.verifiedAt) };
}

function history(value: unknown): V1_9RunHistoryIndex {
  const item = record(value);
  exact(item, ["schemaVersion", "entries"]);
  if (item.schemaVersion !== "v1-9-run-history.v1" || !Array.isArray(item.entries)) fail("v1_9_prepare_transaction_invalid");
  const entries = item.entries.map((raw) => {
    const entry = record(raw);
    exact(entry, ["runId", "relativeRunRoot", "manifestSha256", "disposition", "manifestPath", "successorRunId", "recordedAt"]);
    const base = predecessor({
      runId: entry.runId,
      relativeRunRoot: entry.relativeRunRoot,
      manifestSha256: entry.manifestSha256,
      disposition: entry.disposition,
    });
    return { ...base, manifestPath: runFile(entry.manifestPath, base.relativeRunRoot, MANIFEST_FILE),
      successorRunId: runId(entry.successorRunId), recordedAt: timestamp(entry.recordedAt) };
  });
  if (new Set(entries.map((entry) => entry.runId)).size !== entries.length) fail("v1_9_prepare_transaction_invalid");
  return { schemaVersion: "v1-9-run-history.v1", entries };
}

function predecessor(value: unknown): V1_9RunPredecessor {
  const item = record(value);
  exact(item, ["runId", "relativeRunRoot", "manifestSha256", "disposition"]);
  const id = runId(item.runId);
  const root = runRoot(item.relativeRunRoot);
  const disposition = item.disposition;
  if (path.posix.basename(root) !== id || !["historical_failed", "terminated_contract_upgrade", "completed"].includes(String(disposition))) {
    fail("v1_9_prepare_transaction_invalid");
  }
  return { runId: id, relativeRunRoot: root, manifestSha256: digest(item.manifestSha256),
    disposition: disposition as V1_9RunPredecessor["disposition"] };
}

function parseLockOwner(bytes: Buffer): LockOwner {
  const item = record(JSON.parse(bytes.toString("utf8")));
  exact(item, ["schemaVersion", "pid", "token", "createdAt"]);
  if (item.schemaVersion !== "v1-9-prepare-lock.v1" || !Number.isSafeInteger(item.pid) || Number(item.pid) <= 0 ||
      !/^[a-f0-9]{24}$/.test(String(item.token))) fail("v1_9_prepare_lock_invalid");
  return { schemaVersion: "v1-9-prepare-lock.v1", pid: Number(item.pid), token: String(item.token),
    createdAt: timestamp(item.createdAt) };
}

function activePointer(transaction: V1_9PrepareTransaction) {
  return { schemaVersion: "v1-9-active-run.v2", ...transaction.prepared };
}

function resolveRunRoot(rootDir: string, relative: string) {
  const resultsRoot = path.resolve(rootDir, "test-results");
  const result = path.resolve(rootDir, ...runRoot(relative).split("/"));
  const child = path.relative(resultsRoot, result);
  if (!child || child.startsWith("..") || path.isAbsolute(child)) fail("v1_9_run_root_invalid");
  return result;
}

function resolveTemporaryRoot(resultsRoot: string, name: string) {
  if (!/^\.v1-9-prepare-v1-9-[A-Za-z0-9._-]+-[a-f0-9]{8}$/.test(name)) fail("v1_9_prepare_transaction_invalid");
  const result = path.resolve(resultsRoot, name);
  if (path.dirname(result) !== path.resolve(resultsRoot)) fail("v1_9_prepare_transaction_invalid");
  return result;
}

async function writeJsonExclusive(filePath: string, value: unknown) {
  await writeFile(filePath, serialize(value), { encoding: "utf8", flag: "wx" });
}

async function writeJsonAtomic(filePath: string, value: unknown, randomBytes: (size: number) => Buffer) {
  const temporary = `${filePath}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    await writeFile(temporary, serialize(value), { encoding: "utf8", flag: "wx" });
    await rename(temporary, filePath);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function readOptional(filePath: string) {
  try { return await readFile(filePath); } catch (error) {
    if (nodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

async function exists(filePath: string) {
  try { await access(filePath); return true; } catch { return false; }
}

function processAlive(pid: number) {
  try { process.kill(pid, 0); return true; } catch (error) { return !(nodeError(error) && error.code === "ESRCH"); }
}
function alreadyExists(error: unknown) { return nodeError(error) && ["EEXIST", "ENOTEMPTY", "EPERM"].includes(String(error.code)); }
function nodeError(error: unknown): error is NodeJS.ErrnoException { return error instanceof Error && "code" in error; }
function serialize(value: unknown) { return `${JSON.stringify(value, null, 2)}\n`; }
function sha256(value: Buffer | string) { return createHash("sha256").update(value).digest("hex"); }
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) fail("v1_9_prepare_transaction_invalid"); return value as Record<string, unknown>; }
function exact(value: Record<string, unknown>, fields: string[]) { if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) fail("v1_9_prepare_transaction_invalid"); }
function text(value: unknown) { const result = String(value ?? "").trim(); if (!result) fail("v1_9_prepare_transaction_invalid"); return result; }
function runId(value: unknown) { const result = text(value); if (!/^v1-9-[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(result)) fail("v1_9_prepare_transaction_invalid"); return result; }
function runRoot(value: unknown) { const result = text(value).replaceAll("\\", "/"); if (!/^test-results\/v1-9-[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(result) || result.includes("..")) fail("v1_9_prepare_transaction_invalid"); return result; }
function runFile(value: unknown, root: string, name: string) { const result = text(value).replaceAll("\\", "/"); if (result !== `${root}/${name}`) fail("v1_9_prepare_transaction_invalid"); return result; }
function digest(value: unknown) { const result = text(value).toLowerCase(); if (!/^[a-f0-9]{64}$/.test(result)) fail("v1_9_prepare_transaction_invalid"); return result; }
function timestamp(value: unknown) { const result = text(value); if (!Number.isFinite(Date.parse(result))) fail("v1_9_prepare_transaction_invalid"); return new Date(result).toISOString(); }
function fail(reason: string): never { throw new Error(reason); }
