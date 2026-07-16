import fs from "node:fs";
import path from "node:path";

export function assertCanonicalExistingPathChain(targetPath, options = {}) {
  const fileSystem = options.fileSystem ?? fs;
  const platform = options.platform ?? process.platform;
  const allowMissing = options.allowMissing === true;
  const configuredPath = String(targetPath ?? "").trim();
  if (!configuredPath) throw new Error("Physical path is required.");

  const resolvedPath = path.resolve(configuredPath);
  const fileSystemPath = normalizeFileSystemPath(resolvedPath, platform);
  const volumeRoot = path.parse(fileSystemPath).root;
  if (!volumeRoot || !fileSystem.existsSync(volumeRoot)) {
    throw new Error("Physical path root is invalid.");
  }

  const rootStat = fileSystem.lstatSync(volumeRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("Physical path root cannot be a symbolic link, junction, or reparse redirect.");
  }
  const canonicalRoot = realpath(fileSystem, volumeRoot);
  const relative = path.relative(volumeRoot, fileSystemPath);
  if (!relative) return fileSystemPath;
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Physical path escaped its volume root.");
  }

  const segments = relative.split(path.sep);
  let current = volumeRoot;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    if (!fileSystem.existsSync(current)) {
      if (allowMissing) break;
      throw new Error("Physical path is missing.");
    }
    const stat = fileSystem.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error("Physical path cannot contain a symbolic link, junction, or reparse redirect.");
    }
    const canonicalCurrent = realpath(fileSystem, current);
    const expectedCanonical = path.resolve(canonicalRoot, ...segments.slice(0, index + 1));
    if (!sameCanonicalPath(canonicalCurrent, expectedCanonical, platform)) {
      throw new Error("Physical path contains a junction or reparse redirect.");
    }
  }

  return fileSystemPath;
}

function normalizeFileSystemPath(value, platform) {
  const resolved = path.resolve(value);
  if (platform !== "win32") return resolved;
  return resolved
    .replace(/^\\\\\?\\UNC\\/i, "\\\\")
    .replace(/^\\\\\?\\/i, "");
}

function sameCanonicalPath(left, right, platform) {
  const normalizedLeft = path.normalize(normalizeFileSystemPath(left, platform));
  const normalizedRight = path.normalize(normalizeFileSystemPath(right, platform));
  return platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function realpath(fileSystem, value) {
  const nativeRealpath = fileSystem.realpathSync?.native;
  return typeof nativeRealpath === "function"
    ? nativeRealpath.call(fileSystem.realpathSync, value)
    : fileSystem.realpathSync(value);
}
