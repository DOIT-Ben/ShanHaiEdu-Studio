import { spawnSync } from "node:child_process";
import fs, { lstatSync, readFileSync } from "node:fs";
import path from "node:path";

import { assertCanonicalExistingPathChain } from "./physical-path-integrity.mjs";

const MAX_INSTALLED_TREE_BYTES = 32 * 1024 * 1024;
const fixedNpmListArgs = Object.freeze([
  "ls",
  "--all",
  "--json",
  "--long=true",
  "--package-lock-only=false",
  "--global=false",
  "--workspaces=false",
  "--link=false",
  "--include=prod",
  "--include=dev",
  "--include=optional",
  "--include=peer",
  "--ignore-scripts=true",
  "--offline=true",
  "--prefix=.",
]);

export function evaluateV1_9InstalledTreeProbe(input) {
  const fileSystem = input.fileSystem ?? fs;
  const platform = input.platform ?? process.platform;
  const failed = () => ({
    ok: false,
    allowedOptionalExtraneousCount: 0,
  });
  if (input.commandError || ![0, 1].includes(input.commandStatus) || typeof input.stdout !== "string" ||
      Buffer.byteLength(input.stdout, "utf8") > MAX_INSTALLED_TREE_BYTES) return failed();

  let npmList;
  try {
    npmList = JSON.parse(input.stdout);
  } catch {
    return failed();
  }
  if (!isRecord(npmList) || Object.hasOwn(npmList, "error") ||
      !isRecord(input.packageLock) || input.packageLock.lockfileVersion !== 3 ||
      !isRecord(input.packageLock.packages)) {
    return failed();
  }

  const rawProblems = npmList.problems;
  if (rawProblems !== undefined && (!Array.isArray(rawProblems) || rawProblems.some((item) => typeof item !== "string"))) {
    return failed();
  }
  const problems = rawProblems ?? [];
  if (input.commandStatus === 1 && problems.length === 0) return failed();
  const allowedPaths = new Set();
  for (const problem of problems) {
    const parsed = parseExtraneousProblem(problem, input.cwd);
    if (!parsed || allowedPaths.has(parsed.lockPath)) return failed();
    const lockEntry = input.packageLock.packages[parsed.lockPath];
    if (!isRecord(lockEntry) || lockEntry.version !== parsed.version ||
        (lockEntry.optional !== true && lockEntry.devOptional !== true) ||
        hasLinkSignal(lockEntry) ||
        (!(typeof lockEntry.integrity === "string" && lockEntry.integrity.trim()) && lockEntry.inBundle !== true)) {
      return failed();
    }
    if (hasDependencyTree(npmList)) {
      try {
        assertInstalledPackagePath(parsed.installedPath, input.cwd, fileSystem, platform);
      } catch {
        return failed();
      }
    }
    allowedPaths.add(parsed.lockPath);
  }

  if (hasDependencyTree(npmList)) {
    try {
      validateInstalledDependencyTree(npmList, input, allowedPaths, fileSystem, platform);
    } catch {
      return failed();
    }
  }

  return {
    ok: true,
    allowedOptionalExtraneousCount: allowedPaths.size,
  };
}

export function createV1_9NpmListInvocation(input) {
  const execPath = input.execPath ?? process.execPath;
  const npmCliPath = input.npmCliPath ?? resolveNpmCliPath(execPath);
  if (!npmCliPath) return null;
  return {
    command: execPath,
    args: [
      npmCliPath,
      ...fixedNpmListArgs,
    ],
    options: {
      cwd: input.cwd,
      encoding: "utf8",
      windowsHide: true,
      timeout: 60_000,
      maxBuffer: 32 * 1024 * 1024,
      env: controlledNpmEnvironment(input.env),
    },
  };
}

export function probeV1_9InstalledTree(input) {
  let packageLock;
  try {
    const packageLockBytes = readFileSync(path.join(input.cwd, "package-lock.json"));
    if (packageLockBytes.length > MAX_INSTALLED_TREE_BYTES) throw new Error("package_lock_too_large");
    packageLock = JSON.parse(packageLockBytes.toString("utf8"));
  } catch {
    return { ok: false, allowedOptionalExtraneousCount: 0 };
  }

  const invocation = createV1_9NpmListInvocation(input);
  if (!invocation) return { ok: false, allowedOptionalExtraneousCount: 0 };
  const result = spawnSync(invocation.command, invocation.args, invocation.options);
  return evaluateV1_9InstalledTreeProbe({
    cwd: input.cwd,
    commandStatus: result.status,
    commandError: result.error ?? (result.signal ? new Error("npm_list_interrupted") : undefined),
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    packageLock,
  });
}

