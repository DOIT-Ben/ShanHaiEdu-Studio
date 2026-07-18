import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function collectGitVerificationSubject(root, {
  policyPath = "config/development-gates.json",
  stagePath = "docs/stages/active-stage.json",
} = {}) {
  const resolvedRoot = path.resolve(root);
  const safePolicyPath = requireSafeRelativePath(policyPath, "policy path");
  const safeStagePath = requireSafeRelativePath(stagePath, "stage path");
  const headSha = gitText(resolvedRoot, ["rev-parse", "HEAD"]);
  const treeSha = gitText(resolvedRoot, ["rev-parse", "HEAD^{tree}"]);
  requireGitSha(headSha, "headSha");
  requireGitSha(treeSha, "treeSha");

  const status = gitBuffer(resolvedRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const trackedPaths = splitNull(gitBuffer(resolvedRoot, [
    "diff", "--name-only", "--no-renames", "-z", "HEAD", "--", ".",
  ]));
  const untrackedPaths = splitNull(gitBuffer(resolvedRoot, ["ls-files", "--others", "--exclude-standard", "-z"]));
  const changedPaths = [...new Set([...trackedPaths, ...untrackedPaths]
    .map((entry) => requireSafeRelativePath(entry, "changed Git path")))].sort();
  const workingTreeHash = createHash("sha256").update("shanhai.working-tree-content.v1\0", "utf8");
  for (const relativePath of changedPaths) {
    const absolutePath = resolveWithin(resolvedRoot, relativePath);
    workingTreeHash.update(relativePath, "utf8").update("\0", "utf8");
    if (!existsSync(absolutePath)) {
      workingTreeHash.update("deleted\n", "utf8");
      continue;
    }
    assertOrdinaryFile(resolvedRoot, relativePath, "changed Git path");
    workingTreeHash.update("file\0", "utf8")
      .update(createHash("sha256").update(readFileSync(absolutePath)).digest("hex"), "utf8")
      .update("\n", "utf8");
  }

  assertOrdinaryFile(resolvedRoot, safePolicyPath, "policy path");
  assertOrdinaryFile(resolvedRoot, safeStagePath, "stage path");
  return {
    headSha,
    treeSha,
    workingTreeDigest: workingTreeHash.digest("hex"),
    dirty: status.length > 0,
    policySha256: sha256(readFileSync(resolveWithin(resolvedRoot, safePolicyPath))),
    stageSha256: sha256(readFileSync(resolveWithin(resolvedRoot, safeStagePath))),
  };
}

function assertOrdinaryFile(root, relativePath, label) {
  let current = root;
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`${label} must not traverse a symbolic link: ${relativePath}`);
  }
  const stat = lstatSync(current);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be an ordinary file: ${relativePath}`);
}

function requireSafeRelativePath(value, label) {
  const normalized = typeof value === "string" ? value.replaceAll("\\", "/") : "";
  if (!normalized || normalized !== value || path.posix.isAbsolute(normalized) || path.win32.isAbsolute(normalized) ||
      normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`${label} is unsafe.`);
  }
  return normalized;
}

function resolveWithin(root, relativePath) {
  const target = path.resolve(root, ...relativePath.split("/"));
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Verification path escapes the repository.");
  return target;
}

function gitText(root, args) {
  return gitBuffer(root, args).toString("utf8").trim();
}

function gitBuffer(root, args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: null,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) throw new Error(`Git verification command failed: ${args[0]}.`);
  return result.stdout;
}

function splitNull(buffer) {
  return buffer.toString("utf8").split("\0").filter(Boolean);
}

function requireGitSha(value, label) {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)) throw new Error(`Verification ${label} is invalid.`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
