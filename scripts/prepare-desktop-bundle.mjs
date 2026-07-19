import { cpSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  inspectNextBuildOutput,
  isForbiddenRuntimePath,
  removePhysicalGeneratedDirectory,
} from "./verify-next-build-output.mjs";

const forbiddenTopLevel = new Set([
  ".env",
  ".tmp",
  "data",
  "artifact-storage-root",
  "dist",
  "dist-desktop",
  "desktop-bundle",
  "docs",
  "playwright-report",
  "test-results",
  "tests",
]);

export async function prepareDesktopBundle({ cwd = process.cwd() } = {}) {
  const source = path.join(cwd, ".next", "standalone");
  const output = path.join(cwd, "desktop-bundle");
  if (!existsSync(path.join(source, "server.js"))) {
    return {
      ok: false,
      stage: "m34_prepare_desktop_bundle",
      message: "Next standalone server output is missing. Run npm run build first.",
      output: "desktop-bundle",
    };
  }

  const sourceInspection = inspectNextBuildOutput({ cwd, standaloneRoot: source, inspectNft: false });
  if (!sourceInspection.ok) {
    return {
      ok: false,
      stage: "m34_prepare_desktop_bundle",
      message: "Next standalone output failed the runtime file safety contract.",
      output: "desktop-bundle",
      missing: sourceInspection.missing,
    };
  }

  removePhysicalGeneratedDirectory({ cwd, target: output });
  mkdirSync(output, { recursive: true });
  cpSync(source, output, {
    recursive: true,
    dereference: true,
    filter: (sourcePath) => shouldCopy(cwd, source, sourcePath),
  });

  const staticSource = path.join(cwd, ".next", "static");
  if (existsSync(staticSource)) {
    cpSync(staticSource, path.join(output, ".next", "static"), {
      recursive: true,
      dereference: false,
    });
  }

  const publicSource = path.join(cwd, "public");
  if (existsSync(publicSource)) {
    cpSync(publicSource, path.join(output, "public"), {
      recursive: true,
      dereference: false,
    });
  }

  const inspection = inspectNextBuildOutput({ cwd, standaloneRoot: output, inspectNft: false });
  if (!inspection.ok) {
    return {
      ok: false,
      stage: "m34_prepare_desktop_bundle",
      message: "Desktop bundle failed the runtime file safety contract.",
      output: "desktop-bundle",
      missing: inspection.missing,
    };
  }
  const dependencyIssue = inspectBundledRuntimeDependencies(output);
  if (dependencyIssue) {
    return {
      ok: false,
      stage: "m34_prepare_desktop_bundle",
      message: "Desktop bundle is missing an isolated runtime dependency.",
      output: "desktop-bundle",
      missing: [dependencyIssue],
    };
  }

  return {
    ok: true,
    stage: "m34_prepare_desktop_bundle",
    message: "Desktop safe bundle prepared.",
    output: "desktop-bundle",
  };
}

function shouldCopy(cwd, standaloneRoot, sourcePath) {
  const relative = path.relative(standaloneRoot, sourcePath);
  if (!relative) return true;
  if (isForbiddenRuntimePath(relative)) return false;
  const firstSegment = relative.split(path.sep)[0];
  if (forbiddenTopLevel.has(firstSegment)) return false;

  const projectRelative = path.relative(cwd, sourcePath);
  if (projectRelative.startsWith(`node_modules${path.sep}`)) return false;
  return true;
}

function inspectBundledRuntimeDependencies(bundleRoot) {
  const requireFromBundle = createRequire(path.join(bundleRoot, "server.js"));
  for (const dependency of ["next", "better-sqlite3", "@prisma/client/runtime/client"]) {
    let resolved;
    try {
      resolved = requireFromBundle.resolve(dependency);
    } catch {
      return dependency;
    }
    const relative = path.relative(path.resolve(bundleRoot), path.resolve(resolved));
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return dependency;
    }
  }
  return null;
}

function isMainModule() {
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const result = await prepareDesktopBundle();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exit(2);
  }
}
