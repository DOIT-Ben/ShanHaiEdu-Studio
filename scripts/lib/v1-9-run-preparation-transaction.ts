import { createHash } from "node:crypto";
import { existsSync, lstatSync } from "node:fs";
import { access, link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createV1_9RunManifestV2Digest,
  normalizeV1_9RunManifestV2,
  normalizeV1_9RunState,
  type V1_9RunManifestV2,
  type V1_9RunPredecessor,
  type V1_9RunState,
} from "./v1-9-e2e-contract.mjs";
import { assertCanonicalExistingPathChain } from "./physical-path-integrity.mjs";
const POINTER_FILE = "v1-9-product-e2e-active.json";
const HISTORY_FILE = "v1-9-product-e2e-history.json";
const MANIFEST_FILE = "run-manifest.json";
const STATE_FILE = "run-state.json";
const EVIDENCE_FILE = "predecessor-history-evidence.json";
const LOCK_DIR = ".v1-9-prepare.lock";
const LOCK_OWNER_FILE = "owner.json";
const LOCK_TAKEOVER_CLAIM_FILE = "takeover-claim.json";
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
  | "before_pointer_publish"
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
  schemaVersion: "v1-9-prepare-transaction.v2";
  mode: "fresh" | "successor";
  phase: V1_9PrepareTransactionPhase;
  predecessorRunId: string | null;
  previousPointerSha256: string | null;
  predecessorManifestSha256: string | null;
  predecessorStateSha256: string | null;
  previousHistorySha256: string | null;
  temporaryRunDirectoryName: string;
  prepared: V1_9PreparedRun;
  manifest: V1_9RunManifestV2;
  state: V1_9RunState;
  historyEvidence: V1_9PredecessorHistoryEvidence | null;
  nextHistory: V1_9RunHistoryIndex | null;
  createdAt: string;
};

export type V1_9PrepareIoDependencies = {
  now(): Date;
  randomBytes(size: number): Buffer;
  afterTransactionPhase(phase: V1_9PrepareHookPhase): void | Promise<void>;
  afterLockTakeoverClaimed(): void | Promise<void>;
};

type LockOwner = {
  schemaVersion: "v1-9-prepare-lock.v1";
  pid: number;
  token: string;
  createdAt: string;
};

type LockTakeoverClaim = {
  schemaVersion: "v1-9-prepare-lock-takeover-claim.v1";
  claimantPid: number;
  claimantToken: string;
  expectedOwnerToken: string;
  createdAt: string;
};

export async function withV1_9PrepareLock<T>(
  testResultsRoot: string,
  dependencies: Pick<V1_9PrepareIoDependencies, "now" | "randomBytes"> &
    Partial<Pick<V1_9PrepareIoDependencies, "afterLockTakeoverClaimed">>,
  operation: () => Promise<T>,
): Promise<T> {
  assertV1_9PreparePath(testResultsRoot, testResultsRoot, { kind: "directory" });
  const owner = await acquireLock(testResultsRoot, dependencies);
  try {
    return await operation();
  } finally {
    await releaseLock(testResultsRoot, owner);
  }
}

export async function ensureV1_9PrepareResultsRoot(rootDir: string, testResultsRoot: string) {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedResultsRoot = path.resolve(testResultsRoot);
  if (resolvedResultsRoot !== path.join(resolvedRoot, "test-results")) fail("v1_9_prepare_path_unsafe");
  assertPhysicalPath(resolvedRoot, { kind: "directory" });
  assertPhysicalPath(resolvedResultsRoot, { allowMissing: true });
  await mkdir(resolvedResultsRoot, { recursive: true });
  assertPhysicalPath(resolvedResultsRoot, { kind: "directory" });
}

