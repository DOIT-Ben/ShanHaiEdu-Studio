import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";

const root = process.cwd();
const artifactStorageSource = path.join(root, "src", "server", "artifact-storage", "local-artifact-storage.ts");
const nextConfigSource = path.join(root, "next.config.ts");

test("artifact storage runtime cwd paths are scoped for Next standalone tracing", () => {
  const source = readFileSync(artifactStorageSource, "utf8");

  assert.match(source, /path\.join\(\s*\/\*turbopackIgnore: true\*\/\s*process\.cwd\(\),\s*"\.tmp"\s*\)/);
  assert.doesNotMatch(source, /path\.join\(\s*process\.cwd\(\)\s*\)/);
});

test("Next standalone tracing excludes local generated and private project directories from API routes", () => {
  const source = readFileSync(nextConfigSource, "utf8");

  assert.match(source, /outputFileTracingExcludes/);
  assert.match(source, /["']\/api\/\*\*\/\*["']/);
  for (const pattern of [
    "./.env",
    "./.tmp/**/*",
    "./*.db",
    "./*.md",
    "./data/**/*",
    "./desktop-bundle/**/*",
    "./dist-desktop/**/*",
    "./docs/**/*",
    "./electron-builder.config.cjs",
    "./test-results/**/*",
    "./tests/**/*",
    "./tsconfig.json",
  ]) {
    assert.match(source, new RegExp(escapeRegExp(pattern)));
  }
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
