import "dotenv/config";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  V1_9_FROZEN_PROMPT,
  assertV1_9RunStateOrchestrationAuthority,
  assertV1_9InterruptedRunningResumeState,
  createV1_9RunManifestV2Digest,
  normalizeV1_9RunManifestV2,
  normalizeV1_9RunState,
} from "./lib/v1-9-e2e-contract.mjs";
import { assertCurrentV1_9BaselineLock } from "./lib/v1-9-baseline-lock.mjs";
import { verifyM67FrozenApp } from "./lib/m67-frozen-app.mjs";
import { assertCanonicalExistingPathChain } from "./lib/physical-path-integrity.mjs";
import { createRunnerShutdownAuthority } from "./lib/runner-shutdown-authority.mjs";

const currentFilePath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(currentFilePath), "..");
const activePointerFileName = "v1-9-product-e2e-active.json";

export async function mainV1_9E2E({
  rootDir = root,
  env = process.env,
  runCommand = run,
  verifyAfterM67Stop = verifyV1_9RunAfterM67Stop,
} = {}) {
  const runContext = resolveV1_9RunContext({ rootDir });
  const runMode = resolveV1_9RunMode(env, runContext.runState);
  if (runMode === "resume") assertV1_9ResumeRunStorage(runContext);
  const skillLock = readFrozenSkillLock(runContext.manifest);
  const childEnv = createV1_9ChildEnvironment({ env, runContext, runMode, skillLock });
  const timeoutMs = resolveTimeoutMs(env.V1_9_E2E_TIMEOUT_MS);

  await runCommand(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "scripts/v1-9-product-preflight.ts"],
    childEnv,
    120_000,
  );
  assertManifestBytesUnchanged(runContext);
  assertPointerBytesUnchanged(runContext);
  assertRunStateBytesUnchanged(runContext);

  const verifyAfterStop = ({ reason }) => verifyAfterM67Stop(runContext, {
    childEnv,
    rootDir,
    runMode,
    shutdownReason: reason,
  });
  if (runCommand === run) {
    await runV1_9SupervisedM67Command({
      command: process.execPath,
      args: ["scripts/run-m67-e2e.mjs"],
      env: childEnv,
      timeoutMs: timeoutMs + 180_000,
      postStop: verifyAfterStop,
    });
  } else {
    let commandError;
    try {
      await runCommand(process.execPath, ["scripts/run-m67-e2e.mjs"], childEnv, timeoutMs + 180_000);
    } catch (error) {
      commandError = error;
    }
    let verificationError;
    try {
      await verifyAfterStop({ reason: commandError ? "command-failed" : "completed" });
    } catch (error) {
      verificationError = error;
    }
    if (commandError && verificationError) {
      throw new AggregateError([commandError, verificationError], "v1_9_m67_command_and_verify_failed");
    }
    if (commandError) throw commandError;
    if (verificationError) throw verificationError;
  }
  assertManifestBytesUnchanged(runContext);
  assertPointerBytesUnchanged(runContext);
  assertV1_9RunReadyForExternalAcceptance(runContext);
}

export async function runV1_9SupervisedM67Command({
  command,
  args,
  env,
  timeoutMs,
  postStop,
  dependencies = {},
}) {
  const processObject = dependencies.processObject ?? process;
  const authority = createRunnerShutdownAuthority({ postStop }, dependencies);
  const signalHandlers = installSupervisedSignalHandlers(authority, processObject);
  try {
    try {
      const commandCompletion = authority.runCommand(command, args, {
        cwd: root,
        env,
        stdio: ["inherit", "inherit", "inherit", "ipc"],
        shell: false,
        windowsHide: true,
        timeoutMs,
        label: "v1-9-m67",
        gracefulIpc: true,
      });
      await Promise.race([commandCompletion, signalHandlers.completion]);
      if (signalHandlers.wasSignalled()) throw signalHandlers.error();
    } catch (commandError) {
      try {
        await authority.shutdown({ reason: "command-failed" });
      } catch (shutdownError) {
        throw new AggregateError([commandError, shutdownError], "v1_9_m67_command_and_verify_failed");
      }
      throw commandError;
    }
    await authority.shutdown({ reason: "completed" });
  } finally {
    signalHandlers.detach();
  }
}