export async function writeV1_9RunStateCooperativeCas(input: {
  testResultsRoot: string;
  statePath: string;
  expectedBytes: Buffer;
  nextState: V1_9RunState;
  randomBytes(size: number): Buffer;
  prepareLockHeld?: boolean;
  beforeCommit?(): void | Promise<void>;
}) {
  const normalizedState = normalizeV1_9RunState(input.nextState);
  const nextBytes = Buffer.from(serialize(normalizedState), "utf8");
  const commit = async () => {
    const temporary = `${input.statePath}.tmp-${process.pid}-${input.randomBytes(6).toString("hex")}`;
    assertV1_9PreparePath(input.testResultsRoot, input.statePath, { kind: "file" });
    assertV1_9PreparePath(input.testResultsRoot, temporary, { allowMissing: true });
    if (!(await readFile(input.statePath)).equals(input.expectedBytes)) fail("v1_9_predecessor_state_drift");
    try {
      await writeFile(temporary, nextBytes, { flag: "wx" });
      assertV1_9PreparePath(input.testResultsRoot, temporary, { kind: "file" });
      await input.beforeCommit?.();
      if (!(await readFile(input.statePath)).equals(input.expectedBytes)) fail("v1_9_predecessor_state_drift");
      assertV1_9PreparePath(input.testResultsRoot, input.statePath, { kind: "file" });
      await rename(temporary, input.statePath);
      assertV1_9PreparePath(input.testResultsRoot, input.statePath, { kind: "file" });
      if (!(await readFile(input.statePath)).equals(nextBytes)) fail("v1_9_run_state_write_failed"); return nextBytes;
    } catch (error) {
      if (existsSync(temporary)) await removePreparePath(input.testResultsRoot, temporary, { force: true });
      throw error;
    }
  };
  if (input.prepareLockHeld) return commit();
  return withV1_9PrepareLock(input.testResultsRoot,
    { now: () => new Date(), randomBytes: input.randomBytes }, commit);
}

export function assertV1_9PreparePath(
  testResultsRoot: string,
  targetPath: string,
  options: { allowMissing?: boolean; kind?: "directory" | "file" } = {},
) {
  const root = path.resolve(testResultsRoot);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail("v1_9_prepare_path_unsafe");
  }
  assertPhysicalPath(root, { kind: "directory" });
  assertPhysicalPath(target, options);
  return target;
}

export async function commitV1_9PrepareTransaction(input: {
  rootDir: string;
  testResultsRoot: string;
  transaction: V1_9PrepareTransaction;
  dependencies: V1_9PrepareIoDependencies;
  assertSourceUnchanged(input: { historyPublished: boolean; pointerPublished: boolean }): Promise<void>;
}) {
  const journalPath = path.join(input.testResultsRoot, JOURNAL_FILE);
  let transaction = normalizeTransaction(input.transaction);
  const temporaryRunRoot = resolveTemporaryRoot(
    input.testResultsRoot,
    transaction.temporaryRunDirectoryName,
  );
  const runRoot = resolveRunRoot(input.rootDir, transaction.prepared.relativeRunRoot);
  assertV1_9PreparePath(input.testResultsRoot, temporaryRunRoot, { allowMissing: true });
  assertV1_9PreparePath(input.testResultsRoot, runRoot, { allowMissing: true });
  await writeJsonExclusive(input.testResultsRoot, journalPath, transaction);
  await input.dependencies.afterTransactionPhase("journal_written");
  await createPrepareDirectory(input.testResultsRoot, temporaryRunRoot);
  await writeJsonExclusive(input.testResultsRoot, path.join(temporaryRunRoot, MANIFEST_FILE), transaction.manifest);
  await input.dependencies.afterTransactionPhase("manifest_staged");
  assertV1_9PreparePath(input.testResultsRoot, temporaryRunRoot, { kind: "directory" });
  await writeJsonExclusive(input.testResultsRoot, path.join(temporaryRunRoot, STATE_FILE), transaction.state);
  await input.dependencies.afterTransactionPhase("state_staged");
  assertV1_9PreparePath(input.testResultsRoot, temporaryRunRoot, { kind: "directory" });
  if (transaction.historyEvidence) {
    await writeJsonExclusive(input.testResultsRoot, path.join(temporaryRunRoot, EVIDENCE_FILE), transaction.historyEvidence);
    await input.dependencies.afterTransactionPhase("evidence_staged");
    assertV1_9PreparePath(input.testResultsRoot, temporaryRunRoot, { kind: "directory" });
  }
  await verifyStagedRoot(input.testResultsRoot, temporaryRunRoot, transaction);
  await input.assertSourceUnchanged({ historyPublished: false, pointerPublished: false });
  await input.dependencies.afterTransactionPhase("staged");
  await renamePreparePath(input.testResultsRoot, temporaryRunRoot, runRoot);
  transaction = await setPhase(journalPath, transaction, "run_published", input.dependencies.randomBytes);
  await input.dependencies.afterTransactionPhase("run_published");
  await input.assertSourceUnchanged({ historyPublished: false, pointerPublished: false });
  if (transaction.nextHistory) {
    await writeJsonAtomic(input.testResultsRoot, path.join(input.testResultsRoot, HISTORY_FILE), transaction.nextHistory,
      input.dependencies.randomBytes);
  }
  transaction = await setPhase(journalPath, transaction, "history_published", input.dependencies.randomBytes);
  if (transaction.nextHistory) await input.dependencies.afterTransactionPhase("history_published");
  await input.assertSourceUnchanged({ historyPublished: true, pointerPublished: false });
  await input.dependencies.afterTransactionPhase("before_pointer_publish");
  await input.assertSourceUnchanged({ historyPublished: true, pointerPublished: false });
  await publishActivePointer(input.testResultsRoot, transaction, input.dependencies.randomBytes);
  await input.assertSourceUnchanged({ historyPublished: true, pointerPublished: true });
  transaction = await setPhase(journalPath, transaction, "pointer_published", input.dependencies.randomBytes);
  await input.dependencies.afterTransactionPhase("pointer_published");
  await input.assertSourceUnchanged({ historyPublished: true, pointerPublished: true });
  await verifyCommitted(input.rootDir, input.testResultsRoot, transaction);
  await removePreparePath(input.testResultsRoot, journalPath, { force: true });
  return transaction.prepared;
}

