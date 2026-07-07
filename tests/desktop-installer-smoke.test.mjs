import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  resolveInstallerTimeoutMs,
  runDesktopInstallerSmoke,
  summarizeInstallExperienceState,
  summarizeSilentInstallState,
} from "../scripts/desktop-installer-smoke.mjs";

const root = process.cwd();

test("desktop installer smoke command and artifacts are available", async () => {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

  assert.equal(pkg.scripts?.["desktop:installer-smoke"], "node scripts/desktop-installer-smoke.mjs");
  assert.ok(existsSync(path.join(root, "scripts", "desktop-installer-smoke.mjs")));
});

test("desktop installer smoke validates ignored output and safe resources without launching", async () => {
  const fixture = createInstallerSmokeFixture();
  const result = await runDesktopInstallerSmoke({
    cwd: fixture,
    launch: false,
    runInstaller: false,
  });

  assert.equal(result.ok, true);
  assert.equal(result.stage, "m35_desktop_installer_smoke");
  assert.equal(result.checks.find((item) => item.id === "dist-desktop-ignored")?.ok, true);
  assert.equal(result.checks.find((item) => item.id === "desktop-bundle-ignored")?.ok, true);
  assert.equal(result.checks.find((item) => item.id === "packaged-resource-safety")?.ok, true);
});

test("desktop installer smoke keeps installation opt-in", async () => {
  const fixture = createInstallerSmokeFixture();
  const result = await runDesktopInstallerSmoke({
    cwd: fixture,
    launch: false,
    runInstaller: false,
  });

  assert.equal(result.installerMode, "skipped");
  assert.equal(result.checks.some((item) => item.id === "silent-install"), false);
});

test("silent installer diagnostics separate partial install from missing uninstaller", () => {
  const result = summarizeSilentInstallState({
    installExited: false,
    installedExeOk: true,
    installedServerOk: true,
    uninstallerOk: false,
    uninstallCode: null,
    missing: {
      exe: "install/ShanHaiEdu Studio.exe",
      server: "install/resources/app/desktop-bundle/server.js",
      uninstaller: "install/Uninstall ShanHaiEdu Studio.exe",
    },
  });

  assert.deepEqual(
    result.map((item) => [item.id, item.ok]),
    [
      ["silent-install-exit", false],
      ["installed-exe", true],
      ["installed-server", true],
      ["silent-install-uninstaller", false],
      ["silent-uninstall", false],
    ],
  );
  assert.match(result.find((item) => item.id === "silent-install-uninstaller")?.message ?? "", /Uninstaller/);
});

test("silent installer timeout defaults to a full extraction window", () => {
  assert.equal(resolveInstallerTimeoutMs(), 600_000);
  assert.equal(resolveInstallerTimeoutMs("120000"), 120_000);
  assert.equal(resolveInstallerTimeoutMs("1000"), 600_000);
  assert.equal(resolveInstallerTimeoutMs("not-a-number"), 600_000);
});

test("install experience diagnostics cover system entrypoints and uninstall residue", () => {
  const result = summarizeInstallExperienceState({
    registryBeforeUninstallOk: true,
    startMenuShortcutBeforeUninstallOk: true,
    userDataOk: true,
    registryAfterUninstallOk: false,
    startMenuShortcutAfterUninstallOk: false,
    coreFilesAfterUninstallOk: false,
  });

  assert.deepEqual(
    result.map((item) => [item.id, item.ok]),
    [
      ["uninstall-registry-entry", true],
      ["start-menu-shortcut", true],
      ["desktop-user-data", true],
      ["uninstall-removes-registry", true],
      ["uninstall-removes-start-menu", true],
      ["uninstall-removes-core-files", true],
    ],
  );
});

test("desktop user data smoke verifies runtime data, logs, and crash dump directories", () => {
  const source = readFileSync(path.join(root, "scripts", "desktop-installer-smoke.mjs"), "utf8");

  assert.match(source, /artifact-storage-root/);
  assert.match(source, /logs/);
  assert.match(source, /crash-dumps/);
});

function createInstallerSmokeFixture() {
  const fixture = path.join(tmpdir(), `shanhai-installer-smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(path.join(fixture, "dist-desktop", "win-unpacked", "resources", "app", "desktop-bundle"), { recursive: true });
  mkdirSync(path.join(fixture, "desktop-bundle"), { recursive: true });
  writeFileSync(path.join(fixture, ".gitignore"), "dist-desktop/\ndesktop-bundle/\n");
  writeFileSync(path.join(fixture, "dist-desktop", "ShanHaiEdu Studio Setup 0.1.0.exe"), "fake installer");
  writeFileSync(path.join(fixture, "dist-desktop", "win-unpacked", "ShanHaiEdu Studio.exe"), "fake exe");
  writeFileSync(path.join(fixture, "dist-desktop", "win-unpacked", "resources", "app", "package.json"), "{}");
  writeFileSync(path.join(fixture, "dist-desktop", "win-unpacked", "resources", "app", "desktop-bundle", "server.js"), "");
  return fixture;
}
