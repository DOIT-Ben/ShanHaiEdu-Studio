import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  V1_9BaselineLockDriftError,
  assertCurrentV1_9BaselineLock,
  compareV1_9BaselineLock,
  createV1_9BaselineLock,
} from "../scripts/lib/v1-9-baseline-lock.mjs";

test("creates a deterministic, non-sensitive baseline lock from main and the configured projection", (t) => {
  const fixture = makeFixture(t);

  const first = createV1_9BaselineLock(fixture.input);
  const second = createV1_9BaselineLock(fixture.input);

  assert.deepEqual(second, first);
  assert.deepEqual(Object.keys(first), [
    "schemaVersion",
    "branch",
    "gitHead",
    "generationIntensity",
    "runtimeSourceDigest",
    "requirementsBaselineDigest",
    "registryDigest",
    "projectionRegistryDigest",
    "providerLedgerManifestDigest",
    "projectionId",
  ]);
  assert.equal(first.schemaVersion, "v1-9-baseline-lock.v1");
  assert.equal(first.branch, "main");
  assert.equal(first.generationIntensity, "standard");
  assert.match(first.gitHead, /^[a-f0-9]{40}$/);
  assert.match(first.runtimeSourceDigest, /^[a-f0-9]{64}$/);
  assert.match(first.requirementsBaselineDigest, /^[a-f0-9]{64}$/);
  assert.match(first.registryDigest, /^[a-f0-9]{64}$/);
  assert.equal(first.projectionRegistryDigest, first.registryDigest);
  assert.match(first.providerLedgerManifestDigest, /^[a-f0-9]{64}$/);
  assert.equal(first.projectionId, "runtime-projection-a23-fixture");

  const serialized = JSON.stringify(first);
  assert.doesNotMatch(serialized, /private|secret|token/i);
  assert.doesNotMatch(serialized, /runtime-projection-root/i);
  assert.doesNotMatch(serialized, /registry:\s*fixture/i);
});

test("runtime source digest includes modified, untracked, and relative-path changes", (t) => {
  const fixture = makeFixture(t);
  const original = createV1_9BaselineLock(fixture.input);

  writeFixtureFile(fixture.repoRoot, "src/app.ts", "export const value = 'modified';\n");
  const modified = createV1_9BaselineLock(fixture.input);
  assert.notEqual(modified.runtimeSourceDigest, original.runtimeSourceDigest);
  assert.equal(modified.gitHead, original.gitHead);

  writeFixtureFile(fixture.repoRoot, "scripts/untracked-runtime.mjs", "export const untracked = true;\n");
  const untracked = createV1_9BaselineLock(fixture.input);
  assert.notEqual(untracked.runtimeSourceDigest, modified.runtimeSourceDigest);
  assert.equal(untracked.gitHead, original.gitHead);

  const oldPath = path.join(fixture.repoRoot, "scripts", "untracked-runtime.mjs");
  const newPath = path.join(fixture.repoRoot, "scripts", "renamed-runtime.mjs");
  renameSync(oldPath, newPath);
  const renamed = createV1_9BaselineLock(fixture.input);
  assert.notEqual(renamed.runtimeSourceDigest, untracked.runtimeSourceDigest);
});

test("runtime source digest freezes root fixtures, config, package manifests, and the actual observer", (t) => {
  const fixture = makeFixture(t);
  const runtimeFiles = [
    "fixtures/ppt/template-a1-original-visual-strategy.md",
    "config/node-contracts/lesson_plan.json",
    "package.json",
    "package-lock.json",
    "tests/e2e/v1-9-unique-real-product.spec.ts",
  ];
  let previous = createV1_9BaselineLock(fixture.input);

  for (const [index, relativePath] of runtimeFiles.entries()) {
    writeFixtureFile(fixture.repoRoot, relativePath, `changed-runtime-input-${index}\n`);
    const current = createV1_9BaselineLock(fixture.input);
    assert.notEqual(current.runtimeSourceDigest, previous.runtimeSourceDigest, relativePath);
    previous = current;
  }
});