export async function recoverV1_9PrepareTransaction(input: {
  rootDir: string;
  testResultsRoot: string;
  expectedPredecessorRunId: string | null;
  expectedPredecessorManifestSha256: string | null;
  requestedRunId: string | null;
  randomBytes(size: number): Buffer;
  assertBaselineLockCurrent?(expected: V1_9RunManifestV2["baselineLock"]): void | Promise<void>;
}): Promise<V1_9PreparedRun | null> {
  const journalPath = path.join(input.testResultsRoot, JOURNAL_FILE);
  const bytes = await readOptional(input.testResultsRoot, journalPath);
  if (!bytes) return null;
  const transaction = parseTransaction(bytes);
  const expectedMode = input.expectedPredecessorRunId === null ? "fresh" : "successor";
  if (transaction.mode !== expectedMode || transaction.predecessorRunId !== input.expectedPredecessorRunId ||
      (input.requestedRunId && transaction.prepared.runId !== input.requestedRunId) ||
      (input.expectedPredecessorManifestSha256 &&
        transaction.predecessorManifestSha256 !== digest(input.expectedPredecessorManifestSha256)) ||
      (!input.expectedPredecessorManifestSha256 && transaction.predecessorManifestSha256 !== null)) {
    fail("v1_9_prepare_transaction_conflict");
  }
  const pointerPath = path.join(input.testResultsRoot, POINTER_FILE);
  const pointerBytes = await readOptional(input.testResultsRoot, pointerPath);
  const targetPointerBytes = Buffer.from(serialize(activePointer(transaction)), "utf8");
  if (pointerBytes?.equals(targetPointerBytes)) {
    await input.assertBaselineLockCurrent?.(transaction.manifest.baselineLock);
    await verifyCommitted(input.rootDir, input.testResultsRoot, transaction);
    await removePreparePath(input.testResultsRoot, journalPath, { force: true });
    return transaction.prepared;
  }
  if (optionalDigest(pointerBytes) !== transaction.previousPointerSha256) {
    fail("v1_9_prepare_transaction_conflict");
  }
  await verifyPredecessor(input.rootDir, input.testResultsRoot, transaction);
  const temporaryRoot = resolveTemporaryRoot(input.testResultsRoot, transaction.temporaryRunDirectoryName);
  const runRoot = resolveRunRoot(input.rootDir, transaction.prepared.relativeRunRoot);
  const temporaryExists = await exists(temporaryRoot);
  const runExists = await exists(runRoot);
  if (temporaryExists && runExists) fail("v1_9_prepare_transaction_conflict");
  if (!runExists) {
    if (temporaryExists) await removePreparePath(input.testResultsRoot, temporaryRoot, { recursive: true, force: true });
    await materializeStagedRoot(input.testResultsRoot, temporaryRoot, transaction);
    await input.assertBaselineLockCurrent?.(transaction.manifest.baselineLock);
    await renamePreparePath(input.testResultsRoot, temporaryRoot, runRoot);
  }
  await verifyStagedRoot(input.testResultsRoot, runRoot, transaction);
  const historyPath = path.join(input.testResultsRoot, HISTORY_FILE);
  const historyBytes = await readOptional(input.testResultsRoot, historyPath);
  const targetHistoryBytes = transaction.nextHistory ? Buffer.from(serialize(transaction.nextHistory), "utf8") : null;
  const historyDigest = historyBytes ? sha256(historyBytes) : null;
  if (targetHistoryBytes && historyDigest !== sha256(targetHistoryBytes)) {
    if (historyDigest !== transaction.previousHistorySha256) fail("v1_9_prepare_transaction_conflict");
    await input.assertBaselineLockCurrent?.(transaction.manifest.baselineLock);
    await writeJsonAtomic(input.testResultsRoot, historyPath, transaction.nextHistory, input.randomBytes);
  } else if (!targetHistoryBytes && historyDigest !== transaction.previousHistorySha256) {
    fail("v1_9_prepare_transaction_conflict");
  }
  await verifyPredecessor(input.rootDir, input.testResultsRoot, transaction);
  if (optionalDigest(await readOptional(input.testResultsRoot, pointerPath)) !== transaction.previousPointerSha256) {
    fail("v1_9_prepare_transaction_conflict");
  }
  await input.assertBaselineLockCurrent?.(transaction.manifest.baselineLock);
  await publishActivePointer(input.testResultsRoot, transaction, input.randomBytes);
  await verifyCommitted(input.rootDir, input.testResultsRoot, transaction);
  await removePreparePath(input.testResultsRoot, journalPath, { force: true });
  return transaction.prepared;
}

