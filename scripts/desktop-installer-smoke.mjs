import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

const installerName = "ShanHaiEdu Studio Setup 0.1.0.exe";
const appExeName = "ShanHaiEdu Studio.exe";

export async function runDesktopInstallerSmoke({
  cwd = process.cwd(),
  launch = true,
  runInstaller = process.env.SHANHAI_RUN_INSTALLER_SMOKE === "1",
  port = Number.parseInt(process.env.SHANHAI_DESKTOP_PORT ?? "3127", 10),
} = {}) {
  const paths = resolveDesktopPaths(cwd);
  const checks = [
    checkFile(paths.installer, "installer-artifact", installerName),
    checkFile(paths.unpackedExe, "unpacked-exe", "win-unpacked executable"),
    checkGitIgnored(cwd, "dist-desktop", "dist-desktop-ignored"),
    checkGitIgnored(cwd, "desktop-bundle", "desktop-bundle-ignored"),
    checkPackagedResources(paths.appResources),
  ];

  let installerMode = "skipped";
  if (launch) {
    checks.push(await runExeHttpSmoke(paths.unpackedExe, cwd, port, "unpacked-exe-http"));
  }

  if (runInstaller) {
    installerMode = "enabled";
    const installResult = await runSilentInstallSmoke(paths.installer, cwd, port + 1);
    checks.push(...installResult.checks);
  }

  return {
    ok: checks.every((item) => item.ok),
    stage: "m35_desktop_installer_smoke",
    checkedAt: new Date().toISOString(),
    installerMode,
    checks,
  };
}

function resolveDesktopPaths(cwd) {
  const dist = path.join(cwd, "dist-desktop");
  return {
    installer: path.join(dist, installerName),
    unpackedExe: path.join(dist, "win-unpacked", appExeName),
    appResources: path.join(dist, "win-unpacked", "resources", "app"),
  };
}

function checkFile(filePath, id, label) {
  const ok = existsSync(filePath);
  return buildCheck(id, ok, {
    message: ok ? `${label} is present.` : `${label} is missing.`,
    missing: ok ? [] : [label],
  });
}

function checkGitIgnored(cwd, relativePath, id) {
  const gitignore = existsSync(path.join(cwd, ".gitignore")) ? readFileSync(path.join(cwd, ".gitignore"), "utf8") : "";
  const ok = new RegExp(`^${escapeRegExp(relativePath)}/$`, "m").test(gitignore);
  return buildCheck(id, ok, {
    message: ok ? `${relativePath} is git ignored.` : `${relativePath} is not git ignored.`,
    missing: ok ? [] : [relativePath],
  });
}

function checkPackagedResources(appResources) {
  const forbidden = [
    ".env",
    "data",
    ".tmp",
    "docs",
    "tests",
    "test-results",
    path.join("desktop-bundle", ".env"),
    path.join("desktop-bundle", "data"),
    path.join("desktop-bundle", "test-results"),
  ].filter((entry) => existsSync(path.join(appResources, entry)));

  return buildCheck("packaged-resource-safety", forbidden.length === 0, {
    message: forbidden.length === 0 ? "Packaged resources exclude local-only files." : "Packaged resources contain local-only files.",
    missing: forbidden,
  });
}

async function runExeHttpSmoke(exePath, cwd, port, id) {
  if (!existsSync(exePath)) {
    return buildCheck(id, false, {
      message: "Executable is missing.",
      missing: [exePath],
    });
  }

  const child = spawn(exePath, [], {
    cwd: path.dirname(exePath),
    env: {
      ...process.env,
      SHANHAI_DESKTOP_PORT: String(port),
      DATABASE_URL: `file:./test-results/stage35-desktop-smoke-${port}.db`,
      ARTIFACT_STORAGE_ROOT: path.join(cwd, "artifact-storage-root"),
    },
    detached: false,
    stdio: "ignore",
    windowsHide: true,
  });

  try {
    const ok = await waitForHttpOk(`http://127.0.0.1:${port}`, 30_000);
    return buildCheck(id, ok, {
      message: ok ? `Desktop executable served HTTP 200 on port ${port}.` : `Desktop executable did not serve HTTP 200 on port ${port}.`,
    });
  } finally {
    await stopProcessTree(child.pid);
  }
}

