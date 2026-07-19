import { createHash } from "node:crypto";
import {
  constants,
  copyFileSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import Database from "better-sqlite3";

const schemaVersion = "shanhai-release-data-backup.v1";
const databaseRelativePath = "database/production.sqlite";
const artifactRelativeRoot = "artifacts";
const sqliteBackupPagesPerStep = 100;
const sqliteBackupMaxStalledSteps = 1_000;
const sqliteBackupMaxDurationMs = 15 * 60 * 1_000;

export function createSqliteBackupProgressGuard({
  maxStalledSteps = sqliteBackupMaxStalledSteps,
  maxDurationMs = sqliteBackupMaxDurationMs,
  now = Date.now,
} = {}) {
  const startedAt = now();
  let lastRemainingPages;
  let stalledSteps = 0;

  return ({ remainingPages }) => {
    if (now() - startedAt > maxDurationMs) {
      throw new Error("SQLite backup exceeded its time limit.");
    }
    if (remainingPages === lastRemainingPages) stalledSteps += 1;
    else {
      lastRemainingPages = remainingPages;
      stalledSteps = 0;
    }
    if (stalledSteps >= maxStalledSteps) {
      throw new Error("SQLite backup stopped making progress.");
    }
    return sqliteBackupPagesPerStep;
  };
}

export async function createReleaseDataBackup({
  databasePath,
  artifactRoot,
  backupRoot,
  releaseId,
  offlineConfirmed,
}) {
  requireOfflineConfirmation(offlineConfirmed);
  const normalizedReleaseId = requireReleaseId(releaseId);
  const sourceDatabase = requireOrdinaryFile(databasePath, "database");
  const sourceArtifacts = requireOrdinaryDirectory(artifactRoot, "artifact root");
  const destination = path.resolve(requireText(backupRoot, "backup root"));
  if (existsSync(destination)) throw new Error("Backup destination exists; refusing to overwrite.");
  if (isPathInside(sourceArtifacts, sourceDatabase)) throw new Error("Database and artifact roots must be separate.");
  if (isPathInside(sourceArtifacts, destination)) throw new Error("Backup destination must be outside the artifact root.");

  mkdirSync(destination);
  const databaseDestination = containedPath(destination, databaseRelativePath);
  mkdirSync(path.dirname(databaseDestination), { recursive: true });
  const artifactDestination = containedPath(destination, artifactRelativeRoot);
  mkdirSync(artifactDestination);

  const source = new Database(sourceDatabase, { readonly: true, fileMustExist: true });
  try {
    await source.backup(databaseDestination, { progress: createSqliteBackupProgressGuard() });
  } finally {
    source.close();
  }

  const sourceFiles = collectOrdinaryFiles(sourceArtifacts);
  for (const file of sourceFiles) {
    const target = containedPath(artifactDestination, file.relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(file.absolutePath, target, constants.COPYFILE_EXCL);
  }

  const integrity = normalizeBackupDatabase(databaseDestination);
  if (integrity !== "ok") throw new Error("Backup database integrity check failed.");
  const databaseEntry = await fileEntry(databaseDestination, databaseRelativePath);
  const artifactEntries = await Promise.all(sourceFiles.map(async (file) =>
    fileEntry(containedPath(artifactDestination, file.relativePath), file.relativePath)));

  const manifest = {
    schemaVersion,
    releaseId: normalizedReleaseId,
    createdAt: new Date().toISOString(),
    database: { ...databaseEntry, integrity },
    artifacts: { root: artifactRelativeRoot, files: artifactEntries },
  };
  writeFileSync(containedPath(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  return safeResult("backup", normalizedReleaseId, integrity, artifactEntries.length);
}

export async function verifyReleaseDataBackup({ backupRoot }) {
  const root = requireOrdinaryDirectory(backupRoot, "backup root");
  const manifest = readManifest(root);
  const expectedBackupFiles = [
    "manifest.json",
    manifest.database.path,
    ...manifest.artifacts.files.map((entry) => `${manifest.artifacts.root}/${entry.path}`),
  ].sort();
  const actualBackupFiles = collectOrdinaryFiles(root).map((file) => file.relativePath).sort();
  if (JSON.stringify(actualBackupFiles) !== JSON.stringify(expectedBackupFiles)) throw verificationError();
  const databasePath = containedPath(root, manifest.database.path);
  await assertFileMatches(databasePath, manifest.database);
  const integrity = sqliteIntegrity(databasePath);
  if (integrity !== "ok" || manifest.database.integrity !== "ok") throw verificationError();

  const artifactsRoot = requireOrdinaryDirectory(containedPath(root, manifest.artifacts.root), "backup artifacts");
  const actualFiles = collectOrdinaryFiles(artifactsRoot);
  const expectedFiles = manifest.artifacts.files;
  if (actualFiles.length !== expectedFiles.length) throw verificationError();
  const actualPaths = actualFiles.map((file) => file.relativePath).sort();
  const expectedPaths = expectedFiles.map((file) => file.path).sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) throw verificationError();
  for (const entry of expectedFiles) await assertFileMatches(containedPath(artifactsRoot, entry.path), entry);
  return safeResult("verify", manifest.releaseId, integrity, expectedFiles.length);
}

export async function restoreReleaseDataBackup({
  backupRoot,
  databaseTarget,
  artifactTarget,
  offlineConfirmed,
}) {
  requireOfflineConfirmation(offlineConfirmed);
  const verified = await verifyReleaseDataBackup({ backupRoot });
  const root = requireOrdinaryDirectory(backupRoot, "backup root");
  const manifest = readManifest(root);
  const targetDatabase = path.resolve(requireText(databaseTarget, "database target"));
  const targetArtifacts = path.resolve(requireText(artifactTarget, "artifact target"));
  if (existsSync(targetDatabase) || existsSync(targetArtifacts)) throw new Error("Restore target exists; refusing to overwrite.");
  if (isPathInside(root, targetDatabase) || isPathInside(root, targetArtifacts) || isPathInside(targetArtifacts, targetDatabase)) {
    throw new Error("Restore targets must be separate from the backup and each other.");
  }

  mkdirSync(path.dirname(targetDatabase), { recursive: true });
  copyFileSync(containedPath(root, manifest.database.path), targetDatabase, constants.COPYFILE_EXCL);
  mkdirSync(targetArtifacts);
  const backupArtifacts = containedPath(root, manifest.artifacts.root);
  for (const entry of manifest.artifacts.files) {
    const target = containedPath(targetArtifacts, entry.path);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(containedPath(backupArtifacts, entry.path), target, constants.COPYFILE_EXCL);
  }
  if (sqliteIntegrity(targetDatabase) !== "ok") throw new Error("Restored database integrity check failed.");
  for (const entry of manifest.artifacts.files) await assertFileMatches(containedPath(targetArtifacts, entry.path), entry);
  return { ...verified, operation: "restore" };
}

function readManifest(root) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(containedPath(root, "manifest.json"), "utf8"));
  } catch {
    throw verificationError();
  }
  if (!manifest || manifest.schemaVersion !== schemaVersion ||
      !isReleaseId(manifest.releaseId) ||
      !isFileEntry(manifest.database) || manifest.database.integrity !== "ok" ||
      manifest.artifacts?.root !== artifactRelativeRoot || !Array.isArray(manifest.artifacts.files) ||
      !manifest.artifacts.files.every(isFileEntry)) {
    throw verificationError();
  }
  if (manifest.database.path !== databaseRelativePath) throw verificationError();
  const uniquePaths = new Set(manifest.artifacts.files.map((entry) => entry.path));
  if (uniquePaths.size !== manifest.artifacts.files.length) throw verificationError();
  return manifest;
}