async function acquireLock(
  testResultsRoot: string,
  dependencies: Pick<V1_9PrepareIoDependencies, "now" | "randomBytes"> &
    Partial<Pick<V1_9PrepareIoDependencies, "afterLockTakeoverClaimed">>,
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
  await createPrepareDirectory(testResultsRoot, candidate);
  await writeJsonExclusive(testResultsRoot, path.join(candidate, LOCK_OWNER_FILE), owner);
  try {
    await renamePreparePath(testResultsRoot, candidate, lockPath);
    return owner;
  } catch (error) {
    if (!alreadyExists(error)) {
      await removePreparePath(testResultsRoot, candidate, { recursive: true, force: true });
      throw error;
    }
  }
  let existing: LockOwner;
  try {
    assertV1_9PreparePath(testResultsRoot, path.join(lockPath, LOCK_OWNER_FILE), { kind: "file" });
    existing = parseLockOwner(await readFile(path.join(lockPath, LOCK_OWNER_FILE)));
  } catch {
    await removePreparePath(testResultsRoot, candidate, { recursive: true, force: true });
    return fail("v1_9_prepare_locked");
  }
  if (processAlive(existing.pid)) {
    await removePreparePath(testResultsRoot, candidate, { recursive: true, force: true });
    return fail("v1_9_prepare_locked");
  }
  const claim: LockTakeoverClaim = {
    schemaVersion: "v1-9-prepare-lock-takeover-claim.v1",
    claimantPid: process.pid,
    claimantToken: token,
    expectedOwnerToken: existing.token,
    createdAt: dependencies.now().toISOString(),
  };
  let claimPath: string;
  try {
    claimPath = await acquireTakeoverClaim(testResultsRoot, lockPath, claim, existing);
  } catch (error) {
    await removePreparePath(testResultsRoot, candidate, { recursive: true, force: true });
    throw error;
  }
  await dependencies.afterLockTakeoverClaimed?.();
  const stale = path.join(testResultsRoot, `.v1-9-prepare-lock-stale-${token}`);
  try {
    assertV1_9PreparePath(testResultsRoot, path.join(lockPath, LOCK_OWNER_FILE), { kind: "file" });
    const claimedOwner = parseLockOwner(await readFile(path.join(lockPath, LOCK_OWNER_FILE)));
    if (claimedOwner.token !== existing.token || claimedOwner.pid !== existing.pid || processAlive(claimedOwner.pid)) {
      fail("v1_9_prepare_lock_takeover_conflict");
    }
    await renamePreparePath(testResultsRoot, lockPath, stale);
    assertV1_9PreparePath(testResultsRoot, path.join(stale, LOCK_OWNER_FILE), { kind: "file" });
    const quarantined = parseLockOwner(await readFile(path.join(stale, LOCK_OWNER_FILE)));
    if (quarantined.token !== existing.token || processAlive(quarantined.pid)) {
      fail("v1_9_prepare_lock_takeover_conflict");
    }
    await renamePreparePath(testResultsRoot, candidate, lockPath);
    await removePreparePath(testResultsRoot, stale, { recursive: true, force: true });
    return owner;
  } catch (error) {
    if (await exists(candidate)) await removePreparePath(testResultsRoot, candidate, { recursive: true, force: true });
    if (await exists(stale)) {
      if (!(await exists(lockPath))) await renamePreparePath(testResultsRoot, stale, lockPath).catch(() => undefined);
      else {
        assertV1_9PreparePath(testResultsRoot, path.join(stale, LOCK_OWNER_FILE), { kind: "file" });
        const staleOwner = await readFile(path.join(stale, LOCK_OWNER_FILE)).then(parseLockOwner).catch(() => null);
        if (staleOwner?.token === existing.token && !processAlive(staleOwner.pid)) {
          await removePreparePath(testResultsRoot, stale, { recursive: true, force: true });
        }
      }
    }
    await removeOwnedTakeoverClaim(testResultsRoot, claimPath, claim);
    if (error instanceof Error && error.message === "v1_9_prepare_lock_takeover_conflict") throw error;
    return fail("v1_9_prepare_locked");
  }
}