function parseExtraneousProblem(problem, cwd) {
  const match = /^extraneous:\s+((?:@[^/\s]+\/)?[^@\s]+)@([^\s]+)\s+(.+?)\s*$/.exec(problem);
  if (!match) return null;
  const [, packageName, version, installedPath] = match;
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(packageName) ||
      !version || !path.isAbsolute(installedPath)) {
    return null;
  }
  const relativeNativePath = path.relative(path.resolve(cwd), path.resolve(installedPath));
  if (!isOwnedRelativePath(relativeNativePath)) return null;
  const relativePath = relativeNativePath.replaceAll("\\", "/");
  const expectedSuffix = `node_modules/${packageName}`;
  if (relativePath.includes(":") || relativePath.startsWith("//") ||
      path.win32.isAbsolute(relativePath) || path.posix.isAbsolute(relativePath) ||
      (relativePath !== expectedSuffix && !relativePath.endsWith(`/${expectedSuffix}`))) {
    return null;
  }
  return { installedPath, lockPath: relativePath, version };
}

function hasDependencyTree(npmList) {
  return Object.hasOwn(npmList, "path") || Object.hasOwn(npmList, "dependencies");
}

function validateInstalledDependencyTree(npmList, input, allowedPaths, fileSystem, platform) {
  if (typeof npmList.path !== "string" || !isRecord(npmList.dependencies)) {
    throw new Error("installed_tree_dependency_shape_invalid");
  }
  const physicalCwd = assertCanonicalExistingPathChain(input.cwd, {
    allowMissing: false,
    fileSystem,
    platform,
  });
  const physicalRoot = assertCanonicalExistingPathChain(npmList.path, {
    allowMissing: false,
    fileSystem,
    platform,
  });
  if (!sameCanonicalPath(realpath(fileSystem, physicalCwd), realpath(fileSystem, physicalRoot), platform)) {
    throw new Error("installed_tree_root_path_mismatch");
  }

  const seenPackageRoots = new Map();
  let packageCount = 0;
  visitDependencies(npmList.dependencies, npmList, "", 1);

  function visitDependencies(dependencies, parentNode, parentLockPath, depth) {
    if (!isRecord(dependencies) || depth > 256) throw new Error("installed_tree_depth_limit");
    for (const [packageName, node] of Object.entries(dependencies)) {
      packageCount += 1;
      if (packageCount > 50_000) throw new Error("installed_tree_package_limit");
      validatePackageNode(packageName, node, parentNode, parentLockPath, depth);
    }
  }

  function validatePackageNode(packageName, node, parentNode, parentLockPath, depth) {
    if (!isRecord(node) || !isPackageName(packageName)) {
      throw new Error("installed_tree_node_shape_invalid");
    }
    if (Object.keys(node).length === 0) {
      assertOmittedOptionalDependency(packageName, parentNode, parentLockPath);
      return;
    }
    if (typeof node.path !== "string" || typeof node.version !== "string") {
      throw new Error("installed_tree_node_shape_invalid");
    }
    if (hasLinkSignal(node)) {
      throw new Error("installed_tree_link_signal");
    }
    const packageRoot = assertCanonicalExistingPathChain(node.path, {
      allowMissing: false,
      fileSystem,
      platform,
    });
    const canonicalPackageRoot = realpath(fileSystem, packageRoot);
    const canonicalCwd = realpath(fileSystem, physicalCwd);
    const relative = path.relative(canonicalCwd, canonicalPackageRoot);
    const lockPath = relative.replaceAll("\\", "/");
    const expectedName = packageName;
    if (!isOwnedPackageRelativePath(lockPath, expectedName)) {
      throw new Error("installed_tree_package_path_outside_repo");
    }
    const lockEntry = input.packageLock.packages[lockPath];
    if (!isRecord(lockEntry) || lockEntry.version !== node.version || hasLinkSignal(lockEntry)) {
      throw new Error("installed_tree_lock_path_or_version_mismatch");
    }
    if (typeof node.name === "string" && node.name !== expectedName) {
      throw new Error("installed_tree_package_name_mismatch");
    }
    if (node.extraneous === true && !allowedPaths.has(lockPath)) {
      throw new Error("installed_tree_unapproved_extraneous");
    }

    const key = normalizeComparisonPath(canonicalPackageRoot, platform);
    const prior = seenPackageRoots.get(key);
    if (prior && (prior.lockPath !== lockPath || prior.version !== node.version)) {
      throw new Error("installed_tree_duplicate_root_mismatch");
    }
    if (!prior) seenPackageRoots.set(key, { lockPath, version: node.version });

    if (Object.hasOwn(node, "dependencies")) visitDependencies(node.dependencies, node, lockPath, depth + 1);
  }

  function assertOmittedOptionalDependency(packageName, parentNode, parentLockPath) {
    const parentLockEntry = input.packageLock.packages[parentLockPath];
    if (!isRecord(parentLockEntry)) throw new Error("installed_tree_optional_parent_lock_missing");
    const npmOptional = isRecord(parentNode.optionalDependencies) && Object.hasOwn(parentNode.optionalDependencies, packageName);
    const lockOptional = isRecord(parentLockEntry.optionalDependencies) && Object.hasOwn(parentLockEntry.optionalDependencies, packageName);
    const npmPeerOptional = isRecord(parentNode.peerDependenciesMeta) &&
      isRecord(parentNode.peerDependenciesMeta[packageName]) &&
      parentNode.peerDependenciesMeta[packageName].optional === true;
    const lockPeerOptional = isRecord(parentLockEntry.peerDependenciesMeta) &&
      isRecord(parentLockEntry.peerDependenciesMeta[packageName]) &&
      parentLockEntry.peerDependenciesMeta[packageName].optional === true;
    if (!((npmOptional && lockOptional) || (npmPeerOptional && lockPeerOptional))) {
      throw new Error("installed_tree_empty_node_not_optional");
    }
  }
}

