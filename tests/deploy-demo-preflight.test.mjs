import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = process.cwd();

test("deploy demo preflight exposes a production-like one-command readiness gate", () => {
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["preflight:deploy-demo"], "node scripts/deploy-demo-preflight.mjs");

  const scriptPath = path.join(root, "scripts", "deploy-demo-preflight.mjs");
  assert.equal(existsSync(scriptPath), true);
  const script = readFileSync(scriptPath, "utf8");

  assert.match(script, /preflight:production/);
  assert.match(script, /db:init/);
  assert.match(script, /build/);
  assert.match(script, /\.next.+standalone.+server\.js/s);
  assert.match(script, /deploy-demo-preflight-report\.json/);
  assert.match(script, /deploy-demo-preflight-report\.md/);
  assert.match(script, /mode:\s*"deploy-demo-readiness"/);
  assert.match(script, /dotenv\/config/);
  assert.match(script, /SHANHAI_DEPLOY_DEMO_PREFLIGHT_SKIP_DOTENV/);
  assert.match(script, /normalizeDatabaseUrlForStandalone/);
  assert.match(script, /bootstrap-admin\.mjs/);
  assert.match(script, /SHANHAI_BOOTSTRAP_ADMIN_CONFIRM:\s*"CREATE_ADMIN"/);
  assert.ok(script.indexOf('"db:init"') < script.indexOf("bootstrap-admin.mjs"));
  assert.ok(script.indexOf("bootstrap-admin.mjs") < script.indexOf('"preflight:production"'));
  assert.match(script, /SHANHAI_AUTH_MODE[\s\S]*local[\s\S]*200[\s\S]*401/);
  assert.match(script, /expectedStatus/);
  assert.doesNotMatch(script, /readFileSync\([^)]*\.env/);
  assert.doesNotMatch(script, /console\.log\(process\.env/);

  const localRunbook = readFileSync(path.join(root, "docs", "runbooks", "local-real-mvp-production-readiness.md"), "utf8");
  const liveRunbook = readFileSync(path.join(root, "docs", "runbooks", "live-deployment-demo-handoff.md"), "utf8");
  for (const runbook of [localRunbook, liveRunbook]) {
    assert.match(runbook, /password[^\n]*401/i);
    assert.match(runbook, /local[^\n]*200/i);
    assert.match(runbook, /SHANHAI_TRUST_PROXY=1/);
    assert.match(runbook, /覆盖[^\n]*(?:不能|不要|而非)追加/);
    assert.match(runbook, /SHANHAI_BOOTSTRAP_ADMIN_CONFIRM[^\n]*CREATE_ADMIN/);
  }
  const localGate = localRunbook.slice(localRunbook.indexOf("上线前检查命令"));
  const serverSteps = liveRunbook.slice(liveRunbook.indexOf("服务器部署顺序"));
  assert.ok(localGate.indexOf("bootstrap-admin.mjs") < localGate.indexOf("preflight:production"));
  assert.ok(serverSteps.indexOf("bootstrap-admin.mjs") < serverSteps.indexOf("preflight:production"));
});
