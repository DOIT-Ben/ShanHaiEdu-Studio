import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
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
  const storageRoot = makeExternalStorageRoot();
  const databasePath = makeAuthDatabase({ admin: true });
  mkdirSync(storageRoot, { recursive: true });
  const result = await runProductionPreflight({
    cwd,
    env: {
      ...completeEnv(storageRoot, { databasePath }),
      AGENT_BRAIN_CHANNEL: "fallback",
      AGENT_BRAIN_FALLBACK_API_KEY: "test-fallback-key-do-not-print",
      AGENT_BRAIN_FALLBACK_BASE_URL: "https://fallback-private.invalid/v1",
      AGENT_BRAIN_FALLBACK_MODEL: "fallback-private-model",
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
  assert.doesNotMatch(serialized, /test-tts-key-do-not-print/);
});

test("production preflight keeps MiniMax image authority while accepting the configured Evolink video runtime", async () => {
  const { runProductionPreflight } = await import("../scripts/production-preflight.mjs");
  const cwd = makeRepoFixture({ standalone: true });
  const env = completeEnv(makeExternalStorageRoot());
  delete env.OCTO_API_KEY;
  delete env.OCTO_BASE_URL;
  delete env.VIDEO_MODEL;
  Object.assign(env, {
    VIDEO_PROVIDER_MODE: "evolink",
    EVOLINK_API_KEY: "test-evolink-key-do-not-print",
    EVOLINK_VIDEO_MODEL: "test-evolink-model",
  });

  const result = await runProductionPreflight({ cwd, env });
  const serialized = JSON.stringify(result);

  assert.equal(result.ok, true);
  assert.equal(result.checks.find((check) => check.id === "provider-image")?.source, "provider_ledger:minimax");
  assert.equal(result.checks.find((check) => check.id === "provider-video")?.source, "evolink");
  assert.doesNotMatch(serialized, /test-evolink-key-do-not-print/);
});

test("production preflight requires the exact MiniMax TTS fields declared by the ledger", async () => {
  const { runProductionPreflight } = await import("../scripts/production-preflight.mjs");
  const cwd = makeRepoFixture({ standalone: true });
  const storageRoot = makeExternalStorageRoot();
  const primaryEnv = completeEnv(storageRoot);
  delete primaryEnv.MINIMAX_TTS_MODEL;

  const primaryResult = await runProductionPreflight({ cwd, env: primaryEnv });
  const primaryCheck = primaryResult.checks.find((check) => check.id === "provider-tts");
  const serialized = JSON.stringify(primaryResult);
  assert.equal(primaryCheck?.ok, false);
  assert.equal(primaryCheck?.source, "provider_ledger:minimax");
  assert.doesNotMatch(serialized, /test-tts-key-do-not-print/);
  assert.doesNotMatch(serialized, /tts-private\.invalid/);

  const completeResult = await runProductionPreflight({ cwd, env: completeEnv(storageRoot) });
  const completeCheck = completeResult.checks.find((check) => check.id === "provider-tts");
  assert.equal(completeCheck?.ok, true);
  assert.equal(completeCheck?.source, "provider_ledger:minimax");
});

test("production preflight detects missing standalone output and package script", async () => {
  const { runProductionPreflight } = await import("../scripts/production-preflight.mjs");
  const cwd = makeRepoFixture({ standalone: false, omitStart: true });
  const result = await runProductionPreflight({
    cwd,
    env: completeEnv(makeExternalStorageRoot()),
  });

  const failedIds = result.checks.filter((check) => !check.ok).map((check) => check.id);
  assert.equal(result.ok, false);
  assert.deepEqual(failedIds.sort(), ["next-standalone-output", "package-production-scripts"].sort());
});

test("production preflight rejects a client build that exposes public registration", async () => {
  const { runProductionPreflight } = await import("../scripts/production-preflight.mjs");
  const cwd = makeRepoFixture({ standalone: true });
  const result = await runProductionPreflight({
    cwd,
    env: {
      ...completeEnv(makeExternalStorageRoot()),
      NEXT_PUBLIC_SHANHAI_PUBLIC_REGISTRATION_ENABLED: "1",
    },
  });

  assert.equal(result.checks.find((check) => check.id === "public-registration")?.ok, false);
});

test("production preflight requires explicit trusted proxy mode", async () => {
  const { runProductionPreflight } = await import("../scripts/production-preflight.mjs");
  const cwd = makeRepoFixture({ standalone: true });
  for (const value of [undefined, "0"]) {
    const env = completeEnv(makeExternalStorageRoot());
    if (value === undefined) delete env.SHANHAI_TRUST_PROXY;
    else env.SHANHAI_TRUST_PROXY = value;
    const result = await runProductionPreflight({ cwd, env });
    assert.equal(result.checks.find((check) => check.id === "trusted-proxy")?.ok, false);
  }
});

test("production preflight requires an explicit single application instance for SQLite", async () => {
  const { runProductionPreflight } = await import("../scripts/production-preflight.mjs");
  const cwd = makeRepoFixture({ standalone: true });
  const storageRoot = makeExternalStorageRoot();

  for (const overrides of [
    { SHANHAI_APP_INSTANCE_COUNT: undefined },
    { SHANHAI_APP_INSTANCE_COUNT: "2" },
    { SHANHAI_APP_INSTANCE_COUNT: "1", WEB_CONCURRENCY: "2" },
    { SHANHAI_APP_INSTANCE_COUNT: "1", PM2_INSTANCES: "max" },
  ]) {
    const env = { ...completeEnv(storageRoot), ...overrides };
    if (overrides.SHANHAI_APP_INSTANCE_COUNT === undefined) delete env.SHANHAI_APP_INSTANCE_COUNT;
    const result = await runProductionPreflight({ cwd, env });
    assert.equal(result.checks.find((check) => check.id === "single-instance-topology")?.ok, false);
  }

  const passing = await runProductionPreflight({ cwd, env: completeEnv(storageRoot) });
  assert.equal(passing.checks.find((check) => check.id === "single-instance-topology")?.ok, true);
});

test("production preflight requires a real active password administrator in SQLite", async () => {
  const { runProductionPreflight } = await import("../scripts/production-preflight.mjs");
  const cwd = makeRepoFixture({ standalone: true });
  const storageRoot = makeExternalStorageRoot();
  const cases = [
    path.join(mkdtempSync(path.join(os.tmpdir(), "shanhai-missing-admin-db-")), "missing.db"),
    makeAuthDatabase({ admin: false }),
    makeAuthDatabase({ admin: true, authMode: "pending" }),
    makeAuthDatabase({ admin: true, passwordHash: null }),
  ];

  for (const databasePath of cases) {
    const result = await runProductionPreflight({
      cwd,
      env: completeEnv(storageRoot, { databasePath }),
    });
    assert.equal(result.checks.find((check) => check.id === "admin-readiness")?.ok, false, databasePath);
  }

  const passing = await runProductionPreflight({
    cwd,
    env: completeEnv(storageRoot, { databasePath: makeAuthDatabase({ admin: true }) }),
  });
  assert.equal(passing.checks.find((check) => check.id === "admin-readiness")?.ok, true);
});

test("production preflight directly rejects an incompatible control-plane schema", async () => {
  const { runProductionPreflight } = await import("../scripts/production-preflight.mjs");
  const cwd = makeRepoFixture({ standalone: true });
  const databasePath = makeAuthDatabase({ admin: true });
  const database = new Database(databasePath);
  database.exec('ALTER TABLE "ConversationTurnJob" DROP COLUMN "failureEvidenceDigest"');
  database.close();

  const result = await runProductionPreflight({
    cwd,
    env: completeEnv(makeExternalStorageRoot(), { databasePath }),
  });
  const schemaCheck = result.checks.find((check) => check.id === "database-schema-readiness");
  assert.equal(result.ok, false);
  assert.equal(schemaCheck?.ok, false);
  assert.deepEqual(schemaCheck?.reasons, [{
    code: "database_schema_missing_column",
    table: "ConversationTurnJob",
    column: "failureEvidenceDigest",
  }]);
  assert.equal(JSON.stringify(schemaCheck).includes(path.dirname(databasePath)), false);
});

test("production preflight rejects artifact storage inside release directories and symlink targets", async () => {
  const { runProductionPreflight } = await import("../scripts/production-preflight.mjs");
  const cwd = makeRepoFixture({ standalone: true });
  const forbiddenRoots = ["public", ".next", ".tmp"].map((name) => path.join(cwd, name));
  for (const storageRoot of forbiddenRoots) {
    mkdirSync(storageRoot, { recursive: true });
    const result = await runProductionPreflight({ cwd, env: completeEnv(storageRoot) });
    assert.equal(result.checks.find((check) => check.id === "artifact-storage-root")?.ok, false, storageRoot);
  }

  const linkParent = mkdtempSync(path.join(os.tmpdir(), "shanhai-storage-link-"));
  const storageLink = path.join(linkParent, "linked-storage");
  symlinkSync(path.join(cwd, "public"), storageLink, "junction");
  const linkedResult = await runProductionPreflight({ cwd, env: completeEnv(storageLink) });
  assert.equal(linkedResult.checks.find((check) => check.id === "artifact-storage-root")?.ok, false);
});

test("production preflight rejects a database junction that resolves back into the release", async (t) => {
  const source = readFileSync(path.join(process.cwd(), "scripts", "production-preflight.mjs"), "utf8");
  assert.match(source, /databaseRealpath/);
  assert.match(source, /databaseParentRealpath/);

  const { runProductionPreflight } = await import("../scripts/production-preflight.mjs");
  const cwd = makeRepoFixture({ standalone: true });
  const releaseData = path.join(cwd, "data");
  mkdirSync(releaseData, { recursive: true });
  const insideDatabase = path.join(releaseData, "production.db");
  writeAuthDatabase(insideDatabase, { admin: true });
  const externalParent = mkdtempSync(path.join(os.tmpdir(), "shanhai-db-link-"));
  const linkedDirectory = path.join(externalParent, "linked-data");
  try {
    symlinkSync(releaseData, linkedDirectory, "junction");
  } catch (error) {
    t.diagnostic(`junction unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const result = await runProductionPreflight({
    cwd,
    env: completeEnv(makeExternalStorageRoot(), { databasePath: path.join(linkedDirectory, "production.db") }),
  });
  assert.equal(result.checks.find((check) => check.id === "database-url")?.ok, false);
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

function completeEnv(storageRoot, { databasePath = makeAuthDatabase({ admin: true }) } = {}) {
  mkdirSync(storageRoot, { recursive: true });
  return {
    SHANHAI_PRODUCTION_PREFLIGHT_SKIP_DOTENV: "1",
    SHANHAI_AUTH_MODE: "password",
    SHANHAI_TRUST_PROXY: "1",
    NEXT_PUBLIC_SHANHAI_AUTH_MODE: "password",
    SHANHAI_PUBLIC_REGISTRATION_ENABLED: "0",
    NEXT_PUBLIC_SHANHAI_PUBLIC_REGISTRATION_ENABLED: "0",
    SHANHAI_ADMIN_BOOTSTRAP_CONFIRMED: "1",
    SHANHAI_APP_INSTANCE_COUNT: "1",
    DATABASE_URL: `file:${databasePath}`,
    ARTIFACT_STORAGE_ROOT: storageRoot,
    SHANHAI_PROVIDER_LEDGER_ROOT: path.resolve("tests", "fixtures", "provider-ledger"),
    SHANHAI_PROVIDER_LEDGER_SECRET_SOURCE: "deployment_secret",
    AGENT_BRAIN_CHANNEL: "primary",
    AGENT_BRAIN_API_KEY: "test-agent-key-do-not-print",
    AGENT_BRAIN_BASE_URL: "https://agent-private.invalid/v1",
    AGENT_BRAIN_MODEL: "test-agent-model",
    COZE_API_TOKEN: "test-coze-token-do-not-print",
    COZE_PPT_RUN_URL: "https://coze-private.invalid/run",
    IMAGE_PROVIDER_CHANNEL: "minimax",
    MINIMAX_API_KEY: "test-minimax-key-do-not-print",
    MINIMAX_BASE_URL: "https://minimax-private.invalid",
    MINIMAX_IMAGE_MODEL: "test-image-model",
    OCTO_API_KEY: "test-video-key-do-not-print",
    OCTO_BASE_URL: "https://video-private.invalid/v1",
    VIDEO_MODEL: "test-video-model",
    TTS_PROVIDER_MODE: "minimax",
    MINIMAX_TTS_MODEL: "test-tts-model",
  };
}

function makeExternalStorageRoot() {
  return mkdtempSync(path.join(os.tmpdir(), "shanhai-production-storage-"));
}

function makeAuthDatabase({ admin, authMode = "password", passwordHash = "test-password-hash" }) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "shanhai-auth-db-"));
  const databasePath = path.join(directory, "production.db");
  writeAuthDatabase(databasePath, { admin, authMode, passwordHash });
  return databasePath;
}

function writeAuthDatabase(databasePath, { admin, authMode = "password", passwordHash = "test-password-hash" }) {
  const initialized = spawnSync(process.execPath, ["scripts/init-sqlite-schema.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: `file:${databasePath}`,
      SHANHAI_DB_INIT_SKIP_DOTENV: "1",
    },
    encoding: "utf8",
  });
  if (initialized.status !== 0) throw new Error("isolated schema initialization failed");
  const db = new Database(databasePath);
  if (admin) {
    db.prepare(
      'INSERT INTO "LocalUser" ("id", "displayName", "role", "authMode", "email", "passwordHash", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
    ).run("admin-fixture", "管理员", "admin", authMode, "admin@example.test", passwordHash);
  }
  db.close();
}
