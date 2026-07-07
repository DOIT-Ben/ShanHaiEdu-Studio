import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runDesktopInstallerSmoke } from "../scripts/desktop-installer-smoke.mjs";

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
