import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

import {
  assertV1_9BaselineCandidateUnchanged,
  collectV1_9BaselineCandidateEvidence,
} from "./v1-9-baseline-evidence.mjs";

export const V1_9_BASELINE_LOCK_VERSION = "v1-9-baseline-lock.v2";
export const V1_9_LEGACY_BASELINE_LOCK_VERSION = "v1-9-baseline-lock.v1";

const comparableFields = Object.freeze([
  "schemaVersion",
  "branch",
  "gitHead",
  "generationIntensity",
  "runtimeSourceDigest",
  "requirementsBaselineDigest",
  "registryDigest",
  "projectionRegistryDigest",
  "providerLedgerManifestDigest",
  "projectionId",
  "verificationManifestSha256",
  "workingTreeDigest",
  "policySha256",
  "stageSha256",
  "providerContinuityManifestSha256",
  "providerContinuityReceiptSha256",
  "providerContinuityEvidenceRootDigest",
  "providerContinuitySubjectDigest",
]);

const runtimeSourceDirectories = Object.freeze([
  "src",
  "scripts",
  "prisma",
  "config",
  "fixtures",
  "public",
  "tests/e2e",
  "tests/fixtures/feedback-e2e",
]);

const runtimeRootFilePatterns = Object.freeze([
  /^package(?:-lock)?\.json$/,
  /^npm-shrinkwrap\.json$/,
  /^tsconfig(?:\.[a-z0-9._-]+)?\.json$/i,
  /^next-env\.d\.ts$/,
  /^next\.config\.[cm]?[jt]s$/,
  /^playwright\.config\.[cm]?[jt]s$/,
  /^vitest\.config\.[cm]?[jt]s$/,
  /^postcss\.config\.[cm]?[jt]s$/,
  /^prisma\.config\.[cm]?[jt]s$/,
  /^electron-builder\.config\.[cm]?[jt]s$/,
  /^Dockerfile(?:\.[a-z0-9._-]+)?$/i,
  /^\.dockerignore$/,
]);

const excludedDirectoryNames = new Set([
  ".git",
  ".next",
  ".tmp",
  ".turbo",
  "blob-report",
  "build",
  "coverage",
  "dist",
  "graphify-out",
  "node_modules",
  "out",
  "output",
  "playwright-report",
  "test-results",
]);

export class V1_9BaselineLockDriftError extends Error {
  constructor(driftedFields) {
    super("v1_9_baseline_lock_drift");
    this.name = "V1_9BaselineLockDriftError";
    this.reasonCode = "v1_9_baseline_lock_drift";
    this.driftedFields = Object.freeze([...driftedFields]);
  }
}

export function createV1_9BaselineLock(input = {}) {
  const cwd = resolveRepositoryRoot(input.cwd);
  const staticInputs = collectV1_9BaselineStaticInputs({ ...input, cwd });
  const candidate = collectV1_9BaselineCandidateEvidence({ cwd, now: input.now });
  if (candidate.subject.headSha !== staticInputs.gitHead) throw stableError("v1_9_baseline_subject_drift");
  const lock = {
    schemaVersion: V1_9_BASELINE_LOCK_VERSION,
    ...staticInputs,
    verificationManifestSha256: candidate.verificationManifestSha256,
    workingTreeDigest: candidate.subject.workingTreeDigest,
    policySha256: candidate.subject.policySha256,
    stageSha256: candidate.subject.stageSha256,
    providerContinuityManifestSha256: candidate.providerContinuityManifestSha256,
    providerContinuityReceiptSha256: candidate.providerContinuityReceiptSha256,
    providerContinuityEvidenceRootDigest: candidate.providerContinuityEvidenceRootDigest,
    providerContinuitySubjectDigest: candidate.providerContinuitySubjectDigest,
  };
  assertV1_9BaselineCandidateUnchanged(cwd, candidate);
  return Object.freeze(lock);
}