export async function verifyV1_9RunAfterM67Stop(runContext, {
  childEnv,
  rootDir = runContext.rootDir,
  runMode,
  shutdownReason = "completed",
  readAuthoritySummary = readV1_9OrchestrationAuthoritySummaryAfterStop,
} = {}) {
  assertManifestBytesUnchanged(runContext);
  assertPointerBytesUnchanged(runContext);
  const refreshed = resolveV1_9RunContext({ rootDir, pointerPath: runContext.pointerPath });
  if (refreshed.manifestSha256 !== runContext.manifestSha256 ||
      refreshed.manifest.runId !== runContext.manifest.runId ||
      refreshed.runRoot !== runContext.runRoot) {
    throw new Error("v1_9_post_stop_identity_mismatch");
  }
  assertCurrentV1_9BaselineLock(runContext.manifest.baselineLock, { cwd: rootDir, env: childEnv });
  verifyM67FrozenApp({
    sourceRoot: rootDir,
    runRoot: runContext.runRoot,
    appRoot: runContext.frozenAppRoot,
    markerPath: path.join(runContext.frozenAppRoot, ".m67-frozen-app.json"),
    identity: {
      mode: runMode,
      runId: runContext.manifest.runId,
      manifestSha256: runContext.manifestSha256,
    },
    requestedSpec: childEnv?.M67_E2E_SPEC,
  });
  const summaryPath = path.join(runContext.runRoot, "v1-9-summary.json");
  assertRegularFile(summaryPath, "v1_9_post_stop_summary_invalid");
  let summary;
  try {
    summary = parseJson(fs.readFileSync(summaryPath), "v1_9_post_stop_summary_invalid");
  } catch {
    throw new Error("v1_9_post_stop_summary_invalid");
  }
  const expectedStatus = shutdownReason === "completed" ? "passed" : "failed";
  if (summary?.status !== expectedStatus) throw new Error("v1_9_post_stop_summary_invalid");
  const authoritySummary = await readAuthoritySummary(refreshed);
  assertV1_9RunStateOrchestrationAuthority(
    refreshed.runState,
    authoritySummary,
    shutdownReason === "completed",
  );
  return refreshed;
}

export async function readV1_9OrchestrationAuthoritySummaryAfterStop(runContext, {
  spawnBridge = spawnSync,
} = {}) {
  const state = normalizeV1_9RunState(runContext.runState);
  const projectId = state.identity.projectId;
  const actorUserId = state.identity.actorUserId;
  if (!projectId || !actorUserId || !state.taskContractLock || !state.orchestrationAuthoritySummary) {
    throw new Error("v1_9_orchestration_authority_summary_missing");
  }
  const databasePath = path.join(runContext.runRoot, "m67.sqlite");
  assertOwnedFile(runContext.runRoot, databasePath, "m67.sqlite");
  assertRegularFile(databasePath, "v1_9_orchestration_authority_database_invalid");
  const result = spawnBridge(
    process.execPath,
    [
      "node_modules/tsx/dist/cli.mjs",
      "scripts/lib/v1-9-orchestration-authority-sqlite.ts",
      databasePath,
      projectId,
      actorUserId,
    ],
    {
      cwd: runContext.rootDir,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 120_000,
    },
  );
  if (result.error || result.status !== 0 || typeof result.stdout !== "string" || !result.stdout.trim()) {
    throw new Error("v1_9_orchestration_authority_sqlite_read_failed");
  }
  return parseJson(Buffer.from(result.stdout.trim(), "utf8"), "v1_9_orchestration_authority_sqlite_read_invalid");
}