async function releaseLock(testResultsRoot: string, owner: LockOwner) {
  const lockPath = path.join(testResultsRoot, LOCK_DIR);
  assertV1_9PreparePath(testResultsRoot, path.join(lockPath, LOCK_OWNER_FILE), { kind: "file" });
  const persisted = parseLockOwner(
    await readFile(path.join(lockPath, LOCK_OWNER_FILE)).catch(() => fail("v1_9_prepare_lock_lost")),
  );
  if (persisted.token !== owner.token || persisted.pid !== owner.pid) fail("v1_9_prepare_lock_lost");
  await removePreparePath(testResultsRoot, lockPath, { recursive: true, force: false });
}

async function setPhase(
  journalPath: string,
  transaction: V1_9PrepareTransaction,
  phase: V1_9PrepareTransactionPhase,
  randomBytes: (size: number) => Buffer,
) {
  const next = { ...transaction, phase };
  await writeJsonAtomic(path.dirname(journalPath), journalPath, next, randomBytes);
  return next;
}

async function verifyCommitted(rootDir: string, resultsRoot: string, transaction: V1_9PrepareTransaction) {
  await verifyStagedRoot(
    resultsRoot,
    resolveRunRoot(rootDir, transaction.prepared.relativeRunRoot),
    transaction,
  );
  assertV1_9PreparePath(resultsRoot, path.join(resultsRoot, POINTER_FILE), { kind: "file" });
  if (!(await readFile(path.join(resultsRoot, POINTER_FILE))).equals(Buffer.from(serialize(activePointer(transaction))))) {
    fail("v1_9_prepare_transaction_commit_invalid");
  }
  const historyBytes = await readOptional(resultsRoot, path.join(resultsRoot, HISTORY_FILE));
  if (transaction.nextHistory) {
    if (!historyBytes?.equals(Buffer.from(serialize(transaction.nextHistory)))) {
      fail("v1_9_prepare_transaction_commit_invalid");
    }
  } else if (optionalDigest(historyBytes) !== transaction.previousHistorySha256) {
    fail("v1_9_prepare_transaction_commit_invalid");
  }
  await verifyPredecessor(rootDir, resultsRoot, transaction);
}

async function verifyPredecessor(
  rootDir: string,
  resultsRoot: string,
  transaction: V1_9PrepareTransaction,
) {
  if (transaction.mode === "fresh") return;
  if (!transaction.nextHistory || !transaction.predecessorRunId || !transaction.predecessorManifestSha256) {
    fail("v1_9_prepare_transaction_commit_invalid");
  }
  const entry = transaction.nextHistory.entries.find((item) => item.runId === transaction.predecessorRunId);
  if (!entry) fail("v1_9_prepare_transaction_commit_invalid");
  const manifestPath = path.resolve(rootDir, ...entry.manifestPath.split("/"));
  assertV1_9PreparePath(resultsRoot, manifestPath, { kind: "file" });
  if (sha256(await readFile(manifestPath)) !==
      transaction.predecessorManifestSha256) fail("v1_9_predecessor_manifest_drift");
  if (transaction.predecessorStateSha256) {
    const statePath = path.resolve(rootDir, ...`${entry.relativeRunRoot}/${STATE_FILE}`.split("/"));
    assertV1_9PreparePath(resultsRoot, statePath, { kind: "file" });
    if (sha256(await readFile(statePath)) !== transaction.predecessorStateSha256) {
      fail("v1_9_predecessor_state_drift");
    }
  }
}

