import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  analyzeSourceStringContracts,
  evaluateSourceStringContracts,
} from "../../scripts/development-gates/source-contracts.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const scriptPath = path.join(projectRoot, "scripts", "development-gates", "source-contracts.mjs");

function policy(overrides = {}) {
  return {
    roots: ["tests"],
    excludedPaths: ["tests/fixtures/**", "tests/support/**"],
    implementationMarkers: ["src", "scripts", "config", "package.json"],
    baseline: [],
    ...overrides,
  };
}

const suspiciousSource = `
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const implementationPath = path.join(process.cwd(), "src", "feature.ts");
const source = readFileSync(implementationPath, "utf8");
expect(source).toContain("internalFunction");
expect(source).not.toMatch(/privateBranch/);
expect(source.includes("hiddenFlag")).toBe(true);
assert.match(source, /implementation detail/);
`;

test("finds implementation-text string assertions and reports exact per-file occurrences", () => {
  const actual = analyzeSourceStringContracts(
    [
      { path: "tests/source-contract.test.ts", content: suspiciousSource },
      {
        path: "tests/public-behavior.test.ts",
        content: `expect(await callPublicApi()).toEqual({ ok: true });`,
      },
      {
        path: "tests/fixtures/ignored.test.ts",
        content: suspiciousSource,
      },
    ],
    policy(),
  );

  assert.deepEqual(actual, [
    { path: "tests/source-contract.test.ts", occurrences: 4 },
  ]);
});

test("recognizes direct filesystem reads and package/config implementation paths", () => {
  const actual = analyzeSourceStringContracts(
    [
      {
        path: "tests/config-contract.test.mjs",
        content: `
          import fs from "node:fs";
          const text = fs.readFileSync("config/development-gates.json", "utf8");
          expect(text).toMatch(/schemaVersion/);
        `,
      },
      {
        path: "tests/package-contract.test.mjs",
        content: `
          import { promises as fs } from "node:fs";
          const text = await fs.readFile("package.json", "utf8");
          assert.ok(text.includes("scripts"));
        `,
      },
    ],
    policy(),
  );

  assert.deepEqual(actual, [
    { path: "tests/config-contract.test.mjs", occurrences: 1 },
    { path: "tests/package-contract.test.mjs", occurrences: 1 },
  ]);
});

test("does not flag assertions over data parsed through a structured JSON or YAML API", () => {
  const actual = analyzeSourceStringContracts(
    [
      {
        path: "tests/package-structure.test.mjs",
        content: `
          const pkg = JSON.parse(readFileSync("package.json", "utf8"));
          assert.equal(pkg.scripts.test, "node scripts/run-tests.mjs");
        `,
      },
      {
        path: "tests/workflow-structure.test.mjs",
        content: `
          const workflow = YAML.parse(readFileSync("config/workflow.yml", "utf8"));
          assert.deepEqual(workflow.jobs.build.steps, [{ run: "npm test" }]);
        `,
      },
    ],
    policy(),
  );

  assert.deepEqual(actual, []);
});

test("resolves shadowed variables by lexical scope instead of file-wide name", () => {
  const actual = analyzeSourceStringContracts(
    [{
      path: "tests/lexical-scope-contract.test.ts",
      content: `
        const source = readFileSync("src/feature.ts", "utf8");
        {
          const source = "teacher-facing";
          expect(source).toBe("teacher-facing");
        }
      `,
    }],
    policy(),
  );

  assert.deepEqual(actual, []);
});

test("does not treat an object property name as a tainted variable reference", () => {
  const actual = analyzeSourceStringContracts(
    [{
      path: "tests/property-name-contract.test.ts",
      content: `
        const source = readFileSync("src/feature.ts", "utf8");
        const view = { source: "teacher-facing" };
        expect(view.source).toBe("teacher-facing");
      `,
    }],
    policy(),
  );

  assert.deepEqual(actual, []);
});

test("does not treat getter or JSX attribute names as tainted variable references", () => {
  const actual = analyzeSourceStringContracts(
    [
      {
        path: "tests/named-member-contract.test.ts",
        content: `
          const source = readFileSync("src/feature.ts", "utf8");
          const view = { get source() { return "teacher-facing"; } };
          expect(view.source).toBe("teacher-facing");
        `,
      },
      {
        path: "tests/jsx-attribute-contract.test.tsx",
        content: `
          const source = readFileSync("src/feature.ts", "utf8");
          expect(<Widget source="teacher-facing" />).toBe(true);
          expect(<Widget source:label="teacher-facing" />).toBe(true);
        `,
      },
    ],
    policy(),
  );

  assert.deepEqual(actual, []);
});