export function collectV1_9BaselineStaticInputs(input = {}) {
  const cwd = resolveRepositoryRoot(input.cwd);
  const env = input.env ?? process.env;
  const branch = readGitValue(cwd, ["rev-parse", "--abbrev-ref", "HEAD"], "v1_9_baseline_branch_invalid");
  if (branch !== "main") throw stableError("v1_9_baseline_branch_invalid");

  const gitHead = readGitValue(cwd, ["rev-parse", "HEAD"], "v1_9_baseline_git_head_invalid").toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(gitHead)) throw stableError("v1_9_baseline_git_head_invalid");

  const runtimeRootValue = requiredText(
    env.SHANHAI_SKILLS_RUNTIME_ROOT,
    "v1_9_skills_runtime_root_required",
  );
  const sourceRootValue = requiredText(
    env.SHANHAI_SKILLS_SOURCE_ROOT,
    "v1_9_skills_source_root_required",
  );
  const projectionRoot = resolveExistingDirectory(
    path.resolve(cwd, runtimeRootValue),
    "v1_9_baseline_projection_invalid",
  );
  const sourceSkillsRoot = resolveExistingDirectory(
    path.resolve(cwd, sourceRootValue),
    "v1_9_baseline_registry_invalid",
  );
  assertProjectionOwnedBySource(sourceSkillsRoot, projectionRoot);
  const projectionId = path.basename(projectionRoot);
  if (!isProjectionId(projectionId)) throw stableError("v1_9_baseline_projection_invalid");

  const requirementsPath = path.join(cwd, "docs", "product", "current-requirements-baseline.md");
  const sourceRegistryPath = path.join(
    sourceSkillsRoot,
    "shanhai-suite",
    "assets",
    "registry.yaml",
  );
  const projectionRegistryPath = path.join(
    projectionRoot,
    "shanhai-suite",
    "assets",
    "registry.yaml",
  );
  const providerLedgerManifestPath = path.join(cwd, "API台账系统", "manifest.json");
  const registryDigest = digestRequiredFile(
    sourceSkillsRoot,
    sourceRegistryPath,
    "v1-9-skill-registry.v1",
    "v1_9_baseline_registry_invalid",
  );
  const projectionRegistryDigest = digestRequiredFile(
    projectionRoot,
    projectionRegistryPath,
    "v1-9-skill-registry.v1",
    "v1_9_baseline_projection_registry_invalid",
  );
  if (registryDigest !== projectionRegistryDigest) {
    throw stableError("v1_9_baseline_registry_projection_mismatch");
  }

  return Object.freeze({
    branch: "main",
    gitHead,
    generationIntensity: "standard",
    runtimeSourceDigest: digestRuntimeSource(cwd),
    requirementsBaselineDigest: digestRequiredFile(
      cwd,
      requirementsPath,
      "v1-9-requirements-baseline.v1",
      "v1_9_requirements_baseline_invalid",
    ),
    registryDigest,
    projectionRegistryDigest,
    providerLedgerManifestDigest: digestRequiredFile(
      cwd,
      providerLedgerManifestPath,
      "v1-9-provider-ledger-manifest.v1",
      "v1_9_provider_ledger_manifest_invalid",
    ),
    projectionId,
  });
}

export function compareV1_9BaselineLock(expected, current) {
  const normalizedExpected = normalizeBaselineLock(expected);
  const normalizedCurrent = normalizeBaselineLock(current);
  const driftedFields = comparableFields.filter(
    (field) => normalizedExpected[field] !== normalizedCurrent[field],
  );
  return Object.freeze({
    isCurrent: driftedFields.length === 0,
    driftedFields: Object.freeze(driftedFields),
  });
}

export function assertCurrentV1_9BaselineLock(expected, input = {}) {
  const current = createV1_9BaselineLock(input);
  const comparison = compareV1_9BaselineLock(expected, current);
  if (!comparison.isCurrent) {
    throw new V1_9BaselineLockDriftError(comparison.driftedFields);
  }
  return current;
}

function digestRuntimeSource(cwd) {
  const entries = new Map();
  try {
    for (const relativeDirectory of runtimeSourceDirectories) {
      const absoluteDirectory = path.join(cwd, ...relativeDirectory.split("/"));
      const stat = tryLstat(absoluteDirectory);
      if (!stat) continue;
      if (!stat.isDirectory()) throw stableError("v1_9_baseline_runtime_source_invalid");
      collectDirectoryEntries(cwd, absoluteDirectory, entries);
    }

    for (const entry of readdirSync(cwd, { withFileTypes: true })) {
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      if (!runtimeRootFilePatterns.some((pattern) => pattern.test(entry.name))) continue;
      collectFileEntry(cwd, path.join(cwd, entry.name), entries);
    }
  } catch (error) {
    if (isStableError(error)) throw error;
    throw stableError("v1_9_baseline_runtime_source_invalid");
  }
  return digestEntries("v1-9-runtime-source.v1", entries.values());
}