async function runSilentInstallSmoke(installerPath, cwd, port) {
  const installDir = path.join(cwd, "test-results", "stage35-install");
  if (!isInside(path.resolve(cwd), path.resolve(installDir))) {
    return {
      checks: [
        buildCheck("silent-install", false, {
          message: "Install directory is outside the workspace.",
          missing: ["test-results/stage35-install"],
        }),
      ],
    };
  }

  rmSync(installDir, { recursive: true, force: true });
  mkdirSync(path.dirname(installDir), { recursive: true });

  const installProcess = spawn(installerPath, ["/S", `/D=${installDir}`], {
    cwd,
    detached: false,
    stdio: "ignore",
    windowsHide: true,
  });
  const installedExe = path.join(installDir, appExeName);
  const installedServer = path.join(installDir, "resources", "app", "desktop-bundle", "server.js");
  const uninstaller = path.join(installDir, `Uninstall ${appExeName}`);
  const installOk = await waitForFiles([installedExe, installedServer, uninstaller], 180_000);
  if (!installProcess.killed && installProcess.exitCode === null) {
    installProcess.kill();
  }
  const checks = [
    buildCheck("silent-install", installOk, {
      message: installOk ? "Silent installer created executable, app resources, and uninstaller." : "Silent installer did not complete required files within timeout.",
      missing: installOk ? [] : [installedExe, installedServer, uninstaller].filter((filePath) => !existsSync(filePath)),
    }),
  ];

  if (installOk) {
    checks.push(await runExeHttpSmoke(installedExe, cwd, port, "installed-exe-http"));
  }

  if (existsSync(uninstaller)) {
    const uninstall = await execFileAsync(uninstaller, ["/S"], { cwd: installDir, timeoutMs: 60_000 });
    checks.push(
      buildCheck("silent-uninstall", uninstall.code === 0, {
        message: uninstall.code === 0 ? "Silent uninstall exited with 0." : "Silent uninstall failed.",
      }),
    );
  } else {
    checks.push(
      buildCheck("silent-uninstall", false, {
        message: "Uninstaller was not found.",
        missing: [uninstaller],
      }),
    );
  }

  await stopMatchingDesktopProcesses(cwd);
  return { checks };
}

function execFileAsync(file, args, options) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      resolve({ code });
    };
    const child = execFile(file, args, { ...options, windowsHide: true }, (error) => {
      finish(error?.code ?? 0);
    });
    if (options?.timeoutMs) {
      setTimeout(() => {
        if (child.exitCode === null) {
          child.kill();
          finish(124);
        }
      }, options.timeoutMs);
    }
  });
}

function waitForFiles(filePaths, timeoutMs) {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const attempt = () => {
      if (filePaths.every((filePath) => existsSync(filePath))) {
        resolve(true);
      } else if (Date.now() - startedAt > timeoutMs) {
        resolve(false);
      } else {
        setTimeout(attempt, 500);
      }
    };
    attempt();
  });
}

function waitForHttpOk(url, timeoutMs) {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const attempt = () => {
      const request = http.get(url, { timeout: 2_000 }, (response) => {
        response.resume();
        if (response.statusCode === 200) {
          resolve(true);
        } else if (Date.now() - startedAt > timeoutMs) {
          resolve(false);
        } else {
          setTimeout(attempt, 500);
        }
      });
      request.on("timeout", () => {
        request.destroy();
      });
      request.on("error", () => {
        if (Date.now() - startedAt > timeoutMs) {
          resolve(false);
        } else {
          setTimeout(attempt, 500);
        }
      });
    };
    attempt();
  });
}

async function stopProcessTree(pid) {
  if (!pid) return;
  await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-Command",
    `$ids = @(Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${pid} } | Select-Object -ExpandProperty ProcessId); foreach ($id in $ids) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }; Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`,
  ]);
}

async function stopMatchingDesktopProcesses(cwd) {
  const escaped = cwd.replaceAll("'", "''");
  await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-Command",
    `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq '${appExeName}' -and $_.CommandLine -like '*${escaped}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
  ]);
}

function buildCheck(id, ok, detail) {
  return {
    id,
    ok,
    message: detail.message,
    missing: detail.missing ?? [],
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isMainModule() {
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const result = await runDesktopInstallerSmoke();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exit(2);
  }
}
