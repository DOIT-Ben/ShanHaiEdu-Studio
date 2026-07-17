import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../scripts/run-tests.mjs", import.meta.url), "utf8");

test("the full test runner isolates Node contracts from Vitest state", () => {
  assert.match(source, /node-test-workbench\.db/);
  assert.match(source, /vitest-test-workbench\.db/);
  assert.match(source, /initializeTestDatabase\(nodeTestDatabasePath, nodeTestEnv\)/);
  assert.match(source, /initializeTestDatabase\(vitestDatabasePath, vitestEnv\)/);
  assert.doesNotMatch(source, /DATABASE_URL:\s*"file:\.\/\.tmp\/test-workbench\.db"/);
});