function collectDirectoryEntries(cwd, directory, entries) {
  const children = readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => compareText(left.name, right.name));
  for (const child of children) {
    const absolutePath = path.join(directory, child.name);
    const relativePath = normalizeRelativePath(path.relative(cwd, absolutePath));
    if (child.isSymbolicLink()) throw stableError("v1_9_baseline_runtime_source_invalid");
    if (isExcludedPath(relativePath)) continue;
    if (child.isDirectory()) {
      collectDirectoryEntries(cwd, absolutePath, entries);
      continue;
    }
    if (child.isFile()) {
      collectFileEntry(cwd, absolutePath, entries);
      continue;
    }
    throw stableError("v1_9_baseline_runtime_source_invalid");
  }
}

function collectFileEntry(cwd, absolutePath, entries) {
  const relativePath = normalizeRelativePath(path.relative(cwd, absolutePath));
  if (!relativePath || isExcludedPath(relativePath)) return;
  const stat = lstatSync(absolutePath);
  if (stat.isFile()) {
    entries.set(relativePath, {
      relativePath,
      kind: "file",
      content: readFileSync(absolutePath),
    });
    return;
  }
  throw stableError("v1_9_baseline_runtime_source_invalid");
}

function digestRequiredFile(root, filePath, domain, reasonCode) {
  try {
    const stat = lstatSync(filePath);
    if (!stat.isFile()) throw stableError(reasonCode);
    const relativePath = normalizeRelativePath(path.relative(root, filePath));
    if (!relativePath || relativePath.startsWith("../")) throw stableError(reasonCode);
    return digestEntries(domain, [{
      relativePath,
      kind: "file",
      content: readFileSync(filePath),
    }]);
  } catch (error) {
    if (isStableError(error)) throw error;
    throw stableError(reasonCode);
  }
}

function digestEntries(domain, sourceEntries) {
  const entries = [...sourceEntries]
    .sort((left, right) => compareText(left.relativePath, right.relativePath));
  const hash = createHash("sha256");
  writeHashFrame(hash, "domain", Buffer.from(domain, "utf8"));
  for (const entry of entries) {
    writeHashFrame(hash, "path", Buffer.from(entry.relativePath, "utf8"));
    writeHashFrame(hash, "kind", Buffer.from(entry.kind, "utf8"));
    writeHashFrame(hash, "content", entry.content);
  }
  return hash.digest("hex");
}

function writeHashFrame(hash, label, content) {
  const labelBytes = Buffer.from(label, "utf8");
  hash.update(Buffer.from(`${labelBytes.length}:`, "ascii"));
  hash.update(labelBytes);
  hash.update(Buffer.from(`:${content.length}:`, "ascii"));
  hash.update(content);
  hash.update(Buffer.from(";", "ascii"));
}