async function materializeStagedRoot(resultsRoot: string, root: string, transaction: V1_9PrepareTransaction) {
  await createPrepareDirectory(resultsRoot, root);
  await writeJsonExclusive(resultsRoot, path.join(root, MANIFEST_FILE), transaction.manifest);
  await writeJsonExclusive(resultsRoot, path.join(root, STATE_FILE), transaction.state);
  if (transaction.historyEvidence) {
    await writeJsonExclusive(resultsRoot, path.join(root, EVIDENCE_FILE), transaction.historyEvidence);
  }
  await verifyStagedRoot(resultsRoot, root, transaction);
}

async function verifyStagedRoot(resultsRoot: string, root: string, transaction: V1_9PrepareTransaction) {
  await verifyPreparedRoot(resultsRoot, root, transaction.prepared);
  const evidenceBytes = await readOptional(resultsRoot, path.join(root, EVIDENCE_FILE));
  if (transaction.historyEvidence) {
    if (!evidenceBytes?.equals(Buffer.from(serialize(transaction.historyEvidence)))) {
      fail("v1_9_prepare_transaction_evidence_invalid");
    }
  } else if (evidenceBytes) {
    fail("v1_9_prepare_transaction_evidence_invalid");
  }
}

async function verifyPreparedRoot(resultsRoot: string, root: string, prepared: V1_9PreparedRun) {
  assertV1_9PreparePath(resultsRoot, root, { kind: "directory" });
  assertV1_9PreparePath(resultsRoot, path.join(root, MANIFEST_FILE), { kind: "file" });
  assertV1_9PreparePath(resultsRoot, path.join(root, STATE_FILE), { kind: "file" });
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
  exact(value, ["schemaVersion", "mode", "phase", "predecessorRunId", "previousPointerSha256",
    "predecessorManifestSha256", "predecessorStateSha256", "previousHistorySha256",
    "temporaryRunDirectoryName", "prepared", "manifest", "state", "historyEvidence", "nextHistory", "createdAt"]);
  if (value.schemaVersion !== "v1-9-prepare-transaction.v2" ||
      !["fresh", "successor"].includes(String(value.mode)) ||
      !["staged", "run_published", "history_published", "pointer_published"].includes(String(value.phase))) {
    fail("v1_9_prepare_transaction_invalid");
  }
  const prepared = preparedRun(value.prepared);
  const manifest = normalizeV1_9RunManifestV2(value.manifest);
  const state = normalizeV1_9RunState(value.state);
  const historyEvidence = value.historyEvidence === null ? null : evidence(value.historyEvidence);
  const nextHistory = value.nextHistory === null ? null : history(value.nextHistory);
  const predecessorRunId = value.predecessorRunId === null ? null : runId(value.predecessorRunId);
  const predecessorManifestSha256 = value.predecessorManifestSha256 === null
    ? null
    : digest(value.predecessorManifestSha256);
  const temporaryRunDirectoryName = text(value.temporaryRunDirectoryName);
  if (!/^\.v1-9-prepare-v1-9-[A-Za-z0-9._-]+-[a-f0-9]{8}$/.test(temporaryRunDirectoryName) ||
      createV1_9RunManifestV2Digest(manifest) !== prepared.manifestSha256 ||
      manifest.runId !== prepared.runId || manifest.relativeRunRoot !== prepared.relativeRunRoot ||
      state.runId !== prepared.runId || state.manifestSha256 !== prepared.manifestSha256 || state.status !== "prepared" ||
      (value.mode === "fresh" && (predecessorRunId !== null || value.previousPointerSha256 !== null ||
        predecessorManifestSha256 !== null ||
        value.predecessorStateSha256 !== null || historyEvidence !== null || nextHistory !== null || manifest.predecessor !== null)) ||
      (value.mode === "successor" && (!predecessorRunId || !predecessorManifestSha256 || !historyEvidence || !nextHistory ||
        !manifest.predecessor || historyEvidence.successorRunId !== prepared.runId ||
        historyEvidence.predecessor.runId !== predecessorRunId ||
        nextHistory.entries.filter((entry) => entry.successorRunId === prepared.runId).length !== 1))) {
    fail("v1_9_prepare_transaction_invalid");
  }
  return {
    schemaVersion: "v1-9-prepare-transaction.v2",
    mode: value.mode as "fresh" | "successor",
    phase: value.phase as V1_9PrepareTransactionPhase,
    predecessorRunId,
    previousPointerSha256: value.previousPointerSha256 === null ? null : digest(value.previousPointerSha256),
    predecessorManifestSha256,
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

async function removeOwnedTakeoverClaim(
  resultsRoot: string,
  claimPath: string,
  claim: LockTakeoverClaim,
) {
  const bytes = await readOptional(resultsRoot, claimPath);
  if (!bytes) return;
  if (!bytes.equals(Buffer.from(serialize(claim), "utf8"))) return;
  await removePreparePath(resultsRoot, claimPath, { force: false });
}

async function acquireTakeoverClaim(
  resultsRoot: string,
  lockPath: string,
  claim: LockTakeoverClaim,
  expectedOwner: LockOwner,
) {
  const claimPath = path.join(lockPath, LOCK_TAKEOVER_CLAIM_FILE);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await writeJsonExclusive(resultsRoot, claimPath, claim);
      return claimPath;
    } catch (error) {
      if (!alreadyExists(error)) throw error;
    }
    const existingBytes = await readOptional(resultsRoot, claimPath);
    if (!existingBytes) continue;
    const existingClaim = parseTakeoverClaim(existingBytes);
    if (existingClaim.expectedOwnerToken !== expectedOwner.token || processAlive(existingClaim.claimantPid)) {
      fail("v1_9_prepare_locked");
    }
    const staleClaimPath = path.join(resultsRoot,
      `.v1-9-prepare-claim-stale-${claim.claimantToken}-${attempt}`);
    try {
      await renamePreparePath(resultsRoot, claimPath, staleClaimPath);
    } catch (error) {
      if (nodeError(error) && error.code === "ENOENT") continue;
      throw error;
    }
    assertV1_9PreparePath(resultsRoot, staleClaimPath, { kind: "file" });
    if (!(await readFile(staleClaimPath)).equals(existingBytes)) fail("v1_9_prepare_lock_takeover_conflict");
    await removePreparePath(resultsRoot, staleClaimPath, { force: false });
  }
  return fail("v1_9_prepare_locked");
}

