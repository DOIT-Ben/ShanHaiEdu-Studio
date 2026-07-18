import {
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { collectGitVerificationSubject } from "./verification-subject.mjs";

export const DEFAULT_VERIFICATION_MANIFEST_PATH = ".tmp/verification/development-verification.json";
const POLICY_PATH = "config/development-gates.json";
const STAGE_PATH = "docs/stages/active-stage.json";
const MANIFEST_SCHEMA = "shanhai-development-verification.v1";
const MANIFEST_KEYS = ["schemaVersion", "createdAt", "subject", "requiredCheckIds", "checks"];
const SUBJECT_KEYS = ["headSha", "treeSha", "workingTreeDigest", "dirty", "policySha256", "stageSha256"];
const CHECK_KEYS = ["id", "exitCode", "durationMs", "outputSha256"];

export class VerificationManifestError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "VerificationManifestError";
    this.code = code;
  }
}

export function createVerificationManifest({ subject, requiredChecks, checks, createdAt = new Date().toISOString() } = {}) {
  const normalizedSubject = normalizeSubject(subject);
  const requiredCheckIds = normalizeRequiredChecks(requiredChecks);
  const checksById = normalizeChecks(checks, requiredCheckIds);
  const normalizedCreatedAt = requireTimestamp(createdAt, "createdAt");
  return {
    schemaVersion: MANIFEST_SCHEMA,
    createdAt: normalizedCreatedAt,
    subject: normalizedSubject,
    requiredCheckIds,
    checks: requiredCheckIds.map((id) => checksById.get(id)),
  };
}

export function verifyVerificationManifest(manifest, {
  subject,
  requiredChecks,
  maxAgeHours,
  now = new Date().toISOString(),
} = {}) {
  if (!isRecord(manifest)) fail("verification_manifest_invalid", "verification manifest must be an object");
  requireExactKeys(manifest, MANIFEST_KEYS, "verification manifest");
  if (manifest.schemaVersion !== MANIFEST_SCHEMA) {
    fail("verification_schema_invalid", "verification manifest schemaVersion is unsupported");
  }

  const createdAt = requireTimestamp(manifest.createdAt, "createdAt");
  const expectedSubject = normalizeSubject(subject);
  const actualSubject = normalizeSubject(manifest.subject);
  for (const key of SUBJECT_KEYS) {
    if (actualSubject[key] !== expectedSubject[key]) {
      fail("verification_subject_mismatch", `verification subject ${key} mismatch`);
    }
  }

  const expectedCheckIds = normalizeRequiredChecks(requiredChecks);
  const actualCheckIds = normalizeRequiredChecks(manifest.requiredCheckIds, true);
  if (!sameArray(actualCheckIds, expectedCheckIds)) {
    fail("verification_check_set_mismatch", "verification required check set mismatch");
  }
  const checksById = normalizeChecks(manifest.checks, expectedCheckIds);
  const orderedActualChecks = manifest.checks.map((check) => check.id);
  if (!sameArray(orderedActualChecks, expectedCheckIds)) {
    fail("verification_check_order_mismatch", "verification check order does not match required checks");
  }

  const nowValue = Date.parse(requireTimestamp(now, "now"));
  const createdValue = Date.parse(createdAt);
  if (createdValue > nowValue + 60_000) fail("verification_timestamp_future", "verification manifest timestamp is in the future");
  if (maxAgeHours !== undefined) {
    if (typeof maxAgeHours !== "number" || !Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
      fail("verification_max_age_invalid", "verification maxAgeHours must be a positive number");
    }
    if (nowValue - createdValue > maxAgeHours * 60 * 60 * 1000) {
      fail("verification_manifest_expired", "verification manifest has expired");
    }
  }

  return {
    ok: true,
    headSha: actualSubject.headSha,
    createdAt,
    checkCount: checksById.size,
  };
}

export function collectVerificationSubject(root, {
  policyPath = POLICY_PATH,
  stagePath = STAGE_PATH,
} = {}) {
  return collectGitVerificationSubject(root, { policyPath, stagePath });
}