export function resolveV1_9RunContext({
  rootDir = root,
  pointerPath = path.join(rootDir, "test-results", activePointerFileName),
} = {}) {
  const repositoryRoot = path.resolve(rootDir);
  const resolvedPointerPath = path.resolve(pointerPath);
  const expectedPointerPath = path.join(repositoryRoot, "test-results", activePointerFileName);
  if (resolvedPointerPath !== expectedPointerPath || !fs.existsSync(resolvedPointerPath)) {
    throw new Error("v1_9_active_run_pointer_missing");
  }
  assertRegularFile(resolvedPointerPath, "v1_9_active_run_pointer_invalid");

  const pointerBytes = fs.readFileSync(resolvedPointerPath);
  const pointer = parseJson(pointerBytes, "v1_9_active_run_pointer_invalid");
  if (pointer?.schemaVersion === "v1-9-active-run.v1") {
    throw new Error("v1_9_legacy_active_run_not_resumable");
  }
  assertExactFields(pointer, [
    "schemaVersion",
    "runId",
    "relativeRunRoot",
    "manifestPath",
    "manifestSha256",
    "statePath",
  ], "v1_9_active_run_pointer_invalid");
  if (pointer.schemaVersion !== "v1-9-active-run.v2") {
    throw new Error("v1_9_active_run_pointer_invalid");
  }

  const relativeRunRoot = validateRelativeRunRoot(pointer.relativeRunRoot);
  const runRoot = resolveOwnedRunRoot(repositoryRoot, relativeRunRoot);
  const manifestRelativePath = validateRunFilePath(
    pointer.manifestPath,
    relativeRunRoot,
    "run-manifest.json",
  );
  const stateRelativePath = validateRunFilePath(
    pointer.statePath,
    relativeRunRoot,
    "run-state.json",
  );
  const manifestPath = path.resolve(repositoryRoot, ...manifestRelativePath.split("/"));
  const statePath = path.resolve(repositoryRoot, ...stateRelativePath.split("/"));
  assertOwnedFile(runRoot, manifestPath, "run-manifest.json");
  assertOwnedFile(runRoot, statePath, "run-state.json");
  assertRegularFile(manifestPath, "v1_9_active_run_manifest_missing");
  assertRegularFile(statePath, "v1_9_active_run_state_missing");

  const manifestBytes = fs.readFileSync(manifestPath);
  const stateBytes = fs.readFileSync(statePath);
  const manifest = normalizeV1_9RunManifestV2(parseJson(manifestBytes, "v1_9_run_manifest_invalid"));
  const runState = normalizeV1_9RunState(parseJson(stateBytes, "v1_9_run_state_invalid"));
  const manifestSha256 = createV1_9RunManifestV2Digest(manifest);
  const manifestFileSha256 = sha256(manifestBytes);
  const pointerManifestSha256 = requiredDigest(pointer.manifestSha256, "v1_9_active_run_pointer_invalid");

  if (
    pointer.runId !== manifest.runId ||
    pointer.runId !== runState.runId ||
    manifest.relativeRunRoot !== relativeRunRoot ||
    manifestFileSha256 !== manifestSha256 ||
    pointerManifestSha256 !== manifestSha256 ||
    runState.manifestSha256 !== manifestSha256
  ) {
    throw new Error("v1_9_active_run_identity_mismatch");
  }
  if (manifest.promptDigest !== sha256(V1_9_FROZEN_PROMPT)) {
    throw new Error("v1_9_frozen_prompt_mismatch");
  }

  return {
    rootDir: repositoryRoot,
    pointerPath: resolvedPointerPath,
    pointerBytes,
    pointer,
    runRoot,
    relativeRunRoot,
    manifestPath,
    manifestBytes,
    manifest,
    manifestSha256,
    statePath,
    stateBytes,
    runState,
    frozenAppRoot: path.join(runRoot, "next-app-frozen"),
  };
}

export function resolveV1_9RunMode(env, runState) {
  assertFixtureModesDisabled(env);
  const runMode = String(env.V1_9_RUN_MODE ?? "").trim();
  if (runMode === "start-new") {
    if (runState.status !== "prepared") throw new Error("v1_9_fresh_run_state_invalid");
    return runMode;
  }
  if (runMode === "resume") {
    if (!["running", "paused_recovery", "failed", "external_acceptance_repair_required"].includes(runState.status)) {
      throw new Error("v1_9_resume_run_state_invalid");
    }
    if (runState.status === "running") assertV1_9InterruptedRunningResumeState(runState);
    return runMode;
  }
  throw new Error("v1_9_run_mode_invalid");
}

export function createV1_9ChildEnvironment({ env, runContext, runMode, skillLock }) {
  const childEnv = {
    ...env,
    V1_9_RUN_MODE: runMode,
    M67_E2E_SPEC: "tests/e2e/v1-9-unique-real-product.spec.ts",
    M67_E2E_PROJECTS: "chromium-desktop",
    M67_E2E_DETERMINISTIC: "0",
    M67_E2E_PRESERVE_RUN_DIR: "1",
    M67_E2E_RUN_ROOT: runContext.relativeRunRoot,
    M67_E2E_FROZEN_APP_ROOT: runContext.frozenAppRoot,
    V1_9_E2E_RUN_ID: runContext.manifest.runId,
    V1_9_E2E_MANIFEST_SHA256: runContext.manifestSha256,
    SHANHAI_V1_9_REPOSITORY_ROOT: runContext.rootDir,
    M67_E2E_TIMEOUT_MS: env.V1_9_E2E_TIMEOUT_MS ?? "21600000",
    SHANHAI_SKILL_RUNTIME_MODE: "required",
    SHANHAI_SKILLS_EXPECTED_PROJECTION_LOCK_DIGEST: skillLock.projectionLockDigest,
    SHANHAI_SKILLS_EXPECTED_BINDING_POLICY_DIGEST: skillLock.bindingPolicyDigest,
    V1_9_E2E_MANIFEST_PATH: runContext.manifestPath,
    V1_9_E2E_STATE_PATH: runContext.statePath,
    V1_9_E2E_FROZEN_PROMPT: V1_9_FROZEN_PROMPT,
  };
  const usesProviderHealthEvidence = runMode === "resume" &&
    ["paused_recovery", "failed"].includes(runContext.runState.status);
  if (!usesProviderHealthEvidence) {
    delete childEnv.V1_9_AGENT_BRAIN_HEALTH_EVIDENCE_ID;
  }
  if (runMode === "start-new") {
    childEnv.V1_9_AGENT_BRAIN_HEALTH_EVIDENCE_ID = "";
  }
  return childEnv;
}

