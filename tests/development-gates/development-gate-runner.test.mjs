import assert from "node:assert/strict";
import { test } from "node:test";

import { runDevelopmentGates } from "../../scripts/development-gates/run-development-gates.mjs";

test("development runner executes every static gate and skips live evidence only when no sensitive path changed", async () => {
  const calls = [];
  const result = await runDevelopmentGates({
    runSubgate: async (id) => { calls.push(id); return { ok: true }; },
    detectImpact: () => ({ impacted: false, matchedPaths: [] }),
    verifyProvider: () => { throw new Error("must not run"); },
  });
  assert.deepEqual(calls, ["policy", "stage-paths", "source-contracts", "complexity"]);
  assert.equal(result.provider.status, "not-required");
});

test("development runner accepts only the exact bootstrap deferred status", async () => {
  const result = await runDevelopmentGates({
    runSubgate: async () => ({ ok: true }),
    detectImpact: () => ({ impacted: true, matchedPaths: ["config/development-gates.json"] }),
    verifyProvider: () => ({ ok: false, passed: false, status: "deferred_bootstrap" }),
  });
  assert.equal(result.provider.status, "deferred_bootstrap");

  const captureResult = await runDevelopmentGates({
    runSubgate: async () => ({ ok: true }),
    detectImpact: () => ({ impacted: true, matchedPaths: ["src/server/gpt-protocol/openai-responses-adapter.ts"] }),
    verifyProvider: () => ({ ok: false, passed: false, status: "deferred_capture_bootstrap" }),
  });
  assert.equal(captureResult.status, "passed-with-capture-bootstrap-defer");
  assert.equal(captureResult.provider.status, "deferred_capture_bootstrap");
  assert.equal(captureResult.provider.passed, false);

  const refactorResult = await runDevelopmentGates({
    runSubgate: async () => ({ ok: true }),
    detectImpact: () => ({ impacted: true, matchedPaths: ["src/server/conversation/turn.ts"] }),
    verifyProvider: () => ({ ok: false, passed: false, status: "deferred_provider_validation_during_offline_refactor" }),
  });
  assert.equal(refactorResult.status, "passed-with-offline-refactor-defer");
  assert.equal(refactorResult.provider.passed, false);

  await assert.rejects(() => runDevelopmentGates({
    runSubgate: async () => ({ ok: true }),
    detectImpact: () => ({ impacted: true, matchedPaths: ["src/server/tools/provider.ts"] }),
    verifyProvider: () => ({ ok: false, passed: false, status: "deferred" }),
  }), /Provider continuity/i);
});

test("development runner fails when any static subgate fails", async () => {
  await assert.rejects(() => runDevelopmentGates({
    runSubgate: async (id) => ({ ok: id !== "complexity" }),
    detectImpact: () => ({ impacted: false }),
    verifyProvider: () => ({ ok: true }),
  }), /complexity/i);
});
