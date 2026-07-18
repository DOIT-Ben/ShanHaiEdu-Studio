import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
  const outputPath = ".tmp/verification/failed.json";
  await assert.rejects(() => runVerification({
    root,
    policy: verificationPolicy(),
    outputPath,
    requireClean: false,
    collectSubject: async () => subject(),
    runCommand: async ({ id }) => ({ id, exitCode: id === "test" ? 1 : 0, durationMs: 1, outputSha256: "a".repeat(64) }),
  }), /test.*failed/i);
  assert.equal(existsSync(path.join(root, ...outputPath.split("/"))), false);
});

test("verification runner writes only the complete required check set", async () => {
  const root = fixtureRoot();
  const outputPath = ".tmp/verification/success.json";
  await runVerification({
    root,
    policy: verificationPolicy(),
    outputPath,
    requireClean: false,
    collectSubject: async () => subject(),
    runCommand: async ({ id }) => ({ id, exitCode: 0, durationMs: 1, outputSha256: "a".repeat(64) }),
  });
  const manifest = JSON.parse(readFileSync(path.join(root, ...outputPath.split("/")), "utf8"));
  assert.deepEqual(manifest.checks.map((check) => check.id), ["gate", "test"]);
  assert.equal(manifest.subject.headSha, "b".repeat(40));
  assert.equal(manifest.subject.dirty, true);
});

test("verification runner rejects unsafe output before deleting any existing file", async () => {
  const root = fixtureRoot();
  const protectedPath = path.join(root, "protected.txt");
  writeFileSync(protectedPath, "keep\n");
  const input = {
    root,
    policy: verificationPolicy(),
    collectSubject: async () => subject(),
    runCommand: async ({ id }) => ({ id, exitCode: 0, durationMs: 1, outputSha256: "a".repeat(64) }),
  };
  await assert.rejects(() => runVerification({ ...input, outputPath: "protected.txt" }), /\.tmp\/verification/i);
  await assert.rejects(() => runVerification({ ...input, outputPath: protectedPath }), /unsafe/i);
  assert.equal(readFileSync(protectedPath, "utf8"), "keep\n");

  const unsafeParent = path.join(root, ".tmp", "verification");
  writeFileSync(path.join(root, ".tmp"), "not-a-directory\n");
  await assert.rejects(() => runVerification({ ...input, outputPath: ".tmp/verification/result.json" }), /parent.*unsafe/i);
  assert.equal(existsSync(unsafeParent), false);
});

test("verification runner rejects a directory target without deleting its contents", async () => {
  const root = fixtureRoot();
  const target = path.join(root, ".tmp", "verification", "result.json");
  mkdirSync(target, { recursive: true });
  writeFileSync(path.join(target, "keep.txt"), "keep\n");
  await assert.rejects(() => runVerification({
    root,
    policy: verificationPolicy(),
    outputPath: ".tmp/verification/result.json",
    collectSubject: async () => subject(),
    runCommand: successfulCommand,
  }), /target.*unsafe/i);
  assert.equal(readFileSync(path.join(target, "keep.txt"), "utf8"), "keep\n");
});

test("verification runner refuses a parent junction introduced while checks run", async (t) => {
  const fixture = junctionFixture(t);
  if (!fixture) return;
  const { root, outside, parent } = fixture;
  await assert.rejects(() => runVerification({
    root,
    policy: verificationPolicy(),
    outputPath: ".tmp/verification/result.json",
    collectSubject: async () => subject(),
    runCommand: async ({ id }) => {
      replaceWithDirectoryLink(parent, outside);
      return successfulCommand({ id });
    },
  }), /parent.*unsafe/i);
  assert.equal(readFileSync(path.join(outside, "keep.txt"), "utf8"), "keep\n");
  assert.equal(existsSync(path.join(outside, "result.json")), false);
});

test("verification runner refuses cleanup through a parent junction introduced by a failed check", async (t) => {
  const fixture = junctionFixture(t);
  if (!fixture) return;
  const { root, outside, parent } = fixture;
  await assert.rejects(() => runVerification({
    root,
    policy: verificationPolicy(),
    outputPath: ".tmp/verification/result.json",
    collectSubject: async () => subject(),
    runCommand: async ({ id }) => {
      replaceWithDirectoryLink(parent, outside);
      return { ...(await successfulCommand({ id })), exitCode: 1 };
    },
  }), /unsafe/i);
  assert.equal(readFileSync(path.join(outside, "keep.txt"), "utf8"), "keep\n");
  assert.equal(existsSync(path.join(outside, "result.json")), false);
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

function junctionFixture(t) {
  const root = fixtureRoot();
  const outside = fixtureRoot();
  const parent = path.join(root, ".tmp", "verification");
  mkdirSync(parent, { recursive: true });
  writeFileSync(path.join(outside, "keep.txt"), "keep\n");
  const probe = path.join(root, "junction-probe");
  try {
    symlinkSync(outside, probe, process.platform === "win32" ? "junction" : "dir");
    rmSync(probe, { force: true });
  } catch (error) {
    if (error?.code === "EPERM" || error?.code === "EACCES" || error?.code === "ENOTSUP") {
      t.skip(`directory links unavailable: ${error.code}`);
      return null;
    }
    throw error;
  }
  return { root, outside, parent };
}

function replaceWithDirectoryLink(parent, outside) {
  rmSync(parent, { recursive: true, force: true });
  symlinkSync(outside, parent, process.platform === "win32" ? "junction" : "dir");
}

async function successfulCommand({ id }) {
  return { id, exitCode: 0, durationMs: 1, outputSha256: "a".repeat(64) };
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
