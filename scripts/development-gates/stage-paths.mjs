import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const ACTIVE_STAGE_PATH = "docs/stages/active-stage.json";
const POLICY_PATH = "config/development-gates.json";
const DEFAULT_PROTECTED_PATHS = ["docs/archive/**"];
const NO_STAGE_ALLOWED_PATHS = [
  "docs/product/requirements-backlog.md",
  "docs/stages/active-stage.json",
  "docs/stages/*-plan.md",
  "docs/stages/*-test-plan.md",
];
const BUDGET_KEYS = ["maxChangedFiles", "maxAddedLines", "maxDeletedLines", "maxBinaryFiles"];

export class StagePathError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "StagePathError";
    this.code = code;
  }
}

export function validateStageContract(input) {
  if (!isRecord(input)) fail("stage_contract_invalid", "active stage contract must be an object");
  if (input.schemaVersion !== "shanhai-active-stage.v1") {
    fail("stage_schema_invalid", "active stage schemaVersion is unsupported");
  }
  if (input.status !== "active") fail("stage_status_invalid", "active stage status must be active");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(String(input.stageId ?? ""))) {
    fail("stage_id_invalid", "active stage stageId is invalid");
  }
  requireGitSha(input.baselineSha, "baselineSha");
  requireSafePath(input.plan, "plan", { allowGlob: false });
  requireSafePath(input.testPlan, "testPlan", { allowGlob: false });

  const allowedPaths = requirePathList(input.allowedPaths, "allowedPaths", { allowGlob: true, nonEmpty: true });
  const exceptions = requirePathList(input.protectedPathExceptions, "protectedPathExceptions", {
    allowGlob: false,
    nonEmpty: false,
  });
  for (const exception of exceptions) {
    if (!allowedPaths.some((pattern) => pathMatches(exception, pattern))) {
      fail("stage_exception_not_allowed", `protectedPathExceptions path is not allowlisted: ${exception}`);
    }
  }

  if (!isRecord(input.budgets)) fail("stage_budgets_invalid", "active stage budgets must be an object");
  for (const key of BUDGET_KEYS) {
    const value = input.budgets[key];
    if (!Number.isSafeInteger(value) || value < 0) {
      fail("stage_budget_invalid", `active stage budget ${key} must be a non-negative integer`);
    }
  }
  return input;
}

export function verifyStagePaths({
  stage,
  changes = [],
  protectedPaths = DEFAULT_PROTECTED_PATHS,
  isBaselineAncestor = () => true,
  isPathSymlink = () => false,
} = {}) {
  if (!Array.isArray(changes)) fail("stage_changes_invalid", "changes must be an array");
  const normalizedChanges = normalizeChanges(changes);
  const normalizedProtected = requirePathList(protectedPaths, "protectedPaths", { allowGlob: true, nonEmpty: false });

  if (stage == null) {
    verifyNoStageChanges(normalizedChanges, normalizedProtected, isPathSymlink);
    return summarize(null, normalizedChanges);
  }

  const activeStage = validateStageContract(stage);
  if (isBaselineAncestor(activeStage.baselineSha) !== true) {
    fail("stage_baseline_not_ancestor", "active stage baselineSha is not an ancestor of HEAD");
  }

  const exceptionSet = new Set(activeStage.protectedPathExceptions);
  for (const change of normalizedChanges) {
    if (!activeStage.allowedPaths.some((pattern) => pathMatches(change.path, pattern))) {
      fail("stage_path_not_allowed", `path is outside the active stage allowlist: ${change.path}`);
    }
    if (normalizedProtected.some((pattern) => pathMatches(change.path, pattern)) && !exceptionSet.has(change.path)) {
      fail("stage_protected_path", `protected path has no exact exception: ${change.path}`);
    }
    assertNotSymlink(change, isPathSymlink);
  }

  const result = summarize(activeStage, normalizedChanges);
  for (const [metric, budgetKey] of [
    ["changedFiles", "maxChangedFiles"],
    ["addedLines", "maxAddedLines"],
    ["deletedLines", "maxDeletedLines"],
    ["binaryFiles", "maxBinaryFiles"],
  ]) {
    if (result[metric] > activeStage.budgets[budgetKey]) {
      fail("stage_budget_exceeded", `${budgetKey} exceeded: ${result[metric]} > ${activeStage.budgets[budgetKey]}`);
    }
  }
  return result;
}

