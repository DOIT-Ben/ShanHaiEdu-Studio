import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function runDesktopSmoke({ cwd = process.cwd() } = {}) {
  const checks = [
    checkFile(cwd, "desktop/electron-main.mjs", "desktop-main-entry"),
    checkFile(cwd, "desktop/preload.mjs", "desktop-preload"),
    checkFile(cwd, "electron-builder.config.cjs", "electron-builder-config"),
    checkPackageScripts(cwd),
    checkStandaloneOutput(cwd),
    checkDesktopBundle(cwd),
    checkPreloadBoundary(cwd),
  ];

  return {
    ok: checks.every((item) => item.ok),
    stage: "m34_desktop_smoke",
    checkedAt: new Date().toISOString(),
    checks,
  };
}

function checkFile(cwd, relativePath, id) {
  const ok = existsSync(path.join(cwd, relativePath));
  return buildCheck(id, ok, {
    message: ok ? `${relativePath} is present.` : `${relativePath} is missing.`,
    missing: ok ? [] : [relativePath],
  });
}

function checkPackageScripts(cwd) {
  const pkg = readPackage(cwd);
  const expected = {
    "desktop:smoke": "node scripts/desktop-smoke.mjs",
    "desktop:prepare": "node scripts/prepare-desktop-bundle.mjs",
    "desktop:pack": "npm run build && npm run desktop:prepare && electron-builder --win --config electron-builder.config.cjs",
  };
  const missing = Object.entries(expected)
    .filter(([name, command]) => pkg?.scripts?.[name] !== command)
    .map(([name]) => name);

  return buildCheck("desktop-package-scripts", missing.length === 0, {
    message: missing.length === 0 ? "Desktop package scripts are present." : "Desktop package scripts are missing.",
    missing,
  });
}

function checkStandaloneOutput(cwd) {
  const serverEntry = path.join(cwd, ".next", "standalone", "server.js");
  const ok = existsSync(serverEntry);
  return buildCheck("next-standalone-server", ok, {
    message: ok ? "Next standalone server output is present." : "Run npm run build before desktop smoke.",
    missing: ok ? [] : [".next/standalone/server.js"],
  });
}

function checkDesktopBundle(cwd) {
  const bundleEntry = path.join(cwd, "desktop-bundle", "server.js");
  if (!existsSync(bundleEntry)) {
    return buildCheck("desktop-safe-bundle", true, {
      message: "Desktop safe bundle has not been prepared in this smoke run; npm run desktop:prepare validates and creates it.",
    });
  }

  const forbidden = [".env", ".tmp", "data", "artifact-storage-root", "test-results", "playwright-report", "docs", "tests"].filter((entry) =>
    existsSync(path.join(cwd, "desktop-bundle", entry)),
  );
  return buildCheck("desktop-safe-bundle", forbidden.length === 0, {
    message: forbidden.length === 0 ? "Desktop safe bundle excludes local-only files." : "Desktop safe bundle contains local-only files.",
    missing: forbidden,
  });
}

function checkPreloadBoundary(cwd) {
  const preloadPath = path.join(cwd, "desktop", "preload.mjs");
  const preload = existsSync(preloadPath) ? readFileSync(preloadPath, "utf8") : "";
  const exposesNodeApi = /\bcontextBridge\.exposeInMainWorld\b/.test(preload) || /\brequire\s*\(/.test(preload);
  return buildCheck("desktop-preload-boundary", !exposesNodeApi, {
    message: exposesNodeApi ? "Preload exposes Node-facing APIs." : "Preload does not expose Node APIs.",
  });
}

function buildCheck(id, ok, detail) {
  return {
    id,
    ok,
    message: detail.message,
    missing: detail.missing ?? [],
  };
}

function readPackage(cwd) {
  try {
    return JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

function isMainModule() {
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const result = await runDesktopSmoke();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exit(2);
  }
}