test("runtime source digest excludes secrets, private ledgers, dependencies, results, temp, build, and graph output", (t) => {
  const fixture = makeFixture(t);
  const original = createV1_9BaselineLock(fixture.input);

  const excludedFiles = [
    [".env", "API_TOKEN=secret-root\n"],
    ["src/.env.local", "API_TOKEN=secret-src\n"],
    ["API台账系统/PRIVATE-LOCAL-SECRETS/provider.env", "TOKEN=secret-ledger\n"],
    ["node_modules/private-package/index.js", "module.exports = 'secret';\n"],
    ["test-results/v1-9-private/result.json", "{\"secret\":true}\n"],
    [".tmp/private-state.json", "{\"secret\":true}\n"],
    [".next/server/app.js", "generated next output\n"],
    ["build/generated.js", "generated build output\n"],
    ["output/generated.js", "generated output\n"],
    ["graphify-out/graph.json", "generated root graph\n"],
    ["src/graphify-out/graph.json", "generated nested graph\n"],
    ["scripts/build/generated.mjs", "generated nested build\n"],
  ];
  for (const [relativePath, content] of excludedFiles) {
    writeFixtureFile(fixture.repoRoot, relativePath, content);
  }

  const afterExcludedChanges = createV1_9BaselineLock(fixture.input);
  assert.equal(afterExcludedChanges.runtimeSourceDigest, original.runtimeSourceDigest);
  assert.deepEqual(afterExcludedChanges, original);
});

test("requirements, source Registry, projection Registry, and Provider ledger are independently frozen", (t) => {
  const fixture = makeFixture(t);
  const original = createV1_9BaselineLock(fixture.input);

  writeFixtureFile(
    fixture.repoRoot,
    "docs/product/current-requirements-baseline.md",
    "# Updated requirements baseline\n",
  );
  const requirementsChanged = createV1_9BaselineLock(fixture.input);
  assert.notEqual(requirementsChanged.requirementsBaselineDigest, original.requirementsBaselineDigest);
  assert.equal(requirementsChanged.runtimeSourceDigest, original.runtimeSourceDigest);
  assert.equal(requirementsChanged.registryDigest, original.registryDigest);

  const updatedRegistry = "schemaVersion: registry.v2\nsecret: must-not-leak\n";
  writeFixtureFile(fixture.sourceSkillsRoot, "shanhai-suite/assets/registry.yaml", updatedRegistry);
  writeFixtureFile(fixture.projectionRoot, "shanhai-suite/assets/registry.yaml", updatedRegistry);
  const registryChanged = createV1_9BaselineLock(fixture.input);
  assert.notEqual(registryChanged.registryDigest, requirementsChanged.registryDigest);
  assert.notEqual(registryChanged.projectionRegistryDigest, requirementsChanged.projectionRegistryDigest);
  assert.equal(registryChanged.projectionRegistryDigest, registryChanged.registryDigest);
  assert.equal(registryChanged.runtimeSourceDigest, original.runtimeSourceDigest);
  assert.equal(registryChanged.requirementsBaselineDigest, requirementsChanged.requirementsBaselineDigest);
  assert.equal(registryChanged.projectionId, "runtime-projection-a23-fixture");
  assert.doesNotMatch(JSON.stringify(registryChanged), /must-not-leak/);

  writeFixtureFile(fixture.sourceSkillsRoot, "shanhai-suite/assets/registry.yaml", "schemaVersion: registry.v3\n");
  assert.throws(
    () => createV1_9BaselineLock(fixture.input),
    (error) => error?.reasonCode === "v1_9_baseline_registry_projection_mismatch",
  );

  writeFixtureFile(fixture.sourceSkillsRoot, "shanhai-suite/assets/registry.yaml", updatedRegistry);
  writeFixtureFile(fixture.repoRoot, "API台账系统/manifest.json", "{\"version\":2}\n");
  const providerLedgerChanged = createV1_9BaselineLock(fixture.input);
  assert.notEqual(providerLedgerChanged.providerLedgerManifestDigest, registryChanged.providerLedgerManifestDigest);
  assert.equal(providerLedgerChanged.runtimeSourceDigest, registryChanged.runtimeSourceDigest);
  assert.equal(providerLedgerChanged.registryDigest, registryChanged.registryDigest);
});

