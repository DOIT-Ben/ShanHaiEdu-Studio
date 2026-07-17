import assert from "node:assert/strict";
import { test } from "node:test";

import { runReleaseGate } from "../../scripts/development-gates/release-gate.mjs";

test("release gate rejects a dirty candidate before any release command", async () => {
  let commandCalled = false;
  await assert.rejects(() => runReleaseGate({
    subject: { dirty: true },
    verifyManifest: () => ({ ok: true }),
    verifyProvider: () => ({ ok: true }),
    runCommand: async () => { commandCalled = true; return { exitCode: 0 }; },
  }), /clean candidate/i);
  assert.equal(commandCalled, false);
});

test("release gate fails closed when Provider continuity evidence is unavailable", async () => {
  await assert.rejects(() => runReleaseGate({
    subject: { dirty: false },
    verifyManifest: () => ({ ok: true }),
    verifyProvider: () => { throw new Error("receipt missing"); },
    runCommand: async () => ({ exitCode: 0 }),
  }), /receipt missing/i);
});

test("release gate runs production preflight and desktop smoke only after evidence verifies", async () => {
  const commands = [];
  const result = await runReleaseGate({
    subject: { dirty: false },
    verifyManifest: () => ({ ok: true }),
    verifyProvider: () => ({ ok: true, consecutiveRuns: 5 }),
    runCommand: async (command) => { commands.push(command.id); return { exitCode: 0 }; },
  });
  assert.deepEqual(commands, ["production-preflight", "desktop-smoke"]);
  assert.deepEqual(result, { ok: true, providerConsecutiveRuns: 5 });
});
