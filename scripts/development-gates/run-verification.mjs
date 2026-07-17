import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

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
  const target = containedPath(resolvedRoot, outputPath ?? policy?.verification?.manifestPath ?? "");
  const checks = validateChecks(policy?.verification?.requiredChecks);
  rmSync(target, { force: true });

  const before = await collectSubject(resolvedRoot);
  if (requireClean && before.dirty) throw new Error("Verification requires a clean working tree.");
  const results = [];
  for (const check of checks) {
    const result = await runCommand(check, resolvedRoot);
    if (!result || result.id !== check.id || result.exitCode !== 0) {
      rmSync(target, { force: true });
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
  mkdirSync(path.dirname(target), { recursive: true });
  assertOrdinaryParent(path.dirname(target));
  const temporary = `${target}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  renameSync(temporary, target);
  return manifest;
}

export async function collectGitSubject(root = process.cwd()) {
  const headSha = gitText(root, ["rev-parse", "HEAD"]);
  const treeSha = gitText(root, ["rev-parse", "HEAD^{tree}"]);
  const status = gitBuffer(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const diff = gitBuffer(root, ["diff", "--binary", "--no-ext-diff", "HEAD", "--", "."]);
  const untracked = gitBuffer(root, ["ls-files", "--others", "--exclude-standard", "-z"])
    .toString("utf8").split("\0").filter(Boolean).sort();
  const hash = createHash("sha256").update("tracked-diff\0").update(diff).update("\0untracked\0");
  for (const relative of untracked) {
    if (!isSafeRelativePath(relative)) throw new Error("Git reported an unsafe untracked path.");
    const absolute = containedPath(root, relative);
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Untracked verification input must be an ordinary file.");
    hash.update(normalizePath(relative)).update("\0").update(sha256(readFileSync(absolute))).update("\n");
  }
  return {
    headSha,
    treeSha,
    workingTreeDigest: hash.digest("hex"),
    dirty: status.length > 0,
    policySha256: hashRequiredFile(root, "config/development-gates.json"),
    stageSha256: hashRequiredFile(root, "docs/stages/active-stage.json"),
  };
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

function hashRequiredFile(root, relative) {
  const absolute = containedPath(root, relative);
  const stat = lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Verification input must be an ordinary file.");
  return sha256(readFileSync(absolute));
}

function assertOrdinaryParent(directory) {
  let current = directory;
  while (existsSync(current)) {
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Verification output parent is unsafe.");
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function gitText(root, args) {
  return gitBuffer(root, args).toString("utf8").trim();
}

function gitBuffer(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: null, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error("Git verification command failed.");
  return result.stdout;
}

function containedPath(root, relative) {
  const candidate = path.isAbsolute(relative ?? "")
    ? path.resolve(relative)
    : isSafeRelativePath(relative)
      ? path.resolve(root, ...normalizePath(relative).split("/"))
      : null;
  if (!candidate) throw new Error("Verification output path is unsafe.");
  const remainder = path.relative(root, candidate);
  if (remainder.startsWith("..") || path.isAbsolute(remainder)) throw new Error("Verification output path is unsafe.");
  return candidate;
}

function isSafeRelativePath(value) {
  return typeof value === "string" && Boolean(value) && !path.isAbsolute(value) &&
    !/^[A-Za-z]:[\\/]/.test(value) && value.split(/[\\/]/).every((part) => part && part !== "." && part !== "..");
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