test("rejects a projection alias or a projection not owned by the configured source dist", (t) => {
  const fixture = makeFixture(t);

  assert.throws(
    () => createV1_9BaselineLock({
      cwd: fixture.repoRoot,
      env: {
        SHANHAI_SKILLS_SOURCE_ROOT: fixture.projectionRoot,
        SHANHAI_SKILLS_RUNTIME_ROOT: fixture.projectionRoot,
      },
    }),
    (error) => error?.reasonCode === "v1_9_baseline_source_projection_alias",
  );

  const foreignProjectionRoot = path.join(fixture.fixtureRoot, "foreign", "runtime-projection-a23-foreign");
  writeFixtureFile(
    foreignProjectionRoot,
    "shanhai-suite/assets/registry.yaml",
    "schemaVersion: registry.v1\nname: fixture\n",
  );
  assert.throws(
    () => createV1_9BaselineLock({
      cwd: fixture.repoRoot,
      env: {
        SHANHAI_SKILLS_SOURCE_ROOT: fixture.sourceSkillsRoot,
        SHANHAI_SKILLS_RUNTIME_ROOT: foreignProjectionRoot,
      },
    }),
    (error) => error?.reasonCode === "v1_9_baseline_projection_not_owned_by_source",
  );
});

test("rejects a runtime source symlink, junction, or reparse redirect", (t) => {
  const fixture = makeFixture(t);
  const externalRuntimeRoot = path.join(fixture.fixtureRoot, "external-runtime");
  writeFixtureFile(externalRuntimeRoot, "runtime.ts", "export const external = true;\n");
  symlinkSync(
    externalRuntimeRoot,
    path.join(fixture.repoRoot, "src", "linked-runtime"),
    process.platform === "win32" ? "junction" : "dir",
  );

  assert.throws(
    () => createV1_9BaselineLock(fixture.input),
    (error) => {
      assert.equal(error?.message, "v1_9_baseline_runtime_source_invalid");
      assert.equal(error?.reasonCode, "v1_9_baseline_runtime_source_invalid");
      assert.doesNotMatch(String(error), /external-runtime|linked-runtime|Users|private/i);
      return true;
    },
  );
});

test("rejects any branch other than main with a stable, sanitized error", (t) => {
  const fixture = makeFixture(t);
  git(fixture.repoRoot, "switch", "-c", "feature/private-branch");

  assert.throws(
    () => createV1_9BaselineLock(fixture.input),
    (error) => {
      assert.equal(error?.message, "v1_9_baseline_branch_invalid");
      assert.equal(error?.reasonCode, "v1_9_baseline_branch_invalid");
      assert.doesNotMatch(String(error), /feature|private/i);
      return true;
    },
  );
});

test("compares a frozen lock and fails closed on current baseline drift", (t) => {
  const fixture = makeFixture(t);
  const frozen = createV1_9BaselineLock(fixture.input);

  assert.deepEqual(compareV1_9BaselineLock(frozen, frozen), {
    isCurrent: true,
    driftedFields: [],
  });
  assert.deepEqual(assertCurrentV1_9BaselineLock(frozen, fixture.input), frozen);

  writeFixtureFile(fixture.repoRoot, "src/new-runtime.ts", "export const newRuntime = true;\n");
  const current = createV1_9BaselineLock(fixture.input);
  assert.deepEqual(compareV1_9BaselineLock(frozen, current), {
    isCurrent: false,
    driftedFields: ["runtimeSourceDigest"],
  });
  assert.throws(
    () => assertCurrentV1_9BaselineLock(frozen, fixture.input),
    (error) => {
      assert.ok(error instanceof V1_9BaselineLockDriftError);
      assert.equal(error.message, "v1_9_baseline_lock_drift");
      assert.equal(error.reasonCode, "v1_9_baseline_lock_drift");
      assert.deepEqual(error.driftedFields, ["runtimeSourceDigest"]);
      assert.doesNotMatch(String(error), /new-runtime|private|secret|token/i);
      return true;
    },
  );
});

