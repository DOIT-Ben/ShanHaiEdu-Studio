import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  createV1_9RunManifestV2Digest,
  normalizeV1_9RunManifestV2,
  normalizeV1_9RunState,
  type V1_9RunPredecessor,
  type V1_9RunState,
} from "./v1-9-e2e-contract.mjs";
import { assertV1_9PreparePath } from "./v1-9-run-preparation-transaction";

const V1_POINTER_FIELDS = ["schemaVersion", "runId", "relativeRunRoot", "status"];
const V2_POINTER_FIELDS = ["schemaVersion", "runId", "relativeRunRoot", "manifestPath", "manifestSha256", "statePath"];

export type V1_9PredecessorContext = {
  pointerBytes: Buffer;
  pointerRunId: string;
  relativeRunRoot: string;
  manifestPath: string;
  manifestBytes: Buffer;
  manifestSha256: string;
  statePath: string | null;
  stateBytes: Buffer | null;
  disposition: V1_9RunPredecessor["disposition"];
};

export async function readV1_9PredecessorContext(input: {
  rootDir: string;
  pointerBytes: Buffer;
  expectedPredecessorRunId: string;
  successorRunId: string;
}): Promise<V1_9PredecessorContext> {
  const pointer = parse(input.pointerBytes, "v1_9_active_pointer_invalid");
  if (pointer.schemaVersion === "v1-9-active-run.v1") {
    exact(pointer, V1_POINTER_FIELDS, "v1_9_legacy_active_pointer_invalid");
    if (pointer.status !== "active") fail("v1_9_legacy_active_pointer_invalid");
    const runId = requiredRunId(pointer.runId, "v1_9_legacy_active_pointer_invalid");
    const relativeRunRoot = requiredRunRoot(pointer.relativeRunRoot);
    if (runId !== input.expectedPredecessorRunId) fail("v1_9_predecessor_invalid");
    if (path.posix.basename(relativeRunRoot) !== runId) fail("v1_9_legacy_active_pointer_invalid");
    const manifestPath = path.join(resolveRunRoot(input.rootDir, relativeRunRoot), "run-manifest.json");
    assertV1_9PreparePath(path.join(input.rootDir, "test-results"), manifestPath, { kind: "file" });
    const manifestBytes = await readFile(manifestPath).catch(() => fail("v1_9_predecessor_manifest_missing"));
    const manifest = parse(manifestBytes, "v1_9_predecessor_manifest_invalid");
    if (manifest.schemaVersion !== "v1-9-run-manifest.v1" || manifest.runId !== runId ||
        requiredRunRoot(manifest.relativeRunRoot) !== relativeRunRoot ||
        !["paused_recovery", "failed"].includes(String(manifest.status))) {
      fail("v1_9_predecessor_manifest_invalid");
    }
    return {
      pointerBytes: input.pointerBytes,
      pointerRunId: runId,
      relativeRunRoot,
      manifestPath,
      manifestBytes,
      manifestSha256: sha256(manifestBytes),
      statePath: null,
      stateBytes: null,
      disposition: "historical_failed",
    };
  }
  const context = await readV1_9V2RunContext({
    rootDir: input.rootDir,
    pointerBytes: input.pointerBytes,
    expectedRunId: input.expectedPredecessorRunId,
  });
  if (context.state.status !== "terminated_contract_upgrade" ||
      context.state.termination?.successorRunId !== input.successorRunId ||
      context.state.termination.recoveryEntry !== `test-results/${input.successorRunId}/run-state.json`) {
    fail("v1_9_predecessor_state_invalid");
  }
  return { ...context, disposition: "terminated_contract_upgrade" };
}

