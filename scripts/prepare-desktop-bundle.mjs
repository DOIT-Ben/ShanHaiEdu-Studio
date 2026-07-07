import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

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

  rmSync(output, { recursive: true, force: true });
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
      dereference: true,
    });
  }

  const publicSource = path.join(cwd, "public");
  if (existsSync(publicSource)) {
    cpSync(publicSource, path.join(output, "public"), {
      recursive: true,
      dereference: true,
    });
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
  const firstSegment = relative.split(path.sep)[0];
  if (forbiddenTopLevel.has(firstSegment)) return false;
  if (relative.includes(`${path.sep}.env`)) return false;
  if (relative.split(path.sep).includes("node_modules")) return false;
  if (path.basename(sourcePath).endsWith(".db")) return false;
  if (path.basename(sourcePath).endsWith(".db-journal")) return false;

  const projectRelative = path.relative(cwd, sourcePath);
  if (projectRelative.startsWith(`node_modules${path.sep}`)) return false;
  return true;
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