function makeFixture(t) {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "shanhai-v1-9-baseline-"));
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  const repoRoot = path.join(fixtureRoot, "repo");
  const sourceSkillsRoot = path.join(fixtureRoot, "skill-source");
  const projectionRoot = path.join(sourceSkillsRoot, "dist", "runtime-projection-a23-fixture");
  mkdirSync(repoRoot, { recursive: true });

  const runtimeFiles = [
    ["src/app.ts", "export const value = 'fixture';\n"],
    ["scripts/run.mjs", "export const run = true;\n"],
    ["prisma/schema.prisma", "datasource db { provider = \"sqlite\" url = \"file:fixture.db\" }\n"],
    ["config/node-contracts/lesson_plan.json", "{\"schemaVersion\":\"fixture\"}\n"],
    ["fixtures/ppt/template-a1-original-visual-strategy.md", "fixture prompt template\n"],
    ["public/brand/logo.txt", "fixture-logo\n"],
    ["tests/e2e/v1-9-unique-real-product.spec.ts", "export const observer = true;\n"],
    ["package.json", "{\"name\":\"fixture\",\"private\":true}\n"],
    ["package-lock.json", "{\"name\":\"fixture\",\"lockfileVersion\":3}\n"],
    ["tsconfig.json", "{\"compilerOptions\":{}}\n"],
    ["next-env.d.ts", "/// <reference types=\"next\" />\n"],
    ["next.config.ts", "export default { output: 'standalone' };\n"],
    ["playwright.config.ts", "export default { workers: 1 };\n"],
    ["vitest.config.ts", "export default { test: { maxWorkers: 1 } };\n"],
    ["postcss.config.mjs", "export default {};\n"],
    ["prisma.config.ts", "export default {};\n"],
    ["electron-builder.config.cjs", "module.exports = {};\n"],
    ["Dockerfile", "FROM scratch\n"],
    [".dockerignore", "node_modules\n"],
    ["docs/product/current-requirements-baseline.md", "# Requirements baseline\n"],
    ["API台账系统/manifest.json", "{\"version\":1}\n"],
  ];
  for (const [relativePath, content] of runtimeFiles) writeFixtureFile(repoRoot, relativePath, content);
  writeFixtureFile(
    sourceSkillsRoot,
    "shanhai-suite/assets/registry.yaml",
    "schemaVersion: registry.v1\nname: fixture\n",
  );
  writeFixtureFile(
    projectionRoot,
    "shanhai-suite/assets/registry.yaml",
    "schemaVersion: registry.v1\nname: fixture\n",
  );

  git(repoRoot, "init", "--initial-branch=main");
  git(repoRoot, "add", ".");
  git(
    repoRoot,
    "-c",
    "user.name=ShanHai Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "-m",
    "fixture baseline",
  );

  return {
    fixtureRoot,
    repoRoot,
    sourceSkillsRoot,
    projectionRoot,
    input: {
      cwd: repoRoot,
      env: {
        SHANHAI_SKILLS_RUNTIME_ROOT: projectionRoot,
        SHANHAI_SKILLS_SOURCE_ROOT: sourceSkillsRoot,
      },
    },
  };
}

function writeFixtureFile(root, relativePath, content) {
  const filePath = path.join(root, ...relativePath.split("/"));
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf8");
}

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