export function collectStageChanges(root, baselineSha) {
  const tracked = parseNumstat(runGit(root, ["diff", "--no-renames", "--numstat", "-z", baselineSha, "--"]));
  const untrackedPaths = splitNull(runGit(root, ["ls-files", "--others", "--exclude-standard", "-z"]));
  const symlinkPaths = collectGitSymlinks(root, baselineSha);
  const trackedByPath = new Map(tracked.map((change) => [change.path, change]));

  for (const relativePath of untrackedPaths) {
    const safePath = requireSafePath(relativePath, "Git path", { allowGlob: false });
    if (trackedByPath.has(safePath)) continue;
    const filesystemSymlink = hasFilesystemSymlink(root, safePath);
    if (filesystemSymlink) {
      trackedByPath.set(safePath, {
        path: safePath,
        addedLines: 0,
        deletedLines: 0,
        binary: false,
        symlink: true,
      });
      continue;
    }
    const bytes = readFileSync(path.join(root, ...safePath.split("/")));
    const binary = bytes.includes(0);
    trackedByPath.set(safePath, {
      path: safePath,
      addedLines: binary ? 0 : countLines(bytes.toString("utf8")),
      deletedLines: 0,
      binary,
      symlink: symlinkPaths.has(safePath),
    });
  }

  return [...trackedByPath.values()]
    .map((change) => ({ ...change, symlink: change.symlink || symlinkPaths.has(change.path) }))
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
}

export function isGitAncestor(root, baselineSha) {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", baselineSha, "HEAD"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  fail("stage_git_ancestor_failed", "unable to verify whether baselineSha is an ancestor of HEAD");
}

function verifyNoStageChanges(changes, protectedPaths, isPathSymlink) {
  for (const change of changes) {
    if (!NO_STAGE_ALLOWED_PATHS.some((pattern) => pathMatches(change.path, pattern))) {
      fail("active_stage_required", `an active stage is required to change: ${change.path}`);
    }
    if (protectedPaths.some((pattern) => pathMatches(change.path, pattern))) {
      fail("stage_protected_path", `protected path cannot change without an active stage exception: ${change.path}`);
    }
    assertNotSymlink(change, isPathSymlink);
  }
}

function normalizeChanges(changes) {
  const seen = new Set();
  return changes.map((input, index) => {
    if (!isRecord(input)) fail("stage_change_invalid", `changes[${index}] must be an object`);
    const relativePath = requireSafePath(input.path, `changes[${index}].path`, { allowGlob: false });
    const folded = relativePath.toLowerCase();
    if (seen.has(folded)) fail("stage_change_duplicate", `duplicate changed path: ${relativePath}`);
    seen.add(folded);
    const addedLines = requireCount(input.addedLines, `changes[${index}].addedLines`);
    const deletedLines = requireCount(input.deletedLines, `changes[${index}].deletedLines`);
    if (typeof input.binary !== "boolean") fail("stage_change_invalid", `changes[${index}].binary must be boolean`);
    return { path: relativePath, addedLines, deletedLines, binary: input.binary, symlink: input.symlink === true };
  });
}

function assertNotSymlink(change, isPathSymlink) {
  if (change.symlink) fail("stage_symlink_forbidden", `symbolic link change is forbidden: ${change.path}`);
  const parts = change.path.split("/");
  for (let index = 1; index <= parts.length; index += 1) {
    const candidate = parts.slice(0, index).join("/");
    if (isPathSymlink(candidate) === true) {
      fail("stage_symlink_forbidden", `symbolic link path or ancestor is forbidden: ${change.path}`);
    }
  }
}

function summarize(stage, changes) {
  return {
    ok: true,
    stageId: stage?.stageId ?? null,
    baselineSha: stage?.baselineSha ?? null,
    changedFiles: changes.length,
    addedLines: changes.reduce((sum, change) => sum + change.addedLines, 0),
    deletedLines: changes.reduce((sum, change) => sum + change.deletedLines, 0),
    binaryFiles: changes.filter((change) => change.binary).length,
  };
}

function collectGitSymlinks(root, baselineSha) {
  const paths = new Set();
  for (const record of splitNull(runGit(root, ["ls-files", "-s", "-z"]))) {
    const match = /^(\d{6}) [0-9a-f]+ \d+\t([\s\S]+)$/.exec(record);
    if (!match) fail("stage_git_output_invalid", "git index mode output is invalid");
    if (match[1] === "120000") paths.add(requireSafePath(match[2], "Git path", { allowGlob: false }));
  }
  for (const record of splitNull(runGit(root, ["ls-tree", "-r", "-z", baselineSha, "--"]))) {
    const match = /^(\d{6}) \w+ [0-9a-f]+\t([\s\S]+)$/.exec(record);
    if (!match) fail("stage_git_output_invalid", "git baseline tree output is invalid");
    if (match[1] === "120000") paths.add(requireSafePath(match[2], "Git path", { allowGlob: false }));
  }
  return paths;
}

function parseNumstat(buffer) {
  return splitNull(buffer).map((record) => {
    const firstTab = record.indexOf("\t");
    const secondTab = record.indexOf("\t", firstTab + 1);
    if (firstTab < 1 || secondTab < 0) fail("stage_git_output_invalid", "git numstat output is invalid");
    const added = record.slice(0, firstTab);
    const deleted = record.slice(firstTab + 1, secondTab);
    const relativePath = requireSafePath(record.slice(secondTab + 1), "Git path", { allowGlob: false });
    const binary = added === "-" && deleted === "-";
    if (!binary && (!/^\d+$/.test(added) || !/^\d+$/.test(deleted))) {
      fail("stage_git_output_invalid", `git numstat counts are invalid: ${relativePath}`);
    }
    return {
      path: relativePath,
      addedLines: binary ? 0 : Number(added),
      deletedLines: binary ? 0 : Number(deleted),
      binary,
      symlink: false,
    };
  });
}