function isFileEntry(value) {
  return Boolean(value && typeof value === "object" && isSafeRelativePath(value.path) &&
    Number.isSafeInteger(value.size) && value.size >= 0 && /^[a-f0-9]{64}$/.test(value.sha256));
}

function collectOrdinaryFiles(root) {
  const files = [];
  walk(root, "", files);
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function walk(root, relative, files) {
  const directory = relative ? containedPath(root, relative) : root;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    if (!isSafeRelativePath(childRelative) || entry.isSymbolicLink()) throw new Error("Backup source contains an unsafe entry.");
    if (entry.isDirectory()) walk(root, childRelative, files);
    else if (entry.isFile()) files.push({ relativePath: childRelative, absolutePath: containedPath(root, childRelative) });
    else throw new Error("Backup source contains a non-file entry.");
  }
}

async function fileEntry(filePath, relativePath) {
  const stat = statSync(filePath);
  return { path: relativePath.replaceAll("\\", "/"), size: stat.size, sha256: await hashFile(filePath) };
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function assertFileMatches(filePath, expected) {
  try {
    const file = requireOrdinaryFile(filePath, "backup file");
    if (statSync(file).size !== expected.size) throw verificationError();
    const actual = await hashFile(file);
    if (actual !== expected.sha256) throw verificationError();
  } catch {
    throw verificationError();
  }
}

function sqliteIntegrity(databasePath) {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    return database.pragma("integrity_check", { simple: true });
  } finally {
    database.close();
  }
}