export async function readV1_9V2RunContext(input: {
  rootDir: string;
  pointerBytes: Buffer;
  expectedRunId: string;
}): Promise<V1_9PredecessorContext & { state: V1_9RunState; statePath: string }> {
  const pointer = parse(input.pointerBytes, "v1_9_active_pointer_invalid");
  exact(pointer, V2_POINTER_FIELDS, "v1_9_active_pointer_invalid");
  if (pointer.schemaVersion !== "v1-9-active-run.v2") fail("v1_9_active_pointer_invalid");
  const runId = requiredRunId(pointer.runId, "v1_9_active_pointer_invalid");
  if (runId !== input.expectedRunId) fail("v1_9_predecessor_invalid");
  const relativeRunRoot = requiredRunRoot(pointer.relativeRunRoot);
  if (path.posix.basename(relativeRunRoot) !== runId) fail("v1_9_active_pointer_invalid");
  const runRoot = resolveRunRoot(input.rootDir, relativeRunRoot);
  const manifestRelative = requiredRunFile(pointer.manifestPath, relativeRunRoot, "run-manifest.json");
  const stateRelative = requiredRunFile(pointer.statePath, relativeRunRoot, "run-state.json");
  const manifestPath = path.resolve(input.rootDir, ...manifestRelative.split("/"));
  const statePath = path.resolve(input.rootDir, ...stateRelative.split("/"));
  if (manifestPath !== path.join(runRoot, "run-manifest.json") || statePath !== path.join(runRoot, "run-state.json")) {
    fail("v1_9_active_pointer_invalid");
  }
  const resultsRoot = path.join(input.rootDir, "test-results");
  assertV1_9PreparePath(resultsRoot, runRoot, { kind: "directory" });
  assertV1_9PreparePath(resultsRoot, manifestPath, { kind: "file" });
  assertV1_9PreparePath(resultsRoot, statePath, { kind: "file" });
  const [manifestBytes, stateBytes] = await Promise.all([
    readFile(manifestPath).catch(() => fail("v1_9_predecessor_manifest_missing")),
    readFile(statePath).catch(() => fail("v1_9_predecessor_state_missing")),
  ]);
  const manifestSha256 = sha256(manifestBytes);
  const manifest = normalizeV1_9RunManifestV2(parse(manifestBytes, "v1_9_predecessor_manifest_invalid"));
  if (manifestSha256 !== requiredDigest(pointer.manifestSha256) ||
      createV1_9RunManifestV2Digest(manifest) !== manifestSha256 ||
      manifest.runId !== runId || manifest.relativeRunRoot !== relativeRunRoot) {
    fail("v1_9_predecessor_manifest_digest_mismatch");
  }
  const state = normalizeV1_9RunState(parse(stateBytes, "v1_9_predecessor_state_invalid"));
  if (state.runId !== runId || state.manifestSha256 !== manifestSha256) fail("v1_9_predecessor_state_invalid");
  return {
    pointerBytes: input.pointerBytes,
    pointerRunId: runId,
    relativeRunRoot,
    manifestPath,
    manifestBytes,
    manifestSha256,
    statePath,
    stateBytes,
    disposition: state.status === "terminated_contract_upgrade"
      ? "terminated_contract_upgrade"
      : state.status === "completed" ? "completed" : "historical_failed",
    state,
  };
}

export async function assertV1_9PredecessorBytesUnchanged(input: {
  pointerPath: string;
  context: V1_9PredecessorContext;
  checkPointer?: boolean;
}) {
  const resultsRoot = path.dirname(input.pointerPath);
  assertV1_9PreparePath(resultsRoot, input.pointerPath, { kind: "file" });
  assertV1_9PreparePath(resultsRoot, input.context.manifestPath, { kind: "file" });
  if (input.context.statePath) assertV1_9PreparePath(resultsRoot, input.context.statePath, { kind: "file" });
  const [pointer, manifest, state] = await Promise.all([
    readFile(input.pointerPath),
    readFile(input.context.manifestPath),
    input.context.statePath ? readFile(input.context.statePath) : Promise.resolve(null),
  ]);
  if (input.checkPointer !== false && !pointer.equals(input.context.pointerBytes)) fail("v1_9_active_pointer_drift");
  if (!manifest.equals(input.context.manifestBytes)) fail("v1_9_predecessor_manifest_drift");
  if (input.context.stateBytes && !state?.equals(input.context.stateBytes)) fail("v1_9_predecessor_state_drift");
}

function resolveRunRoot(rootDir: string, relativeRunRoot: string) {
  const testResultsRoot = path.resolve(rootDir, "test-results");
  const runRoot = path.resolve(rootDir, ...relativeRunRoot.split("/"));
  const relative = path.relative(testResultsRoot, runRoot);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) fail("v1_9_run_root_invalid");
  return runRoot;
}

function requiredRunRoot(value: unknown) {
  const result = text(value).replaceAll("\\", "/");
  if (!/^test-results\/v1-9-[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(result) || result.includes("..")) {
    fail("v1_9_run_root_invalid");
  }
  return result;
}

function requiredRunFile(value: unknown, root: string, fileName: string) {
  const result = text(value).replaceAll("\\", "/");
  if (result !== `${root}/${fileName}`) fail("v1_9_active_pointer_invalid");
  return result;
}

function requiredRunId(value: unknown, reason: string) {
  const result = text(value);
  if (!/^v1-9-[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(result)) fail(reason);
  return result;
}

function requiredDigest(value: unknown) {
  const result = text(value).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(result)) fail("v1_9_active_pointer_invalid");
  return result;
}

function parse(bytes: Buffer, reason: string): Record<string, unknown> {
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(reason);
    return value;
  } catch {
    return fail(reason);
  }
}

function exact(value: Record<string, unknown>, fields: string[], reason: string) {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) fail(reason);
}
function text(value: unknown) { const result = String(value ?? "").trim(); if (!result) fail("v1_9_value_required"); return result; }
function sha256(value: Buffer) { return createHash("sha256").update(value).digest("hex"); }
function fail(reason: string): never { throw new Error(reason); }
