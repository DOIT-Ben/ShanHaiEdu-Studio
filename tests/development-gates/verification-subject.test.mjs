import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { collectGitSubject, runVerification } from "../../scripts/development-gates/run-verification.mjs";
import { collectVerificationSubject } from "../../scripts/development-gates/verification-manifest.mjs";
import { collectGitVerificationSubject } from "../../scripts/development-gates/verification-subject.mjs";

test("verification subject hashes working tree content independently of Git staging state", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "shanhai-verification-subject-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "config"), { recursive: true });
  mkdirSync(path.join(root, "docs", "stages"), { recursive: true });
  writeFileSync(path.join(root, "config", "development-gates.json"), "{}\n");
  writeFileSync(path.join(root, "docs", "stages", "active-stage.json"), "{}\n");
  writeFileSync(path.join(root, "tracked.txt"), "baseline\n");
  git(root, "init", "--quiet");
  git(root, "config", "user.email", "verification@example.invalid");
  git(root, "config", "user.name", "Verification Test");
  git(root, "config", "core.autocrlf", "false");
  git(root, "add", "--", ".");
  git(root, "commit", "--quiet", "-m", "fixture");

  writeFileSync(path.join(root, "tracked.txt"), "changed\n");
  writeFileSync(path.join(root, "untracked.txt"), "new\n");
  const beforeStage = collectGitVerificationSubject(root);
  assert.deepEqual(await collectGitSubject(root), beforeStage);
  assert.deepEqual(collectVerificationSubject(root), beforeStage);

  git(root, "add", "--", "tracked.txt", "untracked.txt");
  const afterStage = collectGitVerificationSubject(root);
  assert.equal(afterStage.workingTreeDigest, beforeStage.workingTreeDigest);
  assert.equal(afterStage.dirty, true);

  writeFileSync(path.join(root, "untracked.txt"), "changed after staging\n");
  const changedContent = collectGitVerificationSubject(root);
  assert.notEqual(changedContent.workingTreeDigest, afterStage.workingTreeDigest);

  await assert.rejects(() => runVerification({
    root,
    policy: { verification: { requiredChecks: [{ id: "gate", program: "node", args: ["gate.mjs"] }] } },
    outputPath: ".tmp/verification/test.json",
    runCommand: async ({ id }) => ({ id, exitCode: 0, durationMs: 1, outputSha256: "a".repeat(64) }),
  }), /subject changed/i);
  assert.equal(existsSync(path.join(root, ".tmp", "verification", "test.json")), false);
});

function git(root, ...args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