export function writeVerificationManifest({
  root,
  outputPath = DEFAULT_VERIFICATION_MANIFEST_PATH,
  ...manifestInput
} = {}) {
  if (typeof root !== "string" || root.length === 0) fail("verification_root_invalid", "verification root is required");
  const safeOutputPath = requireSafePath(outputPath, "verification manifest output path");
  const manifest = createVerificationManifest(manifestInput);
  const destination = resolvePath(root, safeOutputPath);
  const directory = path.dirname(destination);
  assertNoSymlinkAncestors(root, safeOutputPath);
  mkdirSync(directory, { recursive: true });
  assertNoSymlinkAncestors(root, safeOutputPath);
  const temporary = `${destination}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    renameSync(temporary, destination);
  } finally {
    rmSync(temporary, { force: true });
  }
  return manifest;
}

function normalizeSubject(value) {
  if (!isRecord(value)) fail("verification_subject_invalid", "verification subject must be an object");
  requireExactKeys(value, SUBJECT_KEYS, "verification subject");
  requireGitSha(value.headSha, "headSha");
  requireGitSha(value.treeSha, "treeSha");
  requireDigest(value.workingTreeDigest, "workingTreeDigest");
  requireDigest(value.policySha256, "policySha256");
  requireDigest(value.stageSha256, "stageSha256");
  if (typeof value.dirty !== "boolean") fail("verification_subject_invalid", "verification subject dirty must be boolean");
  return Object.fromEntries(SUBJECT_KEYS.map((key) => [key, value[key]]));
}

function normalizeRequiredChecks(value, requireStrings = false) {
  if (!Array.isArray(value) || value.length === 0) {
    fail("verification_checks_invalid", "verification required checks must be a non-empty array");
  }
  const seen = new Set();
  return value.map((entry, index) => {
    const id = typeof entry === "string" ? entry : !requireStrings && isRecord(entry) ? entry.id : null;
    if (typeof id !== "string" || !/^[a-z0-9][a-z0-9:-]*$/.test(id)) {
      fail("verification_check_id_invalid", `verification required check id at index ${index} is invalid`);
    }
    if (seen.has(id)) fail("verification_check_duplicate", `duplicate required verification check: ${id}`);
    seen.add(id);
    return id;
  });
}

function normalizeChecks(value, requiredCheckIds) {
  if (!Array.isArray(value)) fail("verification_checks_invalid", "verification checks must be an array");
  const required = new Set(requiredCheckIds);
  const checks = new Map();
  for (const [index, check] of value.entries()) {
    if (!isRecord(check)) fail("verification_check_invalid", `verification check at index ${index} must be an object`);
    requireExactKeys(check, CHECK_KEYS, `verification check ${index}`);
    const { id } = check;
    if (typeof id !== "string" || !/^[a-z0-9][a-z0-9:-]*$/.test(id)) {
      fail("verification_check_id_invalid", `verification check id at index ${index} is invalid`);
    }
    if (checks.has(id)) fail("verification_check_duplicate", `duplicate verification check: ${id}`);
    if (!required.has(id)) fail("verification_check_unexpected", `unexpected verification check: ${id}`);
    if (check.exitCode !== 0) fail("verification_check_failed", `verification check ${id} failed`);
    if (!Number.isSafeInteger(check.durationMs) || check.durationMs < 0) {
      fail("verification_check_invalid", `verification check ${id} durationMs is invalid`);
    }
    requireDigest(check.outputSha256, `verification check ${id} outputSha256`);
    checks.set(id, Object.fromEntries(CHECK_KEYS.map((key) => [key, check[key]])));
  }
  for (const id of requiredCheckIds) {
    if (!checks.has(id)) fail("verification_check_missing", `missing required verification check: ${id}`);
  }
  return checks;
}

function requireTimestamp(value, label) {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
      !Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    fail("verification_timestamp_invalid", `verification ${label} must be an ISO-8601 UTC timestamp`);
  }
  return value;
}

function requireExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (!sameArray(actual, wanted)) fail("verification_shape_invalid", `${label} fields are invalid`);
}

function requireGitSha(value, label) {
  if (typeof value !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)) {
    fail("verification_sha_invalid", `verification subject ${label} is invalid`);
  }
}

function requireDigest(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    fail("verification_digest_invalid", `${label} is invalid`);
  }
}

function requireSafePath(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value || value.includes("\0") || value.includes("\\") ||
      path.posix.isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.startsWith("//")) {
    fail("verification_path_unsafe", `${label} is unsafe`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    fail("verification_path_unsafe", `${label} is unsafe`);
  }
  return value;
}

function resolvePath(root, relativePath) {
  return path.join(root, ...relativePath.split("/"));
}

function assertOrdinaryPath(root, relativePath, label) {
  assertNoSymlinkAncestors(root, relativePath);
  let stat;
  try {
    stat = lstatSync(resolvePath(root, relativePath));
  } catch {
    fail("verification_file_missing", `${label} is missing: ${relativePath}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail("verification_file_invalid", `${label} is not an ordinary file: ${relativePath}`);
}

function assertNoSymlinkAncestors(root, relativePath) {
  const parts = relativePath.split("/");
  for (let index = 1; index < parts.length; index += 1) {
    const candidate = path.join(root, ...parts.slice(0, index));
    try {
      if (lstatSync(candidate).isSymbolicLink()) {
        fail("verification_symlink_forbidden", `symbolic link ancestor is forbidden: ${parts.slice(0, index).join("/")}`);
      }
    } catch (error) {
      if (error instanceof VerificationManifestError) throw error;
      if (error?.code !== "ENOENT") fail("verification_path_inspection_failed", "unable to inspect verification path");
    }
  }
}

function sameArray(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(code, message) {
  throw new VerificationManifestError(code, message);
}

function readJson(root, relativePath) {
  try {
    assertOrdinaryPath(root, relativePath, "required JSON file");
    return JSON.parse(readFileSync(resolvePath(root, relativePath), "utf8"));
  } catch (error) {
    if (error instanceof VerificationManifestError) throw error;
    fail("verification_json_invalid", `required JSON file is missing or invalid: ${relativePath}`);
  }
}

function runCli() {
  const root = process.cwd();
  try {
    const command = process.argv[2] ?? "verify";
    if (command !== "verify") fail("verification_command_invalid", "verification manifest CLI supports only verify");
    const policy = readJson(root, POLICY_PATH);
    const verification = policy?.verification;
    if (!isRecord(verification)) fail("verification_policy_invalid", "verification policy is missing");
    const outputPath = requireSafePath(verification.manifestPath ?? DEFAULT_VERIFICATION_MANIFEST_PATH, "verification manifest path");
    const manifest = readJson(root, outputPath);
    const subject = collectVerificationSubject(root);
    const result = verifyVerificationManifest(manifest, {
      subject,
      requiredChecks: verification.requiredChecks,
      maxAgeHours: verification.maxAgeHours,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const code = error instanceof VerificationManifestError ? error.code : "verification_manifest_failed";
    const message = error instanceof VerificationManifestError ? error.message : "verification manifest verification failed";
    process.stdout.write(`${JSON.stringify({ ok: false, error: { code, message } })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) runCli();
