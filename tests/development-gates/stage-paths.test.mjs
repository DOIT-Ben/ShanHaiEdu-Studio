import assert from "node:assert/strict";
import { test } from "node:test";

import {
  validateStageContract,
  verifyStagePaths,
} from "../../scripts/development-gates/stage-paths.mjs";

test("stage contract rejects unsafe paths, duplicate paths, and invalid budgets", () => {
  const unsafe = stageContract();
  unsafe.allowedPaths = ["src/**", "../outside"];
  assert.throws(() => validateStageContract(unsafe), /unsafe.*allowedPaths/i);

  const duplicate = stageContract();
  duplicate.allowedPaths = ["src/**", "SRC/**"];
  assert.throws(() => validateStageContract(duplicate), /duplicate.*allowedPaths/i);

  const invalidBudget = stageContract();
  invalidBudget.budgets.maxChangedFiles = -1;
  assert.throws(() => validateStageContract(invalidBudget), /maxChangedFiles/i);
});

test("stage path gate accepts only allowlisted changes inside every budget", () => {
  const result = verifyStagePaths({
    stage: stageContract(),
    changes: [
      { path: "src/feature.ts", addedLines: 20, deletedLines: 2, binary: false },
      { path: "tests/feature.test.ts", addedLines: 30, deletedLines: 0, binary: false },
    ],
    isBaselineAncestor: () => true,
    isPathSymlink: () => false,
  });

  assert.deepEqual(result, {
    ok: true,
    stageId: "fixture-stage",
    baselineSha: "a".repeat(40),
    changedFiles: 2,
    addedLines: 50,
    deletedLines: 2,
    binaryFiles: 0,
  });
});

test("stage path gate treats Next.js dynamic route brackets as literal Git path characters", () => {
  const stage = stageContract();
  stage.allowedPaths.push("src/app/api/projects/*/route.ts");
  const result = verifyStagePaths({
    stage,
    changes: [{
      path: "src/app/api/projects/[projectId]/route.ts",
      addedLines: 4,
      deletedLines: 1,
      binary: false,
    }],
    isBaselineAncestor: () => true,
    isPathSymlink: () => false,
  });
  assert.equal(result.ok, true);
});

test("stage path gate fails closed on paths outside the allowlist and budget growth", () => {
  const stage = stageContract();
  assert.throws(() => verifyStagePaths({
    stage,
    changes: [{ path: "package.json", addedLines: 1, deletedLines: 0, binary: false }],
    isBaselineAncestor: () => true,
    isPathSymlink: () => false,
  }), /outside.*allowlist.*package\.json/i);

  assert.throws(() => verifyStagePaths({
    stage,
    changes: [{ path: "src/large.ts", addedLines: 101, deletedLines: 0, binary: false }],
    isBaselineAncestor: () => true,
    isPathSymlink: () => false,
  }), /maxAddedLines/i);
});

test("stage path gate protects archive originals unless the exact path is excepted", () => {
  const stage = stageContract();
  stage.allowedPaths.push("docs/archive/**");
  assert.throws(() => verifyStagePaths({
    stage,
    changes: [{ path: "docs/archive/history.md", addedLines: 1, deletedLines: 0, binary: false }],
    isBaselineAncestor: () => true,
    isPathSymlink: () => false,
  }), /protected.*docs\/archive\/history\.md/i);

  stage.protectedPathExceptions.push("docs/archive/rules.bak");
  assert.equal(verifyStagePaths({
    stage,
    changes: [{ path: "docs/archive/rules.bak", addedLines: 1, deletedLines: 0, binary: false }],
    isBaselineAncestor: () => true,
    isPathSymlink: () => false,
  }).ok, true);
});

test("stage path gate rejects symlinks and a baseline that is not an ancestor", () => {
  const stage = stageContract();
  assert.throws(() => verifyStagePaths({
    stage,
    changes: [{ path: "src/link.ts", addedLines: 1, deletedLines: 0, binary: false }],
    isBaselineAncestor: () => true,
    isPathSymlink: (file) => file === "src/link.ts",
  }), /symbolic link.*src\/link\.ts/i);

  assert.throws(() => verifyStagePaths({
    stage,
    changes: [],
    isBaselineAncestor: () => false,
    isPathSymlink: () => false,
  }), /baseline.*ancestor/i);
});

test("stage path gate rejects production changes when there is no active stage", () => {
  assert.throws(() => verifyStagePaths({
    stage: null,
    changes: [{ path: "src/feature.ts", addedLines: 1, deletedLines: 0, binary: false }],
    isBaselineAncestor: () => true,
    isPathSymlink: () => false,
  }), /active stage.*src\/feature\.ts/i);
});

function stageContract() {
  return {
    schemaVersion: "shanhai-active-stage.v1",
    stageId: "fixture-stage",
    status: "active",
    baselineSha: "a".repeat(40),
    plan: "docs/stages/fixture-plan.md",
    testPlan: "docs/stages/fixture-test-plan.md",
    allowedPaths: ["src/**", "tests/**"],
    protectedPathExceptions: [],
    budgets: {
      maxChangedFiles: 3,
      maxAddedLines: 100,
      maxDeletedLines: 50,
      maxBinaryFiles: 0,
    },
    providerContinuity: {
      requirement: "required",
      reason: "fixture",
      expiresOn: "2026-07-18",
    },
  };
}