export function assertV1_9ResumeRunStorage(runContext) {
  const databasePath = path.join(runContext.runRoot, "m67.sqlite");
  const artifactRoot = path.join(runContext.runRoot, "artifact-storage");
  const frozenAppRoot = runContext.frozenAppRoot;
  assertOwnedFile(runContext.runRoot, databasePath, "m67.sqlite");
  assertOwnedDirectory(runContext.runRoot, artifactRoot, "artifact-storage");
  assertOwnedDirectory(runContext.runRoot, frozenAppRoot, "next-app-frozen");
  assertRegularFile(databasePath, "v1_9_resume_database_missing");
  assertDirectory(artifactRoot, "v1_9_resume_artifact_root_missing");
  assertDirectory(frozenAppRoot, "v1_9_resume_frozen_app_missing");
}

export function assertManifestBytesUnchanged(runContext) {
  const currentBytes = fs.readFileSync(runContext.manifestPath);
  if (!currentBytes.equals(runContext.manifestBytes)) {
    throw new Error("v1_9_run_manifest_mutated");
  }
  const manifest = normalizeV1_9RunManifestV2(parseJson(currentBytes, "v1_9_run_manifest_invalid"));
  if (sha256(currentBytes) !== runContext.manifestSha256 ||
      createV1_9RunManifestV2Digest(manifest) !== runContext.manifestSha256) {
    throw new Error("v1_9_run_manifest_digest_mismatch");
  }
  return manifest;
}

export function assertV1_9RunReadyForExternalAcceptance(runContext) {
  const runState = normalizeV1_9RunState(parseJson(
    fs.readFileSync(runContext.statePath),
    "v1_9_run_state_invalid",
  ));
  if (runState.runId !== runContext.manifest.runId ||
      runState.manifestSha256 !== runContext.manifestSha256) {
    throw new Error("v1_9_run_state_identity_mismatch");
  }
  if (runState.status !== "package_ready_for_external_acceptance") {
    throw new Error("v1_9_run_not_ready_for_external_acceptance");
  }
  if (
    runState.ledger.taskSubmissionCount !== 1 ||
    runState.ledger.finalDownloadCount < 1 ||
    runState.ledger.externalCodexOrchestrationCount !== 0 ||
    runState.ledger.violations.length !== 0
  ) {
    throw new Error("v1_9_unique_ui_contract_incomplete");
  }
  return runState;
}

function assertFixtureModesDisabled(env) {
  if (
    env.M67_E2E_DETERMINISTIC === "1" ||
    env.SHANHAI_E2E_DETERMINISTIC_MAIN_AGENT === "1"
  ) {
    throw new Error("v1_9_deterministic_runtime_forbidden");
  }
}

function readFrozenSkillLock(manifest) {
  const skillLock = manifest.skillLock;
  if (skillLock?.schemaVersion !== "v1-9-skill-lock.v1" ||
      !/^[a-f0-9]{64}$/i.test(String(skillLock.projectionLockDigest ?? "")) ||
      !/^[a-f0-9]{64}$/i.test(String(skillLock.bindingPolicyDigest ?? ""))) {
    throw new Error("v1_9_skill_lock_missing");
  }
  return {
    projectionLockDigest: skillLock.projectionLockDigest.toLowerCase(),
    bindingPolicyDigest: skillLock.bindingPolicyDigest.toLowerCase(),
  };
}

function assertPointerBytesUnchanged(runContext) {
  if (!fs.readFileSync(runContext.pointerPath).equals(runContext.pointerBytes)) {
    throw new Error("v1_9_active_run_pointer_mutated");
  }
}

function assertRunStateBytesUnchanged(runContext) {
  if (!fs.readFileSync(runContext.statePath).equals(runContext.stateBytes)) {
    throw new Error("v1_9_preflight_mutated_run_state");
  }
}

