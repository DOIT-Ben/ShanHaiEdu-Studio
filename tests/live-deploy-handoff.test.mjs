import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = process.cwd();

test("live deployment demo handoff documents real deployment readiness gates", () => {
  const runbookPath = path.join(root, "docs", "runbooks", "live-deployment-demo-handoff.md");
  assert.equal(existsSync(runbookPath), true);

  const runbook = readFileSync(runbookPath, "utf8");
  assert.match(runbook, /Live Target/);
  assert.match(runbook, /npm run preflight:deploy-demo/);
  assert.match(runbook, /npm run demo:e2e:delivery/);
  assert.match(runbook, /nginx|reverse proxy/i);
  assert.match(runbook, /HTTPS/);
  assert.match(runbook, /Provider Smoke/);
  assert.match(runbook, /public URL|PUBLIC_HOST/);
  assert.match(runbook, /回滚/);
  assert.match(runbook, /deploy-demo-readiness.*不等于公网 live/s);
});
