import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { assertCanonicalExistingPathChain } from "./physical-path-integrity.mjs";

export const M67_FROZEN_APP_MARKER_SCHEMA_VERSION = "m67-frozen-app.v3";
const M67_OWNED_TRANSIENT_ROOT_ENTRIES = Object.freeze([".next-m67", ".tmp"]);

export function resolveM67FrozenAppRoot(value, runRoot, dependencies = {}) {
  const fileSystem = dependencies.fileSystem ?? fs;
  const platform = dependencies.platform ?? process.platform;
  const configured = String(value ?? "").trim();
  if (!configured) return null;
  const ownedRunRoot = path.resolve(runRoot);
  const resolved = path.isAbsolute(configured)
    ? path.resolve(configured)
    : path.resolve(ownedRunRoot, configured);
  try {
    return assertM67CanonicalOwnedDescendant(ownedRunRoot, resolved, true, { fileSystem, platform });
  } catch {
    throw new Error("M67_E2E_FROZEN_APP_ROOT must name a canonical owned child directory without a symbolic link, junction, or reparse redirect.");
  }
}

export function assertM67CanonicalOwnedDescendant(ownerRoot, candidatePath, allowMissing, dependencies = {}) {
  const fileSystem = dependencies.fileSystem ?? fs;
  const platform = dependencies.platform ?? process.platform;
  const resolvedOwner = path.resolve(ownerRoot);
  const resolvedCandidate = path.resolve(candidatePath);
  const physicalOwner = assertCanonicalExistingPathChain(resolvedOwner, {
    allowMissing: false,
    fileSystem,
    platform,
  });
  const physicalCandidate = assertCanonicalExistingPathChain(resolvedCandidate, {
    allowMissing,
    fileSystem,
    platform,
  });
  const relative = path.relative(physicalOwner, physicalCandidate);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("M67 path is not a canonical owned child.");
  }
  const ownerStat = fileSystem.lstatSync(physicalOwner);
  if (!ownerStat.isDirectory() || ownerStat.isSymbolicLink()) {
    throw new Error("M67 owned root cannot be a symbolic link, junction, or reparse redirect.");
  }
  return resolvedCandidate;
}

export function resolveM67FrozenRunIdentity(env, frozenRoot) {
  if (!frozenRoot) return null;
  const mode = String(env.V1_9_RUN_MODE ?? "").trim();
  const runId = String(env.V1_9_E2E_RUN_ID ?? "").trim();
  const manifestSha256 = String(env.V1_9_E2E_MANIFEST_SHA256 ?? "").trim().toLowerCase();
  if ((mode !== "start-new" && mode !== "resume") ||
      !/^v1-9-[a-z0-9._-]+$/i.test(runId) ||
      !/^[a-f0-9]{64}$/.test(manifestSha256)) {
    throw new Error("M67 configured frozen run identity is invalid.");
  }
  return { mode, runId, manifestSha256 };
}

export function assertM67FrozenRunStorageState(input, dependencies = {}) {
  const fileSystem = dependencies.fileSystem ?? fs;
  if (!input.identity) return;
  if (input.identity.mode === "start-new") {
    if (fileSystem.existsSync(input.databasePath) ||
        fileSystem.existsSync(input.artifactRoot) ||
        fileSystem.existsSync(input.appRoot)) {
      throw new Error("M67 fresh frozen run storage is not empty.");
    }
    return;
  }
  for (const [entryPath, kind] of [
    [input.databasePath, "file"],
    [input.artifactRoot, "directory"],
    [input.appRoot, "directory"],
  ]) {
    if (!fileSystem.existsSync(entryPath)) throw new Error("M67 resume frozen run storage is incomplete.");
    const stat = fileSystem.lstatSync(entryPath);
    if (stat.isSymbolicLink() || (kind === "file" ? !stat.isFile() : !stat.isDirectory())) {
      throw new Error("M67 resume frozen run storage is invalid.");
    }
  }
}

