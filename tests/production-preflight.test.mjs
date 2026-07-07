import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

test("production preflight fails safely when required env is missing", async () => {
  const { runProductionPreflight } = await import("../scripts/production-preflight.mjs");
  const cwd = makeRepoFixture({ standalone: true });
  const result = await runProductionPreflight({
    cwd,
    env: {
      SHANHAI_PRODUCTION_PREFLIGHT_SKIP_DOTENV: "1",
      AGENT_BRAIN_FALLBACK_API_KEY: "test-secret-key-do-not-print",
      AGENT_BRAIN_FALLBACK_BASE_URL: "https://private-openai.invalid/v1",
      COZE_API_TOKEN: "test-coze-token-do-not-print",
      COZE_PPT_RUN_URL: "https://private-coze.invalid/run",
    },
  });
  const serialized = JSON.stringify(result);

  assert.equal(result.ok, false);
  assert.match(serialized, /database-url/);
  assert.match(serialized, /artifact-storage-root/);
  assert.doesNotMatch(serialized, /test-secret-key-do-not-print/);
  assert.doesNotMatch(serialized, /test-coze-token-do-not-print/);
  assert.doesNotMatch(serialized, /private-openai\.invalid/);
  assert.doesNotMatch(serialized, /private-coze\.invalid/);
});

test("production preflight passes with complete local production env without leaking values", async () => {
  const { runProductionPreflight } = await import("../scripts/production-preflight.mjs");
  const cwd = makeRepoFixture({ standalone: true });
  const storageRoot = path.join(cwd, "deploy-storage");
  mkdirSync(storageRoot, { recursive: true });
  const result = await runProductionPreflight({
    cwd,
    env: {
      SHANHAI_PRODUCTION_PREFLIGHT_SKIP_DOTENV: "1",
      DATABASE_URL: "file:./data/shanhai-production.db",
      ARTIFACT_STORAGE_ROOT: storageRoot,
      AGENT_BRAIN_CHANNEL: "fallback",
      AGENT_BRAIN_FALLBACK_API_KEY: "test-fallback-key-do-not-print",
      AGENT_BRAIN_FALLBACK_BASE_URL: "https://fallback-private.invalid/v1",
      AGENT_BRAIN_FALLBACK_MODEL: "fallback-private-model",
      COZE_API_TOKEN: "test-coze-token-do-not-print",
      COZE_PPT_RUN_URL: "https://coze-private.invalid/run",
      IMAGE_PROVIDER_CHANNEL: "free",
      IMAGEGEN_FREE_API_KEY: "test-image-key-do-not-print",
      IMAGEGEN_FREE_BASE_URL: "https://image-private.invalid/v1",
      IMAGEGEN_FREE_MODEL: "test-image-model",
      OCTO_API_KEY: "test-video-key-do-not-print",
      OCTO_BASE_URL: "https://video-private.invalid/v1",
      VIDEO_MODEL: "test-video-model",
    },
  });
  const serialized = JSON.stringify(result);

  assert.equal(result.ok, true);
  assert.equal(result.checks.every((check) => check.ok), true);
  assert.match(serialized, /next-standalone-output/);
  assert.match(serialized, /provider-video/);
  assert.doesNotMatch(serialized, /test-fallback-key-do-not-print/);
  assert.doesNotMatch(serialized, /fallback-private\.invalid/);
  assert.doesNotMatch(serialized, /test-image-key-do-not-print/);
  assert.doesNotMatch(serialized, /image-private\.invalid/);
  assert.doesNotMatch(serialized, /test-video-key-do-not-print/);
  assert.doesNotMatch(serialized, /video-private\.invalid/);
});

test("production preflight detects missing standalone output and package script", async () => {
  const { runProductionPreflight } = await import("../scripts/production-preflight.mjs");
  const cwd = makeRepoFixture({ standalone: false, omitStart: true });
  const result = await runProductionPreflight({
    cwd,
    env: completeEnv(path.join(cwd, "deploy-storage")),
  });

  const failedIds = result.checks.filter((check) => !check.ok).map((check) => check.id);
  assert.equal(result.ok, false);
  assert.deepEqual(failedIds.sort(), ["next-standalone-output", "package-production-scripts"].sort());
});

test("package exposes the production preflight command", () => {
  const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
  assert.equal(pkg.scripts?.["preflight:production"], "node scripts/production-preflight.mjs");
});

function makeRepoFixture({ standalone, omitStart = false }) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "shanhai-m31-"));
  writeFileSync(
    path.join(cwd, "package.json"),
    JSON.stringify({
      scripts: omitStart ? { build: "prisma generate && next build" } : { build: "prisma generate && next build", start: "next start" },
    }),
  );
  writeFileSync(
    path.join(cwd, "next.config.ts"),
    standalone
      ? 'const nextConfig = { reactStrictMode: true, output: "standalone" };\nexport default nextConfig;\n'
      : "const nextConfig = { reactStrictMode: true };\nexport default nextConfig;\n",
  );
  return cwd;
}

function completeEnv(storageRoot) {
  mkdirSync(storageRoot, { recursive: true });
  return {
    SHANHAI_PRODUCTION_PREFLIGHT_SKIP_DOTENV: "1",
    DATABASE_URL: "file:./data/shanhai-production.db",
    ARTIFACT_STORAGE_ROOT: storageRoot,
    OPENAI_API_KEY: "test-openai-key-do-not-print",
    OPENAI_BASE_URL: "https://openai-private.invalid/v1",
    OPENAI_MODEL: "test-openai-model",
    COZE_API_TOKEN: "test-coze-token-do-not-print",
    COZE_PPT_RUN_URL: "https://coze-private.invalid/run",
    IMAGE_PROVIDER_CHANNEL: "free",
    IMAGEGEN_FREE_API_KEY: "test-image-key-do-not-print",
    IMAGEGEN_FREE_BASE_URL: "https://image-private.invalid/v1",
    IMAGEGEN_FREE_MODEL: "test-image-model",
    OCTO_API_KEY: "test-video-key-do-not-print",
    OCTO_BASE_URL: "https://video-private.invalid/v1",
    VIDEO_MODEL: "test-video-model",
  };
}
