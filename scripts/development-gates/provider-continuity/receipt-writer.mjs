import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function writeExclusiveJson({ root, relativePath, value } = {}) {
  const repositoryRoot = requireOrdinaryRoot(root);
  const target = resolveContinuityTarget(repositoryRoot, relativePath);
  ensureSafeParent(repositoryRoot, target);
  assertSafeTarget(repositoryRoot, target);
  if (existsSync(target)) throw new Error(`Evidence target already exists: ${path.basename(target)}.`);
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    assertSafeTarget(repositoryRoot, target);
    assertSafeTarget(repositoryRoot, temporary);
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    assertSafeTarget(repositoryRoot, target);
    assertSafeTarget(repositoryRoot, temporary);
    if (existsSync(target)) throw new Error(`Evidence target already exists: ${path.basename(target)}.`);
    try {
      linkSync(temporary, target);
    } catch (error) {
      if (error?.code === "EEXIST") throw new Error(`Evidence target already exists: ${path.basename(target)}.`);
      throw error;
    }
    removeSafeTemporary(repositoryRoot, temporary);
    assertSafeTarget(repositoryRoot, target);
  } finally {
    removeSafeTemporary(repositoryRoot, temporary);
  }
}

function requireOrdinaryRoot(value) {
  if (typeof value !== "string" || value.length === 0) throw new Error("Evidence repository root is required.");
  const lexical = path.resolve(value);
  const stat = lstatSync(lexical);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Evidence repository root is unsafe.");
  return realpathSync(lexical);
}

function resolveContinuityTarget(root, value) {
  if (typeof value !== "string" || !value || value.includes("\\") ||
      path.posix.isAbsolute(value) || path.win32.isAbsolute(value) ||
      value.split("/").some((segment) => !segment || segment === "." || segment === "..") ||
      !value.startsWith(".tmp/provider-continuity/") || !value.endsWith(".json")) {
    throw new Error("Evidence output path is unsafe or outside .tmp/provider-continuity.");
  }
  return path.resolve(root, ...value.split("/"));
}

function ensureSafeParent(root, target) {
  const relativeParent = path.relative(root, path.dirname(target));
  let current = root;
  for (const segment of relativeParent.split(path.sep).filter(Boolean)) {
    assertSafeTarget(root, target);
    current = path.join(current, segment);
    if (!existsSync(current)) mkdirSync(current);
    assertOrdinaryContained(root, current, true, "Evidence output parent is unsafe.");
  }
}

function assertSafeTarget(root, target) {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Evidence output path is unsafe.");
  }
  let current = root;
  for (const segment of relative.split(path.sep).slice(0, -1)) {
    current = path.join(current, segment);
    if (!existsSync(current)) break;
    assertOrdinaryContained(root, current, true, "Evidence output parent is unsafe or traverses a link.");
  }
  if (existsSync(target)) {
    assertOrdinaryContained(root, target, false, "Evidence output target is unsafe.");
  }
}

function assertOrdinaryContained(root, target, directory, message) {
  const stat = lstatSync(target);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) throw new Error(message);
  const expected = path.resolve(root, path.relative(root, target));
  if (!samePath(realpathSync(target), expected)) throw new Error(message);
}

function removeSafeTemporary(root, target) {
  assertSafeTarget(root, target);
  if (existsSync(target)) rmSync(target, { force: true });
}

function samePath(left, right) {
  const normalize = (value) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  return normalize(left) === normalize(right);
}

export function sealProviderContinuity({ campaignRoot } = {}) {
  const root = path.resolve(String(campaignRoot ?? ""));
  const capture = path.join(root, "capture");
  const evidence = path.join(root, "evidence");
  if (!existsSync(capture) || !existsSync(evidence)) {
    throw new Error("Provider campaign capture and evidence directories are incomplete.");
  }
  const captureFiles = readdirSync(capture, { withFileTypes: true }).filter((entry) => entry.isFile());
  const evidenceFiles = readdirSync(evidence, { withFileTypes: true }).filter((entry) => entry.isFile());
  if (captureFiles.length === 0 || evidenceFiles.length === 0) {
    throw new Error("Provider campaign capture and evidence are incomplete.");
  }
  throw new Error("Provider campaign cannot be sealed until live authorization and source verification complete.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const campaignIndex = process.argv.indexOf("--campaign-root");
    sealProviderContinuity({ campaignRoot: campaignIndex >= 0 ? process.argv[campaignIndex + 1] : "" });
  } catch (error) {
    console.error(JSON.stringify({ ok: false, passed: false, status: "failed", message: error.message }));
    process.exitCode = 1;
  }
}
