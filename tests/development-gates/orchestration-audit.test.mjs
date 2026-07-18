import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runDevelopmentGates } from "../../scripts/development-gates/run-development-gates.mjs";
import {
  EXPECTED_ORCHESTRATION_WRITE_OPERATIONS,
  evaluateOrchestrationAuditGate,
} from "../../scripts/development-gates/orchestration-audit.mjs";

const expectedOperations = [
  "POST /api/workbench/projects",
  "PATCH /api/workbench/projects/:projectId",
  "POST /api/workbench/projects/:projectId/agent-runs",
  "POST /api/workbench/projects/:projectId/agent-runs/:runId/finish",
  "POST /api/workbench/projects/:projectId/artifacts",
  "POST /api/workbench/projects/:projectId/artifacts/:artifactId/approve",
  "POST /api/workbench/projects/:projectId/artifacts/:artifactId/coze-ppt",
  "POST /api/workbench/projects/:projectId/artifacts/:artifactId/image",
  "POST /api/workbench/projects/:projectId/artifacts/:artifactId/ppt-full-deck-review",
  "POST /api/workbench/projects/:projectId/artifacts/:artifactId/ppt-sample-review",
  "POST /api/workbench/projects/:projectId/artifacts/:artifactId/regenerate",
  "POST /api/workbench/projects/:projectId/artifacts/:artifactId/video",
  "PATCH /api/workbench/projects/:projectId/generation-intensity",
  "POST /api/workbench/projects/:projectId/members",
  "DELETE /api/workbench/projects/:projectId/members/:userId",
  "PATCH /api/workbench/projects/:projectId/members/:userId",
  "POST /api/workbench/projects/:projectId/messages",
  "POST /api/workbench/projects/:projectId/messages/:messageId/reaction",
].sort();

test("accepts the exact registered write surface when every handler calls the shared actor wrapper", () => {
  assert.deepEqual([...EXPECTED_ORCHESTRATION_WRITE_OPERATIONS].sort(), expectedOperations);
  withFixtureRepo(expectedOperations, (root) => {
    const result = evaluateOrchestrationAuditGate({ root });
    assert.equal(result.ok, true, result.errors.join("\n"));
    assert.deepEqual(result.operations.map(operationKey).sort(), expectedOperations);
  });
});

test("fails closed when an unknown unsafe route is exported", () => {
  withFixtureRepo([...expectedOperations, "POST /api/workbench/projects/:projectId/bulk"], (root) => {
    const result = evaluateOrchestrationAuditGate({ root });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /unknown write operation.*bulk/i);
  });
});

test("fails closed when a registered operation is missing", () => {
  withFixtureRepo(expectedOperations.filter((operation) => operation !== "POST /api/workbench/projects"), (root) => {
    const result = evaluateOrchestrationAuditGate({ root });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /missing registered write operation.*POST \/api\/workbench\/projects/i);
  });
});

test("development runner reports orchestration audit as an independent check", async () => {
  const result = await runDevelopmentGates({
    runSubgate: async () => ({ ok: true }),
    verifyOrchestration: () => ({ ok: true, operations: expectedOperations, errors: [] }),
    detectImpact: () => ({ impacted: false, matchedPaths: [] }),
    verifyProvider: () => { throw new Error("must not run"); },
  });
  assert.deepEqual(result.checks.map((check) => check.id), [
    "policy",
    "stage-paths",
    "source-contracts",
    "complexity",
    "orchestration-audit",
  ]);
});

test("requires the exported handler to call the imported shared wrapper", () => {
  withFixtureRepo(expectedOperations, (root) => {
    writeRoute(root, "POST /api/workbench/projects/:projectId/members", {
      source: `
        import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
        export async function POST() { return new Response(null, { status: 204 }); }
      `,
    });
    const result = evaluateOrchestrationAuditGate({ root });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /POST .*\/members.*must return withLocalWorkbenchActor/i);
  });
});

test("does not accept a local function that only copies the wrapper name", () => {
  withFixtureRepo(expectedOperations, (root) => {
    writeRoute(root, "POST /api/workbench/projects/:projectId/members", {
      source: `
        function withLocalWorkbenchActor() { return new Response(null, { status: 204 }); }
        export async function POST() { return withLocalWorkbenchActor(); }
      `,
    });
    const result = evaluateOrchestrationAuditGate({ root });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /POST .*\/members.*must return withLocalWorkbenchActor/i);
  });
});

test("discovers non-TypeScript route handlers and rejects unknown writes", () => {
  withFixtureRepo(expectedOperations, (root) => {
    writeRoute(root, "POST /api/workbench/projects/:projectId/bulk", { extension: "js" });
    const result = evaluateOrchestrationAuditGate({ root });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /unknown write operation.*bulk/i);
  });
});

test("rejects a handler where only one branch uses the shared wrapper", () => {
  withFixtureRepo(expectedOperations, (root) => {
    writeRoute(root, "POST /api/workbench/projects/:projectId/members", {
      source: `
        import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
        export async function POST(request) {
          if (request.headers.get("x-bypass")) return new Response(null, { status: 204 });
          return withLocalWorkbenchActor(request, async () => new Response(null, { status: 204 }));
        }
      `,
    });
    const result = evaluateOrchestrationAuditGate({ root });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /must return withLocalWorkbenchActor as its outer handler boundary/i);
  });
});

test("recognizes an exported alias through the TypeScript AST", () => {
  withFixtureRepo(expectedOperations, (root) => {
    writeRoute(root, "PATCH /api/workbench/projects/:projectId", {
      source: `
        import { withLocalWorkbenchActor as withActor } from "@/server/auth/workbench-route";
        async function updateProject(request) {
          return withActor(request, async () => new Response(null, { status: 204 }));
        }
        export { updateProject as PATCH };
      `,
    });
    const result = evaluateOrchestrationAuditGate({ root });
    assert.equal(result.ok, true, result.errors.join("\n"));
  });
});

function withFixtureRepo(operations, run) {
  const root = mkdtempSync(path.join(tmpdir(), "shanhai-orchestration-audit-"));
  try {
    for (const operation of operations) writeRoute(root, operation);
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeRoute(root, operation, { source, extension = "ts" } = {}) {
  const [method, routeTemplate] = operation.split(" ");
  const relativeRoute = routeTemplate
    .replace(/^\/api\/workbench\/projects\/?/, "")
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.startsWith(":") ? `[${segment.slice(1)}]` : segment);
  const directory = path.join(root, "src", "app", "api", "workbench", "projects", ...relativeRoute);
  mkdirSync(directory, { recursive: true });
  const routePath = path.join(directory, `route.${extension}`);
  const content = source ?? `
    import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
    export async function ${method}(request) {
      return withLocalWorkbenchActor(request, async () => new Response(null, { status: 204 }));
    }
  `;
  writeFileSync(routePath, content, { encoding: "utf8", flag: source ? "w" : "a" });
}

function operationKey(operation) {
  return `${operation.method} ${operation.routeTemplate}`;
}