function parseTakeoverClaim(bytes: Buffer): LockTakeoverClaim {
  const item = record(JSON.parse(bytes.toString("utf8")));
  exact(item, ["schemaVersion", "claimantPid", "claimantToken", "expectedOwnerToken", "createdAt"]);
  if (item.schemaVersion !== "v1-9-prepare-lock-takeover-claim.v1" ||
      !Number.isSafeInteger(item.claimantPid) || Number(item.claimantPid) <= 0 ||
      !/^[a-f0-9]{24}$/.test(String(item.claimantToken)) ||
      !/^[a-f0-9]{24}$/.test(String(item.expectedOwnerToken))) {
    fail("v1_9_prepare_lock_invalid");
  }
  return {
    schemaVersion: "v1-9-prepare-lock-takeover-claim.v1",
    claimantPid: Number(item.claimantPid),
    claimantToken: String(item.claimantToken),
    expectedOwnerToken: String(item.expectedOwnerToken),
    createdAt: timestamp(item.createdAt),
  };
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

async function writeJsonExclusive(resultsRoot: string, filePath: string, value: unknown) {
  assertV1_9PreparePath(resultsRoot, filePath, { allowMissing: true });
  await writeFile(filePath, serialize(value), { encoding: "utf8", flag: "wx" });
  assertV1_9PreparePath(resultsRoot, filePath, { kind: "file" });
}

async function writeJsonAtomic(
  resultsRoot: string,
  filePath: string,
  value: unknown,
  randomBytes: (size: number) => Buffer,
) {
  const temporary = `${filePath}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    assertV1_9PreparePath(resultsRoot, filePath, { allowMissing: true });
    assertV1_9PreparePath(resultsRoot, temporary, { allowMissing: true });
    await writeFile(temporary, serialize(value), { encoding: "utf8", flag: "wx" });
    assertV1_9PreparePath(resultsRoot, temporary, { kind: "file" });
    assertV1_9PreparePath(resultsRoot, filePath, { allowMissing: true });
    await rename(temporary, filePath);
    assertV1_9PreparePath(resultsRoot, filePath, { kind: "file" });
  } catch (error) {
    if (existsSync(temporary)) await removePreparePath(resultsRoot, temporary, { force: true });
    throw error;
  }
}

async function readOptional(resultsRoot: string, filePath: string) {
  assertV1_9PreparePath(resultsRoot, filePath, { allowMissing: true });
  try { return await readFile(filePath); } catch (error) {
    if (nodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

async function publishActivePointer(
  resultsRoot: string,
  transaction: V1_9PrepareTransaction,
  randomBytes: (size: number) => Buffer,
) {
  const pointerPath = path.join(resultsRoot, POINTER_FILE);
  if (transaction.mode === "fresh") {
    try {
      await writeJsonCreateIfAbsentAtomic(resultsRoot, pointerPath, activePointer(transaction), randomBytes);
    } catch (error) {
      if (alreadyExists(error)) fail("v1_9_fresh_active_pointer_conflict");
      throw error;
    }
    return;
  }
  const current = await readOptional(resultsRoot, pointerPath);
  if (optionalDigest(current) !== transaction.previousPointerSha256) {
    fail("v1_9_prepare_transaction_conflict");
  }
  await writeJsonAtomic(resultsRoot, pointerPath, activePointer(transaction), randomBytes);
}

async function writeJsonCreateIfAbsentAtomic(
  resultsRoot: string,
  filePath: string,
  value: unknown,
  randomBytes: (size: number) => Buffer,
) {
  const temporary = `${filePath}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    assertV1_9PreparePath(resultsRoot, filePath, { allowMissing: true });
    assertV1_9PreparePath(resultsRoot, temporary, { allowMissing: true });
    await writeFile(temporary, serialize(value), { encoding: "utf8", flag: "wx" });
    assertV1_9PreparePath(resultsRoot, temporary, { kind: "file" });
    assertV1_9PreparePath(resultsRoot, filePath, { allowMissing: true });
    await link(temporary, filePath);
    assertV1_9PreparePath(resultsRoot, filePath, { kind: "file" });
  } finally {
    if (existsSync(temporary)) await removePreparePath(resultsRoot, temporary, { force: true });
  }
}

