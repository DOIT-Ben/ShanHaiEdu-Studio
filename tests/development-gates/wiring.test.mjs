import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import YAML from "yaml";

import {
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

test("quality-gates workflow calls the repository CI entry without a success bypass", () => {
  const workflowPath = path.join(process.cwd(), ".github", "workflows", "quality-gates.yml");
  const workflow = YAML.parse(readFileSync(workflowPath, "utf8"));
  const job = workflow.jobs?.["quality-gates"];
  assert.equal(job?.["runs-on"], "windows-latest");
  assert.equal(job?.["continue-on-error"], undefined);
  const commands = (job?.steps ?? []).map((step) => step.run).filter(Boolean);
  assert.deepEqual(commands, ["npm ci", "npm run verify:ci"]);
  const upload = (job?.steps ?? []).find((step) => step.uses?.startsWith("actions/upload-artifact@"));
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
});