export function createM67FrozenAppContract(requestedSpec) {
  const normalizedSpec = String(requestedSpec ?? "").replaceAll("\\", "/");
  if (!/^tests\/e2e\/[a-z0-9._-]+\.spec\.ts$/i.test(normalizedSpec)) {
    throw new Error("M67 frozen app requested spec is invalid.");
  }
  const requiredDirectories = ["src", "public", "config", "fixtures"];
  const requiredFiles = [
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "next-env.d.ts",
    "postcss.config.mjs",
    normalizedSpec,
    "tests/e2e/support/feedback.ts",
    "tests/e2e/support/redline.ts",
    "scripts/lib/v1-9-e2e-contract.mjs",
    "scripts/lib/evidence-sanitizer.mjs",
    "scripts/lib/v1-9-final-package-selection.mjs",
  ];
  const copiedEntries = [...requiredDirectories, ...requiredFiles];
  return Object.freeze({
    requiredDirectories: Object.freeze(requiredDirectories),
    requiredFiles: Object.freeze(requiredFiles),
    copiedEntries: Object.freeze(copiedEntries),
    frozenEntries: Object.freeze([...copiedEntries, "next.config.mjs"]),
  });
}

export function prepareM67FrozenApp(input, dependencies = {}) {
  const fileSystem = dependencies.fileSystem ?? fs;
  const now = dependencies.now ?? (() => new Date());
  if (typeof input.assertBaselineCurrent !== "function") {
    throw new Error("M67 frozen app baseline verifier is required.");
  }
  const assertBaselineCurrent = input.assertBaselineCurrent;
  const contract = createM67FrozenAppContract(input.requestedSpec);
  assertBaselineCurrent();
  if (input.identity.mode === "resume") {
    verifyM67FrozenAppBeforeCacheCleanup({ ...input, contract }, { fileSystem });
    cleanM67OwnedFrozenAppCaches(input.appRoot, input.runRoot, { fileSystem });
    verifyM67FrozenApp({ ...input, contract }, { fileSystem });
    return contract;
  }
  if (input.identity.mode !== "start-new") throw new Error("M67 frozen app fresh mode is invalid.");
  const resolvedRunRoot = path.resolve(input.runRoot);
  const resolvedAppRoot = assertM67CanonicalOwnedDescendant(
    resolvedRunRoot,
    input.appRoot,
    true,
    { fileSystem },
  );
  if (path.dirname(resolvedAppRoot) !== resolvedRunRoot) {
    throw new Error("M67 frozen app root must be a direct owned child of the run root.");
  }
  if (fileSystem.existsSync(resolvedAppRoot)) {
    throw new Error("M67 frozen app root already exists for a fresh run.");
  }

  const sourceDigestBefore = digestM67FrozenAppEntries(input.sourceRoot, contract.copiedEntries, { fileSystem });
  let stagingRoot = fileSystem.mkdtempSync(path.join(resolvedRunRoot, `.${path.basename(resolvedAppRoot)}.staging-`));
  try {
    assertM67CanonicalOwnedDescendant(resolvedRunRoot, stagingRoot, false, { fileSystem });
    for (const directory of contract.requiredDirectories) {
      copyFrozenEntry(input.sourceRoot, stagingRoot, directory, "directory", fileSystem);
    }
    for (const file of contract.requiredFiles) {
      copyFrozenEntry(input.sourceRoot, stagingRoot, file, "file", fileSystem);
    }
    fileSystem.writeFileSync(
      path.join(stagingRoot, "next.config.mjs"),
      input.nextConfigContents,
      { encoding: "utf8", flag: "wx" },
    );

    let sourceDigestAfter;
    try {
      sourceDigestAfter = digestM67FrozenAppEntries(input.sourceRoot, contract.copiedEntries, { fileSystem });
    } catch {
      throw new Error("M67 frozen app source changed while freezing.");
    }
    if (sourceDigestAfter !== sourceDigestBefore) {
      throw new Error("M67 frozen app source changed while freezing.");
    }
    const copiedEntriesDigest = digestM67FrozenAppEntries(stagingRoot, contract.copiedEntries, { fileSystem });
    if (copiedEntriesDigest !== sourceDigestBefore) {
      throw new Error("M67 frozen app copy digest mismatch.");
    }
    const frozenEntriesDigest = digestM67FrozenAppEntries(stagingRoot, contract.frozenEntries, { fileSystem });
    const stagingMarkerPath = path.join(stagingRoot, ".m67-frozen-app.json");
    fileSystem.writeFileSync(stagingMarkerPath, JSON.stringify({
      schemaVersion: M67_FROZEN_APP_MARKER_SCHEMA_VERSION,
      runId: input.identity.runId,
      manifestSha256: input.identity.manifestSha256,
      frozenAt: now().toISOString(),
      copiedEntries: contract.copiedEntries,
      sourceEntriesDigest: `sha256:${sourceDigestBefore}`,
      copiedEntriesDigest: `sha256:${copiedEntriesDigest}`,
      frozenEntries: contract.frozenEntries,
      frozenEntriesDigest: `sha256:${frozenEntriesDigest}`,
    }, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    verifyM67FrozenApp({
      ...input,
      appRoot: stagingRoot,
      markerPath: stagingMarkerPath,
      contract,
    }, { fileSystem });
    assertBaselineCurrent();
    fileSystem.renameSync(stagingRoot, resolvedAppRoot);
    stagingRoot = null;
    assertM67CanonicalOwnedDescendant(resolvedRunRoot, resolvedAppRoot, false, { fileSystem });
    return contract;
  } finally {
    if (stagingRoot && fileSystem.existsSync(stagingRoot)) {
      fileSystem.rmSync(stagingRoot, { recursive: true, force: true });
    }
  }
}

export function assertM67FrozenAppIdentity(input, dependencies = {}) {
  const fileSystem = dependencies.fileSystem ?? fs;
  const contract = input.contract ?? createM67FrozenAppContract(input.requestedSpec);
  return readValidatedFrozenAppMarker({ ...input, contract }, fileSystem);
}

export function verifyM67FrozenApp(input, dependencies = {}) {
  return verifyM67FrozenAppWithAllowedRootEntries(input, [], dependencies);
}

export function verifyM67FrozenAppBeforeCacheCleanup(input, dependencies = {}) {
  return verifyM67FrozenAppWithAllowedRootEntries(
    input,
    M67_OWNED_TRANSIENT_ROOT_ENTRIES,
    dependencies,
  );
}

function verifyM67FrozenAppWithAllowedRootEntries(input, allowedRootEntries, dependencies) {
  const fileSystem = dependencies.fileSystem ?? fs;
  const contract = input.contract ?? createM67FrozenAppContract(input.requestedSpec);
  const marker = assertM67FrozenAppIdentity({ ...input, contract }, { fileSystem });
  assertNoUnexpectedFrozenRootEntries(
    input.appRoot,
    contract.frozenEntries,
    allowedRootEntries,
    fileSystem,
  );
  let sourceDigest;
  let copiedDigest;
  let frozenDigest;
  try {
    sourceDigest = digestM67FrozenAppEntries(input.sourceRoot, contract.copiedEntries, { fileSystem });
    copiedDigest = digestM67FrozenAppEntries(input.appRoot, contract.copiedEntries, { fileSystem });
    frozenDigest = digestM67FrozenAppEntries(input.appRoot, contract.frozenEntries, { fileSystem });
  } catch {
    throw new Error("M67 frozen app content digest mismatch on resume.");
  }
  if (marker.sourceEntriesDigest !== `sha256:${sourceDigest}` ||
      marker.copiedEntriesDigest !== marker.sourceEntriesDigest ||
      marker.copiedEntriesDigest !== `sha256:${copiedDigest}` ||
      marker.frozenEntriesDigest !== `sha256:${frozenDigest}`) {
    throw new Error("M67 frozen app content digest mismatch on resume.");
  }
  return marker;
}

export function cleanM67OwnedFrozenAppCaches(appRoot, runRoot, dependencies = {}) {
  const fileSystem = dependencies.fileSystem ?? fs;
  const resolvedRunRoot = path.resolve(runRoot);
  const resolvedAppRoot = assertM67CanonicalOwnedDescendant(
    resolvedRunRoot,
    appRoot,
    false,
    { fileSystem },
  );
  if (path.dirname(resolvedAppRoot) !== resolvedRunRoot) {
    throw new Error("M67 frozen app root must be a direct owned child of the run root.");
  }
  const cachePaths = [];
  for (const entryName of M67_OWNED_TRANSIENT_ROOT_ENTRIES) {
    const entryPath = path.join(resolvedAppRoot, entryName);
    if (!fileSystem.existsSync(entryPath)) continue;
    assertOwnedCacheTree(resolvedAppRoot, entryPath, entryName, fileSystem);
    cachePaths.push(entryPath);
  }
  for (const entryPath of cachePaths) {
    fileSystem.rmSync(entryPath, { recursive: true, force: true });
  }
}

export function resolveM67FrozenPlaywrightSpecPath(spec, appRoot) {
  const normalized = String(spec ?? "").replaceAll("\\", "/");
  if (!/^tests\/e2e\/[a-z0-9._-]+\.spec\.ts$/i.test(normalized)) {
    throw new Error("M67 frozen Playwright spec path is invalid.");
  }
  if (!appRoot) return normalized;
  return path.join(appRoot, ...normalized.split("/"));
}

export function digestM67FrozenAppEntries(baseRoot, frozenEntries, dependencies = {}) {
  const fileSystem = dependencies.fileSystem ?? fs;
  const platform = dependencies.platform ?? process.platform;
  const digest = createHash("sha256");
  const descriptors = [];
  const seenPaths = new Set();
  const resolvedBaseRoot = assertCanonicalExistingPathChain(baseRoot, {
    allowMissing: false,
    fileSystem,
    platform,
  });
  if (!fileSystem.lstatSync(resolvedBaseRoot).isDirectory()) {
    throw new Error("M67 frozen app digest root must be a directory.");
  }
  const readBuffer = Buffer.allocUnsafe(64 * 1024);

  function normalizeEntry(value) {
    const normalized = String(value).replaceAll("\\", "/");
    if (!normalized ||
        normalized !== path.posix.normalize(normalized) ||
        normalized.startsWith("/") ||
        /^[a-z]:/i.test(normalized) ||
        normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
      throw new Error("M67 frozen app digest received an invalid relative entry.");
    }
    return normalized;
  }

  function resolveEntry(relativePath) {
    const absolutePath = path.resolve(resolvedBaseRoot, ...relativePath.split("/"));
    const boundary = path.relative(resolvedBaseRoot, absolutePath);
    if (!boundary || boundary === ".." || boundary.startsWith(`..${path.sep}`) || path.isAbsolute(boundary)) {
      throw new Error("M67 frozen app digest entry escaped its root.");
    }
    return assertCanonicalExistingPathChain(absolutePath, {
      allowMissing: false,
      fileSystem,
      platform,
    });
  }

  function collect(relativePath) {
    const normalizedPath = normalizeEntry(relativePath);
    if (seenPaths.has(normalizedPath)) throw new Error("M67 frozen app digest received duplicate entries.");
    seenPaths.add(normalizedPath);
    const absolutePath = resolveEntry(normalizedPath);
    const stat = fileSystem.lstatSync(absolutePath);
    if (stat.isDirectory()) {
      descriptors.push({ relativePath: normalizedPath, kind: "directory", absolutePath, size: 0 });
      for (const child of fileSystem.readdirSync(absolutePath, { withFileTypes: true })) {
        collect(`${normalizedPath}/${child.name}`);
      }
      return;
    }
    if (stat.isFile()) {
      descriptors.push({ relativePath: normalizedPath, kind: "file", absolutePath, size: stat.size });
      return;
    }
    throw new Error(`M67 frozen app digest does not allow non-file entries: ${normalizedPath}.`);
  }

  function writeFrame(label, content) {
    const labelBytes = Buffer.from(label, "utf8");
    digest.update(Buffer.from(`${labelBytes.length}:`, "ascii"));
    digest.update(labelBytes);
    digest.update(Buffer.from(`:${content.length}:`, "ascii"));
    digest.update(content);
    digest.update(Buffer.from(";", "ascii"));
  }

  function writeFileContent(descriptor) {
    const labelBytes = Buffer.from("content", "utf8");
    digest.update(Buffer.from(`${labelBytes.length}:`, "ascii"));
    digest.update(labelBytes);
    digest.update(Buffer.from(`:${descriptor.size}:`, "ascii"));
    const file = fileSystem.openSync(descriptor.absolutePath, "r");
    let remaining = descriptor.size;
    try {
      while (remaining > 0) {
        const bytesRead = fileSystem.readSync(file, readBuffer, 0, Math.min(readBuffer.length, remaining), null);
        if (bytesRead === 0) throw new Error("M67 frozen app file changed while hashing.");
        digest.update(readBuffer.subarray(0, bytesRead));
        remaining -= bytesRead;
      }
      if (fileSystem.readSync(file, readBuffer, 0, 1, null) !== 0) {
        throw new Error("M67 frozen app file changed while hashing.");
      }
    } finally {
      fileSystem.closeSync(file);
    }
    digest.update(Buffer.from(";", "ascii"));
  }

  writeFrame("domain", Buffer.from("m67-frozen-app-entries.v1", "utf8"));
  for (const entry of frozenEntries) collect(entry);
  descriptors.sort((left, right) => left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0);
  for (const descriptor of descriptors) {
    writeFrame("path", Buffer.from(descriptor.relativePath, "utf8"));
    writeFrame("kind", Buffer.from(descriptor.kind, "utf8"));
    if (descriptor.kind === "file") writeFileContent(descriptor);
  }
  return digest.digest("hex");
}

function readValidatedFrozenAppMarker(input, fileSystem) {
  if (!input.identity) throw new Error("M67 frozen app run identity is missing.");
  const resolvedRunRoot = path.resolve(input.runRoot);
  const resolvedAppRoot = path.resolve(input.appRoot);
  if (!fileSystem.existsSync(resolvedAppRoot)) throw new Error("M67 frozen app root is missing on resume.");
  assertM67CanonicalOwnedDescendant(resolvedRunRoot, resolvedAppRoot, false, { fileSystem });
  if (path.dirname(resolvedAppRoot) !== resolvedRunRoot) {
    throw new Error("M67 frozen app root must be a direct owned child of the run root.");
  }
  const resolvedMarkerPath = path.resolve(input.markerPath);
  const expectedMarkerPath = path.join(resolvedAppRoot, ".m67-frozen-app.json");
  const normalizePath = (value) => process.platform === "win32" ? value.toLowerCase() : value;
  if (normalizePath(resolvedMarkerPath) !== normalizePath(expectedMarkerPath)) {
    throw new Error("M67 frozen app marker path is invalid on resume.");
  }
  assertM67CanonicalOwnedDescendant(resolvedAppRoot, resolvedMarkerPath, false, { fileSystem });
  const markerStat = fileSystem.lstatSync(resolvedMarkerPath);
  if (!markerStat.isFile() || markerStat.isSymbolicLink()) {
    throw new Error("M67 frozen app marker is invalid on resume.");
  }
  let marker;
  try {
    marker = JSON.parse(fileSystem.readFileSync(resolvedMarkerPath, "utf8"));
  } catch {
    throw new Error("M67 frozen app marker is invalid on resume.");
  }
  const expectedFields = [
    "schemaVersion",
    "runId",
    "manifestSha256",
    "frozenAt",
    "copiedEntries",
    "sourceEntriesDigest",
    "copiedEntriesDigest",
    "frozenEntries",
    "frozenEntriesDigest",
  ].sort();
  if (!marker || typeof marker !== "object" || Array.isArray(marker) ||
      JSON.stringify(Object.keys(marker).sort()) !== JSON.stringify(expectedFields) ||
      marker.schemaVersion !== M67_FROZEN_APP_MARKER_SCHEMA_VERSION ||
      typeof marker.frozenAt !== "string" || !Number.isFinite(Date.parse(marker.frozenAt)) ||
      !sameStringArray(marker.copiedEntries, input.contract.copiedEntries) ||
      !sameStringArray(marker.frozenEntries, input.contract.frozenEntries) ||
      !isTaggedSha256(marker.sourceEntriesDigest) ||
      !isTaggedSha256(marker.copiedEntriesDigest) ||
      !isTaggedSha256(marker.frozenEntriesDigest)) {
    throw new Error("M67 frozen app marker is invalid on resume.");
  }
  if (marker.runId !== input.identity.runId || marker.manifestSha256 !== input.identity.manifestSha256) {
    throw new Error("M67 frozen app marker identity mismatch on resume.");
  }
  return marker;
}

function assertOwnedCacheTree(appRoot, entryPath, entryName, fileSystem) {
  const stat = fileSystem.lstatSync(entryPath);
  if (stat.isSymbolicLink()) {
    throw new Error(`M67 owned Next cache is a symbolic link, junction, or reparse redirect: ${entryName}.`);
  }
  assertM67CanonicalOwnedDescendant(appRoot, entryPath, false, { fileSystem });
  if (!stat.isDirectory()) return;
  for (const child of fileSystem.readdirSync(entryPath, { withFileTypes: true })) {
    assertOwnedCacheTree(appRoot, path.join(entryPath, child.name), `${entryName}/${child.name}`, fileSystem);
  }
}

function copyFrozenEntry(sourceRoot, destinationRoot, relativePath, expectedKind, fileSystem) {
  const segments = relativePath.split("/");
  const source = path.join(sourceRoot, ...segments);
  const destination = path.join(destinationRoot, ...segments);
  const stat = fileSystem.lstatSync(source);
  if (stat.isSymbolicLink() || (expectedKind === "directory" ? !stat.isDirectory() : !stat.isFile())) {
    throw new Error(`M67 frozen app source ${expectedKind} is invalid: ${relativePath}.`);
  }
  fileSystem.mkdirSync(path.dirname(destination), { recursive: true });
  if (expectedKind === "directory") {
    fileSystem.cpSync(source, destination, { recursive: true, force: false, errorOnExist: true, dereference: false });
  } else {
    fileSystem.copyFileSync(source, destination, fileSystem.constants.COPYFILE_EXCL);
  }
}

function sameStringArray(value, expected) {
  return Array.isArray(value) && value.length === expected.length &&
    expected.every((entry, index) => value[index] === entry);
}

function isTaggedSha256(value) {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function assertNoUnexpectedFrozenRootEntries(appRoot, frozenEntries, allowedRootEntries, fileSystem) {
  const allowed = new Set(frozenEntries.map((entry) => entry.split("/")[0]));
  allowed.add(".m67-frozen-app.json");
  for (const entry of allowedRootEntries) allowed.add(entry);
  for (const entry of fileSystem.readdirSync(appRoot, { withFileTypes: true })) {
    if (!allowed.has(entry.name)) {
      throw new Error(`M67 frozen app contains an unexpected entry: ${entry.name}.`);
    }
    const entryPath = path.join(appRoot, entry.name);
    if (fileSystem.lstatSync(entryPath).isSymbolicLink()) {
      throw new Error(`M67 frozen app contains a symbolic link, junction, or reparse redirect: ${entry.name}.`);
    }
  }
}
