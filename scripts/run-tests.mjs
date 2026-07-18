import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeTestDatabasePath = path.join(root, ".tmp", "node-test-workbench.db");
const vitestDatabaseFamily = "vitest-test-workbench.db";
const providerLedgerFixtureRoot = path.join(root, "tests", "fixtures", "provider-ledger");
const providerLedgerFixtureEnvKeys = readProviderLedgerFixtureEnvKeys(providerLedgerFixtureRoot);
const baseEnv = createTestBaseEnv();
const nodeTestEnv = createSuiteEnv("node-test-workbench.db", { base: baseEnv });

export function runAllTests() {
  run(npxCommand(), ["prisma", "generate"], { shell: process.platform === "win32", env: nodeTestEnv });
  initializeTestDatabase(nodeTestDatabasePath, nodeTestEnv);
  run(process.execPath, createNodeTestArgs(), { env: nodeTestEnv });
  for (const plan of createVitestShardPlans()) {
    const vitestDatabasePath = plan.databasePath;
    const vitestEnv = plan.env;
    initializeTestDatabase(vitestDatabasePath, vitestEnv);
    run(npxCommand(), plan.args, { shell: process.platform === "win32", env: vitestEnv });
  }
}

export function createNodeTestArgs() {
  return ["--test", "--test-concurrency=1", "tests/*.test.mjs"];
}

export function createVitestShardPlans({
  root: repositoryRoot = root,
  base = baseEnv,
  providerLedgerRoot = providerLedgerFixtureRoot,
  providerEnvKeys = providerLedgerFixtureEnvKeys,
  shardCount = 2,
} = {}) {
  if (!Number.isSafeInteger(shardCount) || shardCount < 2 || shardCount > 8) {
    throw new Error("Vitest shardCount must be an integer between 2 and 8.");
  }
  return Array.from({ length: shardCount }, (_, index) => {
    const sequence = index + 1;
    const databaseName = path.parse(vitestDatabaseFamily);
    const databaseFileName = `${databaseName.name}-shard-${sequence}${databaseName.ext}`;
    return Object.freeze({
      sequence,
      databasePath: path.join(repositoryRoot, ".tmp", databaseFileName),
      env: createSuiteEnv(databaseFileName, { base, providerLedgerRoot, providerEnvKeys }),
      args: [
        "vitest",
        "run",
        "--maxWorkers=1",
        "--no-file-parallelism",
        `--shard=${sequence}/${shardCount}`,
      ],
    });
  });
}

export function resolveCanonicalTestTempRoot({ fileSystem = fs, tempRoot = os.tmpdir() } = {}) {
  const nativeRealpath = fileSystem.realpathSync?.native;
  const canonical = typeof nativeRealpath === "function"
    ? nativeRealpath.call(fileSystem.realpathSync, tempRoot)
    : fileSystem.realpathSync(tempRoot);
  const stat = fileSystem.lstatSync(canonical);
  if (!stat.isDirectory()) throw new Error("Test temp root must resolve to a physical directory.");
  return path.resolve(canonical);
}

export function createTestBaseEnv({ env = process.env, tempRoot = resolveCanonicalTestTempRoot() } = {}) {
  return {
    ...env,
    TEMP: tempRoot,
    TMP: tempRoot,
    TMPDIR: tempRoot,
    VITEST_MAX_WORKERS: env.VITEST_MAX_WORKERS ?? "1",
  };
}

function initializeTestDatabase(databasePath, env) {
  fs.rmSync(databasePath, { force: true });
  run(process.execPath, ["scripts/init-sqlite-schema.mjs"], { env });
}

export function createSuiteEnv(databaseFileName, { base = baseEnv, providerLedgerRoot, providerEnvKeys = [] } = {}) {
  const sanitizedBase = { ...base };
  for (const key of providerEnvKeys) delete sanitizedBase[key];
  const providerEnv = providerLedgerRoot ? {
    SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS: "1",
    SHANHAI_PROVIDER_LEDGER_ROOT: providerLedgerRoot,
  } : {};
  return {
    ...sanitizedBase,
    DATABASE_URL: `file:./.tmp/${databaseFileName}`,
    ...providerEnv,
  };
}

function readProviderLedgerFixtureEnvKeys(ledgerRoot) {
  const manifest = JSON.parse(fs.readFileSync(path.join(ledgerRoot, "manifest.json"), "utf8"));
  if (!Array.isArray(manifest.providers)) throw new Error("Provider ledger test fixture is invalid.");
  return [...new Set(manifest.providers.flatMap((provider) =>
    Array.isArray(provider.env_vars) ? provider.env_vars : []))];
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: options.env ?? baseEnv,
    stdio: "inherit",
    shell: options.shell ?? false,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function npxCommand() {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAllTests();
}