test("resolves var declarations in the nearest function scope", () => {
  const actual = analyzeSourceStringContracts(
    [{
      path: "tests/var-scope-contract.test.ts",
      content: `
        var source = "teacher-facing";
        if (flag) {
          var source = readFileSync("src/feature.ts", "utf8");
        }
        expect(source).toContain("internalFunction");
      `,
    }],
    policy(),
  );

  assert.deepEqual(actual, [
    { path: "tests/var-scope-contract.test.ts", occurrences: 1 },
  ]);
});

test("recognizes implementation markers in template literal paths", () => {
  const actual = analyzeSourceStringContracts(
    [{
      path: "tests/template-path-contract.test.ts",
      content: [
        'const fileName = "feature.ts";',
        'const source = readFileSync(`src/${fileName}`, "utf8");',
        'expect(source).toContain("internalFunction");',
      ].join("\n"),
    }],
    policy(),
  );

  assert.deepEqual(actual, [
    { path: "tests/template-path-contract.test.ts", occurrences: 1 },
  ]);
});

test("unwraps TypeScript expressions before deciding whether structured data was parsed", () => {
  const actual = analyzeSourceStringContracts(
    [{
      path: "tests/typescript-wrapper-contract.test.ts",
      content: `
        const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: object };
        assert.deepEqual(packageJson.scripts, {});
      `,
    }],
    policy(),
  );

  assert.deepEqual(actual, []);
});

test("does not crash on a new expression without an argument list", () => {
  const actual = analyzeSourceStringContracts(
    [{
      path: "tests/new-expression-contract.test.ts",
      content: `expect(new PublicValue).toBe(true);`,
    }],
    policy(),
  );

  assert.deepEqual(actual, []);
});

test("does not use a later source assignment to classify an earlier assertion", () => {
  const actual = analyzeSourceStringContracts(
    [{
      path: "tests/assignment-order-contract.test.ts",
      content: `
        let source = "teacher-facing";
        expect(source).toBe("teacher-facing");
        source = readFileSync("src/feature.ts", "utf8");
      `,
    }],
    policy(),
  );

  assert.deepEqual(actual, []);
});

test("fails closed for added, increased, or decreased unratcheted debt", () => {
  const files = [{ path: "tests/source-contract.test.ts", content: suspiciousSource }];

  const exact = evaluateSourceStringContracts(
    files,
    policy({
      baseline: [{ path: "tests/source-contract.test.ts", occurrences: 4 }],
    }),
  );
  assert.equal(exact.ok, true);
  assert.deepEqual(exact.errors, []);

  const added = evaluateSourceStringContracts(files, policy());
  assert.equal(added.ok, false);
  assert.match(added.errors.join("\n"), /new source-string contract debt/i);

  const increased = evaluateSourceStringContracts(
    files,
    policy({
      baseline: [{ path: "tests/source-contract.test.ts", occurrences: 3 }],
    }),
  );
  assert.equal(increased.ok, false);
  assert.match(increased.errors.join("\n"), /changed from 3 to 4/i);

  const decreased = evaluateSourceStringContracts(
    files,
    policy({
      baseline: [{ path: "tests/source-contract.test.ts", occurrences: 5 }],
    }),
  );
  assert.equal(decreased.ok, false);
  assert.match(decreased.errors.join("\n"), /changed from 5 to 4/i);

  const removedWithoutRatchet = evaluateSourceStringContracts(
    [],
    policy({
      baseline: [{ path: "tests/old-source-contract.test.ts", occurrences: 1 }],
    }),
  );
  assert.equal(removedWithoutRatchet.ok, false);
  assert.match(removedWithoutRatchet.errors.join("\n"), /no longer exists in actual debt/i);
});

test("rejects incomplete or internally invalid policy instead of silently passing", () => {
  assert.throws(
    () => analyzeSourceStringContracts([], { roots: ["tests"] }),
    /sourceStringContracts policy/i,
  );
  assert.throws(
    () =>
      analyzeSourceStringContracts(
        [],
        policy({ baseline: [{ path: "tests/a.test.ts", occurrences: 0 }] }),
      ),
    /positive integer/i,
  );
});

test("--report-json reports actual debt without rewriting policy", () => {
  const root = mkdtempSync(path.join(tmpdir(), "shanhai-source-contracts-"));
  try {
    mkdirSync(path.join(root, "config"), { recursive: true });
    mkdirSync(path.join(root, "tests"), { recursive: true });
    const policyPath = path.join(root, "config", "development-gates.json");
    const document = { sourceStringContracts: policy() };
    writeFileSync(policyPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    writeFileSync(path.join(root, "tests", "contract.test.ts"), suspiciousSource, "utf8");
    const before = readFileSync(policyPath, "utf8");

    const output = execFileSync(
      process.execPath,
      [scriptPath, "--repo-root", root, "--policy", policyPath, "--report-json"],
      { encoding: "utf8", windowsHide: true },
    );

    assert.deepEqual(JSON.parse(output), [
      { path: "tests/contract.test.ts", occurrences: 4 },
    ]);
    assert.equal(readFileSync(policyPath, "utf8"), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
