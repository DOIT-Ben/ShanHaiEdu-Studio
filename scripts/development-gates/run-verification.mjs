import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { collectGitVerificationSubject } from "./verification-subject.mjs";

const manifestSchemaVersion = "shanhai-development-verification.v1";

export async function runVerification({
  root = process.cwd(),
  policy,
  outputPath,
  requireClean = false,
  collectSubject = collectGitSubject,
  runCommand = executeCommand,
} = {}) {
  const resolvedRoot = path.resolve(root);
  const target = verificationOutputPath(resolvedRoot, outputPath ?? policy?.verification?.manifestPath ?? "");
  const checks = validateChecks(policy?.verification?.requiredChecks);
  removeSafeVerificationFiles(resolvedRoot, [target]);

  const before = await collectSubject(resolvedRoot);
  if (requireClean && before.dirty) throw new Error("Verification requires a clean working tree.");
  const results = [];
  for (const check of checks) {
    const result = await runCommand(check, resolvedRoot);
    if (!result || result.id !== check.id || result.exitCode !== 0) {
      removeSafeVerificationFiles(resolvedRoot, [target]);
      throw new Error(`Required check ${check.id} failed.`);
    }
    results.push(normalizeCheckResult(result));
  }
  const after = await collectSubject(resolvedRoot);
  assertStableSubject(before, after);
  if (requireClean && after.dirty) throw new Error("Verification requires a clean working tree.");

  const manifest = {
    schemaVersion: manifestSchemaVersion,
    createdAt: new Date().toISOString(),
    subject: after,
    requiredCheckIds: checks.map((check) => check.id),
    checks: results,
  };
  ensureSafeVerificationParent(resolvedRoot, target);
  const temporary = `${target}.tmp-${process.pid}`;
  try {
    assertSafeVerificationTarget(resolvedRoot, target);
    assertSafeVerificationTarget(resolvedRoot, temporary);
    writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    assertSafeVerificationTarget(resolvedRoot, target);
    assertSafeVerificationTarget(resolvedRoot, temporary);
    renameSync(temporary, target);
    assertSafeVerificationTarget(resolvedRoot, target);
    const afterWrite = await collectSubject(resolvedRoot);
    assertSafeVerificationTarget(resolvedRoot, target);
    assertStableSubject(after, afterWrite);
  } catch (error) {
    try {
      removeSafeVerificationFiles(resolvedRoot, [temporary, target]);
    } catch (cleanupError) {
      throw new Error("Verification cleanup refused an unsafe output path.", { cause: cleanupError });
    }
    throw error;
  }
  return manifest;
}

export async function collectGitSubject(root = process.cwd()) {
  return collectGitVerificationSubject(root);
}

