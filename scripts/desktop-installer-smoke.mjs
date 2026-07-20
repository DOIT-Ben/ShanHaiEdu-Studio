import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

const installerName = "ShanHaiEdu Studio Setup 0.1.0.exe";
const appExeName = "ShanHaiEdu Studio.exe";
export const DESKTOP_USER_DATA_DIRECTORIES = Object.freeze([
  "data",
  "artifact-storage-root",
  "logs",
  "crash-dumps",
]);

export async function runDesktopInstallerSmoke({
  cwd = process.cwd(),
  launch = true,
  runInstaller = process.env.SHANHAI_RUN_INSTALLER_SMOKE === "1",
  port = Number.parseInt(process.env.SHANHAI_DESKTOP_PORT ?? "3127", 10),
  installerTimeoutMs = resolveInstallerTimeoutMs(),
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
    const installResult = await runSilentInstallSmoke(paths.installer, cwd, port + 1, installerTimeoutMs);
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
  const resources = path.join(dist, "win-unpacked", "resources");
  return {
    installer: path.join(dist, installerName),
    unpackedExe: path.join(dist, "win-unpacked", appExeName),
    appResources: path.join(resources, "app"),
    unpackedResources: path.join(resources, "app.asar.unpacked"),
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

function checkPackagedResources(appResources, unpackedResources = path.join(path.dirname(appResources), "app.asar.unpacked")) {
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
  ].filter((entry) => existsSync(path.join(appResources, entry)) || existsSync(path.join(unpackedResources, entry)));

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

  return runExeHttpSmokeWithEnv(exePath, cwd, port, id);
}

async function runExeHttpSmokeWithEnv(exePath, cwd, port, id, extraEnv = {}) {
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
      ...extraEnv,
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

async function runSilentInstallSmoke(installerPath, cwd, port, installerTimeoutMs) {
  const installDir = path.join(cwd, "test-results", "stage35-install");
  if (!isInside(path.resolve(cwd), path.resolve(installDir))) {
    return {
      checks: [
        buildCheck("silent-install-exit", false, {
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
  const installedServer = resolveInstalledServerPath(installDir);
  const uninstaller = path.join(installDir, `Uninstall ${appExeName}`);
  const userDataDir = path.join(cwd, "test-results", "stage37-user-data");
  const shortcutPath = resolveStartMenuShortcutPath();
  const installExited = await waitForProcessExit(installProcess, installerTimeoutMs);
  if (!installExited && !installProcess.killed && installProcess.exitCode === null) {
    installProcess.kill();
  }

  const installedExeOk = existsSync(installedExe);
  const installedServerOk = existsSync(installedServer);
  const uninstallerOk = existsSync(uninstaller);
  const registryBeforeUninstallOk = await checkUninstallRegistryEntry(installDir);
  const startMenuShortcutBeforeUninstallOk = existsSync(shortcutPath);
  let installedExeHttpCheck = null;
  let uninstallCode = null;

  if (installedExeOk && installedServerOk) {
    mkdirSync(userDataDir, { recursive: true });
    installedExeHttpCheck = await runExeHttpSmokeWithEnv(installedExe, cwd, port, "installed-exe-http", {
      SHANHAI_DESKTOP_USER_DATA_DIR: userDataDir,
    });
  }

  const userDataOk = checkDesktopUserData(userDataDir);

  if (uninstallerOk) {
    const uninstall = await execFileAsync(uninstaller, ["/S"], { cwd: installDir, timeoutMs: 60_000 });
    uninstallCode = uninstall.code;
  }

  const cleanupState = await waitForUninstallCleanup({
    installDir,
    shortcutPath,
    coreFiles: [installedExe, installedServer, uninstaller],
    timeoutMs: 60_000,
  });
  const registryAfterUninstallOk = cleanupState.registryAfterUninstallOk;
  const startMenuShortcutAfterUninstallOk = cleanupState.startMenuShortcutAfterUninstallOk;
  const coreFilesAfterUninstallOk = cleanupState.coreFilesAfterUninstallOk;

  const checks = summarizeSilentInstallState({
    installExited,
    installedExeOk,
    installedServerOk,
    uninstallerOk,
    uninstallCode,
    missing: {
      exe: installedExe,
      server: installedServer,
      uninstaller,
    },
  });

  if (installedExeHttpCheck) {
    checks.splice(3, 0, installedExeHttpCheck);
  }
  checks.push(
    ...summarizeInstallExperienceState({
      registryBeforeUninstallOk,
      startMenuShortcutBeforeUninstallOk,
      userDataOk,
      registryAfterUninstallOk,
      startMenuShortcutAfterUninstallOk,
      coreFilesAfterUninstallOk,
    }),
  );

  await stopMatchingDesktopProcesses(cwd);
  return { checks };
}

export function resolveInstallerTimeoutMs(value = process.env.SHANHAI_INSTALLER_TIMEOUT_MS) {
  const parsed = Number.parseInt(value ?? "600000", 10);
  return Number.isFinite(parsed) && parsed >= 60_000 ? parsed : 600_000;
}

export function summarizeSilentInstallState({
  installExited,
  installedExeOk,
  installedServerOk,
  uninstallerOk,
  uninstallCode,
  missing,
}) {
  return [
    buildCheck("silent-install-exit", installExited, {
      message: installExited ? "Silent installer process exited." : "Silent installer process did not exit within timeout.",
    }),
    buildCheck("installed-exe", installedExeOk, {
      message: installedExeOk ? "Installed executable is present." : "Installed executable is missing.",
      missing: installedExeOk ? [] : [missing.exe],
    }),
    buildCheck("installed-server", installedServerOk, {
      message: installedServerOk ? "Installed desktop server bundle is present." : "Installed desktop server bundle is missing.",
      missing: installedServerOk ? [] : [missing.server],
    }),
    buildCheck("silent-install-uninstaller", uninstallerOk, {
      message: uninstallerOk ? "Uninstaller is present." : "Uninstaller was not generated.",
      missing: uninstallerOk ? [] : [missing.uninstaller],
    }),
    buildCheck("silent-uninstall", uninstallerOk && uninstallCode === 0, {
      message: !uninstallerOk
        ? "Uninstaller was not found."
        : uninstallCode === 0
          ? "Silent uninstall exited with 0."
          : "Silent uninstall failed.",
      missing: uninstallerOk ? [] : [missing.uninstaller],
    }),
  ];
}

export function summarizeInstallExperienceState({
  registryBeforeUninstallOk,
  startMenuShortcutBeforeUninstallOk,
  userDataOk,
  registryAfterUninstallOk,
  startMenuShortcutAfterUninstallOk,
  coreFilesAfterUninstallOk,
}) {
  return [
    buildCheck("uninstall-registry-entry", registryBeforeUninstallOk, {
      message: registryBeforeUninstallOk ? "Windows uninstall registry entry is present." : "Windows uninstall registry entry is missing.",
    }),
    buildCheck("start-menu-shortcut", startMenuShortcutBeforeUninstallOk, {
      message: startMenuShortcutBeforeUninstallOk ? "Start menu shortcut is present." : "Start menu shortcut is missing.",
    }),
    buildCheck("desktop-user-data", userDataOk, {
      message: userDataOk ? "Desktop user data directories are present." : "Desktop user data directories are missing.",
    }),
    buildCheck("uninstall-removes-registry", !registryAfterUninstallOk, {
      message: registryAfterUninstallOk ? "Windows uninstall registry entry remains after uninstall." : "Windows uninstall registry entry was removed.",
    }),
    buildCheck("uninstall-removes-start-menu", !startMenuShortcutAfterUninstallOk, {
      message: startMenuShortcutAfterUninstallOk ? "Start menu shortcut remains after uninstall." : "Start menu shortcut was removed.",
    }),
    buildCheck("uninstall-removes-core-files", !coreFilesAfterUninstallOk, {
      message: coreFilesAfterUninstallOk ? "Installed core files remain after uninstall." : "Installed core files were removed.",
    }),
  ];
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

function waitForProcessExit(child, timeoutMs) {
  if (child.exitCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    child.once("exit", () => finish(true));
    setTimeout(() => finish(false), timeoutMs);
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

async function checkUninstallRegistryEntry(installDir) {
  const escapedInstallDir = installDir.replaceAll("'", "''");
  const result = await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-Command",
    `$paths=@('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'); $found=$false; foreach($base in $paths){ Get-ChildItem $base -ErrorAction SilentlyContinue | ForEach-Object { $p=Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue; if($p.DisplayName -like 'ShanHaiEdu Studio*' -and (($p.InstallLocation -eq '${escapedInstallDir}') -or ($p.UninstallString -like '*stage35-install*') -or ($p.QuietUninstallString -like '*stage35-install*'))) { $found=$true } } }; if($found){ exit 0 } else { exit 3 }`,
  ]);
  return result.code === 0;
}

async function waitForUninstallCleanup({ installDir, shortcutPath, coreFiles, timeoutMs }) {
  const startedAt = Date.now();
  while (true) {
    const registryAfterUninstallOk = await checkUninstallRegistryEntry(installDir);
    const startMenuShortcutAfterUninstallOk = existsSync(shortcutPath);
    const coreFilesAfterUninstallOk = coreFiles.some((filePath) => existsSync(filePath));
    if (!registryAfterUninstallOk && !startMenuShortcutAfterUninstallOk && !coreFilesAfterUninstallOk) {
      return { registryAfterUninstallOk, startMenuShortcutAfterUninstallOk, coreFilesAfterUninstallOk };
    }
    if (Date.now() - startedAt > timeoutMs) {
      return { registryAfterUninstallOk, startMenuShortcutAfterUninstallOk, coreFilesAfterUninstallOk };
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

function resolveStartMenuShortcutPath() {
  return path.join(process.env.APPDATA ?? "", "Microsoft", "Windows", "Start Menu", "Programs", "ShanHaiEdu Studio.lnk");
}

function checkDesktopUserData(userDataDir) {
  return DESKTOP_USER_DATA_DIRECTORIES.every((directory) => existsSync(path.join(userDataDir, directory)));
}

function resolveInstalledServerPath(installDir) {
  const candidates = [
    path.join(installDir, "resources", "app.asar.unpacked", "desktop-bundle", "server.js"),
    path.join(installDir, "resources", "app", "desktop-bundle", "server.js"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
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
