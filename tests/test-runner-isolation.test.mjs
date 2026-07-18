import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  createNodeTestPlan,
  createTestBaseEnv,
  createVitestShardPlans,
  runAllTests,
} from "../scripts/run-tests.mjs";

test("the full test runner uses one SQLite family with isolated role files", () => {
  const root = path.resolve("test-runner-fixture");
  const base = createTestBaseEnv({
    env: { VITEST_MAX_WORKERS: "99", REAL_PROVIDER_KEY: "must-not-leak" },
    tempRoot: path.parse(root).root,
  });
  const node = createNodeTestPlan({
    root,
    base,
    providerEnvKeys: ["REAL_PROVIDER_KEY"],
    runToken: "run-1",
  });
  const vitest = createVitestShardPlans({
    root,
    base,
    providerEnvKeys: ["REAL_PROVIDER_KEY"],
    providerLedgerRoot: path.join(root, "provider-ledger"),
    runToken: "run-1",
  });

  assert.equal(path.basename(node.databasePath), "test-workbench-run-1-node.db");
  assert.deepEqual(vitest.map((plan) => path.basename(plan.databasePath)), [
    "test-workbench-run-1-vitest-shard-1.db",
    "test-workbench-run-1-vitest-shard-2.db",
  ]);
  assert.equal(node.env.VITEST_MAX_WORKERS, "1");
  assert.equal(node.env.REAL_PROVIDER_KEY, undefined);
  assert.equal(node.env.SHANHAI_PROVIDER_LEDGER_ROOT, undefined);
  assert.equal(vitest[0].env.REAL_PROVIDER_KEY, undefined);
});

test("the full test runner cleans the Node database after a child failure", () => {
  const initialized = [];
  const cleaned = [];
  let commandCount = 0;

  assert.throws(() => runAllTests({
    runCommand: () => {
      commandCount += 1;
      if (commandCount === 2) throw new Error("simulated_node_test_failure");
    },
    initializeDatabase: (databasePath) => initialized.push(databasePath),
    cleanupDatabase: (databasePath) => cleaned.push(databasePath),
  }), /simulated_node_test_failure/);

  assert.equal(initialized.length, 1);
  assert.deepEqual(cleaned, initialized);
});