function runGit(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "buffer", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0 || result.error) fail("stage_git_failed", `git ${args[0]} failed`);
  return result.stdout;
}

function splitNull(buffer) {
  return buffer.toString("utf8").split("\0").filter((entry) => entry.length > 0);
}

function countLines(text) {
  if (text.length === 0) return 0;
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

function requirePathList(value, label, options) {
  if (!Array.isArray(value) || (options.nonEmpty && value.length === 0)) {
    fail("stage_path_list_invalid", `${label} must be ${options.nonEmpty ? "a non-empty " : "an "}array`);
  }
  const seen = new Set();
  return value.map((entry, index) => {
    const normalized = requireSafePath(entry, `${label}[${index}]`, options);
    const folded = normalized.toLowerCase();
    if (seen.has(folded)) fail("stage_path_duplicate", `duplicate ${label} path: ${normalized}`);
    seen.add(folded);
    return normalized;
  });
}

function requireSafePath(value, label, { allowGlob }) {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value || value.includes("\0") || value.includes("\\")) {
    fail("stage_path_unsafe", `unsafe ${label}`);
  }
  if (path.posix.isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.startsWith("//")) {
    fail("stage_path_unsafe", `unsafe ${label}`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    fail("stage_path_unsafe", `unsafe ${label}`);
  }
  if (!allowGlob && /[*?\[\]{}]/.test(value)) fail("stage_path_unsafe", `unsafe ${label}`);
  if (allowGlob && /[\[\]{}]/.test(value)) fail("stage_path_unsafe", `unsupported glob in ${label}`);
  return value;
}

function pathMatches(relativePath, pattern) {
  if (!pattern.includes("*") && !pattern.includes("?")) return relativePath === pattern;
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*") {
      if (pattern[index + 2] === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else {
        source += ".*";
        index += 1;
      }
    } else if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`${source}$`).test(relativePath);
}

function requireGitSha(value, label) {
  if (typeof value !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)) {
    fail("stage_sha_invalid", `${label} must be a lowercase Git object SHA`);
  }
  return value;
}

function requireCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail("stage_change_invalid", `${label} must be a non-negative integer`);
  return value;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(code, message) {
  throw new StagePathError(code, message);
}

function isFilesystemSymlink(root, relativePath) {
  try {
    return lstatSync(path.join(root, ...relativePath.split("/"))).isSymbolicLink();
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false;
    fail("stage_path_inspection_failed", `unable to inspect changed path: ${relativePath}`);
  }
}

function hasFilesystemSymlink(root, relativePath) {
  const parts = relativePath.split("/");
  for (let index = 1; index <= parts.length; index += 1) {
    if (isFilesystemSymlink(root, parts.slice(0, index).join("/"))) return true;
  }
  return false;
}

function readJson(root, relativePath, required = true) {
  try {
    if (hasFilesystemSymlink(root, relativePath)) {
      fail("stage_symlink_forbidden", `symbolic link path or ancestor is forbidden: ${relativePath}`);
    }
    const stat = lstatSync(path.join(root, ...relativePath.split("/")));
    if (!stat.isFile()) fail("stage_json_invalid", `required JSON file is not an ordinary file: ${relativePath}`);
    return JSON.parse(readFileSync(path.join(root, ...relativePath.split("/")), "utf8"));
  } catch (error) {
    if (error instanceof StagePathError) throw error;
    if (!required && error?.code === "ENOENT") return null;
    fail("stage_json_invalid", `required JSON file is missing or invalid: ${relativePath}`);
  }
}

function runCli() {
  const root = process.cwd();
  try {
    const stage = readJson(root, ACTIVE_STAGE_PATH, false);
    const policy = readJson(root, POLICY_PATH, false);
    const validated = stage == null ? null : validateStageContract(stage);
    const changes = validated == null ? collectChangesWithoutStage(root) : collectStageChanges(root, validated.baselineSha);
    const result = verifyStagePaths({
      stage: validated,
      changes,
      protectedPaths: policy?.protectedPaths ?? DEFAULT_PROTECTED_PATHS,
      isBaselineAncestor: (baselineSha) => isGitAncestor(root, baselineSha),
      isPathSymlink: (relativePath) => isFilesystemSymlink(root, relativePath),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const code = error instanceof StagePathError ? error.code : "stage_path_gate_failed";
    const message = error instanceof StagePathError ? error.message : "stage path gate failed";
    process.stdout.write(`${JSON.stringify({ ok: false, error: { code, message } })}\n`);
    process.exitCode = 1;
  }
}

function collectChangesWithoutStage(root) {
  const paths = splitNull(runGit(root, ["ls-files", "--modified", "--deleted", "--others", "--exclude-standard", "-z"]));
  return [...new Set(paths)].map((relativePath) => ({
    path: relativePath,
    addedLines: 0,
    deletedLines: 0,
    binary: false,
    symlink: false,
  }));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) runCli();
