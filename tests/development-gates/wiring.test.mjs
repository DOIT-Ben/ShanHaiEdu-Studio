import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import YAML from "yaml";

import {
  createNodeTestArgs,
  createVitestShardPlans,
  createSuiteEnv,
  createTestBaseEnv,
  resolveCanonicalTestTempRoot,
} from "../../scripts/run-tests.mjs";

test("package exposes one development, CI, manifest, Provider, and release gate family", () => {
  const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
  assert.equal(pkg.scripts?.typecheck, "prisma generate && tsc --noEmit");
  assert.equal(pkg.scripts?.["gate:development"], "node scripts/development-gates/run-development-gates.mjs");
  assert.equal(pkg.scripts?.["gate:manifest:verify"], "node scripts/development-gates/verification-manifest.mjs verify");
  assert.equal(pkg.scripts?.["gate:provider:impact"], "node scripts/development-gates/provider-continuity.mjs impact");
  assert.equal(pkg.scripts?.["gate:provider:verify"], "node scripts/development-gates/provider-continuity.mjs verify");
  assert.equal(pkg.scripts?.["verify:local"], "node scripts/development-gates/run-verification.mjs");
  assert.equal(pkg.scripts?.["verify:ci"], "node scripts/development-gates/run-verification.mjs --require-clean");
  assert.equal(pkg.scripts?.["gate:release"], "node scripts/development-gates/release-gate.mjs");
});

test("the full Vitest suite restarts a single worker across isolated database shards", () => {
  assert.deepEqual(createNodeTestArgs(), ["--test", "--test-concurrency=1", "tests/*.test.mjs"]);
  const plans = createVitestShardPlans({
    root: "C:\\repo",
    base: { EXISTING: "yes" },
    providerLedgerRoot: "C:\\repo\\tests\\fixtures\\provider-ledger",
    providerEnvKeys: ["MINIMAX_API_KEY"],
    shardCount: 2,
  });
  assert.deepEqual(plans.map((plan) => plan.args), [
    ["vitest", "run", "--maxWorkers=1", "--no-file-parallelism", "--shard=1/2"],
    ["vitest", "run", "--maxWorkers=1", "--no-file-parallelism", "--shard=2/2"],
  ]);
  assert.equal(plans[0].databasePath, "C:\\repo\\.tmp\\vitest-test-workbench-shard-1.db");
  assert.equal(plans[1].databasePath, "C:\\repo\\.tmp\\vitest-test-workbench-shard-2.db");
  assert.notEqual(plans[0].env.DATABASE_URL, plans[1].env.DATABASE_URL);
  assert.equal(plans[0].env.MINIMAX_API_KEY, undefined);
});

test("package exposes the single Provider live preflight and seal entrypoints", () => {
  const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
  const policy = JSON.parse(readFileSync(path.join(process.cwd(), "config", "development-gates.json"), "utf8"));
  assert.equal(pkg.scripts["gate:provider:live"], "node scripts/development-gates/provider-continuity/live-runner.mjs");
  assert.equal(pkg.scripts["gate:provider:seal"], "node scripts/development-gates/provider-continuity/receipt-writer.mjs");
  assert.ok(policy.providerContinuity.sensitivePaths.includes("scripts/development-gates/provider-continuity/**"));
  assert.ok(policy.providerContinuity.sensitivePaths.includes("scripts/development-gates/run-development-gates.mjs"));
});

test("the active stage starts after archival and exposes no archive mutation exception", () => {
  const stage = JSON.parse(readFileSync(path.join(process.cwd(), "docs", "stages", "active-stage.json"), "utf8"));
  assert.equal(stage.baselineSha, "336e6b3a5c94eaa1d9c674c6ffd053339b3f95ee");
  assert.deepEqual(stage.protectedPathExceptions, []);
  assert.equal(stage.allowedPaths.some((entry) => entry.startsWith("docs/archive/")), false);
  assert.equal(stage.allowedPaths.includes("docs/stages/project-development-gates-plan.md"), false);
  assert.equal(stage.allowedPaths.includes("docs/stages/project-development-gates-test-plan.md"), false);
});