function assertInstalledPackagePath(installedPath, cwd, fileSystem, platform) {
  const physicalCwd = assertCanonicalExistingPathChain(cwd, { allowMissing: false, fileSystem, platform });
  const packageRoot = assertCanonicalExistingPathChain(installedPath, { allowMissing: false, fileSystem, platform });
  const relative = path.relative(realpath(fileSystem, physicalCwd), realpath(fileSystem, packageRoot));
  if (!isOwnedPackageRelativePath(relative.replaceAll("\\", "/"), packageNameFromRelativePath(relative))) {
    throw new Error("installed_tree_extraneous_path_outside_repo");
  }
}

function isOwnedPackageRelativePath(relativePath, packageName) {
  if (!relativePath || !relativePath.startsWith("node_modules/") || relativePath === ".." ||
      relativePath.startsWith("../") || path.posix.isAbsolute(relativePath)) return false;
  const expectedSuffix = `node_modules/${packageName}`;
  return relativePath === expectedSuffix || relativePath.endsWith(`/${expectedSuffix}`);
}

function isPackageName(value) {
  return /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(value);
}

function hasLinkSignal(value) {
  return value.link === true || value.type === "link" ||
    (typeof value.resolved === "string" && /^(?:link|file):/i.test(value.resolved));
}

function packageNameFromRelativePath(relativePath) {
  const segments = relativePath.replaceAll("\\", "/").split("/");
  const nodeModulesIndex = segments.lastIndexOf("node_modules");
  if (nodeModulesIndex < 0 || nodeModulesIndex === segments.length - 1) return "";
  const first = segments[nodeModulesIndex + 1];
  return first.startsWith("@")
    ? `${first}/${segments[nodeModulesIndex + 2] ?? ""}`
    : first;
}

function realpath(fileSystem, value) {
  const nativeRealpath = fileSystem.realpathSync?.native;
  return typeof nativeRealpath === "function"
    ? nativeRealpath.call(fileSystem.realpathSync, value)
    : fileSystem.realpathSync(value);
}

function normalizeComparisonPath(value, platform) {
  const normalized = path.normalize(String(value));
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

function sameCanonicalPath(left, right, platform) {
  return normalizeComparisonPath(left, platform) === normalizeComparisonPath(right, platform);
}

function controlledNpmEnvironment(env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => (
    !/^npm_config_/i.test(name) &&
    !/^(?:node_env|node_options|node_path)$/i.test(name)
  )));
}

function isOwnedRelativePath(relativePath) {
  return Boolean(relativePath) &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath);
}

function resolveNpmCliPath(execPath) {
  const candidate = path.join(path.dirname(execPath), "node_modules", "npm", "bin", "npm-cli.js");
  try {
    const stat = lstatSync(candidate);
    return stat.isFile() && !stat.isSymbolicLink() ? candidate : null;
  } catch {
    return null;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
