import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

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
  assert.match(main, /ELECTRON_RUN_AS_NODE/);
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

function readPackage() {
  return JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
}