function normalizeBackupDatabase(databasePath) {
  const database = new Database(databasePath, { fileMustExist: true });
  try {
    database.pragma("journal_mode = DELETE");
    return database.pragma("integrity_check", { simple: true });
  } finally {
    database.close();
  }
}

function requireOrdinaryFile(value, label) {
  const candidate = path.resolve(requireText(value, label));
  try {
    const stat = lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be an ordinary file.`);
    return realpathSync(candidate);
  } catch {
    throw new Error(`${label} must be an ordinary file.`);
  }
}

function requireOrdinaryDirectory(value, label) {
  const candidate = path.resolve(requireText(value, label));
  try {
    const stat = lstatSync(candidate);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be an ordinary directory.`);
    return realpathSync(candidate);
  } catch {
    throw new Error(`${label} must be an ordinary directory.`);
  }
}

function containedPath(root, relative) {
  if (!isSafeRelativePath(relative)) throw verificationError();
  const candidate = path.resolve(root, ...relative.split("/"));
  if (!isPathInside(root, candidate)) throw verificationError();
  return candidate;
}

function isSafeRelativePath(value) {
  return typeof value === "string" && Boolean(value) && !path.isAbsolute(value) &&
    !/^[A-Za-z]:[\\/]/.test(value) && value.split(/[\\/]/).every((part) => part && part !== "." && part !== "..");
}

function isPathInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function requireText(value, label) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function requireReleaseId(value) {
  const normalized = requireText(value, "release id");
  if (!isReleaseId(normalized)) throw new Error("Release id must use 1-128 safe identifier characters.");
  return normalized;
}

function isReleaseId(value) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(value);
}

function requireOfflineConfirmation(value) {
  if (value !== true) throw new Error("Explicit offline confirmation is required.");
}

function verificationError() {
  return new Error("Release data backup verification failed.");
}

function safeResult(operation, releaseId, databaseIntegrity, artifactFileCount) {
  return { operation, ok: true, releaseId, databaseIntegrity, artifactFileCount };
}

function parseArguments(argv) {
  const [operation, ...rest] = argv;
  const values = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--confirm-offline") values.offlineConfirmed = true;
    else if (token.startsWith("--")) values[token.slice(2)] = rest[++index];
  }
  return { operation, values };
}

async function runCli() {
  const { operation, values } = parseArguments(process.argv.slice(2));
  let result;
  if (operation === "backup") {
    result = await createReleaseDataBackup({
      databasePath: values.database,
      artifactRoot: values.artifacts,
      backupRoot: values.backup,
      releaseId: values["release-id"],
      offlineConfirmed: values.offlineConfirmed,
    });
  } else if (operation === "verify") {
    result = await verifyReleaseDataBackup({ backupRoot: values.backup });
  } else if (operation === "restore") {
    result = await restoreReleaseDataBackup({
      backupRoot: values.backup,
      databaseTarget: values["database-target"],
      artifactTarget: values["artifacts-target"],
      offlineConfirmed: values.offlineConfirmed,
    });
  } else {
    throw new Error("Operation must be backup, verify, or restore.");
  }
  console.log(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch(() => {
    console.error(JSON.stringify({ ok: false, error: "Release data operation failed." }));
    process.exit(2);
  });
}