test("quality-gates workflow calls the repository CI entry without a success bypass", () => {
  const workflowPath = path.join(process.cwd(), ".github", "workflows", "quality-gates.yml");
  const workflow = YAML.parse(readFileSync(workflowPath, "utf8"));
  const job = workflow.jobs?.["quality-gates"];
  assert.equal(job?.["runs-on"], "windows-latest");
  assert.equal(job?.["continue-on-error"], undefined);
  const steps = job?.steps ?? [];
  const installMedia = steps.find((step) => step.name === "Install real media dependencies");
  assert.equal(installMedia?.run?.trimEnd(), [
    "choco install ffmpeg libreoffice-fresh --yes --no-progress",
    "winget install --id oschwartz10612.Poppler --version 25.07.0-0 --exact --silent --disable-interactivity --accept-package-agreements --accept-source-agreements --location \"$env:RUNNER_TEMP\\poppler\"",
  ].join("\n"));
  const exposeMedia = steps.find((step) => step.name === "Expose real media binaries");
  assert.match(exposeMedia?.run ?? "", /FFMPEG_PATH=.*GITHUB_ENV/s);
  assert.match(exposeMedia?.run ?? "", /FFPROBE_PATH=.*GITHUB_ENV/s);
  assert.match(exposeMedia?.run ?? "", /PDFINFO_BIN=.*GITHUB_ENV/s);
  assert.match(exposeMedia?.run ?? "", /PDFTOPPM_BIN=.*GITHUB_ENV/s);
  assert.match(exposeMedia?.run ?? "", /RUNNER_TEMP.*poppler/s);
  assert.match(exposeMedia?.run ?? "", /Poppler installation did not provide pdfinfo\.exe and pdftoppm\.exe/s);
  assert.match(exposeMedia?.run ?? "", /pdfinfo\.exe is not runnable/s);
  assert.match(exposeMedia?.run ?? "", /pdftoppm\.exe is not runnable/s);
  assert.match(exposeMedia?.run ?? "", /LIBREOFFICE_BIN=.*GITHUB_ENV/s);
  assert.match(exposeMedia?.run ?? "", /GITHUB_PATH/);
  const npmCommands = steps
    .map((step) => step.run)
    .filter((command) => typeof command === "string" && /^npm(?:\s|$)/.test(command));
  assert.deepEqual(npmCommands, ["npm ci", "npm run verify:ci"]);
  const verification = steps.find((step) => step.name === "Run SHA-bound verification");
  assert.equal(verification?.run, "npm run verify:ci");
  assert.equal(verification?.if, undefined);
  assert.equal(verification?.["continue-on-error"], undefined);
  const upload = steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
  assert.equal(upload?.if, "always()");
  assert.equal(upload?.with?.path, ".tmp/verification/development-verification.json");
});

test("the test runner resolves a physical temp root before security-sensitive fixtures", () => {
  const fileSystem = {
    realpathSync: Object.assign(() => "C:\\physical-temp", {
      native: () => "C:\\physical-temp",
    }),
    lstatSync: () => ({ isDirectory: () => true }),
  };
  const tempRoot = resolveCanonicalTestTempRoot({ fileSystem, tempRoot: "D:\\runner-link" });
  assert.equal(tempRoot, "C:\\physical-temp");
  assert.deepEqual(createTestBaseEnv({ env: { EXISTING: "yes" }, tempRoot }), {
    EXISTING: "yes",
    TEMP: tempRoot,
    TMP: tempRoot,
    TMPDIR: tempRoot,
    VITEST_MAX_WORKERS: "1",
  });
  expectSuiteEnv(createSuiteEnv("vitest.db", {
    base: { EXISTING: "yes", MINIMAX_API_KEY: "must-not-leak" },
    providerLedgerRoot: "C:\\repo\\tests\\fixtures\\provider-ledger",
    providerEnvKeys: ["MINIMAX_API_KEY"],
  }));
});

function expectSuiteEnv(env) {
  assert.deepEqual(env, {
    EXISTING: "yes",
    DATABASE_URL: "file:./.tmp/vitest.db",
    SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS: "1",
    SHANHAI_PROVIDER_LEDGER_ROOT: "C:\\repo\\tests\\fixtures\\provider-ledger",
  });
}
