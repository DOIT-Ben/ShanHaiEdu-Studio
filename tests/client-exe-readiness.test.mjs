import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runClientExeReadiness } from "../scripts/client-exe-readiness.mjs";

const root = process.cwd();

test("client exe readiness passes web-to-exe prerequisites without pretending an exe exists", async () => {
  const storageRoot = mkdtempSync(path.join(tmpdir(), "shanhai-client-exe-storage-"));
  const result = await runClientExeReadiness({
    cwd: root,
    env: { ARTIFACT_STORAGE_ROOT: storageRoot },
  });

  assert.equal(result.ok, true);
  assert.equal(result.stage, "m33_client_exe_readiness");
  assert.deepEqual(
    result.checks.map((item) => item.id),
    [
      "package-production-scripts",
      "client-exe-preflight-script",
      "next-standalone-output",
      "download-routes",
      "artifact-storage-root",
      "loopback-origin-compatibility",
    ],
  );
  assert.ok(result.warnings.some((item) => item.id === "desktop-wrapper-not-configured"));
});

test("client exe readiness fails when web packaging prerequisites are missing", async () => {
  const fixture = mkdtempSync(path.join(tmpdir(), "shanhai-client-exe-missing-"));
  writeFileSync(
    path.join(fixture, "package.json"),
    JSON.stringify({ scripts: { dev: "next dev" } }, null, 2),
  );
  writeFileSync(path.join(fixture, "next.config.ts"), "const nextConfig = {}; export default nextConfig;\n");
  mkdirSync(path.join(fixture, "src", "server", "auth"), { recursive: true });
  writeFileSync(path.join(fixture, "src", "server", "auth", "workbench-route.ts"), "export {};\n");

  const result = await runClientExeReadiness({ cwd: fixture, env: {} });
  assert.equal(result.ok, false);
  assert.equal(result.checks.find((item) => item.id === "package-production-scripts")?.ok, false);
  assert.equal(result.checks.find((item) => item.id === "client-exe-preflight-script")?.ok, false);
  assert.equal(result.checks.find((item) => item.id === "next-standalone-output")?.ok, false);
  assert.equal(result.checks.find((item) => item.id === "download-routes")?.ok, false);
});

test("client exe readiness output does not leak configured local values", async () => {
  const storageRoot = mkdtempSync(path.join(tmpdir(), "shanhai-client-exe-privateish-"));
  const result = await runClientExeReadiness({
    cwd: root,
    env: {
      ARTIFACT_STORAGE_ROOT: storageRoot,
      COZE_API_TOKEN: "do-not-print-token-value",
      OPENAI_API_KEY: "do-not-print-openai-value",
    },
  });
  const serialized = JSON.stringify(result);

  assert.equal(result.ok, true);
  assert.equal(serialized.includes(storageRoot), false);
  assert.equal(serialized.includes("do-not-print-token-value"), false);
  assert.equal(serialized.includes("do-not-print-openai-value"), false);
});

test("package exposes the client exe readiness command", async () => {
  const result = await runClientExeReadiness({ cwd: root, env: {} });
  assert.equal(result.checks.find((item) => item.id === "client-exe-preflight-script")?.ok, true);
});
