import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const downloadRouteFiles = [
  "src/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/pptx/route.ts",
  "src/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/image/route.ts",
  "src/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/video/route.ts",
  "src/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/package/route.ts",
];

const desktopMarkers = [
  "electron",
  "electron-builder",
  "@tauri-apps/cli",
  "tauri",
  "src-tauri",
  "electron-builder.yml",
  "electron.vite.config",
];

export async function runClientExeReadiness({ cwd = process.cwd(), env = process.env } = {}) {
  const checks = [
    checkPackageScripts(cwd),
    checkClientExeScript(cwd),
    checkNextStandalone(cwd),
    checkDownloadRoutes(cwd),
    checkArtifactStorageRoot(env),
    checkLoopbackAuthCompatibility(cwd),
  ];
  const warnings = [checkDesktopWrapper(cwd)].filter(Boolean);

  return {
    ok: checks.every((item) => item.ok),
    stage: "m33_client_exe_readiness",
    checkedAt: new Date().toISOString(),
    checks,
    warnings,
  };
}

function checkPackageScripts(cwd) {
  const pkg = readPackage(cwd);
  const missing = ["build", "start"].filter((scriptName) => !pkg?.scripts?.[scriptName]);
  return buildCheck("package-production-scripts", missing.length === 0, {
    message: missing.length === 0 ? "build/start scripts are present." : "Production build/start scripts are missing.",
    missing,
  });
}

function checkClientExeScript(cwd) {
  const pkg = readPackage(cwd);
  const ok = Boolean(pkg?.scripts?.["preflight:client-exe"]);
  return buildCheck("client-exe-preflight-script", ok, {
    message: ok ? "Client exe readiness preflight command is present." : "Add npm run preflight:client-exe.",
    missing: ok ? [] : ["preflight:client-exe"],
  });
}

function checkNextStandalone(cwd) {
  const configText = readText(path.join(cwd, "next.config.ts"));
  const ok = /output\s*:\s*["']standalone["']/.test(configText);
  return buildCheck("next-standalone-output", ok, {
    message: ok ? "Next standalone output is configured." : "Next standalone output is not configured.",
  });
}

function checkDownloadRoutes(cwd) {
  const missing = downloadRouteFiles.filter((routeFile) => !existsSync(path.join(cwd, routeFile)));
  return buildCheck("download-routes", missing.length === 0, {
    message: missing.length === 0 ? "Download routes required by client verification are present." : "Download routes are missing.",
    missing,
  });
}

function checkArtifactStorageRoot(env) {
  const storageRoot = env.ARTIFACT_STORAGE_ROOT?.trim();
  if (!storageRoot) {
    return buildCheck("artifact-storage-root", true, {
      message: "Artifact storage root is not required for dry client readiness; production preflight validates the real value.",
      source: "not_configured",
    });
  }

  const absolute = path.isAbsolute(storageRoot);
  const accessible = absolute && canAccessDirectory(storageRoot);
  return buildCheck("artifact-storage-root", absolute && accessible, {
    message: absolute && accessible ? "Artifact storage root is absolute and accessible." : "Configured artifact storage root must be absolute and accessible.",
    source: "configured",
    absolute,
    accessible,
  });
}

function checkLoopbackAuthCompatibility(cwd) {
  const routeText = readText(path.join(cwd, "src", "server", "auth", "workbench-route.ts"));
  const required = ["localhost", "127.0.0.1", "::1"];
  const missing = required.filter((host) => !routeText.includes(host));
  return buildCheck("loopback-origin-compatibility", missing.length === 0, {
    message: missing.length === 0 ? "Loopback host aliases are recognized by the workbench auth boundary." : "Loopback host aliases are not fully represented.",
    missing,
  });
}

function checkDesktopWrapper(cwd) {
  const pkg = readPackage(cwd);
  const dependencies = {
    ...(pkg?.dependencies ?? {}),
    ...(pkg?.devDependencies ?? {}),
  };
  const dependencyHit = Object.keys(dependencies).find((name) => desktopMarkers.includes(name));
  const fileHit = desktopMarkers.find((marker) => existsSync(path.join(cwd, marker)));
  const scriptHit = Object.values(pkg?.scripts ?? {}).find((script) => /\b(electron|tauri|msix|appx|installer|electron-builder)\b/i.test(script));
  if (dependencyHit || fileHit || scriptHit) return null;

  return {
    id: "desktop-wrapper-not-configured",
    level: "warning",
    message: "No real desktop exe packaging project is configured yet; this stage proves readiness for later client verification only.",
  };
}

function buildCheck(id, ok, detail) {
  return {
    id,
    ok,
    message: detail.message,
    missing: detail.missing ?? [],
    source: detail.source,
    absolute: detail.absolute,
    accessible: detail.accessible,
  };
}

function readPackage(cwd) {
  try {
    return JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

function readText(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function canAccessDirectory(directory) {
  try {
    accessSync(directory, constants.R_OK | constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function isMainModule() {
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  if (process.env.SHANHAI_CLIENT_EXE_READINESS_SKIP_DOTENV !== "1") {
    await import("dotenv/config");
  }
  const result = await runClientExeReadiness();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exit(2);
  }
}