async function createPrepareDirectory(resultsRoot: string, target: string) {
  assertV1_9PreparePath(resultsRoot, target, { allowMissing: true });
  await mkdir(target);
  assertV1_9PreparePath(resultsRoot, target, { kind: "directory" });
}

async function renamePreparePath(resultsRoot: string, source: string, target: string) {
  assertV1_9PreparePath(resultsRoot, source);
  assertV1_9PreparePath(resultsRoot, target, { allowMissing: true });
  await rename(source, target);
  assertV1_9PreparePath(resultsRoot, target);
}

async function removePreparePath(
  resultsRoot: string,
  target: string,
  options: { recursive?: boolean; force?: boolean },
) {
  assertV1_9PreparePath(resultsRoot, target, { allowMissing: options.force === true });
  await rm(target, options);
}

function assertPhysicalPath(
  target: string,
  options: { allowMissing?: boolean; kind?: "directory" | "file" },
) {
  try {
    const resolved = assertCanonicalExistingPathChain(target, { allowMissing: options.allowMissing === true });
    if (!existsSync(resolved)) {
      if (options.allowMissing === true) return;
      fail("v1_9_prepare_path_unsafe");
    }
    const stat = lstatSync(resolved);
    if (options.kind === "directory" && !stat.isDirectory()) fail("v1_9_prepare_path_unsafe");
    if (options.kind === "file" && !stat.isFile()) fail("v1_9_prepare_path_unsafe");
  } catch {
    fail("v1_9_prepare_path_unsafe");
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
function optionalDigest(value: Buffer | null) { return value ? sha256(value) : null; }
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) fail("v1_9_prepare_transaction_invalid"); return value as Record<string, unknown>; }
function exact(value: Record<string, unknown>, fields: string[]) { if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) fail("v1_9_prepare_transaction_invalid"); }
function text(value: unknown) { const result = String(value ?? "").trim(); if (!result) fail("v1_9_prepare_transaction_invalid"); return result; }
function runId(value: unknown) { const result = text(value); if (!/^v1-9-[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(result)) fail("v1_9_prepare_transaction_invalid"); return result; }
function runRoot(value: unknown) { const result = text(value).replaceAll("\\", "/"); if (!/^test-results\/v1-9-[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(result) || result.includes("..")) fail("v1_9_prepare_transaction_invalid"); return result; }
function runFile(value: unknown, root: string, name: string) { const result = text(value).replaceAll("\\", "/"); if (result !== `${root}/${name}`) fail("v1_9_prepare_transaction_invalid"); return result; }
function digest(value: unknown) { const result = text(value).toLowerCase(); if (!/^[a-f0-9]{64}$/.test(result)) fail("v1_9_prepare_transaction_invalid"); return result; }
function timestamp(value: unknown) { const result = text(value); if (!Number.isFinite(Date.parse(result))) fail("v1_9_prepare_transaction_invalid"); return new Date(result).toISOString(); }
function fail(reason: string): never { throw new Error(reason); }
