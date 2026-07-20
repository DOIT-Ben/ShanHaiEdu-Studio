import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { createDesktopServerEnvironment } from "../scripts/ops-runtime-config.mjs";

const root = process.cwd();

test("desktop packaging entry files and scripts are configured", () => {
  const pkg = readPackage();

  assert.ok(existsSync(path.join(root, "desktop", "electron-main.mjs")), "desktop/electron-main.mjs should exist");
  assert.ok(existsSync(path.join(root, "desktop", "preload.mjs")), "desktop/preload.mjs should exist");
  assert.ok(existsSync(path.join(root, "scripts", "desktop-smoke.mjs")), "scripts/desktop-smoke.mjs should exist");
  assert.ok(existsSync(path.join(root, "scripts", "prepare-desktop-bundle.mjs")), "scripts/prepare-desktop-bundle.mjs should exist");
  assert.equal(pkg.scripts?.["desktop:smoke"], "node scripts/desktop-smoke.mjs");
  assert.equal(pkg.scripts?.["desktop:prepare"], "node scripts/prepare-desktop-bundle.mjs");
  assert.equal(pkg.scripts?.["desktop:pack"], "npm run build && npm run desktop:prepare && electron-builder --win --config electron-builder.config.cjs");
});

test("desktop packaging uses Electron without exposing Node APIs in preload", () => {
  const pkg = readPackage();
  const dependencies = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

  assert.ok(dependencies.electron, "electron dev dependency should be installed");
  assert.ok(dependencies["electron-builder"], "electron-builder dev dependency should be installed");

  const preloadPath = path.join(root, "desktop", "preload.mjs");
  assert.ok(existsSync(preloadPath), "desktop/preload.mjs should exist");
  const preload = readFileSync(preloadPath, "utf8");
  assert.equal(/\bcontextBridge\.exposeInMainWorld\b/.test(preload), false);
  assert.equal(/\brequire\s*\(/.test(preload), false);

  const main = readFileSync(path.join(root, "desktop", "electron-main.mjs"), "utf8");
  assert.match(main, /SHANHAI_DESKTOP_PORT/);
  assert.match(main, /SHANHAI_DESKTOP_USER_DATA_DIR/);
  assert.match(main, /app\.setPath\(["']userData["']/);
  assert.deepEqual(
    createDesktopServerEnvironment({
      baseEnv: {},
      port: 3127,
      databaseUrl: "file:fixture.db",
      artifactStorageRoot: "fixture-artifacts",
    }),
    {
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      HOSTNAME: "127.0.0.1",
      PORT: "3127",
      DATABASE_URL: "file:fixture.db",
      ARTIFACT_STORAGE_ROOT: "fixture-artifacts",
    },
  );
});

test("electron builder config keeps binary artifacts out of git-scoped source", () => {
  assert.ok(existsSync(path.join(root, "electron-builder.config.cjs")), "electron-builder.config.cjs should exist");
  const config = readFileSync(path.join(root, "electron-builder.config.cjs"), "utf8");

  assert.match(config, /appId:\s*["']cn\.shanhaiedu\.studio["']/);
  assert.match(config, /directories:\s*{/);
  assert.match(config, /output:\s*["']dist-desktop["']/);
  assert.match(config, /runAfterFinish:\s*false/);
  assert.match(config, /desktop-bundle\/\*\*/);
  assert.doesNotMatch(config, /\.next\/standalone/);

  const gitignore = readFileSync(path.join(root, ".gitignore"), "utf8");
  assert.match(gitignore, /^dist-desktop\/$/m);
  assert.match(gitignore, /^desktop-bundle\/$/m);
});

test("desktop packaging defines client metadata, icon, and asar unpack boundary", () => {
  const config = readFileSync(path.join(root, "electron-builder.config.cjs"), "utf8");

  assert.match(config, /asar:\s*true/);
  assert.match(config, /asarUnpack:\s*\[/);
  assert.match(config, /desktop-bundle\/\*\*/);
  assert.match(config, /node_modules\/\*\*/);
  assert.match(config, /icon:\s*["']desktop\/assets\/icon\.ico["']/);
  assert.match(config, /extraMetadata/);
  assert.match(config, /description:\s*["']/);
  assert.match(config, /author:\s*["']/);
  assert.equal(existsSync(path.join(root, "desktop", "assets", "icon.ico")), true);
});

test("desktop main process prepares logs, crash dumps, and asar unpacked server lookup", () => {
  const main = readFileSync(path.join(root, "desktop", "electron-main.mjs"), "utf8");

  assert.match(main, /app\.setAppLogsPath/);
  assert.match(main, /app\.setPath\(["']crashDumps["']/);
  assert.match(main, /\.asar\.unpacked/);
});

test("desktop main process waits for the local server before showing the window", () => {
  const main = readFileSync(path.join(root, "desktop", "electron-main.mjs"), "utf8");

  assert.match(main, /waitForDesktopServer/);
  assert.match(main, /mainWindow\.webContents\.once\(["']did-fail-load["']/);
  assert.match(main, /loadDesktopUrl/);
  assert.match(main, /loadFile/);
  assert.match(main, /127\.0\.0\.1/);
});

function readPackage() {
  return JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
}
