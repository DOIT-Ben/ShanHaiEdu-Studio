import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { executeCommand, runVerification } from "../../scripts/development-gates/run-verification.mjs";

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("verification runner does not write a success manifest when a required command fails", async () => {
  const root = fixtureRoot();
  const outputPath = path.join(root, ".tmp", "verification.json");
  await assert.rejects(() => runVerification({
    root,
    policy: verificationPolicy(),
    outputPath,
    requireClean: false,
    collectSubject: async () => subject(),
    runCommand: async ({ id }) => ({ id, exitCode: id === "test" ? 1 : 0, durationMs: 1, outputSha256: "a".repeat(64) }),
  }), /test.*failed/i);
  assert.equal(existsSync(outputPath), false);
});

test("verification runner writes only the complete required check set", async () => {
  const root = fixtureRoot();
  const outputPath = path.join(root, ".tmp", "verification.json");
  await runVerification({
    root,
    policy: verificationPolicy(),
    outputPath,
    requireClean: false,
    collectSubject: async () => subject(),
    runCommand: async ({ id }) => ({ id, exitCode: 0, durationMs: 1, outputSha256: "a".repeat(64) }),
  });
  const manifest = JSON.parse(readFileSync(outputPath, "utf8"));
  assert.deepEqual(manifest.checks.map((check) => check.id), ["gate", "test"]);
  assert.equal(manifest.subject.headSha, "b".repeat(40));
  assert.equal(manifest.subject.dirty, true);
});

test("npm checks run through the current npm CLI with Node instead of spawning npm.cmd directly", async () => {
  const root = fixtureRoot();
  const npmCli = path.join(root, "npm-cli-fixture.cjs");
  writeFileSync(npmCli, "process.stdout.write('npm-cli-ok');\n");
  const previous = process.env.npm_execpath;
  process.env.npm_execpath = npmCli;
  try {
    const result = await executeCommand({ id: "npm-check", program: "npm", args: [] }, root);
    assert.equal(result.exitCode, 0);
    assert.match(result.outputSha256, /^[a-f0-9]{64}$/);
  } finally {
    if (previous === undefined) delete process.env.npm_execpath;
    else process.env.npm_execpath = previous;
  }
});

function fixtureRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), "shanhai-verification-"));
  roots.push(root);
  return root;
}

function verificationPolicy() {
  return {
    schemaVersion: "shanhai-development-gates.v1",
    verification: {
      requiredChecks: [
        { id: "gate", program: "node", args: ["gate.mjs"] },
        { id: "test", program: "npm", args: ["test"] },
      ],
    },
  };
}

function subject() {
  return {
    headSha: "b".repeat(40),
    treeSha: "c".repeat(40),
    workingTreeDigest: "d".repeat(64),
    dirty: true,
    policySha256: "e".repeat(64),
    stageSha256: "f".repeat(64),
  };
}
