import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testRunToken = `${process.pid}-${Date.now().toString(36)}`;
const testDotenvPath = path.join(root, ".tmp", `test-dotenv-${testRunToken}.env`);
const testDatabaseFamily = "test-workbench.db";
const providerLedgerFixtureRoot = path.join(root, "tests", "fixtures", "provider-ledger");
const providerLedgerFixtureEnvKeys = readProviderLedgerFixtureEnvKeys(providerLedgerFixtureRoot);
const baseEnv = { ...createTestBaseEnv(), DOTENV_CONFIG_PATH: testDotenvPath };

export function runAllTests({
  runCommand = run,
  initializeDatabase = initializeTestDatabase,
  cleanupDatabase = removeTestDatabaseFamily,
} = {}) {
  fs.mkdirSync(path.dirname(testDotenvPath), { recursive: true });
  fs.writeFileSync(testDotenvPath, "", { flag: "wx" });
  try { return runTestSuites({ runCommand, initializeDatabase, cleanupDatabase }); }
  finally { fs.rmSync(testDotenvPath, { force: true }); }
}

function runTestSuites({ runCommand, initializeDatabase, cleanupDatabase }) {
  const nodePlan = createNodeTestPlan({ runToken: testRunToken });
  runCommand(npxCommand(), ["prisma", "generate"], {
    shell: process.platform === "win32",
    env: nodePlan.env,
  });
  try {
    initializeDatabase(nodePlan.databasePath, nodePlan.env);
    runCommand(process.execPath, createNodeTestArgs(), { env: nodePlan.env });
  } finally {
    cleanupDatabase(nodePlan.databasePath);
  }
  for (const plan of createVitestShardPlans({ runToken: testRunToken })) {
    const vitestDatabasePath = plan.databasePath;
    const vitestEnv = plan.env;
    try {
      initializeDatabase(vitestDatabasePath, vitestEnv);
      runCommand(npxCommand(), plan.args, { shell: process.platform === "win32", env: vitestEnv });
    } finally {
      cleanupDatabase(vitestDatabasePath);
    }
  }
}

export function createNodeTestArgs() {
  return ["--test", "--test-concurrency=1", "tests/*.test.mjs"];
}

export function createNodeTestPlan({
  root: repositoryRoot = root,
  base = baseEnv,
  providerEnvKeys = providerLedgerFixtureEnvKeys,
  runToken = testRunToken,
} = {}) {
  const databaseFileName = createTestDatabaseFileName({ runToken, role: "node" });
  return Object.freeze({
    databasePath: path.join(repositoryRoot, ".tmp", databaseFileName),
    env: createSuiteEnv(databaseFileName, {
      base,
      providerLedgerRoot: null,
      providerEnvKeys,
    }),
  });
}

export function createVitestShardPlans({
  root: repositoryRoot = root,
  base = baseEnv,
  providerLedgerRoot = providerLedgerFixtureRoot,
  providerEnvKeys = providerLedgerFixtureEnvKeys,
  shardCount = 2,
  runToken = null,
} = {}) {
  if (!Number.isSafeInteger(shardCount) || shardCount < 2 || shardCount > 8) {
    throw new Error("Vitest shardCount must be an integer between 2 and 8.");
  }
  if (runToken !== null && !/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(runToken)) {
    throw new Error("Vitest runToken must be a safe identifier.");
  }
  return Array.from({ length: shardCount }, (_, index) => {
    const sequence = index + 1;
    const databaseFileName = createTestDatabaseFileName({
      runToken,
      role: `vitest-shard-${sequence}`,
    });
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
    VITEST_MAX_WORKERS: "1",
  };
}

function createTestDatabaseFileName({ runToken, role }) {
  if (runToken !== null && !/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(runToken)) {
    throw new Error("Test runToken must be a safe identifier.");
  }
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(role)) {
    throw new Error("Test database role must be a safe identifier.");
  }
  const databaseName = path.parse(testDatabaseFamily);
  const tokenSuffix = runToken === null ? "" : `-${runToken}`;
  return `${databaseName.name}${tokenSuffix}-${role}${databaseName.ext}`;
}

function initializeTestDatabase(databasePath, env) {
  removeTestDatabaseFamily(databasePath);
  run(process.execPath, ["scripts/init-sqlite-schema.mjs"], { env });
}

export function removeTestDatabaseFamily(databasePath, { fileSystem = fs } = {}) {
  for (const candidate of [`${databasePath}-wal`, `${databasePath}-shm`, databasePath]) {
    fileSystem.rmSync(candidate, { force: true });
  }
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
    const error = new Error(`Test command failed with exit code ${result.status ?? 1}.`);
    error.exitCode = result.status ?? 1;
    throw error;
  }
}

function npxCommand() {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAllTests();
}