export async function executeCommand(check, root = process.cwd()) {
  const npmCli = check.program === "npm" ? process.env.npm_execpath : undefined;
  if (check.program === "npm" && (!npmCli || !path.isAbsolute(npmCli))) {
    throw new Error("npm verification commands require the current npm CLI path.");
  }
  const program = check.program === "npm" ? process.execPath : check.program;
  const args = check.program === "npm" ? [npmCli, ...check.args] : check.args;
  const started = Date.now();
  const result = spawnSync(program, args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  return {
    id: check.id,
    exitCode: result.status ?? 2,
    durationMs: Date.now() - started,
    outputSha256: sha256(`${stdout}\0${stderr}\0${result.error?.code ?? ""}`),
  };
}

function validateChecks(checks) {
  if (!Array.isArray(checks) || checks.length === 0) throw new Error("Verification required checks are missing.");
  const ids = new Set();
  return checks.map((check) => {
    const valid = check && /^[a-z0-9][a-z0-9-]{0,63}$/.test(check.id ?? "") &&
      ["node", "npm"].includes(check.program) && Array.isArray(check.args) &&
      check.args.every((arg) => typeof arg === "string" && arg.length > 0);
    if (!valid || ids.has(check?.id)) throw new Error("Verification check definition is invalid or duplicated.");
    ids.add(check.id);
    return { id: check.id, program: check.program, args: [...check.args] };
  });
}

function normalizeCheckResult(result) {
  if (!Number.isSafeInteger(result.durationMs) || result.durationMs < 0 ||
      !/^[a-f0-9]{64}$/.test(result.outputSha256 ?? "")) {
    throw new Error(`Required check ${result.id} returned invalid evidence.`);
  }
  return { id: result.id, exitCode: 0, durationMs: result.durationMs, outputSha256: result.outputSha256 };
}

function assertStableSubject(before, after) {
  const fields = ["headSha", "treeSha", "workingTreeDigest", "dirty", "policySha256", "stageSha256"];
  if (fields.some((field) => before[field] !== after[field])) {
    throw new Error("Verification subject changed while checks were running.");
  }
}

function assertSafeVerificationTarget(root, target) {
  const relative = path.relative(root, target);
  const segments = normalizePath(relative).split("/");
  let current = root;
  assertOrdinaryContainedPath(root, current, "Verification root is unsafe.", true);
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    if (!existsSync(current)) break;
    assertOrdinaryContainedPath(root, current, "Verification output parent is unsafe.", true);
  }
  if (existsSync(target)) {
    assertOrdinaryContainedPath(root, target, "Verification output target is unsafe.", false);
  }
}

function ensureSafeVerificationParent(root, target) {
  const relativeParent = path.relative(root, path.dirname(target));
  const segments = normalizePath(relativeParent).split("/");
  let current = root;
  for (const segment of segments) {
    assertSafeVerificationTarget(root, target);
    current = path.join(current, segment);
    if (!existsSync(current)) {
      mkdirSync(current);
    }
    assertOrdinaryContainedPath(root, current, "Verification output parent is unsafe.", true);
  }
  assertSafeVerificationTarget(root, target);
}

function removeSafeVerificationFiles(root, targets) {
  for (const target of targets) {
    assertSafeVerificationTarget(root, target);
    if (existsSync(target)) rmSync(target, { force: true });
  }
}

function assertOrdinaryContainedPath(root, candidate, message, directory) {
  const stat = lstatSync(candidate);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) throw new Error(message);
  const realRoot = realpathSync.native(root);
  const expected = path.resolve(realRoot, path.relative(root, candidate));
  const actual = realpathSync.native(candidate);
  if (!samePath(actual, expected)) throw new Error(message);
}

function samePath(left, right) {
  const normalize = (value) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  return normalize(left) === normalize(right);
}

function verificationOutputPath(root, relative) {
  if (!isSafeRelativePath(relative)) throw new Error("Verification output path is unsafe.");
  const normalized = normalizePath(relative);
  if (!normalized.startsWith(".tmp/verification/") || normalized.endsWith("/")) {
    throw new Error("Verification output must be inside .tmp/verification/.");
  }
  return path.resolve(root, ...normalized.split("/"));
}

function isSafeRelativePath(value) {
  return typeof value === "string" && Boolean(value) && !value.includes("\\") && !path.isAbsolute(value) &&
    !/^[A-Za-z]:[\\/]/.test(value) && value.split("/").every((part) => part && part !== "." && part !== "..");
}

function normalizePath(value) {
  return value.replaceAll("\\", "/");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function runCli() {
  const args = new Set(process.argv.slice(2));
  const root = process.cwd();
  const policy = JSON.parse(readFileSync(path.join(root, "config", "development-gates.json"), "utf8"));
  const manifest = await runVerification({ root, policy, requireClean: args.has("--require-clean") });
  console.log(JSON.stringify({ ok: true, schemaVersion: manifest.schemaVersion, dirty: manifest.subject.dirty, checkCount: manifest.checks.length }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch(() => {
    console.error(JSON.stringify({ ok: false, error: "Development verification failed." }));
    process.exit(2);
  });
}