function normalizeBaselineLock(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw stableError("v1_9_baseline_lock_invalid");
  }
  if (![V1_9_BASELINE_LOCK_VERSION, V1_9_LEGACY_BASELINE_LOCK_VERSION].includes(value.schemaVersion) ||
      value.branch !== "main" ||
      value.generationIntensity !== "standard") {
    throw stableError("v1_9_baseline_lock_invalid");
  }
  const gitHead = String(value.gitHead ?? "").toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(gitHead)) throw stableError("v1_9_baseline_lock_invalid");
  const runtimeSourceDigest = normalizeDigest(value.runtimeSourceDigest);
  const requirementsBaselineDigest = normalizeDigest(value.requirementsBaselineDigest);
  const registryDigest = normalizeDigest(value.registryDigest);
  const projectionRegistryDigest = normalizeDigest(value.projectionRegistryDigest);
  const providerLedgerManifestDigest = normalizeDigest(value.providerLedgerManifestDigest);
  if (registryDigest !== projectionRegistryDigest) {
    throw stableError("v1_9_baseline_registry_projection_mismatch");
  }
  const projectionId = String(value.projectionId ?? "").trim();
  if (!isProjectionId(projectionId)) throw stableError("v1_9_baseline_lock_invalid");
  const normalized = {
    schemaVersion: value.schemaVersion,
    branch: "main",
    gitHead,
    generationIntensity: "standard",
    runtimeSourceDigest,
    requirementsBaselineDigest,
    registryDigest,
    projectionRegistryDigest,
    providerLedgerManifestDigest,
    projectionId,
  };
  if (value.schemaVersion === V1_9_LEGACY_BASELINE_LOCK_VERSION) return normalized;
  return {
    ...normalized,
    verificationManifestSha256: normalizeDigest(value.verificationManifestSha256),
    workingTreeDigest: normalizeDigest(value.workingTreeDigest),
    policySha256: normalizeDigest(value.policySha256),
    stageSha256: normalizeDigest(value.stageSha256),
    providerContinuityManifestSha256: normalizeDigest(value.providerContinuityManifestSha256),
    providerContinuityReceiptSha256: normalizeDigest(value.providerContinuityReceiptSha256),
    providerContinuityEvidenceRootDigest: normalizeDigest(value.providerContinuityEvidenceRootDigest),
    providerContinuitySubjectDigest: normalizeDigest(value.providerContinuitySubjectDigest),
  };
}

function normalizeDigest(value) {
  const digest = String(value ?? "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw stableError("v1_9_baseline_lock_invalid");
  return digest;
}

function resolveRepositoryRoot(value) {
  const cwd = path.resolve(value ?? process.cwd());
  try {
    if (!lstatSync(cwd).isDirectory()) throw stableError("v1_9_baseline_repo_invalid");
  } catch (error) {
    if (isStableError(error)) throw error;
    throw stableError("v1_9_baseline_repo_invalid");
  }
  return cwd;
}

function resolveExistingDirectory(value, reasonCode) {
  try {
    const resolved = realpathSync(value);
    if (!lstatSync(resolved).isDirectory()) throw stableError(reasonCode);
    return resolved;
  } catch (error) {
    if (isStableError(error)) throw error;
    throw stableError(reasonCode);
  }
}

function assertProjectionOwnedBySource(sourceSkillsRoot, projectionRoot) {
  if (sourceSkillsRoot === projectionRoot) {
    throw stableError("v1_9_baseline_source_projection_alias");
  }
  let sourceDistRoot;
  try {
    sourceDistRoot = realpathSync(path.join(sourceSkillsRoot, "dist"));
  } catch {
    throw stableError("v1_9_baseline_projection_not_owned_by_source");
  }
  const relative = path.relative(sourceDistRoot, projectionRoot);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw stableError("v1_9_baseline_projection_not_owned_by_source");
  }
}

function readGitValue(cwd, args, reasonCode) {
  try {
    const value = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }).trim();
    if (!value) throw stableError(reasonCode);
    return value;
  } catch (error) {
    if (isStableError(error)) throw error;
    throw stableError(reasonCode);
  }
}

function isExcludedPath(relativePath) {
  const parts = relativePath.split("/");
  if (parts.some((part) => excludedDirectoryNames.has(part.toLowerCase()))) return true;
  if (parts.some((part) => {
    const lower = part.toLowerCase();
    return lower === "private-local-secrets" ||
      (lower.startsWith("api") && lower.includes("\u53f0\u8d26"));
  })) return true;
  const fileName = parts.at(-1)?.toLowerCase() ?? "";
  return fileName === ".env" ||
    fileName.startsWith(".env.") ||
    fileName.endsWith(".tsbuildinfo");
}

function isProjectionId(value) {
  return Boolean(value) &&
    value !== "." &&
    value !== ".." &&
    value.length <= 255 &&
    !/[\\/]/.test(value);
}

function normalizeRelativePath(value) {
  return value.replaceAll("\\", "/");
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function tryLstat(filePath) {
  try {
    return lstatSync(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function requiredText(value, reasonCode) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw stableError(reasonCode);
  return normalized;
}

function stableError(reasonCode) {
  const error = new Error(reasonCode);
  error.reasonCode = reasonCode;
  return error;
}

function isStableError(error) {
  return error instanceof Error &&
    typeof error.reasonCode === "string" &&
    error.message === error.reasonCode;
}
