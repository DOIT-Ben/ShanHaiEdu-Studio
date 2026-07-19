import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  analyzeComplexityDebt,
  evaluateComplexityDebt,
} from "../../scripts/development-gates/complexity.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const scriptPath = path.join(projectRoot, "scripts", "development-gates", "complexity.mjs");

function policy(overrides = {}) {
  return {
    roots: ["src"],
    excludedPaths: ["src/generated/**", "**/__tests__/**", "**/fixtures/**"],
    maxFileLines: 500,
    maxFunctionLines: 150,
    baseline: [],
    ...overrides,
  };
}

function fileWithLines(count) {
  return Array.from({ length: count }, (_, index) => `const line${index} = ${index};`).join("\n");
}

function functionWithLines(name, count) {
  assert.ok(count >= 2);
  return [
    `function ${name}() {`,
    ...Array.from({ length: count - 2 }, (_, index) => `  const value${index} = ${index};`),
    "}",
  ].join("\n");
}

test("reports exact file and function debt using TypeScript syntax ranges", () => {
  const twoLongFunctions = `${functionWithLines("first", 151)}\n\n${functionWithLines("second", 153)}`;
  const actual = analyzeComplexityDebt(
    [
      { path: "src/large-file.ts", content: fileWithLines(501) },
      { path: "src/long-functions.ts", content: twoLongFunctions },
      { path: "src/healthy.ts", content: functionWithLines("healthy", 150) },
    ],
    policy(),
  );

  assert.deepEqual(actual, [
    {
      path: "src/large-file.ts",
      lines: 501,
      violatingFunctions: 0,
      maxFunctionLines: 0,
      totalFunctionLines: 0,
    },
    {
      path: "src/long-functions.ts",
      lines: 305,
      violatingFunctions: 2,
      maxFunctionLines: 153,
      totalFunctionLines: 304,
    },
  ]);
});

test("counts nested functions independently and ignores configured generated/test fixtures", () => {
  const nested = [
    "function outer() {",
    ...Array.from({ length: 149 }, (_, index) => `  const outer${index} = ${index};`),
    ...functionWithLines("inner", 151).split("\n").map((line) => `  ${line}`),
    "}",
  ].join("\n");
  const actual = analyzeComplexityDebt(
    [
      { path: "src/nested.ts", content: nested },
      { path: "src/generated/client.ts", content: fileWithLines(700) },
      { path: "src/domain/__tests__/large.test.ts", content: fileWithLines(700) },
      { path: "src/domain/fixtures/large.ts", content: fileWithLines(700) },
    ],
    policy(),
  );

  assert.deepEqual(actual, [
    {
      path: "src/nested.ts",
      lines: 302,
      violatingFunctions: 2,
      maxFunctionLines: 302,
      totalFunctionLines: 453,
    },
  ]);
});

test("fails closed for new, grown, or reduced unratcheted complexity debt", () => {
  const files = [{ path: "src/large-file.ts", content: fileWithLines(501) }];
  const baseline = {
    path: "src/large-file.ts",
    lines: 501,
    violatingFunctions: 0,
    maxFunctionLines: 0,
    totalFunctionLines: 0,
  };

  assert.equal(evaluateComplexityDebt(files, policy({ baseline: [baseline] })).ok, true);

  const added = evaluateComplexityDebt(files, policy());
  assert.equal(added.ok, false);
  assert.match(added.errors.join("\n"), /new complexity debt/i);

  const grown = evaluateComplexityDebt(
    [{ path: "src/large-file.ts", content: fileWithLines(502) }],
    policy({ baseline: [baseline] }),
  );
  assert.equal(grown.ok, false);
  assert.match(grown.errors.join("\n"), /lines changed from 501 to 502/i);

  const reduced = evaluateComplexityDebt(
    [{ path: "src/large-file.ts", content: fileWithLines(500) }],
    policy({ baseline: [baseline] }),
  );
  assert.equal(reduced.ok, false);
  assert.match(reduced.errors.join("\n"), /no longer exists in actual debt/i);

  const reducedStillOverLimit = evaluateComplexityDebt(
    [{ path: "src/large-file.ts", content: fileWithLines(501) }],
    policy({ baseline: [{ ...baseline, lines: 502 }] }),
  );
  assert.equal(reducedStillOverLimit.ok, false);
  assert.match(reducedStillOverLimit.errors.join("\n"), /lines changed from 502 to 501/i);

  const explicitlyRatcheted = evaluateComplexityDebt(
    [{ path: "src/large-file.ts", content: fileWithLines(501) }],
    policy({ baseline: [baseline] }),
  );
  assert.equal(explicitlyRatcheted.ok, true);

  const reintroduced = evaluateComplexityDebt(
    [{ path: "src/large-file.ts", content: fileWithLines(502) }],
    policy({ baseline: [baseline] }),
  );
  assert.equal(reintroduced.ok, false);
  assert.match(reintroduced.errors.join("\n"), /lines changed from 501 to 502/i);
});

test("rejects missing, duplicate, or inconsistent complexity policy", () => {
  assert.throws(() => analyzeComplexityDebt([], { roots: ["src"] }), /complexity policy/i);
  assert.throws(
    () =>
      analyzeComplexityDebt(
        [],
        policy({
          baseline: [
            {
              path: "src/a.ts",
              lines: 501,
              violatingFunctions: 1,
              maxFunctionLines: 0,
              totalFunctionLines: 0,
            },
          ],
        }),
      ),
    /inconsistent function statistics/i,
  );
});

test("--report-json reports actual debt and never ratchets the policy automatically", () => {
  const root = mkdtempSync(path.join(tmpdir(), "shanhai-complexity-"));
  try {
    mkdirSync(path.join(root, "config"), { recursive: true });
    mkdirSync(path.join(root, "src"), { recursive: true });
    const policyPath = path.join(root, "config", "development-gates.json");
    const document = {
      complexity: policy({ maxFileLines: 5, maxFunctionLines: 4 }),
    };
    writeFileSync(policyPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    writeFileSync(path.join(root, "src", "large.ts"), fileWithLines(6), "utf8");
    const before = readFileSync(policyPath, "utf8");

    const output = execFileSync(
      process.execPath,
      [scriptPath, "--repo-root", root, "--policy", policyPath, "--report-json"],
      { encoding: "utf8", windowsHide: true },
    );

    assert.deepEqual(JSON.parse(output), [
      {
        path: "src/large.ts",
        lines: 6,
        violatingFunctions: 0,
        maxFunctionLines: 0,
        totalFunctionLines: 0,
      },
    ]);
    assert.equal(readFileSync(policyPath, "utf8"), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
