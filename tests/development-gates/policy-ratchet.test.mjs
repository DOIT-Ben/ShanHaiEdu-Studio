import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import {
  assertPolicyRatchet,
  verifyBoundContracts,
} from "../../scripts/development-gates/policy-ratchet.mjs";

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("policy ratchet rejects relaxed thresholds and debt growth", () => {
  const previous = policy();
  const relaxed = structuredClone(previous);
  relaxed.complexity.maxFileLines = 600;
  assert.throws(() => assertPolicyRatchet(previous, relaxed), /maxFileLines/i);

  const grown = structuredClone(previous);
  grown.complexity.baseline[0].lines += 1;
  assert.throws(() => assertPolicyRatchet(previous, grown), /complexity debt/i);

  const newDebt = structuredClone(previous);
  newDebt.sourceStringContracts.baseline.push({ path: "tests/new.test.mjs", occurrences: 1 });
  assert.throws(() => assertPolicyRatchet(previous, newDebt), /source string debt/i);
});

test("policy ratchet rejects weaker Provider evidence and larger lint allowance", () => {
  const previous = policy();
  const fewerRuns = structuredClone(previous);
  fewerRuns.providerContinuity.developmentConsecutiveRuns = 2;
  assert.throws(() => assertPolicyRatchet(previous, fewerRuns), /consecutive/i);

  const olderEvidence = structuredClone(previous);
  olderEvidence.providerContinuity.maxAgeHours = 336;
  assert.throws(() => assertPolicyRatchet(previous, olderEvidence), /maxAgeHours/i);

  const missingSensitiveBoundary = structuredClone(previous);
  missingSensitiveBoundary.providerContinuity.sensitivePaths = [];
  assert.throws(() => assertPolicyRatchet(previous, missingSensitiveBoundary), /sensitive paths/i);

  const moreWarnings = structuredClone(previous);
  moreWarnings.lint.maxWarnings = 151;
  assert.throws(() => assertPolicyRatchet(previous, moreWarnings), /lint/i);
});

test("bound contract verification rejects tampering and path escape", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "shanhai-policy-"));
  roots.push(root);
  mkdirSync(path.join(root, "docs"));
  writeFileSync(path.join(root, "docs", "contract.md"), "contract\n");
  const bound = [{
    path: "docs/contract.md",
    sha256: createHash("sha256").update("contract\n").digest("hex")
  }];
  assert.doesNotThrow(() => verifyBoundContracts(root, bound));
  writeFileSync(path.join(root, "docs", "contract.md"), "tampered\n");
  assert.throws(() => verifyBoundContracts(root, bound), /contract hash/i);
  assert.throws(() => verifyBoundContracts(root, [{ path: "../outside", sha256: "a".repeat(64) }]), /unsafe/i);
});

function policy() {
  return {
    complexity: {
      maxFileLines: 500,
      maxFunctionLines: 150,
      excludedPaths: ["src/generated/**"],
      baseline: [{ path: "src/large.ts", lines: 600, violatingFunctions: 1, maxFunctionLines: 200, totalFunctionLines: 200 }],
    },
    sourceStringContracts: {
      excludedPaths: ["tests/fixtures/**"],
      baseline: [{ path: "tests/legacy.test.mjs", occurrences: 2 }],
    },
    lint: { maxWarnings: 150 },
    providerContinuity: {
      sensitivePaths: ["src/server/**"],
      maxAgeHours: 168,
      developmentConsecutiveRuns: 3,
      releaseConsecutiveRuns: 5,
      forbiddenModes: ["mock", "fallback", "degraded", "placeholder"],
      requiredScenarios: [{ id: "one" }],
    },
  };
}