function validateRelativeRunRoot(value) {
  const normalized = String(value ?? "").trim().replaceAll("\\", "/");
  if (!/^test-results\/v1-9-[a-z0-9._-]+$/i.test(normalized) || normalized.includes("..")) {
    throw new Error("v1_9_run_root_invalid");
  }
  return normalized;
}

function validateRunFilePath(value, relativeRunRoot, expectedFileName) {
  const normalized = String(value ?? "").trim().replaceAll("\\", "/");
  if (normalized !== `${relativeRunRoot}/${expectedFileName}` || normalized.includes("..")) {
    throw new Error("v1_9_active_run_path_invalid");
  }
  return normalized;
}

function resolveOwnedRunRoot(repositoryRoot, relativeRunRoot) {
  try {
    const testResultsRoot = assertCanonicalExistingPathChain(path.join(repositoryRoot, "test-results"));
    const runRoot = assertCanonicalExistingPathChain(path.resolve(repositoryRoot, ...relativeRunRoot.split("/")));
    const relative = path.relative(testResultsRoot, runRoot);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("v1_9_run_root_invalid");
    }
    return runRoot;
  } catch {
    throw new Error("v1_9_run_root_invalid");
  }
}

function assertOwnedFile(runRoot, filePath, expectedFileName) {
  const relative = path.relative(runRoot, filePath);
  if (relative !== expectedFileName || path.isAbsolute(relative)) {
    throw new Error("v1_9_active_run_path_invalid");
  }
}

function assertOwnedDirectory(runRoot, directoryPath, expectedDirectoryName) {
  const relative = path.relative(runRoot, directoryPath);
  if (relative !== expectedDirectoryName || path.isAbsolute(relative)) {
    throw new Error("v1_9_active_run_path_invalid");
  }
}

function assertRegularFile(filePath, errorCode) {
  try {
    const physicalPath = assertCanonicalExistingPathChain(filePath);
    const stat = fs.lstatSync(physicalPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(errorCode);
  } catch {
    throw new Error(errorCode);
  }
}

function assertDirectory(directoryPath, errorCode) {
  try {
    const physicalPath = assertCanonicalExistingPathChain(directoryPath);
    const stat = fs.lstatSync(physicalPath);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(errorCode);
  } catch {
    throw new Error(errorCode);
  }
}

function assertExactFields(value, expectedFields, errorCode) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(errorCode);
  const actual = Object.keys(value).sort();
  const expected = [...expectedFields].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(errorCode);
}

function requiredDigest(value, errorCode) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(errorCode);
  return normalized;
}

function parseJson(bytes, errorCode) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(errorCode);
  }
}

function resolveTimeoutMs(value) {
  const parsed = Number.parseInt(String(value ?? "21600000"), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error("v1_9_e2e_timeout_invalid");
  return parsed;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function run(command, args, env, timeoutMs) {
  const authority = createRunnerShutdownAuthority();
  return authority.runCommand(command, args, {
      cwd: root,
      env,
      stdio: "inherit",
      shell: false,
      windowsHide: true,
      timeoutMs,
      label: path.basename(command),
    }).then(() => undefined);
}

function installSupervisedSignalHandlers(authority, processObject) {
  let rejectCompletion;
  const completion = new Promise((_, reject) => { rejectCompletion = reject; });
  const handlers = new Map([
    ["SIGINT", () => requestSignalShutdown("SIGINT", 130)],
    ["SIGTERM", () => requestSignalShutdown("SIGTERM", 143)],
  ]);
  let signalShutdownPromise;
  let signalError;
  for (const [signal, handler] of handlers) processObject.once(signal, handler);
  return {
    completion,
    detach() {
      for (const [signal, handler] of handlers) processObject.off?.(signal, handler);
    },
    error() {
      return signalError ?? new Error("v1_9_supervised_signal");
    },
    wasSignalled() {
      return Boolean(signalShutdownPromise);
    },
  };

  function requestSignalShutdown(signal, exitCode) {
    processObject.exitCode = exitCode;
    if (!signalShutdownPromise) {
      signalShutdownPromise = authority.shutdown({ reason: "signal", signal }).then(
        () => {
          signalError = new Error(`v1_9_supervised_signal:${signal}`);
          rejectCompletion(signalError);
        },
        (shutdownError) => {
          signalError = new AggregateError(
            [shutdownError],
            `v1_9_supervised_signal_shutdown_failed:${signal}`,
          );
          rejectCompletion(signalError);
        },
      );
    }
    return signalShutdownPromise;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath && invokedPath.toLowerCase() === currentFilePath.toLowerCase()) {
  await mainV1_9E2E();
}
